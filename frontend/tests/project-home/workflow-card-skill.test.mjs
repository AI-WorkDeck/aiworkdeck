// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 点内置工作流卡片要把该工作流的 skill id 随消息显式带上（skillIds），不靠后端按触发词猜：
// 「法律意见书核查」卡片的句子曾因命中门槛漏了「核查/核验」而不激活技能（tutorial #146）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL('../../src/' + rel, import.meta.url), 'utf8')
const chat = read('components/ChatInterface.vue')
const stream = read('composables/useAgentStream.js')

const between = (src, from, to) => {
  const start = src.indexOf(from)
  assert.ok(start >= 0, `missing ${from}`)
  const end = src.indexOf(to, start)
  assert.ok(end > start, `missing ${to}`)
  return src.slice(start, end)
}

test('点卡片记下工作流 id，currentSkillIds 带上它；草稿清空即作废', () => {
  const apply = between(chat, 'const applyBuiltinWorkflow = (bw) =>', 'const pendingWorkflowSkillId')
  assert.match(apply, /pendingWorkflowSkillId\.value = bw\.id/)

  const block = between(chat, 'const pendingWorkflowSkillId = ref(null)', 'const toggleSkillSelection')
  const ref = (value) => ({ value })
  const watchers = []
  const watch = (source, cb) => watchers.push([source, cb])
  const make = new Function('ref', 'watch', 'inputPrompt', 'skillDisabledByMode', 'selectedSkillIds',
    block + '\nreturn { pendingWorkflowSkillId, currentSkillIds }')
  const inputPrompt = ref('')
  const disabled = ref(false)
  const selected = ref(['contract-review'])
  const { pendingWorkflowSkillId, currentSkillIds } = make(ref, watch, inputPrompt, disabled, selected)

  assert.deepEqual(currentSkillIds(), ['contract-review'])
  pendingWorkflowSkillId.value = 'legal-opinion-review'
  assert.deepEqual(currentSkillIds(), ['contract-review', 'legal-opinion-review'])
  disabled.value = true
  assert.deepEqual(currentSkillIds(), [], 'ASK 模式下技能不生效，不带')
  disabled.value = false

  assert.equal(watchers.length, 1)
  assert.equal(watchers[0][0], inputPrompt)
  watchers[0][1]('请按内置法律意见书核查流程……')
  assert.equal(pendingWorkflowSkillId.value, 'legal-opinion-review', '草稿还在就继续带')
  watchers[0][1]('   ')
  assert.equal(pendingWorkflowSkillId.value, null, '发送后/清空草稿即作废')
})

test('后端回执里内置工作流的 manual 按自动接管展示（闪一下、出「已加载」提示）', () => {
  assert.match(stream, /s && s\.builtinWorkflow && s\.source === 'manual' \? \{ \.\.\.s, source: 'auto' \} : s/)
})
