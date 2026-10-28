// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeCommand, documentIdentity, detectHost, hostFamily } from './hostBridge.js'

// Real bridge, file operations and identity logic; only native globals are replaced.
function fixture(host, options = {}) {
  const keys = ['Office', 'Word', 'Excel', 'PowerPoint', 'wps', 'Application', 'window', 'crypto']
  const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of keys) delete globalThis[key]
  const active = { word: 'ActiveDocument', excel: 'ActiveWorkbook', powerpoint: 'ActivePresentation' }[host]
  const collectionName = { word: 'Documents', excel: 'Workbooks', powerpoint: 'Presentations' }[host]
  const extension = { word: 'docx', excel: 'xlsx', powerpoint: 'pptx' }[host]
  const calls = { random: 0, writes: [], reads: [], removes: [], opens: [], creates: 0, saves: 0 }
  const files = new Map()
  const model = { [active]: { Name: 'source.' + extension, FullName: '/synthetic/source.' + extension } }
  const source = model[active]
  const switchDocument = name => { model[active] = { Name: name, FullName: '' } }
  model[collectionName] = {
    Open(path) { calls.opens.push(path); model[active] = { Name: path.split('/').at(-1), FullName: path } },
    Add() { calls.creates++; switchDocument('Untitled QA ' + calls.creates) }
  }
  source.Save = () => { calls.saves++; throw new Error('native save outcome uncertain') }
  const services = {
    FileSystem: {
      Exists: path => options.collision === true || files.has(path),
      writeAsBinaryString(path, bytes) { calls.writes.push(path); files.set(path, bytes) },
      readAsBinaryString(path) { calls.reads.push(path); if (options.switchOnRead) switchDocument('Other unsaved QA'); return files.get(path) },
      Remove(path) { calls.removes.push(path); files.delete(path) }
    },
    Env: { GetTempPath: () => '/synthetic-temp' }
  }
  // Factories return the document model, which deliberately has no FileSystem/Env.
  globalThis.wps = { WpsApplication: () => model, EtApplication: () => model, WppApplication: () => model }
  if (options.aliasOnly) Object.assign(globalThis.wps, services)
  else globalThis.Application = services
  globalThis.window = { Application: globalThis.Application }
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues(bytes) { calls.random++; for (let i = 0; i < bytes.length; i++) bytes[i] = i + 1; return bytes }
  } })
  return { calls, files, source, model, extension, switchDocument,
    restore() { for (const key of keys) { delete globalThis[key]; const descriptor = descriptors.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor) } }
  }
}
const bytes = 'PK\x03\x04synthetic native file bytes'
for (const host of ['word', 'excel', 'powerpoint']) {
  test(`WPS ${host}: bridge opens verified bytes using root services and getRandomValues fallback`, async () => {
    const f = fixture(host)
    try {
      assert.equal(hostFamily(), 'wps'); assert.equal(detectHost(), host)
      const sourceIdentity = documentIdentity()
      assert.equal(f.model.FileSystem, undefined); assert.equal(globalThis.crypto.randomUUID, undefined)
      const result = await executeCommand('file_open', { host, base64: btoa(bytes), expectedDocumentKey: sourceIdentity.key })
      assert.equal(result.ok, true, result.error)
      assert.equal(result.data.openedAs, 'copy'); assert.equal(result.data.requiresSessionRebind, true)
      assert.equal(result.data.temporary, true); assert.equal(result.data.requiresSaveAs, true)
      assert.deepEqual(result.data.sourceIdentity, sourceIdentity)
      assert.match(result.data.temporaryPath, new RegExp('/aiworkdeck-[0-9a-f]{32}\\.' + f.extension + '$'))
      assert.deepEqual(f.calls.opens, [result.data.temporaryPath]); assert.equal(f.calls.random, 1)
      assert.equal(f.files.get(result.data.temporaryPath), bytes); assert.equal(f.calls.removes.length, 0)
      assert.notEqual(documentIdentity().key, sourceIdentity.key)
      assert.equal(f.source.FullName, '/synthetic/source.' + f.extension)
    } finally { f.restore() }
  })
  test(`WPS ${host}: actual bridge returns source identity and rebind after native blank creation`, async () => {
    const f = fixture(host)
    try {
      const before = documentIdentity(), result = await executeCommand('file_create', { expectedDocumentKey: before.key })
      assert.equal(result.ok, true, result.error); assert.equal(result.data.created, true)
      assert.equal(result.data.requiresSessionRebind, true); assert.deepEqual(result.data.sourceIdentity, before)
      assert.equal(documentIdentity().saved, false); assert.notEqual(documentIdentity().key, before.key)
      assert.equal(f.calls.creates, 1); assert.equal(f.calls.writes.length, 0)
    } finally { f.restore() }
  })
}
test('WPS alias root services work when global Application is absent', async () => {
  const f = fixture('excel', { aliasOnly: true })
  try { const result = await executeCommand('file_open', { base64: btoa(bytes) }); assert.equal(result.ok, true, result.error); assert.equal(f.calls.opens.length, 1) }
  finally { f.restore() }
})
test('stale session identity refuses before native reads, writes or document creation', async () => {
  const f = fixture('word')
  try {
    for (const command of ['file_open', 'file_create']) {
      const result = await executeCommand(command, { expectedDocumentKey: '/different-source', ...(command === 'file_open' ? { base64: btoa(bytes) } : {}) })
      assert.equal(result.ok, false)
    }
    assert.deepEqual(f.calls, { random: 0, writes: [], reads: [], removes: [], opens: [], creates: 0, saves: 0 })
  } finally { f.restore() }
})
test('identity switch during temporary-file verification prevents Open and removes only the temporary file', async () => {
  const f = fixture('powerpoint', { switchOnRead: true })
  try {
    const result = await executeCommand('file_open', { base64: btoa(bytes) })
    assert.equal(result.ok, false); assert.equal(f.calls.opens.length, 0)
    assert.equal(f.calls.writes.length, 1); assert.deepEqual(f.calls.removes, f.calls.writes)
    assert.equal(f.files.size, 0); assert.equal(f.source.FullName, '/synthetic/source.pptx')
  } finally { f.restore() }
})
test('native temporary-path collision refuses before any file write', async () => {
  const f = fixture('excel', { collision: true })
  try { const result = await executeCommand('file_open', { base64: btoa(bytes) }); assert.equal(result.ok, false); assert.equal(f.calls.writes.length, 0); assert.equal(f.calls.opens.length, 0) }
  finally { f.restore() }
})
test('native save uncertainty retains partial result through the real host bridge', async () => {
  const f = fixture('word')
  try {
    const before = documentIdentity(), result = await executeCommand('file_save', {})
    assert.equal(result.ok, false); assert.match(result.error, /native save outcome uncertain/)
    assert.equal(result.partialResult.operation, 'save'); assert.equal(result.partialResult.outcomeUnknown, true)
    assert.equal(result.partialResult.retryable, false); assert.deepEqual(result.partialResult.sourceIdentity, before)
    assert.equal(f.calls.saves, 1)
  } finally { f.restore() }
})
