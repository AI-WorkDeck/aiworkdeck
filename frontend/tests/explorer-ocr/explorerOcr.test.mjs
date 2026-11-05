// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Explorer right-click OCR (tutorial-series#155): targets, naming, batch queue, consent, cancel,
// failure summary, clipboard text and side-by-side proofreading.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isOcrTarget, canOcrItems, ocrOutputName, runOcrBatch, summarizeOcrBatch,
  joinCopiedTexts, sideBySidePlan, openOcrSideBySide,
} from '../../src/utils/explorerOcr.js'

const f = (id, name, extra = {}) => ({ id, name, fileType: name.includes('.') ? name.split('.').pop() : '', ...extra })

test('targets are PDFs and the images the backend OCR accepts', () => {
  for (const n of ['a.pdf', 'b.PNG', 'c.jpg', 'd.jpeg', 'e.webp', 'f.bmp', 'g.gif']) assert.ok(isOcrTarget(f(1, n)), n)
  for (const n of ['a.docx', 'b.heic', 'c.tif', 'd.txt', 'noext']) assert.ok(!isOcrTarget(f(1, n)), n)
  assert.ok(!isOcrTarget({ id: 1, name: 'x.pdf', isFolder: true }))
  assert.ok(canOcrItems([f(1, 'a.pdf'), f(2, 'b.png')]))
  assert.ok(!canOcrItems([f(1, 'a.pdf'), f(2, 'b.docx')]), 'mixed selection hides the entry')
  assert.ok(!canOcrItems([f(1, 'a.pdf')], 'recycle'))
  assert.ok(!canOcrItems([]))
})

test('output name keeps the full stem and appends the localized suffix', () => {
  assert.equal(ocrOutputName('合同.final.pdf', '.txt', '-识别文字'), '合同.final-识别文字.txt')
  assert.equal(ocrOutputName('scan', '.docx', '-识别文字'), 'scan-识别文字.docx')
  assert.equal(ocrOutputName('  a/b\\c.png ', '.txt', '-OCR text'), 'a_b_c-OCR text.txt')
  assert.equal(ocrOutputName('', '.txt', '-x'), 'file-x.txt')
})

function fakeServer(script) {
  const calls = []
  const recognize = async (item, opts) => {
    calls.push({ id: item.id, ...opts })
    const r = script(item, opts, calls.length)
    if (r instanceof Error) throw r
    return r
  }
  return { calls, recognize }
}

test('batch runs sequentially, reports progress, and one failure does not stop the rest', async () => {
  const progress = []
  const { calls, recognize } = fakeServer(item => item.id === 2 ? new Error('余额不足') : { status: 'done', text: 't' + item.id })
  const batch = await runOcrBatch({ items: [f(1, 'a.png'), f(2, 'b.png'), f(3, 'c.pdf')], recognize, onProgress: p => progress.push([p.index, p.total, p.item.id]) })
  assert.deepEqual(calls.map(c => c.id), [1, 2, 3])
  assert.deepEqual(progress, [[0, 3, 1], [1, 3, 2], [2, 3, 3]])
  const s = summarizeOcrBatch(batch)
  assert.equal(s.done.length, 2)
  assert.deepEqual(s.failed.map(x => [x.name, x.error]), [['b.png', '余额不足']])
  assert.equal(batch.cancelled, false)
})

test('consent is asked once per batch and the version is reused for later files', async () => {
  let asked = 0
  const { calls, recognize } = fakeServer((item, opts) => opts.consentVersion === 'v1'
    ? { status: 'done', text: 'x' } : { status: 'consent_required', notice: 'N', version: 'v1' })
  const batch = await runOcrBatch({ items: [f(1, 'a.png'), f(2, 'b.png')], recognize, requestConsent: async ({ notice }) => { asked++; assert.equal(notice, 'N'); return true } })
  assert.equal(asked, 1)
  assert.deepEqual(calls.map(c => [c.id, c.consentVersion || null]), [[1, null], [1, 'v1'], [2, 'v1']])
  assert.equal(summarizeOcrBatch(batch).done.length, 2)
})

test('declined consent skips scanned files but text-layer PDFs still finish for free', async () => {
  let asked = 0
  const { recognize } = fakeServer(item => item.name.endsWith('.pdf') ? { status: 'done', text: 'layer' } : { status: 'consent_required', notice: 'N', version: 'v1' })
  const batch = await runOcrBatch({ items: [f(1, 'a.png'), f(2, 'b.pdf'), f(3, 'c.jpg')], recognize, requestConsent: async () => { asked++; return false } })
  assert.equal(asked, 1, 'a declined batch is not asked again')
  const s = summarizeOcrBatch(batch)
  assert.deepEqual(s.done.map(x => x.item.id), [2])
  assert.deepEqual(s.skipped.map(x => x.item.id), [1, 3])
})

test('cancel stops before the next file and marks the rest as not run', async () => {
  let cancel = false
  const { calls, recognize } = fakeServer(() => { cancel = true; return { status: 'done', text: 'x' } })
  const batch = await runOcrBatch({ items: [f(1, 'a.png'), f(2, 'b.png'), f(3, 'c.png')], recognize, isCancelled: () => cancel })
  assert.equal(calls.length, 1)
  assert.equal(batch.cancelled, true)
  assert.deepEqual(summarizeOcrBatch(batch).notRun.map(x => x.item.id), [2, 3])
})

test('a server-side cancelled status (cancel arrived mid-file) also ends the batch', async () => {
  const { calls, recognize } = fakeServer(() => ({ status: 'cancelled' }))
  const batch = await runOcrBatch({ items: [f(1, 'a.pdf'), f(2, 'b.pdf')], recognize })
  assert.equal(calls.length, 1)
  assert.equal(batch.cancelled, true)
  assert.equal(summarizeOcrBatch(batch).notRun.length, 2)
})

test('local-only preference fails that file with a reason; fatal config errors stop the batch', async () => {
  const local = await runOcrBatch({ items: [f(1, 'a.png')], recognize: fakeServer(() => ({ status: 'local_only' })).recognize })
  assert.equal(summarizeOcrBatch(local).failed[0].reason, 'localOnly')
  const notConfigured = Object.assign(new Error('OCR 未配置'), { featureNotConfigured: true })
  const { calls, recognize } = fakeServer(() => notConfigured)
  const batch = await runOcrBatch({ items: [f(1, 'a.png'), f(2, 'b.png')], recognize, isFatal: e => !!e.featureNotConfigured })
  assert.equal(calls.length, 1)
  assert.equal(batch.fatal, notConfigured)
  assert.equal(summarizeOcrBatch(batch).notRun.length, 1)
})

test('same-stem files ask for the same name; the summary shows the names the server actually created', async () => {
  const taken = new Set()
  const { calls, recognize } = fakeServer((item, opts) => {
    let name = opts.name, n = 0
    while (taken.has(name)) name = opts.name.replace(/(\.[^.]+)$/, ` (${++n})$1`)
    taken.add(name)
    return { status: 'done', file: { id: 100 + item.id, name } }
  })
  const batch = await runOcrBatch({ items: [f(1, 'a.pdf'), f(2, 'a.png')], recognize, nameFor: item => ocrOutputName(item.name, '.txt', '-识别文字') })
  assert.deepEqual(calls.map(c => c.name), ['a-识别文字.txt', 'a-识别文字.txt'])
  assert.deepEqual(summarizeOcrBatch(batch).done.map(x => x.file.name), ['a-识别文字.txt', 'a-识别文字 (1).txt'])
})

test('clipboard text: single file is plain, several files get name headers, empty results are left out', () => {
  const r = (name, text) => ({ status: 'done', item: f(1, name), text })
  assert.equal(joinCopiedTexts([r('a.png', ' 甲 ')]), '甲')
  assert.equal(joinCopiedTexts([r('a.png', '甲'), r('b.pdf', ''), r('c.pdf', '乙')]), '【a.png】\n甲\n\n【c.pdf】\n乙')
})

test('side-by-side plan opens only the first Word; the rest are listed', () => {
  const done = id => ({ status: 'done', item: f(id, `s${id}.pdf`), file: { id: 100 + id, name: `s${id}-识别文字.docx` } })
  const plan = sideBySidePlan({ results: [{ status: 'failed', item: f(9, 'x.pdf') }, done(1), done(2), done(3)] })
  assert.equal(plan.first.source.id, 1)
  assert.equal(plan.first.output.id, 101)
  assert.deepEqual(plan.others, ['s2-识别文字.docx', 's3-识别文字.docx'])
  assert.equal(sideBySidePlan({ results: [] }).first, null)
})

function fakeVm({ left = [], right = [], splitMode = false } = {}) {
  const vm = {
    leftFiles: left, rightFiles: right, splitMode, focusedPane: 'left', opened: [],
    openFile(file) { this.opened.push([this.focusedPane, file.id]); const list = this.focusedPane === 'left' ? this.leftFiles : this.rightFiles; if (!this.leftFiles.concat(this.rightFiles).some(t => t.id === file.id)) list.push({ ...file }); if (this.focusedPane === 'right') this.splitMode = true },
    moveTabTo(id, from, to) { const src = from === 'left' ? this.leftFiles : this.rightFiles; const i = src.findIndex(t => t.id === id); const [t] = src.splice(i, 1); (to === 'left' ? this.leftFiles : this.rightFiles).push(t) },
  }
  return vm
}

test('side-by-side: original on the left, Word on the right, split turned on', async () => {
  const vm = fakeVm()
  await openOcrSideBySide(vm, f(1, 's.pdf'), { id: 101, name: 's-识别文字.docx', fileType: 'docx' })
  assert.equal(vm.splitMode, true)
  assert.deepEqual(vm.opened, [['left', 1], ['right', 101]])
  assert.deepEqual(vm.leftFiles.map(t => t.id), [1])
  assert.deepEqual(vm.rightFiles.map(t => t.id), [101])
})

test('side-by-side: an original already open on the right is moved left first', async () => {
  const vm = fakeVm({ left: [{ id: 5 }], right: [{ id: 1 }], splitMode: true })
  await openOcrSideBySide(vm, f(1, 's.pdf'), { id: 101, name: 's-识别文字.docx' })
  assert.deepEqual(vm.leftFiles.map(t => t.id), [5, 1])
  assert.deepEqual(vm.rightFiles.map(t => t.id), [101])
})
