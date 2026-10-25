// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const worker = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const exportMethod = worker.slice(worker.indexOf('  export_document(p) {'), worker.indexOf('  // 导出当前文档为 PDF 字节'))

for (const saveSnapshotId of [1, undefined, 0, '1']) {
  test(`worker acknowledges only a host save snapshot immediately before synchronous export: ${saveSnapshotId}`, () => {
    const events = []
    const deps = {
      IMPORT_FILTERS: {}, zetajs: { unoObject: (_types, object) => object }, css: { io: { XOutputStream: {} } },
      mkProp: (name, value) => ({ name, value }),
      xModel: { isModified: () => true, storeToURL(_url, props) {
        events.push('store')
        props.find(p => p.name === 'OutputStream').value.writeBytes(new Uint8Array([1, 2]))
      } },
      withInlineMarkupForExport: fn => fn(), repairMoveRangeBookmarks() {}, log() {},
      post: (cmd, payload) => events.push({ cmd, ...payload }),
    }
    const run = new Function(...Object.keys(deps), `let exportInFlight = false, saveSeq = 0; return {${exportMethod}}`)(...Object.values(deps)).export_document
    const result = run({ name: 'test.docx', saveSnapshotId })
    assert.deepEqual([...result.bytes], [1, 2])
    assert.deepEqual(events, saveSnapshotId === 1 ? [{ cmd: 'save-snapshot', saveSnapshotId: 1 }, 'store'] : ['store'])
  })
}

test('snapshot relay resets modify throttling so rapid edits after export are never dropped', () => {
  const source = readFileSync(new URL('../../src/zetaoffice/editor-main.js', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('function relayModified(d) {'), source.indexOf('// (自建工具栏) 光标/选区动了'))
  const messages = []
  const relay = new Function('hostTransport', 'Date', `let lastModifiedRelay = 0;
    const reviewBalloons = null, reviewHover = null, inlineReview = null;
    ${fn}; return relayModified`)( { send: msg => messages.push(msg) }, { now: () => 1000 })
  relay({ cmd: 'modified' })
  relay({ cmd: 'modified' })
  relay({ cmd: 'save-snapshot', saveSnapshotId: 1 })
  relay({ cmd: 'modified' })
  assert.deepEqual(messages.map(m => m.type), ['modified', 'save-snapshot', 'modified'])
  assert.equal(messages[1].saveSnapshotId, 1)
})
