// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C12 (lane C S2): a case with a large or audio/video file can't be submitted until file cloud
// backup is on. That used to surface as a toast that vanished, with no way to turn backup on.
// Every 交稿 entry point now shows a dialog that stays until dismissed and offers the switch; the
// backend message (kind LARGE_FILES_NEED_BACKUP) already names the files and says deleting them
// won't help.

export const LARGE_FILES_NEED_BACKUP = 'LARGE_FILES_NEED_BACKUP'
export const OPEN_BACKUP_CONSENT_EVENT = 'awd:open-backup-consent'

/** @returns {boolean} true when the error was the large-file case and the dialog is shown */
export function showLargeFileBackupBlock(err, t, ui = null) {
  const kind = err && (err.kind || (err.data && err.data.kind))
  if (kind !== LARGE_FILES_NEED_BACKUP) return false
  if (!ui) {
    if (typeof uni === 'undefined') return false
    ui = { showModal: (o) => uni.showModal(o), $emit: (e) => uni.$emit(e) }
  }
  ui.showModal({
    title: t('version.largeFilesNeedBackupTitle'),
    content: String((err && err.message) || t('version.largeFilesNeedBackupBody')),
    confirmText: t('version.largeFilesEnableBackup'),
    cancelText: t('common.cancel'),
    success: (r) => { if (r && r.confirm) ui.$emit(OPEN_BACKUP_CONSENT_EVENT) },
  })
  return true
}
