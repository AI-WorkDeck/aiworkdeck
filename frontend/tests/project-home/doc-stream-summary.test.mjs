// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, watchEffect } from 'vue'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'
import { visibleChatTimeline } from '../../src/components/AgentMessage/chatTimeline.mjs'

const PLACEHOLDER = 'agentStream.docStreamingPlaceholder'
const BODY = '尊敬的主席：这是只应写入文档的正文。'
const SUMMARY = '已按您的要求调整开头与结尾，保留原有事实。'

function stream() {
  const s = buildAgentStreamFactory({ expose: 'handleEvent, currentAssistantBubble, createAssistantBubble' })
  const bubble = s.createAssistantBubble()
  bubble.isStreaming = true
  s.bubbles.value.push(bubble)
  s.currentAssistantBubble.value = s.bubbles.value[0]
  const actions = []
  s.onClientAction(action => { actions.push(action) })
  const event = (name, data = {}) => s.handleEvent(name, JSON.stringify(data))
  const text = content => event('text_delta', { content })
  const start = () => {
    event('doc_stream_data', { content: BODY })
    text(BODY)
    assert.equal(s.bubbles.value[0].content, PLACEHOLDER)
  }
  return { s, bubble: s.bubbles.value[0], actions, event, text, start }
}

for (const tagged of [true, false]) {
  test(`successful doc_stream_end releases ${tagged ? 'tagged' : 'plain'} summary in the current reactive bubble`, async () => {
    const { s, bubble, actions, event, text, start } = stream()
    let visible = ''
    const stop = watchEffect(() => {
      visible = visibleChatTimeline(s.bubbles.value[0]).filter(e => e.type === 'text')
        .map(e => s.bubbles.value[0].content.slice(e.start, e.end)).join('')
    })
    start()
    // Protocol-looking document tails can be held by the parser until the end event.
    text('<甲方')
    event('doc_stream_end', { wrote: true })
    assert.equal(bubble.isEditorStreaming, false)
    assert.equal(bubble.content, '')
    const reply = tagged ? `<final>${SUMMARY}</final>` : SUMMARY
    for (const char of reply) text(char)
    event('bubble_end', { status: 'finished', documentEdited: true })
    await nextTick()
    assert.equal(bubble.content, SUMMARY)
    assert.equal(visible, SUMMARY)
    assert.equal(bubble.isStreaming, false)
    assert.equal(actions.filter(a => a.action === 'doc_stream_data').map(a => a.content).join(''), BODY)
    stop()
  })
}

test('final before doc_stream_end replaces the placeholder, while remaining document body stays suppressed', () => {
  const { bubble, event, text, start } = stream()
  start()
  text(`<final>${SUMMARY}</final>`)
  assert.equal(bubble.content, SUMMARY)
  text('另一段文档正文')
  assert.equal(bubble.content, SUMMARY)
  event('doc_stream_end', { wrote: true })
  event('bubble_end', { status: 'finished' })
  assert.equal(bubble.content, SUMMARY)
  assert.equal(bubble.isEditorStreaming, false)
})

test('no-body failure is visible even with no editor consumer', () => {
  const { s, bubble, event, start } = stream()
  start()
  s.onClientAction(null)
  event('doc_stream_end', { wrote: false })
  assert.equal(bubble.isEditorStreaming, false)
  assert.equal(bubble.content.trim(), 'agentStream.docStreamFailedNotice')
})

test('late editor failure remains visible after summary, without a success placeholder', () => {
  const { bubble, actions, event, text, start } = stream()
  start()
  event('doc_stream_end', { wrote: true })
  text(`<final>${SUMMARY}</final>`)
  const report = actions.find(a => a.action === 'doc_stream_end').report
  report('写入失败')
  report('写入失败')
  assert.equal(bubble.content, `${SUMMARY}\n\nagentStream.docStreamFailedNotice`)
  assert.equal(bubble.isEditorStreaming, false)
})

for (const terminal of ['cancelled', 'error']) {
  test(`${terminal} clears streaming placeholder without claiming document success`, () => {
    const { bubble, event, start } = stream()
    start()
    event(terminal, terminal === 'error' ? { message: '模型失败' } : {})
    assert.equal(bubble.isEditorStreaming, false)
    assert.equal(bubble.content.includes(PLACEHOLDER), false)
    assert.equal(bubble.documentEdited, false)
  })
}

test('persisted final is visible after history parsing', () => {
  const { s } = stream()
  const history = s.parseAssistantHistory(`<process><tool_code>doc_start_stream({})</tool_code><tool_output status="SUCCESS">已开始</tool_output></process><final>${SUMMARY}</final>`)
  assert.equal(history.content, SUMMARY)
  assert.equal(history.content.includes(PLACEHOLDER), false)
})

test('recovery on the existing streaming bubble restores final and still suppresses document body', () => {
  const { bubble, event, start } = stream()
  start()
  event('state_recovery', { content: `${BODY}<final>${SUMMARY}</final>` })
  event('doc_stream_end', { wrote: true })
  event('bubble_end', { status: 'finished' })
  assert.equal(bubble.content, SUMMARY)
  assert.equal(bubble.isEditorStreaming, false)
})

test('removing a recorded placeholder preserves short summary/tool order and the plan cursor', () => {
  const { bubble, event, text, start } = stream()
  start()
  event('plan_update', { todos: [{ content: '写信', status: 'in_progress' }] })
  text('更多文档正文')
  event('doc_stream_end', { wrote: true })
  text('<final>已修改。</final>')
  text('<process name="核对"><tool_code>doc_get_document_text({})</tool_code><tool_output status="SUCCESS">已核对</tool_output></process>')
  text('<final>内容已核对。</final>')
  event('plan_update', { todos: [{ content: '写信', status: 'completed' }] })
  event('bubble_end', { status: 'finished' })
  const visible = visibleChatTimeline(bubble).filter(e => ['text', 'execution'].includes(e.type))
    .map(e => e.type === 'text' ? bubble.content.slice(e.start, e.end).trim() : 'tool')
  assert.deepEqual(visible, ['已修改。', 'tool', '内容已核对。'])
  assert.equal(visibleChatTimeline(bubble).find(e => e.type === 'plan').data[0].status, 'completed')
})
