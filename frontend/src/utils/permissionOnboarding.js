// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// macOS 系统权限引导（Codex 式首启权限排查 + 自动打开系统设置 + 拖拽应用浮窗，dev-board#1433）。
//
// 与 FeedbackWidget.vue 同一套挂载模式：在 <body> 下单独 createApp 一个只管权限引导弹窗的
// Vue 实例，跨页面常驻且全局唯一。任何页面（首次启动、微信拖入因 TCC 被拒、设置页按钮）
// 只需 emit `awd:open-permission-onboarding` 或调用 openPermissionOnboarding() 即可唤起。

import { host } from '../services/host.js'

export const PERMISSION_ONBOARDING_EVENT = 'awd:open-permission-onboarding'
export const PERMISSION_ONBOARDING_PREF_KEY = 'macosPermissionsOnboardingDoneV1'
const CONTAINER_ID = 'awd-permission-onboarding'

const DEFAULT_ORDER = ['fullDiskAccess', 'screenRecording', 'microphone', 'accessibility']

export function normalizePermissionItems(rawItems = []) {
  const byId = new Map(
    (Array.isArray(rawItems) ? rawItems : [])
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => [item.id, item])
  )
  return DEFAULT_ORDER.map((id) => {
    const found = byId.get(id) || {}
    return {
      id,
      status: found.status === 'granted' ? 'granted' : 'not-granted',
      supportsDragToSettings: found.supportsDragToSettings !== undefined ? !!found.supportsDragToSettings : id !== 'microphone',
      recommended: found.recommended !== undefined ? !!found.recommended : id !== 'accessibility',
      requiredForWeChatDrop: id === 'fullDiskAccess',
    }
  })
}

export function shouldAutoPromptPermissionOnboarding(state, onboardingDone = false) {
  if (!state || !state.supported) return false
  if (onboardingDone) return false
  const items = normalizePermissionItems(state.items)
  // 核心推荐权限（尤其完全磁盘访问权限 Full Disk Access）未全部开启时，首次启动自动引导
  return items.some((item) => item.recommended && item.status !== 'granted')
}

export function nextMissingPermissionId(items = [], preferredId = '') {
  const normalized = normalizePermissionItems(items)
  if (preferredId) {
    const preferred = normalized.find((item) => item.id === preferredId && item.status !== 'granted')
    if (preferred) return preferred.id
  }
  const missingRec = normalized.find((item) => item.recommended && item.status !== 'granted')
  if (missingRec) return missingRec.id
  const missingAny = normalized.find((item) => item.status !== 'granted')
  return missingAny ? missingAny.id : ''
}

let mounted = false

export async function mountPermissionOnboarding() {
  // #ifdef H5
  if (mounted || typeof document === 'undefined') return
  if (!host.permissions || typeof host.permissions.getStatus !== 'function') return
  if (document.getElementById(CONTAINER_ID)) return
  try {
    const [{ createApp }, { default: PermissionOnboardingModal }, { i18n }] = await Promise.all([
      import('vue'),
      import('@/components/PermissionOnboardingModal.vue'),
      import('@/i18n'),
    ])
    if (mounted || document.getElementById(CONTAINER_ID)) return
    const el = document.createElement('div')
    el.id = CONTAINER_ID
    document.body.appendChild(el)
    createApp(PermissionOnboardingModal).use(i18n).mount(el)
    mounted = true
  } catch (e) {
    console.warn('[permissions] 权限引导浮层挂载失败:', e)
  }
  // #endif
}

export function openPermissionOnboarding(payload = {}) {
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.$emit === 'function') {
      uni.$emit(PERMISSION_ONBOARDING_EVENT, payload)
    }
  } catch (_) { /* ignore */ }
}
