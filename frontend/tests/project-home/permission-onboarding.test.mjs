// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizePermissionItems,
  shouldAutoPromptPermissionOnboarding,
  nextMissingPermissionId,
} from '../../src/utils/permissionOnboarding.js'

test('normalizePermissionItems normalizes status, drag support, and recommended flags', () => {
  const items = normalizePermissionItems([
    { id: 'fullDiskAccess', status: 'not-granted', recommended: true },
    { id: 'screenRecording', status: 'granted', recommended: true },
    { id: 'microphone', status: 'not-determined', recommended: true },
    { id: 'accessibility', status: 'denied', recommended: false },
  ])

  assert.equal(items.length, 4)
  assert.equal(items[0].id, 'fullDiskAccess')
  assert.equal(items[0].status, 'not-granted')
  assert.equal(items[0].requiredForWeChatDrop, true)
  assert.equal(items[1].id, 'screenRecording')
  assert.equal(items[1].status, 'granted')
  assert.equal(items[2].id, 'microphone')
  assert.equal(items[2].supportsDragToSettings, false)
  assert.equal(nextMissingPermissionId(items), 'fullDiskAccess')
  assert.equal(nextMissingPermissionId(items, 'microphone'), 'microphone')
})

test('shouldAutoPromptPermissionOnboarding prompts on first launch when recommended permission is missing', () => {
  const missingFullDisk = {
    supported: true,
    items: [
      { id: 'fullDiskAccess', status: 'not-granted', recommended: true },
      { id: 'screenRecording', status: 'granted', recommended: true },
      { id: 'microphone', status: 'granted', recommended: true },
      { id: 'accessibility', status: 'not-granted', recommended: false },
    ],
  }

  assert.equal(shouldAutoPromptPermissionOnboarding(missingFullDisk, false), true)
  assert.equal(shouldAutoPromptPermissionOnboarding(missingFullDisk, true), false)
  assert.equal(
    shouldAutoPromptPermissionOnboarding(
      {
        supported: true,
        items: [
          { id: 'fullDiskAccess', status: 'granted', recommended: true },
          { id: 'screenRecording', status: 'granted', recommended: true },
          { id: 'microphone', status: 'granted', recommended: true },
          { id: 'accessibility', status: 'not-granted', recommended: false },
        ],
      },
      false,
    ),
    false,
  )
  assert.equal(shouldAutoPromptPermissionOnboarding({ supported: false, items: [] }, false), false)
})
