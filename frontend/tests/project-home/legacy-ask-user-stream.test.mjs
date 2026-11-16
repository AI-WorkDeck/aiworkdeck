// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'
import { formatAskUserAnswer, parseAskUserAnswer } from '../../src/utils/askUserAnswer.mjs'

const QUESTION = '请确认会议日期和地点。'
const OPTIONS = [{ label: '按现有信息起草', description: '未确认的信息留空' }, { label: '补充信息', description: '我来提供准确内容' }]
const WRAPPER = `<ask_user>\n<question>${QUESTION}</question>\n<options>${JSON.stringify(OPTIONS)}</options>\n</ask_user>`
function stream() {
  const s = buildAgentStreamFactory({ expose: 'handleEvent, createAssistantBubble, currentAssistantBubble' })
  const bubble = s.createAssistantBubble()
  bubble.isStreaming = true
  test.after(() => s.resetSSE())
  s.bubbles.value.push(bubble)
  s.currentAssistantBubble.value = bubble
  return s
}
function feed(s, text, size) {
  for (let i = 0; i < text.length; i += size) s.handleEvent('text_delta', JSON.stringify({ content: text.slice(i, i + size) }))
}
for (const size of [1, 2, 7, 31, 99999]) {
  test(`legacy wrapper/${size}: stream and history keep one answerable card, no protocol in body`, () => {
    const s = stream()
    const text = '已经读完材料，请确认：\n\n' + WRAPPER + '\n'
    feed(s, text, size)
    s.handleEvent('bubble_end', JSON.stringify({ status: 'awaiting_input' }))
    const live = s.bubbles.value[0]
    const history = s.parseAssistantHistory(text)
    for (const b of [live, history]) {
      assert.equal(b.content, '已经读完材料，请确认：\n\n\n')
      assert.equal(b.question.text, QUESTION)
      assert.deepEqual(b.question.options, OPTIONS.map(o => o.label))
      assert.deepEqual(b.question.descriptions, OPTIONS.map(o => o.description))
      const answer = formatAskUserAnswer({ id: b.question.id, question: b.question.text, selected: [b.question.options[0]], other: '' })
      assert.deepEqual(parseAskUserAnswer(answer.prompt).selected, [OPTIONS[0].label])
    }
    assert.equal(s.agentAwaitingInput.value, true)
  })
  test(`legacy wrapper/${size}: code and prose examples remain literal, never create a card`, () => {
    for (const text of ['```js\n' + WRAPPER + '\n```', '```xml\n' + WRAPPER + '\n```', '~~~xml\n' + WRAPPER + '\n~~~', '写法示例：`' + WRAPPER + '`', '    ' + WRAPPER, '`多行代码\n' + WRAPPER + '\n`']) {
      const s = stream()
      feed(s, text, size)
      s.handleEvent('bubble_end', JSON.stringify({ status: 'finished' }))
      assert.equal(s.bubbles.value[0].question, null)
      assert.ok(s.bubbles.value[0].content.includes(WRAPPER))
      const history = s.parseAssistantHistory(text)
      assert.equal(history.question, null)
      assert.equal(history.content, text.trimStart())
    }
  })
}

test('canonical ask_user event replaces compatibility card with server id; history replay does not damage pending live wrapper', () => {
  const s = stream()
  feed(s, WRAPPER.slice(0, 30), 1)
  s.parseAssistantHistory(WRAPPER)
  feed(s, WRAPPER.slice(30), 2)
  s.handleEvent('ask_user', JSON.stringify({ v: 1, id: 'ask-server', question: QUESTION, options: OPTIONS }))
  assert.equal(s.bubbles.value[0].question.id, 'ask-server')
  assert.equal(s.bubbles.value[0].content, '')
})

test('malformed options and arbitrary wrappers retain their original content rather than disappearing', () => {
  for (const text of [WRAPPER.replace(JSON.stringify(OPTIONS), '{broken json}'), '<ask_user>literal custom markup</ask_user>', '<ask_user><question>unfinished']) {
    const s = stream()
    feed(s, text, 1)
    s.handleEvent('bubble_end', JSON.stringify({ status: 'cancelled' }))
    assert.equal(s.bubbles.value[0].content, text)
    assert.equal(s.bubbles.value[0].question, null)
  }
})

test('cancelled after a complete question/options still exposes a usable card', () => {
  const s = stream()
  feed(s, WRAPPER.replace('</ask_user>', ''), 1)
  s.handleEvent('bubble_end', JSON.stringify({ status: 'awaiting_input' }))
  assert.equal(s.bubbles.value[0].question.text, QUESTION)
  assert.deepEqual(s.bubbles.value[0].question.options, OPTIONS.map(o => o.label))
})

test('a wrapper inside thinking or tool output remains in its original scope', () => {
  for (const [open, close, read] of [
    ['<thinking>\n', '</thinking>', b => b.thinking.content],
    ['<process><tool_code>read_file()</tool_code><tool_output>\n', '</tool_output></process>', b => b.processes[0].items[0].output],
  ]) {
    const s = stream()
    feed(s, open + WRAPPER + close, 7)
    s.handleEvent('bubble_end', JSON.stringify({ status: 'finished' }))
    assert.equal(s.bubbles.value[0].question, null)
    assert.ok(read(s.bubbles.value[0]).includes(WRAPPER))
  }
})

test('disconnect recovery uses the same nested-question decoder without duplicate body/card', () => {
  const s = stream()
  s.handleEvent('state_recovery', JSON.stringify({ content: '材料已读。\n' + WRAPPER }))
  s.handleEvent('state_recovery', JSON.stringify({ content: '材料已读。\n' + WRAPPER }))
  s.handleEvent('bubble_end', JSON.stringify({ status: 'awaiting_input' }))
  assert.equal(s.bubbles.value.length, 1)
  assert.equal(s.bubbles.value[0].content, '材料已读。\n')
  assert.deepEqual(s.bubbles.value[0].question.options, OPTIONS.map(o => o.label))
})

for (const size of [1, 7, 99999]) {
  test(`parameter wrapper/${size}: complete question renders in stream and history`, () => {
    const text = `<ask_user><parameter=question>${QUESTION}</parameter><parameter=options>${JSON.stringify(OPTIONS)}</parameter><parameter=header>继续方式</parameter><parameter=multi_select>false</parameter></ask_user>`
    const s = stream()
    feed(s, text, size)
    s.handleEvent('bubble_end', JSON.stringify({ status: 'awaiting_input' }))
    for (const b of [s.bubbles.value[0], s.parseAssistantHistory(text)]) {
      assert.equal(b.content, '')
      assert.equal(b.question.text, QUESTION)
      assert.deepEqual(b.question.options, OPTIONS.map(o => o.label))
    }
  })
}

test('parameter calls preserve malformed, truncated and quoted text without creating cards', () => {
  const tag = `<ask_user><parameter=question>${QUESTION}</parameter><parameter=options>${JSON.stringify(OPTIONS)}</parameter></ask_user>`
  for (const text of ['```xml\n' + tag + '\n```', '说明：' + tag, tag.replace('</ask_user>', ''), tag.replace(JSON.stringify(OPTIONS), '{invalid}'), tag.replace('parameter=options', 'parameter=unknown')]) {
    const s = stream()
    feed(s, text, 1)
    s.handleEvent('bubble_end', JSON.stringify({ status: 'finished' }))
    assert.equal(s.bubbles.value[0].question, null)
    assert.equal(s.parseAssistantHistory(text).question, null)
    assert.ok(s.bubbles.value[0].content.includes('<ask_user>'))
  }
})

test('parameter calls inside thinking stay in thinking, not a question card', () => {
  const tag = `<ask_user><parameter=question>${QUESTION}</parameter></ask_user>`
  const text = '<thinking>\n' + tag + '</thinking>'
  const s = stream()
  feed(s, text, 1)
  s.handleEvent('bubble_end', JSON.stringify({ status: 'finished' }))
  for (const b of [s.bubbles.value[0], s.parseAssistantHistory(text)]) {
    assert.equal(b.question, null)
    assert.ok(b.thinking.content.includes(tag))
  }
})

test('parameter display compatibility preserves finished state and produces a normal follow-up answer', () => {
  const text = `说明如下：\n<ask_user><parameter=question>${QUESTION}</parameter><parameter=options>${JSON.stringify(OPTIONS)}</parameter><parameter=header>继续方式</parameter></ask_user>`
  const s = stream()
  feed(s, text, 1)
  s.handleEvent('bubble_end', JSON.stringify({ status: 'finished' }))
  assert.equal(s.agentAwaitingInput.value, false)
  for (const b of [s.bubbles.value[0], s.parseAssistantHistory(text)]) {
    assert.equal(b.question.header, '继续方式')
    const answer = formatAskUserAnswer({ id: b.question.id, question: b.question.text, selected: [b.question.options[0]], other: '' })
    assert.deepEqual(parseAskUserAnswer(answer.prompt).selected, [OPTIONS[0].label])
    assert.ok(!b.content.includes('<parameter='))
  }
})


test('explicit null parameters are invalid, not omitted defaults', () => {
  for (const key of ['options', 'multi_select']) {
    const text = `<ask_user><parameter=question>${QUESTION}</parameter><parameter=${key}>null</parameter></ask_user>`
    const s = stream()
    feed(s, text, 1)
    s.handleEvent('bubble_end', JSON.stringify({ status: 'finished' }))
    for (const b of [s.bubbles.value[0], s.parseAssistantHistory(text)]) {
      assert.equal(b.question, null)
      assert.equal(b.content, text)
    }
  }
})

const SAMPLE_OPTIONS = [{ label: '提供文件', description: '上传相关法律文书，我帮您查找期限' }, { label: '口头说明', description: '您直接告诉我下个月有哪些期限' }]
const ATTR_FORMS = {
  'single-quoted options': `<ask_user question="没有文件，请问是哪个期限？" options='${JSON.stringify(SAMPLE_OPTIONS)}' />`,
  'double-quoted options': `<ask_user question="没有文件，请问是哪个期限？" options="${JSON.stringify(SAMPLE_OPTIONS)}" />`,
  'entity-escaped quotes': `<ask_user question=&quot;没有文件，请问是哪个期限？&quot; options=&quot;${JSON.stringify(SAMPLE_OPTIONS).replace(/"/g, '&quot;')}&quot; />`,
}
for (const [name, tag] of Object.entries(ATTR_FORMS)) {
  for (const size of [1, 5, 99999]) {
    test(`self-closing attribute form/${name}/${size}: one answerable card, no raw tag in body`, () => {
      const s = stream()
      const text = '先问一下：\n' + tag + '\n'
      feed(s, text, size)
      s.handleEvent('bubble_end', JSON.stringify({ status: 'awaiting_input' }))
      for (const b of [s.bubbles.value[0], s.parseAssistantHistory(text)]) {
        assert.ok(!b.content.includes('<ask_user'), b.content)
        assert.equal(b.question.text, '没有文件，请问是哪个期限？')
        assert.deepEqual(b.question.options, SAMPLE_OPTIONS.map(o => o.label))
        assert.deepEqual(b.question.descriptions, SAMPLE_OPTIONS.map(o => o.description))
      }
    })
  }
}

test('self-closing attribute form: string-array options, and code-fenced / malformed forms stay literal', () => {
  const s = stream()
  feed(s, `<ask_user question='怎么整理？' options='["仅格式","仅措辞"]' />`, 3)
  s.handleEvent('bubble_end', JSON.stringify({ status: 'awaiting_input' }))
  assert.deepEqual(s.bubbles.value[0].question.options, ['仅格式', '仅措辞'])
  for (const text of ['```\n<ask_user question="x" />\n```', '<ask_user options=\'["a"]\' />', '<ask_user question="x" options=\'[not json]\' />']) {
    const t = stream()
    feed(t, text, 2)
    t.handleEvent('bubble_end', JSON.stringify({ status: 'finished' }))
    assert.equal(t.bubbles.value[0].question, null)
    assert.ok(t.bubbles.value[0].content.includes('<ask_user'))
  }
})
