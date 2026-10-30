// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLitigationGeneration } from '../../src/utils/litigationGeneration.mjs'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function fixture(t, saved = null) {
  const posts = [], opened = [], connections = []
  let failPost = false, authorized = true, current = true, count = 0, clock = 1000, metadata = null
  let diagrams = [], kickoffWait = null, resultWait = null
  const stream = buildAgentStreamFactory({
    expose: 'handleEvent',
    console: { log() {}, warn() {}, error() {} },
    setInterval: () => 1, clearInterval() {},
    getConversationMetadata: async () => metadata,
    fetch: async (url, options = {}) => {
      if (url.endsWith('/chat')) {
        posts.push(JSON.parse(options.body))
        if (failPost) throw new Error('synthetic connection failure')
        return { ok: true, json: async () => ({ status: 'accepted', messageId: `m-${posts.length}`, state: 'applied' }) }
      }
      if (url.includes('/cancel/')) return { ok: true, json: async () => ({ cancelled: true }) }
      if (url.includes('/connect/')) {
        let controller
        const body = new ReadableStream({ start(c) { controller = c } })
        options.signal.addEventListener('abort', () => { try { controller.close() } catch {} }, { once: true })
        connections.push(url)
        return { ok: true, body }
      }
      return { ok: true, json: async () => [] }
    },
  })
  let history = [], inbox = { items: [], status: null }
  const api = { projectId: 42,
    authorize: async () => { if (!authorized) throw new Error('disabled') },
    kickoff: async () => { if (kickoffWait) await kickoffWait; return { prompt: '诉讼可视化：合成材料' } },
    issue: async () => ({ conversationId: `conv-chart-${++count}` }),
    model: async () => 'chosen-model',
    diagrams: async () => { if (resultWait) await resultWait; return diagrams },
    history: async () => history,
    inbox: async () => inbox,
  }
  const generation = createLitigationGeneration({ stream, api, isCurrent: () => current,
    storage: { load: () => saved, save: value => { saved = value } },
    text: key => key, uuid: () => `request-${++count}`, now: () => clock,
    openFile: async id => { opened.push(id) }, changed() {},
  })
  t.after(() => generation.dispose())
  const start = async () => {
    const snapshot = await generation.request('generate', { scope: '合成材料 (ID: 1)', diagramHint: '当事人法律关系图', clientRequestId: 'first-request' })
    await flush()
    return snapshot
  }
  const event = (name, data) => stream.handleEvent(name, typeof data === 'string' ? data : JSON.stringify(data))
  return { generation, stream, posts, opened, connections, start, event, saved: () => saved,
    set: values => {
      if ('diagrams' in values) diagrams = values.diagrams
      if ('authorized' in values) authorized = values.authorized
      if ('current' in values) current = values.current
      if ('failPost' in values) failPost = values.failPost
      if ('kickoffWait' in values) kickoffWait = values.kickoffWait
      if ('resultWait' in values) resultWait = values.resultWait
      if ('clock' in values) clock = values.clock
      if ('history' in values) history = values.history
      if ('inbox' in values) inbox = values.inbox
      if ('metadata' in values) metadata = values.metadata
    },
  }
}

test('start uses its own native stream and stays busy after the inbox ACK; repeated clicks send once', async t => {
  const f = fixture(t)
  assert.equal((await f.start()).phase, 'starting')
  assert.equal((await f.generation.observe()).phase, 'running')
  await f.start()
  assert.equal(f.posts.length, 1)
  assert.equal(f.posts[0].conversationId, f.saved().conversationId)
  assert.equal(f.posts[0].model, 'chosen-model')
  assert.deepEqual(f.posts[0].skillIds, ['litigation-visual'])
  assert.equal(f.posts[0].conversationScope, 'litigation-visual')
  assert.match(f.connections[0], /[?]conversationScope=litigation-visual$/)
  assert.equal(f.opened.length, 0)
})

test('native question markup is answered on the same stream with the explicit selected choices', async t => {
  const f = fixture(t)
  await f.start()
  f.event('text_delta', '<question>确认当事人关系？<option>按材料确认</option><option>需要修改</option></question>')
  f.event('bubble_end', { status: 'awaiting_input' })
  const waiting = await f.generation.observe()
  assert.equal(waiting.phase, 'waiting')
  assert.equal(waiting.question.text, '确认当事人关系？')
  assert.deepEqual(waiting.question.options, ['按材料确认', '需要修改'])
  await assert.rejects(f.generation.request('answer', { taskId: waiting.taskId, questionKey: 'old', answer: { selected: ['按材料确认'] } }), /staleQuestion/)
  await f.generation.request('answer', { taskId: waiting.taskId, questionKey: waiting.question.key, answer: { selected: ['需要修改'], other: '不要红色强调' } })
  await flush()
  assert.equal(f.posts.length, 2)
  assert.equal(f.posts[1].conversationId, f.posts[0].conversationId)
  assert.match(f.posts[1].message, /需要修改/)
  assert.match(f.posts[1].message, /不要红色强调/)
  assert.deepEqual(f.posts[1].skillIds, ['litigation-visual'])
})

test('completion verifies an actual related gallery artifact then opens the editable file once', async t => {
  const f = fixture(t)
  await f.start()
  f.event('client_action', { action: 'doc_open_file', fileId: 71 })
  f.set({ diagrams: [{ folderId: 70, name: '合成关系', drawioFileId: 71, svgFileId: 72 }] })
  assert.equal(f.opened.length, 0, 'an unverified open signal alone is not completion')
  f.event('bubble_end', { status: 'finished' })
  const done = await f.generation.observe()
  assert.equal(done.phase, 'completed')
  assert.equal(done.resultFileId, 71)
  assert.deepEqual(f.opened, [71])
  await f.generation.observe()
  assert.deepEqual(f.opened, [71])
})

test('legacy checkpoint prose recovers the original confirmation block without internal tool instructions', async t => {
  const f = fixture(t)
  await f.start()
  f.event('text_delta', '<process><tool_code>litigation_checkpoint(semanticMapJson="{}")</tool_code><tool_output status="SUCCESS">1. 确认结构？\n2. 选择风格？\n3. 是否强调？\n\n────────── 以下是给你（AI）的执行指引，不要发给用户 ──────────\n调用内部工具继续</tool_output></process><final>请确认以上内容。</final>')
  f.event('bubble_end', { status: 'finished' })
  const waiting = await f.generation.observe()
  assert.equal(waiting.phase, 'waiting')
  assert.equal(waiting.question.text, '1. 确认结构？\n2. 选择风格？\n3. 是否强调？')
  assert.doesNotMatch(waiting.question.text, /AI|内部工具/)
  assert.equal(f.posts.length, 1, 'no automatic confirmation is submitted')
})

test('finished without output stays visibly failed, including an unrelated gallery addition', async t => {
  const f = fixture(t)
  await f.start()
  f.set({ diagrams: [{ folderId: 90, drawioFileId: 91, name: '别的任务的图' }] })
  f.event('bubble_end', { status: 'finished' })
  assert.deepEqual((await f.generation.observe()).message, 'noDiagram')
  assert.equal((await f.generation.observe()).phase, 'failed')
  assert.equal(f.opened.length, 0)
})

test('lost POST receipt retries the same frozen prompt and request ID rather than a new task', async t => {
  const f = fixture(t)
  f.set({ failPost: true })
  await f.start()
  assert.equal((await f.generation.observe()).phase, 'failed')
  f.set({ failPost: false })
  await f.start()
  assert.equal(f.posts.length, 2)
  assert.equal(f.posts[0].clientRequestId, f.posts[1].clientRequestId)
  assert.equal(f.posts[0].conversationId, f.posts[1].conversationId)
  assert.equal(f.posts[0].message, f.posts[1].message)
})

test('failed preflight can retry after access is restored without a null pending submission', async t => {
  const f = fixture(t)
  f.set({ authorized: false })
  await f.start()
  assert.equal((await f.generation.observe()).phase, 'failed')
  assert.equal(f.posts.length, 0)
  f.set({ authorized: true })
  await f.start()
  assert.equal(f.posts.length, 1)
  assert.equal((await f.generation.observe()).phase, 'running')
})

test('stop remains stopping until the native cancelled event, preserving generated files', async t => {
  const f = fixture(t)
  await f.start()
  const running = await f.generation.observe()
  assert.equal((await f.generation.request('stop', { taskId: running.taskId })).phase, 'stopping')
  await flush()
  assert.equal((await f.generation.observe()).phase, 'stopping')
  f.set({ clock: 20000 })
  assert.equal((await f.generation.observe()).message, 'stopUnconfirmed')
  f.event('cancelled', {})
  assert.equal((await f.generation.observe()).phase, 'cancelled')
})

test('stop during preparation never dispatches a paid model request', async t => {
  const f = fixture(t), wait = deferred()
  f.set({ kickoffWait: wait.promise })
  const started = await f.start()
  await f.generation.request('stop', { taskId: started.taskId })
  wait.resolve()
  await flush()
  assert.equal(f.posts.length, 0)
  assert.equal((await f.generation.observe()).phase, 'cancelled')
})

test('stopping a task already waiting for an answer releases the panel without a nonexistent run receipt', async t => {
  const f = fixture(t)
  await f.start()
  f.event('text_delta', '<question>确认关系？<option>确认</option></question>')
  f.event('bubble_end', { status: 'awaiting_input' })
  const waiting = await f.generation.observe()
  assert.equal(waiting.phase, 'waiting')
  assert.equal((await f.generation.request('stop', { taskId: waiting.taskId })).phase, 'cancelled')
  assert.equal(f.posts.length, 1)
})

test('switching project during async preparation prevents the old request from being submitted', async t => {
  const f = fixture(t), wait = deferred()
  f.set({ kickoffWait: wait.promise })
  await f.start()
  f.set({ current: false })
  wait.resolve()
  await flush()
  assert.equal(f.posts.length, 0)
  assert.equal(f.opened.length, 0)
})

test('late result checking cannot open a diagram in another project', async t => {
  const f = fixture(t), wait = deferred()
  await f.start()
  f.event('client_action', { action: 'doc_open_file', fileId: 71 })
  f.event('bubble_end', { status: 'finished' })
  f.set({ resultWait: wait.promise, diagrams: [{ folderId: 70, drawioFileId: 71 }] })
  const pending = f.generation.observe()
  await flush()
  f.set({ current: false })
  wait.resolve()
  await pending
  assert.equal(f.opened.length, 0)
})

test('reopening a waiting task restores the persisted question without sending or opening chat', async t => {
  const f = fixture(t)
  await f.start()
  const saved = f.saved()
  const recovered = fixture(t, saved)
  recovered.set({ history: [{ role: 'USER', content: '合成任务' }, { role: 'ASSISTANT', content: '<question>请选择风格<option>白描</option></question>' }] })
  const restoring = recovered.generation.observe()
  await flush()
  recovered.event('run_state', { status: 'AWAITING_INPUT' })
  await restoring
  const view = await recovered.generation.observe()
  assert.equal(view.phase, 'waiting')
  assert.equal(view.question.text, '请选择风格')
  assert.equal(recovered.posts.length, 0)
})

test('completion while disconnected is recovered using persisted conversation metadata', async t => {
  const f = fixture(t)
  await f.start()
  const recovered = fixture(t, f.saved())
  recovered.set({ metadata: { fileChanges: [{ fileName: '合成关系', changeType: 'ADDED' }] },
    diagrams: [{ folderId: 70, name: '合成关系', drawioFileId: 71 }] })
  await recovered.generation.observe()
  recovered.event('run_state', { status: 'FINISHED' })
  assert.equal((await recovered.generation.observe()).phase, 'completed')
  assert.deepEqual(recovered.opened, [71])
})

test('editor commands from the dedicated stream do not act on the current document', async t => {
  const f = fixture(t)
  await f.start()
  f.event('client_action', { action: 'doc_open_file_sync', fileId: 1 })
  f.event('client_action', { action: 'editor_command', command: 'delete_all' })
  assert.deepEqual(f.opened, [])
  assert.deepEqual(f.saved().outputIds, [])
})


test('lost receipt after server delivery recovers the unanswered question without a duplicate turn', async t => {
  const f = fixture(t)
  f.set({ failPost: true })
  await f.start()
  assert.equal((await f.generation.observe()).phase, 'failed')
  f.set({ failPost: false,
    inbox: { status: 'AWAITING_INPUT', items: [{ clientRequestId: 'first-request', state: 'applied' }] },
    history: [{ role: 'USER', clientRequestId: 'first-request', content: 'synthetic input' },
      { role: 'ASSISTANT', content: '<question>确认关系？<option>确认</option></question>' }],
  })
  const recovered = await f.start()
  assert.equal(recovered.phase, 'waiting')
  assert.equal(recovered.question.text, '确认关系？')
  assert.equal(recovered.question.answered, false)
  assert.equal(f.posts.length, 1, 'an applied idempotent submission must not create an empty assistant turn')
  await f.generation.request('answer', { taskId: recovered.taskId, questionKey: recovered.question.key, answer: { selected: ['确认'] } })
  await flush()
  assert.equal(f.posts.length, 2)
  assert.notEqual(f.posts[1].clientRequestId, 'first-request')
})

test('persisted input that never reached the server becomes retryable with its original ID', async t => {
  const f = fixture(t)
  await f.start()
  const saved = f.saved()
  saved.phase = 'starting'
  saved.accepted = false
  const recovered = fixture(t, saved)
  assert.equal((await recovered.generation.observe()).phase, 'failed')
  await recovered.start()
  assert.equal(recovered.posts.length, 1)
  assert.equal(recovered.posts[0].clientRequestId, 'first-request')
  assert.equal(recovered.posts[0].conversationId, saved.conversationId)
})

test('revoking a waiting task releases the panel even though the server has no active run', async t => {
  const f = fixture(t)
  await f.start()
  f.event('text_delta', '<question>确认？<option>确认</option></question>')
  f.event('bubble_end', { status: 'awaiting_input' })
  await f.generation.observe()
  await f.generation.revoke('disabled')
  const view = await f.generation.observe()
  assert.equal(view.phase, 'cancelled')
  assert.equal(view.message, 'disabled')
  assert.equal(f.posts.length, 1)
})

test('a native error while stopping becomes a visible failure instead of locking the panel', async t => {
  const f = fixture(t)
  await f.start()
  await f.generation.request('stop', { taskId: f.saved().id })
  f.event('run_state', { status: 'ERROR' })
  assert.equal((await f.generation.observe()).phase, 'failed')
})


for (const status of ['AWAITING_INPUT', 'FINISHED']) {
  test(`a terminal reconnect supersedes a stale RUNNING inbox snapshot: ${status}`, async t => {
    const f = fixture(t)
    await f.start()
    const recovered = fixture(t, f.saved())
    recovered.set({ inbox: { status: 'RUNNING', items: [{ clientRequestId: 'first-request', state: 'applied' }] },
      history: status === 'AWAITING_INPUT' ? [{ role: 'ASSISTANT', content: '<question>确认？<option>确认</option></question>' }] : [],
      metadata: status === 'FINISHED' ? { fileChanges: [{ fileName: '合成关系', changeType: 'ADDED' }] } : null,
      diagrams: status === 'FINISHED' ? [{ folderId: 70, name: '合成关系', drawioFileId: 71 }] : [],
    })
    assert.equal((await recovered.generation.observe()).phase, 'running')
    recovered.event('run_state', { status })
    assert.equal((await recovered.generation.observe()).phase, status === 'AWAITING_INPUT' ? 'waiting' : 'completed')
    assert.equal(recovered.posts.length, 0)
  })
}

test('approval shows the implementation plan and only continues after an explicit answer', async t => {
  const f = fixture(t)
  await f.start()
  f.event('artifact', { operation: 'create', id: 'plan-1', type: 'implementation_plan', status: 'draft', data: { content: '1. 核对材料\n2. 生成关系图' } })
  f.event('bubble_end', { status: 'awaiting_approval' })
  const waiting = await f.generation.observe()
  assert.equal(waiting.phase, 'waiting')
  assert.equal(waiting.question.text, '1. 核对材料\n2. 生成关系图')
  assert.equal(f.posts.length, 1, 'no automatic approval is submitted')
  await f.generation.request('answer', { taskId: waiting.taskId, questionKey: waiting.question.key, answer: { selected: [], other: '按此计划继续' } })
  await flush()
  assert.equal(f.posts.length, 2)
  assert.match(f.posts[1].message, /按此计划继续/)
})


test('question stays concise while the full reply remains in the dedicated transcript', async t => {
  const f = fixture(t)
  await f.start()
  f.event('text_delta', '<final>Material inventory with many rows.</final><question>Which style?<option>Outline</option></question>')
  f.event('bubble_end', { status: 'awaiting_input' })
  const view = await f.generation.observe()
  assert.equal(view.question.text, 'Which style?')
  assert.ok(view.messages.some(message => message.content.includes('Material inventory')))
  assert.ok(view.messages.every(message => !message.content.includes('questionProtocol')))
})

test('plain follow-up stays in the dedicated conversation and does not reopen an old diagram', async t => {
  const f = fixture(t)
  await f.start()
  f.event('client_action', { action: 'doc_open_file', fileId: 71 })
  f.set({ diagrams: [{ folderId: 70, name: 'Synthetic', drawioFileId: 71 }] })
  f.event('bubble_end', { status: 'finished' })
  const done = await f.generation.observe()
  await f.generation.request('message', { taskId: done.taskId, message: 'Explain the first event' })
  await flush()
  assert.equal(f.posts.length, 2)
  assert.equal(f.posts[1].conversationId, f.posts[0].conversationId)
  assert.equal(f.posts[1].conversationScope, 'litigation-visual')
  assert.equal(f.posts[1].displayText, 'Explain the first event')
  f.event('text_delta', '<final>The first event is the signing.</final>')
  f.event('bubble_end', { status: 'finished' })
  const answered = await f.generation.observe()
  assert.equal(answered.phase, 'completed')
  assert.ok(answered.messages.some(message => message.content === 'The first event is the signing.'))
  assert.deepEqual(f.opened, [71])
})

test('a new diagram uses the same dedicated history but cannot count the previous result as new', async t => {
  const f = fixture(t)
  await f.start()
  f.event('client_action', { action: 'doc_open_file', fileId: 71 })
  f.set({ diagrams: [{ folderId: 70, name: 'Synthetic', drawioFileId: 71 }] })
  f.event('bubble_end', { status: 'finished' })
  await f.generation.observe()
  await f.start()
  assert.equal(f.posts[1].conversationId, f.posts[0].conversationId)
  f.event('bubble_end', { status: 'finished' })
  assert.equal((await f.generation.observe()).phase, 'failed')
  assert.deepEqual(f.opened, [71])
})

test('completed task restores its own transcript without reopening or sending again', async t => {
  const f = fixture(t)
  await f.start()
  f.event('client_action', { action: 'doc_open_file', fileId: 71 })
  f.set({ diagrams: [{ folderId: 70, name: 'Synthetic', drawioFileId: 71 }] })
  f.event('bubble_end', { status: 'finished' })
  await f.generation.observe()
  const restored = fixture(t, f.saved())
  restored.set({ history: [{ role: 'USER', content: 'hidden kickoff', displayContent: 'Create a diagram' },
    { role: 'ASSISTANT', id: 10, content: '<final>Diagram saved.</final>' }] })
  const view = await restored.generation.observe()
  assert.equal(view.phase, 'completed')
  assert.deepEqual(view.messages, [{ role: 'USER', content: 'Create a diagram' }, { role: 'ASSISTANT', content: 'Diagram saved.' }])
  assert.deepEqual(restored.opened, [])
  assert.equal(restored.posts.length, 0)
})


test('restored later round excludes prior artifact metadata even if it is still in the gallery', async t => {
  const f = fixture(t)
  await f.start()
  const saved = { ...f.saved(), round: 3, accepted: true, pending: { clientRequestId: 'new-round', prompt: 'new diagram' } }
  const restored = fixture(t, saved)
  restored.set({ inbox: { status: 'FINISHED', items: [{ clientRequestId: 'new-round', state: 'applied' }] },
    history: [{ role: 'USER', clientRequestId: 'old-round', content: 'old' },
      { role: 'ASSISTANT', id: 11, content: '<final>Old diagram</final>' },
      { role: 'USER', clientRequestId: 'new-round', content: 'new' },
      { role: 'ASSISTANT', id: 12, content: '<final>No diagram created</final>' }],
    metadata: { fileChanges: [{ assistantMessageId: 11, fileId: 71, fileName: 'Synthetic', changeType: 'ADDED' }] },
    diagrams: [{ folderId: 70, name: 'Synthetic', drawioFileId: 71 }] })
  assert.equal((await restored.generation.observe()).phase, 'failed')
  assert.deepEqual(restored.opened, [])
})
