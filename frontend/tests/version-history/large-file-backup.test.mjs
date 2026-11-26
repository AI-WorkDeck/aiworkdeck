// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C12 (lane C S2): large/AV files need file cloud backup before 交稿. The refusal must be a dialog that
// stays (with the switch), and the workbench warns before submit, not a vanishing toast.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { showLargeFileBackupBlock, OPEN_BACKUP_CONSENT_EVENT } from '../../src/utils/largeFileBackup.js'

test('C12: the large-file refusal opens a persistent dialog whose button opens backup consent', () => {
  let modal = null, emitted = null
  const ui = { showModal: (o) => { modal = o }, $emit: (e) => { emitted = e } }
  const t = (k) => k
  assert.equal(showLargeFileBackupBlock({ kind: 'LARGE_FILES_NEED_BACKUP', message: '这份案卷里有大文件或音视频（庭审录像.mp4）…' }, t, ui), true)
  assert.match(modal.content, /庭审录像\.mp4/)
  assert.equal(modal.confirmText, 'version.largeFilesEnableBackup')
  modal.success({ confirm: true })
  assert.equal(emitted, OPEN_BACKUP_CONSENT_EVENT)
  assert.equal(showLargeFileBackupBlock({ kind: 'VERSION_BUSY' }, t, ui), false, 'other errors keep their toast')
  assert.equal(showLargeFileBackupBlock(null, t, ui), false)
})

test('C12: every 交稿 path uses it, and backup consent opens on the event', () => {
  const read = (p) => readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')
  for (const p of ['components/collab/CollabDialog.vue', 'components/collab/SubmitDraftGuide.vue', 'components/version/CommitHistoryTab.vue', 'pages/project-overview/project-overview.vue']) {
    assert.match(read(p), /showLargeFileBackupBlock\(e, \(k\) => this\.\$t\(k\)\)/, p)
  }
  assert.match(read('components/MobileBackupConsent.vue'), /uni\.\$on\(OPEN_BACKUP_CONSENT_EVENT, this\._openFromElsewhere\)/)
  const page = read('pages/project-overview/project-overview.vue')
  assert.match(page, /v-if="collabLargeFilesBlocked && !collabMemberBlocked && !largeFilesBarDismissed"/)
  assert.match(page, /@tap="openBackupConsent"/)
})
