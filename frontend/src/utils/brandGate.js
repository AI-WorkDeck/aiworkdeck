// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 贴牌版本的整屏付费闸：与反馈浮窗同样在 <body> 下单独 createApp 一个实例。
// 只在桌面端挂（团队服务器的浏览器端没有「本机连官网账户」）；后端说 required=false 时组件什么都不渲染。
import { createApp } from 'vue'
import BrandGate from '@/components/account/BrandGate.vue'
import { i18n } from '@/i18n'
import { isDesktopHost } from '@/services/host.js'

const CONTAINER_ID = 'awd-brand-gate-root'

export function mountBrandGate() {
  // #ifdef H5
  if (typeof document === 'undefined' || document.getElementById(CONTAINER_ID)) return
  try {
    if (!isDesktopHost()) return
    const el = document.createElement('div')
    el.id = CONTAINER_ID
    document.body.appendChild(el)
    createApp(BrandGate).use(i18n).mount(el)
  } catch (e) {
    console.warn('[brandGate] 挂载失败:', e)
  }
  // #endif
}
