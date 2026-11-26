// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C14 (lane C S3): in a multi-person project group the assistant answers only when someone
// explicitly calls it: 「@助手」 / 「@AI」 / 「@<assistant name>」 (or the 「请助手回复」 button). Every
// message in a group used to trigger a billed AI turn whenever a stale member count said the
// sender was alone.

const GENERIC = ['助手', '项目助手', 'AI 助手', 'AI助手', 'AI', 'assistant', 'Assistant']

export function mentionsAssistant(text, agent) {
  const t = String(text || '')
  if (!t.includes('@') && !t.includes('＠')) return false
  const names = new Set(GENERIC)
  if (agent && agent.name) names.add(String(agent.name))
  if (agent && agent.title) names.add(String(agent.title))
  for (const name of names) {
    if (!name) continue
    const at = new RegExp('[@＠]' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i')
    if (at.test(t)) return true
  }
  return false
}
