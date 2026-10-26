// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The numeric badge counts files relative to HEAD, never commits or cloud uploads.
export function versionEntryState(t, { status = {}, cloud, conflict = false, unavailable = false } = {}) {
  const count = status.enabled ? Math.max(0, Math.floor(Number(status.changedCount) || 0)) : 0
  const details = []
  if (unavailable) details.push(t('version.entryUnavailable'))
  else if (count) details.push(t('version.pendingFileCount', { count }))
  else if (status.enabled && status.working && !status.onDraft) details.push(t('version.changesAutoRecorded'))
  if (conflict) details.push(t('version.pendingChoice'))
  if (cloud?.linked) {
    if (cloud.offline) details.push(t('version.libraryUnreachable'))
    else {
      if (cloud.pendingUpload) details.push(t('version.pendingCloudUpload'))
      if (cloud.remoteAhead) details.push(t('version.pendingCloudUpdate'))
    }
  }
  const badge = unavailable || conflict ? '!'
    : count ? (count > 99 ? '99+' : String(count))
      : cloud?.linked && cloud.offline ? '!'
        : cloud?.linked && cloud.pendingUpload && cloud.remoteAhead ? '↕'
          : cloud?.linked && cloud.pendingUpload ? '↑'
            : cloud?.linked && cloud.remoteAhead ? '↓'
              : status.enabled && status.working && !status.onDraft ? '·' : ''
  return {
    badge,
    attention: unavailable || conflict || !!(cloud?.linked && cloud.offline),
    title: [t('version.controlEntry'), ...details, t('version.openProjectChanges')].join(' · '),
  }
}
