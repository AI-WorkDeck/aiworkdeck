// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
export const builtinWorkflowTabMethods = {
  openWorkflowEditorTab(request) {
    const id = 'builtin-workflow-settings'
    for (const pane of ['left', 'right']) {
      const tab = this[pane === 'left' ? 'leftFiles' : 'rightFiles'].find(item => item.id === id)
      if (!tab) continue
      tab.workflowRequest = { ...request }
      this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = id
      this.focusedPane = pane
      if (pane === 'right' && !this.splitMode) this.splitMode = true
      this.$nextTick(() => this.triggerWorkbenchResize())
      return
    }
    const pane = this.splitMode && this.focusedPane === 'right' ? 'right' : 'left'
    this[pane === 'left' ? 'leftFiles' : 'rightFiles'].push({
      id, tabType: id, name: this.$t('chat.builtinWorkflowsHeader'), workflowRequest: { ...request }
    })
    this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = id
    this.focusedPane = pane
    this.$nextTick(() => this.triggerWorkbenchResize())
  }
}
