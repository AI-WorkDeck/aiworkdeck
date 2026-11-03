// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../../src/components/project-home/ScratchTransferDialog.vue', import.meta.url), 'utf8')
function component(copy) {
  const script = source.slice(source.indexOf('<script>') + '<script>'.length, source.indexOf('</script>')).replace(/import[^\n]+\n/, '').replace('export default', 'result =')
  const context = { result: null, getMyProjects: async () => [{ id: 1, projectType: 'SCRATCH' }, { id: 2, projectType: 'BLANK', myRole: 'OWNER' }, { id: 3, projectType: 'BLANK', myRole: 'MEMBER' }], copyScratchToProject: copy }
  vm.runInNewContext(script, context)
  return context.result
}
test('transfer submits only selected content and retains selection on a failed copy', async () => {
  let received
  const c = component(async data => { received = data; throw new Error('quota') })
  const state = { ...c.data(), beforeCopy: async () => {}, sourceProjectId: '1', target: '2', fileIds: [4], conversationIds: ['conversation'], $t: k => k, $emit: () => assert.fail('failure must not close dialog') }
  await c.mounted.call(state)
  assert.deepEqual(Array.from(state.projects, p => p.id), [2])
  await c.methods.copy.call(state)
  assert.equal(received.sourceProjectId, 1)
  assert.equal(received.targetProjectId, 2)
  assert.deepEqual(received.selectedFileIds, [4])
  assert.equal(state.error, 'quota')
  assert.equal(state.busy, false)
  assert.deepEqual(state.conversationIds, ['conversation'])
})
test('a second click cannot submit while copying, successful copy emits receipt', async () => {
  let finish, calls = 0
  const c = component(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  const events = []
  const state = { ...c.data(), beforeCopy: async () => {}, sourceProjectId: '1', target: '2', fileIds: [4], $t: k => k, $emit: (...e) => events.push(e) }
  const first = c.methods.copy.call(state)
  await c.methods.copy.call(state)
  assert.equal(calls, 1)
  finish({ data: { sourcePreserved: true, targetProjectId: 2 } })
  await first
  assert.equal(events[0][0], 'copied')
  assert.equal(events[0][1].sourcePreserved, true)
})

test('failed editor save prevents copying stale bytes and preserves selection', async () => {
  const c = component(() => assert.fail('must not copy before successful save'))
  const state = { ...c.data(), sourceProjectId: '1', target: '2', fileIds: [4], beforeCopy: async () => { throw new Error('save failed') }, $t: k => k, $emit: () => assert.fail('must not close') }
  await c.methods.copy.call(state)
  assert.equal(state.error, 'save failed')
  assert.equal(state.busy, false)
  assert.deepEqual(state.fileIds, [4])
})
