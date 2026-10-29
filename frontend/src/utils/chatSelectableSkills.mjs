// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Legacy redirect entries do not execute AI workflows; their actual desktop plugins remain managed separately.
export const isAiWorkflowSkill = skill => !['text-to-speech', 'desensitize'].includes(skill.id)
export function selectableChatSkills(skills) {
  const active = (skills || []).filter(s => !s.builtinWorkflow && s.activationMode !== 'disabled'
    && s.enabled !== false && s.available !== false && isAiWorkflowSkill(s))
  const hasMeetingWorkflow = active.some(s => s.sourcePluginId === 'tencent-meeting')
  return active.filter(s => s.id !== 'tencent-meeting' || !hasMeetingWorkflow)
}
