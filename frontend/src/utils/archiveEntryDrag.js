// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
export const ARCHIVE_ENTRY_MIME = 'application/x-checkba-archive-entry'

function validEntry(value) {
  return value && /^\d+$/.test(String(value.projectId)) && /^\d+$/.test(String(value.fileId)) &&
    typeof value.path === 'string' && value.path.length > 0
}

export function readArchiveEntryDrag(dt) {
  try {
    const value = JSON.parse(dt?.getData(ARCHIVE_ENTRY_MIME) || 'null')
    if (validEntry(value)) return value
  } catch (_) { /* protected drag data store */ }
  const value = typeof document !== 'undefined' && document.__checkbaDraggedArchiveEntry
  return validEntry(value) ? value : null
}

export function isArchiveEntryDrag(dt) {
  return !!readArchiveEntryDrag(dt) || Array.from(dt?.types || []).includes(ARCHIVE_ENTRY_MIME)
}

export function beginArchiveEntryDrag(dt, entry) {
  if (!validEntry(entry)) return false
  if (typeof document !== 'undefined') document.__checkbaDraggedArchiveEntry = entry
  if (dt) {
    dt.effectAllowed = 'copy'
    dt.setData(ARCHIVE_ENTRY_MIME, JSON.stringify(entry))
  }
  return true
}

export function endArchiveEntryDrag(entry) {
  if (typeof document !== 'undefined' && document.__checkbaDraggedArchiveEntry === entry) {
    document.__checkbaDraggedArchiveEntry = null
  }
}
