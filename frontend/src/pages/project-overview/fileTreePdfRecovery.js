// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Continue a single-file conversion in its ordinary visible editor. No save/reload of dirty bytes.
function targetTab(vm, file) {
  for (const pane of ['left', 'right']) {
    const tab = ((pane === 'left' ? vm.leftFiles : vm.rightFiles) || []).find(t => !t.tabType && String(t.id) === String(file.id))
    if (tab) return { pane, tab }
  }
  return null
}

function loadFailed(editor) {
  return editor.docLoadFailed || (editor.isError && !['saveFailed', 'movedSaveFailed'].includes(editor.statusKey))
}

export async function resumePdfExport(vm, file, { timeoutMs = 300000, pollMs = 100, retry = false } = {}) {
  vm.cancelFileTreePdfExport()
  if (!file || file.isFolder || file.id == null) return false
  const projectId = vm.projectId
  const task = { file, projectId }
  vm._pdfRecoveryTask = task
  vm.pdfRecovery = { name: file.name, phase: 'opening' }
  const currentProject = () => vm._pdfRecoveryTask === task && vm.projectId === projectId
  let target
  try {
    target = targetTab(vm, file)
    if (target) vm.activateTab(target.tab, target.pane)
    else vm.handleFileTreeOpen(file)
    target = targetTab(vm, file)
    if (!target) throw new Error('open failed')
    const current = () => currentProject() && (target.pane === 'left' ? vm.leftFiles : vm.rightFiles).includes(target.tab)
    const key = target.pane + ':' + target.tab.id
    const initialEditor = vm._libreRefs?.[key]
    // Only an explicit retry may restart a failed, unmodified document load.
    if (retry && initialEditor && loadFailed(initialEditor) && !initialEditor.dirty) initialEditor.retryLoad?.()
    const deadline = Date.now() + timeoutMs
    while (current()) {
      const editor = vm._libreRefs?.[key]
      if (editor && String(editor.file?.id) === String(file.id)) {
        if (loadFailed(editor) || ['desktopOnly', 'unsupported'].includes(editor.statusKey)) throw new Error('editor failed')
        if (editor.ready && editor.executor && !editor._reloading && !editor.loadingOverlayVisible) {
          const executor = editor.executor
          const stillCurrent = () => current() && vm._libreRefs?.[key] === editor && editor.executor === executor && String(editor.file?.id) === String(file.id)
          vm.pdfRecovery = { name: file.name, phase: 'exporting' }
          const result = await editor.exportPdf({ isCurrent: stillCurrent })
          if (!stillCurrent()) break
          if (result !== true) throw new Error('export failed')
          // This means the Save As flow was started, not that a PDF was saved.
          vm.cancelFileTreePdfExport()
          return true
        }
      }
      if (Date.now() >= deadline) throw new Error('editor timeout')
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
    if (vm._pdfRecoveryTask === task) vm.cancelFileTreePdfExport()
  } catch (_) {
    if (currentProject()) vm.pdfRecovery = { name: file.name, phase: 'failed' }
  }
  return false
}

export const fileTreePdfRecoveryMethods = {
  handleFileTreePdfExport(file) { return resumePdfExport(this, file) },
  retryFileTreePdfExport() {
    const task = this._pdfRecoveryTask
    if (task && task.projectId === this.projectId) return resumePdfExport(this, task.file, { retry: true })
  },
  cancelFileTreePdfExport() {
    this._pdfRecoveryTask = null
    this.pdfRecovery = null
  },
}
