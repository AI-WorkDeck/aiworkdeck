// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness² 对齐（dev-board#1481）：静默运行期自愈、静默自进化判定与独立核验报告的前端接线断言。
// 自进化与运行期自愈全部由后端自动判定作用域与技能升格，严禁在对话流或过程卡里弹出打扰用户的三选一卡片。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { attachEvolutionsToBubbles } from '../../src/utils/harnessEvolutionHistory.mjs'

const read = (rel) => readFileSync(new URL('../../src/' + rel, import.meta.url), 'utf8')
const stripComments = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('useAgentStream 接收三条 Harness SSE 事件，且静默自愈/自进化不把空回合撑成可见气泡', () => {
  const src = stripComments(read('composables/useAgentStream.js'))
  for (const evt of ['harness_adaptation', 'verification_report', 'harness_evolution']) {
    assert.ok(src.includes(`'${evt}'`), `缺少 ${evt} 事件处理`)
  }
  const handlerAt = src.indexOf("evt === 'harness_adaptation'")
  const guardAt = src.indexOf('if (!currentAssistantBubble.value) {', handlerAt)
  assert.ok(handlerAt > 0 && guardAt > handlerAt, 'Harness 事件必须在气泡守卫之前处理（重连时气泡指针可能为空）')
  assert.match(src, /harnessAdaptations:\s*\[\]/, '新气泡需初始化 harnessAdaptations')
  assert.match(src, /verificationReport:\s*null/)
  assert.match(src, /harnessEvolution:\s*null/)
  assert.match(src, /\|\|\s*bubble\.verificationReport/, 'assistantHasOutput 需把核验报告算作产出')
  assert.doesNotMatch(src, /\|\|\s*bubble\.harnessEvolution/, '静默自进化不渲染卡片，不应单独把空回合算作可见气泡')
})

test('ProcessCard 与 RootBubble 不渲染打扰用户的自愈诊断块或自进化三选一卡片', () => {
  const procSrc = stripComments(read('components/AgentMessage/ProcessCard.vue'))
  assert.doesNotMatch(procSrc, /data-harness-adaptation-list/, 'ProcessCard 不应内联渲染底层自愈归因块打扰用户')

  const rootSrc = stripComments(read('components/AgentMessage/RootBubble.vue'))
  assert.match(rootSrc, /import VerificationReportCard from '\.\/VerificationReportCard\.vue'/)
  assert.match(rootSrc, /<VerificationReportCard[^>]*v-if="bubble\.verificationReport"/)
  assert.doesNotMatch(rootSrc, /<HarnessEvolutionCard/, 'RootBubble 严禁在对话流挂载打扰用户的自进化选择卡')
})

test('核验报告卡展示有据/待核/冲突三类计数，且后台管理 API 保持完整', () => {
  const src = stripComments(read('components/AgentMessage/VerificationReportCard.vue'))
  assert.match(src, /verificationMetricSupported/)
  assert.match(src, /verificationMetricUnverified/)
  assert.match(src, /verificationMetricConflict/)

  const api = stripComments(read('services/api.js'))
  for (const fn of ['getHarnessEvolutions', 'switchHarnessEvolutionScope', 'promoteHarnessEvolutionToSkill', 'revertHarnessEvolution']) {
    assert.ok(api.includes(fn), `api.js 缺少 ${fn}`)
  }
})

test('attachEvolutionsToBubbles 纯函数保持按 assistantMessageId 归并能力', () => {
  const bubbles = [
    { id: 100, role: 'USER', content: '审查合同' },
    { id: 101, role: 'ASSISTANT', content: '已完成第一版', harnessEvolution: null },
    { id: 102, role: 'ASSISTANT', content: '已完成第二版', harnessEvolution: { id: 'evo-live' } },
  ]
  const records = [
    { id: 'evo-old', assistantMessageId: 101, createdAt: '2026-10-26T01:00:00Z', status: 'APPLIED_MEMORY' },
    { id: 'evo-newer', assistantMessageId: 101, createdAt: '2026-10-26T02:00:00Z', status: 'PROMOTED_SKILL' },
    { id: 'evo-102-db', assistantMessageId: 102, createdAt: '2026-10-26T03:00:00Z', status: 'APPLIED_MEMORY' },
  ]
  const count = attachEvolutionsToBubbles(bubbles, records)
  assert.equal(count, 1)
  assert.equal(bubbles[1].harnessEvolution.id, 'evo-newer')
  assert.equal(bubbles[2].harnessEvolution.id, 'evo-live')
})
