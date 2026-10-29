// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectableChatSkills, isAiWorkflowSkill } from '../../src/utils/chatSelectableSkills.mjs'
test('desktop redirects are excluded while real AI workflows remain selectable', () => {
  const rows = ['text-to-speech', 'desensitize', 'litigation-visual', 'plugin-dev', 'meeting-recorder'].map(id => ({ id }))
  assert.deepEqual(selectableChatSkills(rows).map(s => s.id), ['litigation-visual', 'plugin-dev', 'meeting-recorder'])
  assert.equal(isAiWorkflowSkill({ id: 'contract-review' }), true)
})
test('legacy meeting workflow is deduplicated only when a usable plugin workflow replaces it', () => {
  const legacy = { id: 'tencent-meeting' }, modern = { id: 'tencent-meeting-market', sourcePluginId: 'tencent-meeting' }
  assert.deepEqual(selectableChatSkills([legacy, modern]), [modern])
  assert.deepEqual(selectableChatSkills([legacy, { ...modern, enabled: false }]), [legacy])
  assert.deepEqual(selectableChatSkills([legacy, { ...modern, available: false }]), [legacy])
  assert.deepEqual(selectableChatSkills([{ id: 'installed', builtinWorkflow: true }, { id: 'off', activationMode: 'disabled' }]), [])
})
