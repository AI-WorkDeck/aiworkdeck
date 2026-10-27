// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { computed, nextTick, ref, watch } from 'vue'

const filename = new URL('../../src/components/AgentMessage/QuestionCard.vue', import.meta.url)
const descriptor = parse(readFileSync(filename, 'utf8')).descriptor
const script = compileScript(descriptor, { id: 'question-response-test' })
const component = new Function('computed', 'nextTick', 'ref', 'watch', 'MarkdownPreview',
  script.content.replace(/^import .*$/gm, '').replace('export default', 'return'))(computed, nextTick, ref, watch, {})
function card(overrides = {}) {
  const events = []
  const state = component.setup({ text: '选哪种？', kind: '', options: [], descriptions: [], questionId: '', multiSelect: false, actionable: true, ...overrides },
    { expose() {}, emit: (...args) => events.push(args) })
  return { state, events }
}
test('legacy open question now has a card-local input and emits ordinary reply without inventing ask authority', () => {
  const { state, events } = card()
  state.otherText.value = '明天下午三点'
  state.submit()
  state.submit()
  assert.deepEqual(events, [['answer', '明天下午三点']])
  const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'question-response-test', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.ok(template.code.includes('q-other-input'))
  assert.ok(!template.code.includes('answerHint'))
})
test('legacy option is actionable through the same single-click card controls', () => {
  const { state, events } = card({ options: ['保留正文', '修改格式'] })
  state.choose(1)
  assert.deepEqual(events, [['answer', '修改格式']])
})
test('canonical ask response retains server id, selection, other text and IME guard', () => {
  const { state, events } = card({ kind: 'ask_user', questionId: 'ask-123', multiSelect: true, options: ['保留正文', '修改格式'] })
  state.choose(0)
  state.choose(1)
  state.otherOpen.value = true
  state.otherText.value = '标题保持原样'
  state.onOtherEnter({ isComposing: true })
  assert.equal(events.length, 0)
  state.submit()
  assert.deepEqual(events[0], ['answer', { kind: 'ask_user', id: 'ask-123', question: '选哪种？', selected: ['保留正文', '修改格式'], other: '标题保持原样' }])
})
test('historical questions cannot submit or change selection', () => {
  const { state, events } = card({ actionable: false, options: ['已选项'] })
  state.choose(0)
  state.otherText.value = '不能重发'
  state.submit()
  assert.deepEqual(events, [])
})
