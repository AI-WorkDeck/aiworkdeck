// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// D33：最后一份逐页/逐格确定之后立即收尾，不再取决于有没有碰巧来一次 /status 刷新。
const source = readFileSync(new URL('../../src/components/version/AdoptConflictDialog.vue', import.meta.url), 'utf8')
const body = source.match(/\n    async confirmStructured\(row\) \{\n([\s\S]*?)\n    \},/)[1]

function dialog(rows, { failPost = false } = {}) {
  const calls = { posted: 0, confirmed: 0, toasts: [] }
  const vm = {
    busy: false, projectId: 1, localMerged: {}, rows,
    allCellsPicked: () => true, overlapsOf: () => [{ key: 'slide-1' }], pickOf: () => 'mine',
    $t: (k) => k, $nextTick: async () => {},
    async confirm() { calls.confirmed++ },
  }
  const uni = { $emit() {}, showToast: (o) => calls.toasts.push(o.title) }
  const post = async () => { calls.posted++; if (failPost) throw new Error('offline') }
  const fn = new Function('postMergeResolveStructured', 'uni', 'errorText', `return async function(row) {${body}}`)(post, uni, (e, f) => f)
  return { run: (row) => fn.call(vm, row), calls, vm }
}

test('resolving the last structured row lands the merge without a second click', async () => {
  const rows = [{ path: 'a.pptx', state: 'merged' }, { path: 'b.pptx', state: 'merged' }]
  const d = dialog(rows)
  await d.run(rows[1])
  assert.equal(d.calls.posted, 1)
  assert.equal(d.calls.confirmed, 1)
  assert.equal(d.vm.busy, false)
})

test('a row still needing a whole-file choice keeps the dialog open; a failed save never finalizes', async () => {
  const pending = [{ path: 'a.pptx', state: 'merged' }, { path: 'c.pdf', state: 'choice' }]
  const d = dialog(pending)
  await d.run(pending[0])
  assert.equal(d.calls.confirmed, 0)
  const failed = dialog([{ path: 'a.pptx', state: 'merged' }], { failPost: true })
  await failed.run({ path: 'a.pptx' })
  assert.equal(failed.calls.confirmed, 0)
  assert.deepEqual(failed.calls.toasts, ['version.mergeStructuredFailed'])
})
