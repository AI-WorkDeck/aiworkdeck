// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/LitigationVisualPanel.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '')
const component = new Function('t', 'uni', script.replace('export default', 'return'))(key => key, { $off() {} })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function panel(request) {
  const calls = [], events = []
  let reloads = 0
  const vm = Object.assign(component.data(), component.methods, {
    projectId: 42,
    generationAlive: true,
    generationLoading: false,
    status: { available: true },
    generationRequest: async (operation, params) => { calls.push({ operation, params }); return request(operation, params) },
    $t: (key, params) => params ? `${key}:${JSON.stringify(params)}` : key,
    $emit: (...args) => events.push(args),
    reload: async () => { reloads++ },
  })
  for (const [name, get] of Object.entries(component.computed)) Object.defineProperty(vm, name, { get: () => get.call(vm) })
  return { vm, calls, events, reloads: () => reloads }
}
const running = { taskId: 'task-1', phase: 'running', startedAt: Date.now(), message: 'Reading materials' }
const waiting = { ...running, phase: 'waiting', question: { key: 'q1', text: '确认日期与重点', options: ['采用日期', '不标红'], descriptions: ['', ''], multiSelect: true } }

test('a submission acknowledgment keeps the task busy; no chat event is emitted', async () => {
  let snapshot = running
  const p = panel(async () => snapshot)
  p.vm.scope = { description: '合成材料，文件 ID 7', label: '合成材料' }
  p.vm.diagramHint = '当事人法律关系图'
  await p.vm.start()
  assert.equal(p.vm.starting, false)
  assert.equal(p.vm.generationLocked, true)
  assert.equal(p.calls[0].operation, 'generate')
  assert.equal(p.calls[0].params.scope, p.vm.scope.description)
  assert.match(p.calls[0].params.clientRequestId, /^litviz-/)
  await p.vm.start()
  p.vm.pickScope()
  p.vm.selectKind('案件流程图')
  assert.equal(p.calls.length, 1)
  assert.equal(p.events.length, 0)
  assert.equal(p.vm.diagramHint, '当事人法律关系图')
  snapshot = waiting
  await p.vm.refreshGeneration()
  assert.equal(p.vm.generation.phase, 'waiting')
  assert.equal(p.vm.generationLocked, true)
})

test('double clicks submit only once, including before the host acknowledges', async () => {
  const pending = deferred()
  const p = panel(() => pending.promise)
  const first = p.vm.start()
  await p.vm.start()
  assert.equal(p.calls.length, 1)
  pending.resolve(running)
  await first
  assert.equal(p.vm.generationLocked, true)
})

test('a failed submission remains visible and retries reuse its id until input changes', async () => {
  const p = panel(async () => { throw new Error('合成请求失败') })
  await p.vm.start()
  assert.equal(p.vm.generationError, '合成请求失败')
  assert.equal(p.vm.generationLocked, false)
  await p.vm.start()
  assert.equal(p.calls[0].params.clientRequestId, p.calls[1].params.clientRequestId)
  p.vm.selectKind('案件流程图')
  await p.vm.start()
  assert.notEqual(p.calls[1].params.clientRequestId, p.calls[2].params.clientRequestId)
})

test('a new start rejected after a completed task keeps its request identity for retry', async () => {
  const p = panel(async () => { throw Error('合成启动回执丢失') })
  p.vm.applyGeneration({ ...running, phase: 'completed', resultFileId: 10 })
  await p.vm.start()
  await p.vm.start()
  assert.equal(p.calls.length, 2)
  assert.equal(p.calls[0].params.clientRequestId, p.calls[1].params.clientRequestId)
  p.vm.applyGeneration({ taskId: 'task-2', phase: 'completed', resultFileId: 20 })
  await p.vm.start()
  assert.notEqual(p.calls[1].params.clientRequestId, p.calls[2].params.clientRequestId)
})

test('questions require an explicit answer; multi-select and free text survive polling', async () => {
  let next = waiting
  const p = panel(async () => next)
  p.vm.applyGeneration(waiting)
  await p.vm.answerGeneration()
  assert.equal(p.calls.length, 0)
  p.vm.selectAnswer('采用日期')
  p.vm.selectAnswer('不标红')
  p.vm.generationOther = '  采用材料中的原始日期  '
  await p.vm.refreshGeneration()
  assert.deepEqual(p.vm.generationSelected, ['采用日期', '不标红'])
  assert.equal(p.vm.generationOther.trim(), '采用材料中的原始日期')
  next = running
  await p.vm.answerGeneration()
  assert.deepEqual(p.calls.at(-1), { operation: 'answer', params: {
    taskId: 'task-1', questionKey: 'q1', answer: { selected: ['采用日期', '不标红'], other: '采用材料中的原始日期' }
  } })
  assert.equal(p.vm.generation.phase, 'running')
  assert.deepEqual(p.vm.generationSelected, [])
})

test('single select replaces the old choice; failed answers preserve the selection', async () => {
  const p = panel(async () => { throw Error('合成回答失败') })
  p.vm.applyGeneration({ ...waiting, question: { ...waiting.question, multiSelect: false } })
  p.vm.selectAnswer('采用日期')
  p.vm.selectAnswer('不标红')
  assert.deepEqual(p.vm.generationSelected, ['不标红'])
  await p.vm.answerGeneration()
  assert.equal(p.vm.generationError, '合成回答失败')
  assert.deepEqual(p.vm.generationSelected, ['不标红'])
  p.vm.applyGeneration({ ...waiting, question: { ...waiting.question, key: 'q2' } })
  assert.deepEqual(p.vm.generationSelected, [])
})

test('stop remains pending until the host confirms cancellation; paused tasks can continue', async () => {
  const p = panel(async operation => ({ ...running, phase: operation === 'stop' ? 'stopping' : 'running' }))
  p.vm.applyGeneration(running)
  await p.vm.stopGeneration()
  assert.equal(p.vm.generation.phase, 'stopping')
  assert.equal(p.vm.generationLocked, true)
  await p.vm.stopGeneration()
  assert.equal(p.calls.length, 1)
  p.vm.applyGeneration({ ...running, phase: 'paused' })
  await p.vm.continueGeneration()
  assert.deepEqual(p.calls.at(-1), { operation: 'continue', params: { taskId: 'task-1' } })
  p.vm.applyGeneration({ ...running, phase: 'cancelled' })
  assert.equal(p.vm.generationLocked, false)
})

test('poll failures retain the task and block duplicate starts until status is known', async () => {
  let failed = true
  const p = panel(async () => { if (failed) throw Error('合成连接失败'); return running })
  p.vm.applyGeneration(running)
  await p.vm.refreshGeneration()
  assert.equal(p.vm.generationSyncError, '合成连接失败')
  assert.equal(p.vm.generation.phase, 'running')
  await p.vm.start()
  assert.equal(p.calls.length, 1)
  failed = false
  await p.vm.refreshGeneration()
  assert.equal(p.vm.generationSyncError, '')
})

test('a stale poll cannot replace a newer acknowledged task', async () => {
  const poll = deferred()
  const p = panel(operation => operation === 'generation' ? poll.promise : running)
  const refresh = p.vm.refreshGeneration()
  await p.vm.start()
  poll.resolve({ phase: 'idle' })
  await refresh
  assert.equal(p.vm.generation.phase, 'running')
})

test('switching projects discards late submission and picker callbacks', async () => {
  const pending = deferred()
  const p = panel(operation => operation === 'generate' ? pending.promise : { phase: 'idle' })
  p.vm.pickScope()
  const pick = p.events[0][1]
  const submit = p.vm.start()
  p.vm.projectId = 43
  component.watch.projectId.handler.call(p.vm)
  pick({ label: '旧项目', description: 'old' })
  pending.resolve(running)
  await submit
  assert.equal(p.vm.generation.phase, 'idle')
  assert.equal(p.vm.scope, null)
  assert.equal(p.vm.starting, false)
})

test('completion refreshes the gallery once and invalid results do not report success', () => {
  const p = panel(async () => running)
  p.vm.applyGeneration(running)
  const completed = { ...running, phase: 'completed', resultFileId: 10 }
  p.vm.applyGeneration(completed)
  p.vm.applyGeneration(completed)
  assert.equal(p.reloads(), 1)
  assert.equal(p.vm.generationLocked, false)
  assert.throws(() => p.vm.applyGeneration(null), /litGenerationInvalid/)
  assert.equal(p.vm.generation.phase, 'completed')
})

test('unmount stops polling and ignores late results without cancelling the background task', async t => {
  const pending = deferred()
  const p = panel(() => pending.promise)
  let ticks = 0
  const timer = setInterval(() => { ticks++ }, 5)
  t.after(() => clearInterval(timer))
  p.vm.generationTimer = timer
  const refresh = p.vm.refreshGeneration()
  component.beforeUnmount.call(p.vm)
  pending.resolve(running)
  await refresh
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(ticks, 0)
  assert.equal(p.vm.generation.phase, 'idle')
  assert.deepEqual(p.calls.map(call => call.operation), ['generation'])
})

test('the packaged panel delegates the named service without opening a chat panel', () => {
  const wrapper = readFileSync(new URL('../../plugin-app/pages/panel.vue', import.meta.url), 'utf8')
  assert.match(wrapper, /:generation-request="generationRequest"/)
  assert.match(wrapper, /window\.awd\.services\.request\('litigation', operation, params\)/)
  assert.doesNotMatch(wrapper, /awd\.chat\.send|start-drawing/)
  assert.doesNotMatch(source, /getLitigationKickoffPrompt|start-drawing/)
  assert.match(source, /class="lv-generation-status" role="status" aria-live="polite"/)
  assert.match(source, /class="lv-generation-error" role="alert"/)
})

test('follow-up stays in the same diagram task and double submission is blocked', async () => {
  const receipt = deferred()
  const p = panel(() => receipt.promise)
  p.vm.applyGeneration({ ...running, phase: 'completed', messages: [{ role: 'ASSISTANT', content: '合成图表已保存' }] })
  assert.equal(p.vm.latestReply, '合成图表已保存')
  p.vm.generationFollowUp = '  将第二个节点移到下方  '
  const sending = p.vm.sendFollowUp()
  await p.vm.sendFollowUp()
  assert.deepEqual(p.calls, [{ operation: 'message', params: { taskId: 'task-1', message: '将第二个节点移到下方' } }])
  receipt.resolve(running)
  await sending
  assert.equal(p.vm.generationFollowUp, '')
  assert.equal(p.events.length, 0)
})

test('follow-up failures retain the draft; unresolved questions and lost status block follow-up', async () => {
  const p = panel(async () => { throw Error('合成发送失败') })
  p.vm.applyGeneration({ ...running, phase: 'completed' })
  p.vm.generationFollowUp = '保留我的修改要求'
  await p.vm.sendFollowUp()
  assert.equal(p.vm.generationFollowUp, '保留我的修改要求')
  assert.equal(p.vm.generationError, '合成发送失败')
  p.vm.generationSyncError = '连接中断'
  await p.vm.sendFollowUp()
  p.vm.generationSyncError = ''
  p.vm.applyGeneration(waiting)
  await p.vm.sendFollowUp()
  assert.equal(p.calls.length, 1)
})

test('switching diagram task discards the old follow-up draft but polling retains it', () => {
  const p = panel(async () => running)
  p.vm.applyGeneration({ ...running, phase: 'completed' })
  p.vm.generationFollowUp = '原图的修改'
  p.vm.applyGeneration({ ...running, phase: 'completed' })
  assert.equal(p.vm.generationFollowUp, '原图的修改')
  p.vm.applyGeneration({ ...running, taskId: 'task-2' })
  assert.equal(p.vm.generationFollowUp, '')
})
