// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createApp } from 'vue'
import ProjectExitDialog from '@/components/version/ProjectExitDialog.vue'
import { t } from '@/i18n'
import { pendingExitProjects } from './projectExitState.js'
import { getSessionId } from './auth.js'
import { isDesktopHost } from '@/services/host.js'
import { setGlobalOverlay } from './overlayState.js'

export function confirmProjectExit({ isCurrent = () => true } = {}) {
  if (!isDesktopHost() && !getSessionId() && !pendingExitProjects().length) return Promise.resolve(true)
  return new Promise(resolve => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const holder = Symbol('project-exit')
    setGlobalOverlay(true, holder)
    const previousFocus = document.activeElement
    let timer, closed = false
    const finish = accepted => {
      if (closed) return
      closed = true
      clearInterval(timer)
      app.unmount()
      container.remove()
      setGlobalOverlay(false, holder)
      previousFocus?.focus?.()
      resolve(accepted && isCurrent())
    }
    const app = createApp(ProjectExitDialog, { isCurrent, onClose: finish })
    app.config.globalProperties.$t = t
    app.mount(container)
    timer = setInterval(() => { if (!isCurrent()) finish(false) }, 200)
  })
}
