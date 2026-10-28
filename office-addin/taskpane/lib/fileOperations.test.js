// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeFileOperation, FILE_MAX_BYTES } from './fileOperations.js'

function fixture(host = 'word') {
  let identity = { key: 'document-a', saved: true }, closed = 0, created = 0, uploaded = 0
  const bytes = new TextEncoder().encode('%PDF-1.7\nverified')
  const file = { size: bytes.length, sliceCount: 2,
    getSliceAsync(i, cb) { cb({ status: 'ok', value: { data: i ? bytes.slice(5) : bytes.slice(0, 5) } }) },
    closeAsync(cb) { closed++; cb() } }
  const env = { family: 'office', host, settings: {}, projectId: 3, readIdentity: () => identity,
    Office: { AsyncResultStatus: { Succeeded: 'ok' }, FileType: { Pdf: 'pdf' }, context: {
      platform: 'PC', requirements: { isSetSupported: () => true }, document: {
        getFileAsync(type, options, cb) { assert.equal(type, 'pdf'); cb({ status: 'ok', value: file }) }
      } } },
    createProjectFile: async () => { created++; return { id: 12, name: 'result.pdf' } },
    uploadFileBytes: async (settings, id, blob, size) => { uploaded++; assert.equal(id, 12); assert.equal(size, bytes.length); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes) }
  }
  return { env, file, bytes, switch: () => { identity = { key: 'document-b', saved: true } }, counts: () => ({ closed, created, uploaded }) }
}
test('PDF exports real bytes to project and releases all slices', async () => {
  const f = fixture(); const result = await executeFileOperation('file_export_pdf', { fileName: 'result' }, f.env)
  assert.equal(result.fileId, 12); assert.equal(result.destination, 'project'); assert.equal(result.sourceIdentity.key, 'document-a')
  assert.deepEqual(f.counts(), { closed: 1, created: 1, uploaded: 1 })
})
test('slice failure releases handle and never creates a project file', async () => {
  const f = fixture(); f.file.getSliceAsync = (i, cb) => cb({ status: 'failed', error: { message: 'slice failed' } })
  await assert.rejects(executeFileOperation('file_export_pdf', {}, f.env), /slice failed/)
  assert.deepEqual(f.counts(), { closed: 1, created: 0, uploaded: 0 })
})
test('oversized/malformed bytes are not uploaded', async () => {
  for (const size of [FILE_MAX_BYTES + 1, 2]) {
    const f = fixture(); f.file.size = size
    await assert.rejects(executeFileOperation('file_export_pdf', {}, f.env))
    assert.deepEqual(f.counts(), { closed: 1, created: 0, uploaded: 0 })
  }
})
test('switching document during export rejects before project creation', async () => {
  const f = fixture(); const original = f.file.getSliceAsync
  f.file.getSliceAsync = (i, cb) => { original(i, cb); f.switch() }
  await assert.rejects(executeFileOperation('file_export_pdf', {}, f.env))
  assert.equal(f.counts().created, 0); assert.equal(f.counts().closed, 1)
})
test('Word web PDF denied before reading; iPad uses 64KiB', async () => {
  const f = fixture(); f.env.Office.context.platform = 'OfficeOnline'
  await assert.rejects(executeFileOperation('file_export_pdf', {}, f.env)); assert.equal(f.counts().closed, 0)
  f.env.Office.context.platform = 'iPad'
  f.env.Office.context.document.getFileAsync = (type, options, cb) => { assert.equal(options.sliceSize, 65536); cb({ status: 'ok', value: f.file }) }
  await executeFileOperation('file_export_pdf', {}, f.env)
})
test('failed upload does not report success and preserves recovery fileId', async () => {
  const f = fixture(); f.env.uploadFileBytes = async () => { throw new Error('upload failed') }
  await assert.rejects(executeFileOperation('file_export_pdf', {}, f.env), e => e.partialResult.fileId === 12 && e.partialResult.uploaded === false && e.partialResult.exported === false)
})
test('create has host-only semantics and refuses cross-host and file inputs', async () => {
  const f = fixture('excel'); let calls = 0; f.env.Excel = { createWorkbook: async () => calls++ }
  const result = await executeFileOperation('file_create', {}, f.env)
  assert.equal(result.openedAs, 'new'); assert.equal(result.destination, 'host'); assert.equal(result.requiresSessionRebind, true)
  for (const args of [{ host: 'word' }, { base64: 'abc' }]) await assert.rejects(executeFileOperation('file_create', args, f.env))
  assert.equal(calls, 1)
})
test('Excel save version guard and rejection from save propagate', async () => {
  const f = fixture('excel'); let calls = 0
  f.env.Office.context.requirements.isSetSupported = (set, version) => { assert.equal(version, '1.11'); return false }
  f.env.Excel = { run: async fn => { calls++; await fn({ workbook: { save: () => {} }, sync: async () => {} }) } }
  await assert.rejects(executeFileOperation('file_save', {}, f.env)); assert.equal(calls, 0)
  f.env.Office.context.requirements.isSetSupported = () => true
  f.env.Excel.run = async () => { throw new Error('cancelled') }
  await assert.rejects(executeFileOperation('file_save', {}, f.env), /cancelled/)
})
test('Office PPT cannot falsely report original saved', async () => {
  await assert.rejects(executeFileOperation('file_save', {}, fixture('powerpoint').env))
})
test('unsaved Word prompts on first save and requires WordApi 1.5 before mutation', async () => {
  const f = fixture(); let calls = 0; const behaviors = []
  f.env.readIdentity = () => ({ key: 'unsaved-a', saved: false })
  f.env.Word = { run: async fn => { calls++; return fn({ document: { save: (...args) => behaviors.push(args) }, sync: async () => {} }) } }
  f.env.Office.context.requirements.isSetSupported = (set, version) => version === '1.1'
  await assert.rejects(executeFileOperation('file_save', {}, f.env))
  assert.equal(calls, 0)
  f.env.Office.context.requirements.isSetSupported = (set, version) => { assert.equal(version, '1.5'); return true }
  await executeFileOperation('file_save', {}, f.env)
  assert.deepEqual(behaviors, [['Prompt']])
})
test('Word first-save cancellation propagates without a success receipt', async () => {
  const f = fixture(); f.env.readIdentity = () => ({ key: 'unsaved-a', saved: false })
  f.env.Word = { run: async fn => fn({ document: { save: behavior => assert.equal(behavior, 'Prompt') }, sync: async () => { throw new Error('user cancelled Save As') } }) }
  await assert.rejects(executeFileOperation('file_save', {}, f.env), /user cancelled Save As/)
})
test('issued Word save failures preserve uncertainty even if the host assigns a path', async () => {
  for (const savedAfter of [false, true]) {
    const f = fixture(); let saved = false
    f.env.readIdentity = () => ({ key: saved ? 'saved-path' : 'unsaved-pane', saved })
    f.env.Word = { run: async fn => fn({ document: { save() {} }, sync: async () => { saved = savedAfter; throw new Error('GeneralException') } }) }
    await assert.rejects(executeFileOperation('file_save', {}, f.env), e => {
      assert.equal(e.message, 'GeneralException')
      assert.equal(e.partialResult.operation, 'save')
      assert.equal(e.partialResult.outcomeUnknown, true)
      assert.equal(e.partialResult.retryable, false)
      assert.equal(e.partialResult.sourceIdentity.key, 'unsaved-pane')
      assert.equal(e.partialResult.currentIdentity.saved, savedAfter)
      assert.equal(e.partialResult.saved, undefined)
      return true
    })
  }
})
test('save preflight failures do not claim a save was issued', async () => {
  const f = fixture(); f.env.readIdentity = () => ({ key: 'unsaved-pane', saved: false })
  f.env.Office.context.requirements.isSetSupported = () => false
  await assert.rejects(executeFileOperation('file_save', {}, f.env), e => !e.partialResult)
})
test('saved Word keeps the WordApi 1.1 default save behavior', async () => {
  const f = fixture(); const behaviors = []
  f.env.Office.context.requirements.isSetSupported = (set, version) => { assert.equal(version, '1.1'); return true }
  f.env.Word = { run: async fn => fn({ document: { save: (...args) => behaviors.push(args) }, sync: async () => {} }) }
  assert.equal((await executeFileOperation('file_save', {}, f.env)).saved, true)
  assert.deepEqual(behaviors, [[]])
})
test('WPS uses correct native PDF signatures and cleans temporary file', async () => {
  for (const host of ['word', 'excel', 'powerpoint']) {
    const f = fixture(host); let removed = '', exported = []
    f.env.family = 'wps'; f.env.application = {}
    f.env.nativeServices = { environment: { GetTempPath: () => '/tmp/' },
      fileSystem: { Exists: () => false, readAsBinaryString: () => String.fromCharCode(...f.bytes), Remove: path => { removed = path } } }
    f.env.application[host === 'word' ? 'ActiveDocument' : host === 'excel' ? 'ActiveWorkbook' : 'ActivePresentation'] = { ExportAsFixedFormat: (...args) => { exported = args } }
    await executeFileOperation('file_export_pdf', {}, f.env)
    assert.match(removed, /^\/tmp\/aiworkdeck-.*\.pdf$/)
    assert.equal(host === 'excel' ? exported[0] : exported[1], host === 'excel' ? 0 : host === 'word' ? 17 : 2)
  }
})
test('WPS cancellation or missing binary reader cannot claim success', async () => {
  const f = fixture(); f.env.family = 'wps'; let saves = 0
  f.env.application = { ActiveDocument: { Save: () => saves++, Saved: false, FullName: 'Untitled' } }
  await assert.rejects(executeFileOperation('file_save', {}, f.env)); assert.equal(saves, 1)
  await assert.rejects(executeFileOperation('file_export_pdf', {}, f.env)); assert.equal(f.counts().created, 0)
})
test('Word opens original path; Excel import explicitly returns copy', async () => {
  const f = fixture(); let path
  f.env.Word = { run: async fn => fn({ application: { openDocument: value => { path = value } }, sync: async () => {} }) }
  const result = await executeFileOperation('file_open', { path: '/tmp/source.docx' }, f.env)
  assert.equal(path, '/tmp/source.docx'); assert.equal(result.openedAs, 'original')
  f.env.host = 'excel'; let data; f.env.Excel = { createWorkbook: async value => { data = value } }
  const b64 = btoa('PK\x03\x04test')
  assert.equal((await executeFileOperation('file_open', { base64: b64 }, f.env)).openedAs, 'copy')
  assert.equal(data, b64)
  await assert.rejects(executeFileOperation('file_open', { base64: btoa('not zip') }, f.env))
})
test('Word base64 import creates a new copy, never opens an original path', async () => {
  const f = fixture(); const data = btoa('PK\x03\x04document'); let received, opened = 0
  f.env.Word = { run: async fn => fn({ application: { createDocument: value => { received = value; return { open: () => opened++ } } }, sync: async () => {} }) }
  assert.equal((await executeFileOperation('file_open', { base64: data }, f.env)).openedAs, 'copy')
  assert.equal(received, data); assert.equal(opened, 1)
})
test('WPS imported copy retains its verified temporary file while open; failure cleans it', async () => {
  for (const shouldFail of [false, true]) {
    const f = fixture('excel'); const binary = 'PK\x03\x04workbook'; let written, removed = 0
    f.env.family = 'wps'
    f.env.nativeServices = { environment: { GetTempPath: () => '/tmp' }, fileSystem: {
      Exists: () => false, writeAsBinaryString: (path, bytes) => { written = bytes }, readAsBinaryString: () => written, Remove: () => removed++
    } }
    f.env.application = { Workbooks: { Open: path => { assert.match(path, /\.xlsx$/); if (shouldFail) throw new Error('open failed') } } }
    const run = executeFileOperation('file_open', { base64: btoa(binary) }, f.env)
    if (shouldFail) { await assert.rejects(run, /open failed/); assert.equal(removed, 1) }
    else { const result = await run; assert.equal(result.temporary, true); assert.equal(result.requiresSaveAs, true); assert.equal(result.openedAs, 'copy'); assert.equal(removed, 0) }
    assert.equal(written, binary)
  }
})

test('PDF uses PdfFile requirement set even when File is unsupported', async () => {
  const f = fixture(); const checked = []
  f.env.Office.context.requirements.isSetSupported = (name, version) => { checked.push([name, version]); return name === 'PdfFile' }
  assert.equal((await executeFileOperation('file_export_pdf', {}, f.env)).exported, true)
  assert.deepEqual(checked, [['PdfFile', '1.1']])
})

test('WPS non-byte binary strings fail before creating or uploading a PDF', async () => {
  for (const suffix of ['\u0100', '\u20ac', '\ud83d\ude00']) {
    const f = fixture(); let removed = 0, uploads = 0
    f.env.family = 'wps'
    f.env.application = { ActiveDocument: { ExportAsFixedFormat() {} } }
    f.env.nativeServices = { environment: { GetTempPath: () => '/tmp' }, fileSystem: {
      Exists: () => false, readAsBinaryString: () => '%PDF-1.7\n' + suffix, Remove: () => removed++
    } }
    f.env.uploadFileBytes = async () => { uploads++ }
    await assert.rejects(executeFileOperation('file_export_pdf', {}, f.env))
    assert.equal(f.counts().created, 0)
    assert.equal(uploads, 0)
    assert.equal(removed, 1, 'invalid native bytes still release the temporary PDF')
  }
})
