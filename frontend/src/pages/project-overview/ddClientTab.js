// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export const ddClientTabMethods = {
  openDdClientTab() {
    for (const pane of ['left', 'right']) {
      const existing = this[pane === 'left' ? 'leftFiles' : 'rightFiles'].find(tab => tab.tabType === 'dd-client')
      if (!existing) continue
      this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = existing.id
      this.focusedPane = pane
      if (pane === 'right' && !this.splitMode) this.splitMode = true
      this.$nextTick(() => this.triggerWorkbenchResize())
      return
    }
    const pane = this.splitMode && this.focusedPane === 'right' ? 'right' : 'left'
    this[pane === 'left' ? 'leftFiles' : 'rightFiles'].push({ id: 'dd-client', tabType: 'dd-client', name: this.$t('ddWorkflow.clientWorkspace') })
    this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = 'dd-client'
    this.focusedPane = pane
    this.$nextTick(() => this.triggerWorkbenchResize())
  },
}
