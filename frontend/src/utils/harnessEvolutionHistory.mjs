// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness 自进化卡片的历史回放（dev-board#1481）。
// 自进化记录随 SSE harness_evolution 推到当轮气泡上；刷新/切回会话后气泡来自历史接口，
// 不带这张卡。后端记录里带 assistantMessageId，这里按它把卡片挂回原来那条助手气泡——
// 否则用户刷新一下，「撤销这次学习」的入口就没了，而规则仍在生效。

/**
 * 把持久化的自进化记录挂回历史气泡（就地修改 bubbles）。
 * 规则：只挂到 id 与 assistantMessageId 相同的助手气泡；气泡上已有（本轮 SSE 刚推来的）不覆盖；
 * 同一气泡多条记录时取最新的一条（卡片一次只展示一条）。
 *
 * @param {Array<object>} bubbles 当前会话气泡
 * @param {Array<object>} records GET /api/agent/harness/evolutions 的返回
 * @returns {number} 实际挂上的卡片数
 */
export function attachEvolutionsToBubbles(bubbles, records) {
  if (!Array.isArray(bubbles) || !Array.isArray(records) || !records.length) return 0
  const latestByMessage = new Map()
  for (const rec of records) {
    if (!rec || rec.assistantMessageId == null || !rec.id) continue
    const key = String(rec.assistantMessageId)
    const prev = latestByMessage.get(key)
    if (!prev || String(rec.createdAt || '') > String(prev.createdAt || '')) {
      latestByMessage.set(key, rec)
    }
  }
  let attached = 0
  for (const bubble of bubbles) {
    if (!bubble || bubble.role !== 'ASSISTANT' || bubble.id == null || bubble.harnessEvolution) continue
    const rec = latestByMessage.get(String(bubble.id))
    if (rec) {
      bubble.harnessEvolution = rec
      attached++
    }
  }
  return attached
}
