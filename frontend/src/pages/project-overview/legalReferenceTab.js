// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { legalReferenceId } from '../../utils/legalReferences.js'

export const legalReferenceTabMethods = {
  openLegalReferenceTab(reference) {
    if (!reference || !['LAW', 'CASE', 'PENALTY'].includes(reference.kind) || !reference.title) return
    const id = legalReferenceId(reference)
    for (const pane of ['left', 'right']) {
      const existing = this[pane === 'left' ? 'leftFiles' : 'rightFiles'].find(tab => tab.id === id)
      if (!existing) continue
      if (pane === 'right') this.splitMode = true
      this.focusedPane = pane
      this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = id
      this.$nextTick(() => this.triggerWorkbenchResize())
      return
    }
    this.splitMode = true
    this.focusedPane = 'right'
    this.rightFiles.push({ id, tabType: 'legal-reference', name: reference.title, legalReference: JSON.parse(JSON.stringify(reference)) })
    this.activeFileIdRight = id
    this.$nextTick(() => this.triggerWorkbenchResize())
  },
}
