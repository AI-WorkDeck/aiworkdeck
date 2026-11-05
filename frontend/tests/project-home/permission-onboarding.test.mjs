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

// 问题 3/33：preload 的 prefs 签名是 get(key) / set(key, value)，传对象会把整个对象当 key，
// 「稍后设置」永远存不上，每次启动都弹权限窗。
test('PermissionOnboardingModal 按位置参数调用 host.prefs.get/set', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../src/components/PermissionOnboardingModal.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /prefs\.(get|set)\(\s*\{/)
  assert.match(src, /prefs\.get\(PERMISSION_ONBOARDING_PREF_KEY\)/)
  assert.match(src, /prefs\.set\(PERMISSION_ONBOARDING_PREF_KEY,\s*true\)/)
})

// 问题 4/40：首启时权限窗与「可选组件」窗叠在一起。权限窗的启动检查结束（不弹，或弹了已关）
// 之前，可选组件窗要等着。
test('首启弹窗排队：权限引导启动检查结束前，可选组件窗等待', async () => {
  const mod = await import('../../src/utils/permissionOnboarding.js')
  let settled = false
  mod.whenPermissionOnboardingStartupSettled().then(() => { settled = true })
  await new Promise((r) => setImmediate(r))
  assert.equal(settled, false)
  mod.markPermissionOnboardingStartupSettled()
  await new Promise((r) => setImmediate(r))
  assert.equal(settled, true)

  const { readFileSync } = await import('node:fs')
  const modal = readFileSync(new URL('../../src/components/PermissionOnboardingModal.vue', import.meta.url), 'utf8')
  assert.match(modal, /markPermissionOnboardingStartupSettled\(\)/)
  const overview = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const fn = overview.slice(overview.indexOf('async maybePromptOptionalComponents()'))
  const body = fn.slice(0, fn.indexOf('\n    },\n'))
  assert.match(body, /await whenPermissionOnboardingStartupSettled\(\)/)
  assert.ok(body.indexOf('await whenPermissionOnboardingStartupSettled()') < body.indexOf('this.showOptionalComponents = '))
})
