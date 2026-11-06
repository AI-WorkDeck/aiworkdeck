// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computed, ref, reactive } from 'vue'
import { captureChatTimeline, visibleChatTimeline, isTimelineEntryActive } from '../../src/components/AgentMessage/chatTimeline.mjs'

function mount(bubble) {
  const source = readFileSync(new URL('../../src/components/AgentMessage/RootBubble.vue', import.meta.url), 'utf8')
  const body = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  // watch / onBeforeUnmount 只喂空实现：这份夹具验的是时间线分组与展开逻辑，
  // 而 setup 里那两句是运行状态条的秒表（dev-board#792）。喂真的 watch 会让
  // immediate 回调起一个 setInterval，node:test 进程就再也退不出去了。
  return new Function('inject', 'computed', 'ref', 'watch', 'onBeforeUnmount', 't', 'defineProps', 'defineEmits', 'visibleChatTimeline', 'isTimelineEntryActive', body + '\nreturn { timeline, isExpanded, toggleEntry }')(
    () => null, computed, ref, () => {}, () => {}, k => k, () => ({ bubble }), () => () => {}, visibleChatTimeline, isTimelineEntryActive)
}
const base = () => ({ thinking: { status: 'idle', content: '' }, content: '', processes: [], artifacts: [], isStreaming: true })
const proc = (id, status = 'loading') => ({ id, stepIndex: 0, items: [{ type: 'tool', status, code: 'read_file({})' }] })

test('text → tools → thought → text keeps chronology; thought never gets merged into earlier thinking', () => {
  const bubble = reactive(base())
  bubble.content = 'Before'; captureChatTimeline(bubble)
  bubble.processes.push(proc('a')); captureChatTimeline(bubble)
  bubble.processes[0].items.push({ type: 'thinking', content: 'Review', status: 'thinking' }); captureChatTimeline(bubble)
  bubble.content += 'After'; captureChatTimeline(bubble)
  const entries = visibleChatTimeline(bubble)
  assert.deepEqual(entries.map(e => e.type), ['text', 'execution', 'thinking', 'text'])
  assert.deepEqual(entries.filter(e => e.type === 'text').map(e => bubble.content.slice(e.start, e.end)), ['Before', 'After'])
})

test('raw bubble becoming reactive does not duplicate waiting/thinking entries', () => {
  const raw = base(); raw.thinking.status = 'thinking'; captureChatTimeline(raw)
  const bubble = reactive(raw); bubble.thinking.content = 'Think'; captureChatTimeline(bubble)
  assert.equal(bubble.timeline.length, 1)
})

test('two separated executions of the same step expand independently', () => {
  const bubble = reactive(base())
  bubble.processes.push(proc('a', 'success')); captureChatTimeline(bubble)
  bubble.content = 'Retry'; captureChatTimeline(bubble)
  bubble.processes.push(proc('b', 'success')); captureChatTimeline(bubble)
  bubble.isStreaming = false
  const view = mount(bubble)
  const entries = view.timeline.value
  view.toggleEntry(entries[2], 2)
  assert.equal(view.isExpanded(entries[2], 2), true)
  assert.equal(view.isExpanded(entries[0], 0), false)
})

test('current execution expands, a later thought collapses it, completion collapses all', () => {
  const bubble = reactive(base())
  bubble.processes.push(proc('a')); captureChatTimeline(bubble)
  const view = mount(bubble)
  assert.equal(view.isExpanded(view.timeline.value[0], 0), true)
  view.toggleEntry(view.timeline.value[0], 0)
  assert.equal(view.isExpanded(view.timeline.value[0], 0), false, 'manual collapse during work')
  view.toggleEntry(view.timeline.value[0], 0)
  bubble.processes[0].items.push({ type: 'thinking', content: 'Review', status: 'thinking' }); captureChatTimeline(bubble)
  assert.equal(view.isExpanded(view.timeline.value[0], 0), false, 'phase change auto-collapses past work')
  bubble.isStreaming = false
  assert.ok(view.timeline.value.every((e, i) => !isTimelineEntryActive(e, i, view.timeline.value, false)))
})

test('plan updates retain position and render updated statuses, explicit clear removes it', () => {
  const bubble = reactive(base())
  bubble.planTodos = [{ content: 'Read', status: 'in_progress' }]; captureChatTimeline(bubble)
  bubble.content = 'Result'; captureChatTimeline(bubble)
  bubble.planTodos = [{ content: 'Read', status: 'completed' }]; captureChatTimeline(bubble)
  assert.equal(bubble.timeline[0].data[0].status, 'completed')
  assert.deepEqual(visibleChatTimeline(bubble).map(e => e.type), ['plan', 'text'])
  bubble.planTodos = []; captureChatTimeline(bubble)
  assert.deepEqual(visibleChatTimeline(bubble).map(e => e.type), ['text'])
})

test('plan heads the turn whether it was recorded mid-run or replayed after the last todo_write', () => {
  const live = reactive(base())
  live.thinking = { status: 'done', content: 'Scope' }; captureChatTimeline(live)
  live.processes.push(proc('a', 'success')); captureChatTimeline(live)
  live.planTodos = [{ content: 'Read', status: 'in_progress' }]; captureChatTimeline(live)
  live.processes.push(proc('b')); captureChatTimeline(live)
  assert.deepEqual(visibleChatTimeline(live).map(e => e.type), ['plan', 'thinking', 'execution'])
  // History replay inserts the recovered plan right after the last todo_write, i.e. near the end.
  const replayed = reactive({ ...base(), isStreaming: false, content: 'Answer', planTodos: [{ content: 'Read', status: 'completed' }] })
  replayed.timeline = [{ type: 'process', data: proc('a', 'success') }, { type: 'plan', data: replayed.planTodos }, { type: 'text', start: 0, end: 6 }]
  assert.deepEqual(visibleChatTimeline(replayed).map(e => e.type), ['plan', 'execution', 'text'])
})

test('running plan is open without stealing the working highlight; it folds when the turn ends', () => {
  const bubble = reactive(base())
  bubble.processes.push(proc('a')); captureChatTimeline(bubble)
  bubble.planTodos = [{ content: 'Read', status: 'in_progress' }, { content: 'Write', status: 'pending' }]; captureChatTimeline(bubble)
  const view = mount(bubble)
  const [plan, execution] = view.timeline.value
  assert.equal(plan.type, 'plan')
  assert.equal(view.isExpanded(plan, 0), true, 'plan visible while steps run')
  assert.equal(isTimelineEntryActive(plan, 0, view.timeline.value, true), false, 'executing step keeps the highlight')
  assert.equal(view.isExpanded(execution, 1), true)
  bubble.isStreaming = false
  assert.equal(view.isExpanded(view.timeline.value[0], 0), false, 'finished turn folds to the n/n summary')
})
