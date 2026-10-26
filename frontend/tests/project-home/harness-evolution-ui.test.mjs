// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness² 对齐（dev-board#1481）：运行期自愈、独立核验报告、自进化卡片的前端接线断言。
// 组件带 @/ 别名无法在 node:test 中直接挂载，这里核实源码层的事件接线与用户可控入口。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL('../../src/' + rel, import.meta.url), 'utf8')
const stripComments = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('useAgentStream 接收三条 Harness SSE 事件，并在气泡守卫之前处理', () => {
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
})

test('ProcessCard 内联展示自愈「归因 → 处方」并按层级区分', () => {
  const src = stripComments(read('components/AgentMessage/ProcessCard.vue'))
  assert.match(src, /process\.harnessAdaptations/)
  assert.match(src, /harnessAdaptationBadgeDomain/)
  assert.match(src, /harnessAdaptationBadgeInvariant/)
  assert.match(src, /item\.diagnosis/)
})

test('RootBubble 挂载核验报告卡与自进化卡', () => {
  const src = stripComments(read('components/AgentMessage/RootBubble.vue'))
  assert.match(src, /import VerificationReportCard from '\.\/VerificationReportCard\.vue'/)
  assert.match(src, /import HarnessEvolutionCard from '\.\/HarnessEvolutionCard\.vue'/)
  assert.match(src, /<VerificationReportCard[^>]*v-if="bubble\.verificationReport"/)
  assert.match(src, /<HarnessEvolutionCard[\s\S]*?v-if="bubble\.harnessEvolution"/)
})

test('自进化卡给用户三个掌舵入口：切换作用域、升格技能、撤销学习', () => {
  const src = stripComments(read('components/AgentMessage/HarnessEvolutionCard.vue'))
  for (const fn of ['switchHarnessEvolutionScope', 'promoteHarnessEvolutionToSkill', 'revertHarnessEvolution']) {
    assert.ok(src.includes(fn), `HarnessEvolutionCard 未调用 ${fn}`)
  }
  const api = stripComments(read('services/api.js'))
  for (const fn of ['getHarnessEvolutions', 'switchHarnessEvolutionScope', 'promoteHarnessEvolutionToSkill', 'revertHarnessEvolution']) {
    assert.ok(api.includes(fn), `api.js 缺少 ${fn}`)
  }
})

test('核验报告卡展示有据/待核/冲突三类计数', () => {
  const src = stripComments(read('components/AgentMessage/VerificationReportCard.vue'))
  assert.match(src, /verificationMetricSupported/)
  assert.match(src, /verificationMetricUnverified/)
  assert.match(src, /verificationMetricConflict/)
})
