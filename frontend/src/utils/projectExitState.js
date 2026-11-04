// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

function validateStatus(status) {
  if (typeof status?.enabled !== 'boolean' || typeof status?.working !== 'boolean'
    || typeof status?.canCommit !== 'boolean' || !Number.isFinite(status.changedCount) || status.changedCount < 0)
    throw new Error('invalid status')
  return status
}

// Status failures remain visible, never masquerading as an empty project.
export async function inspectExitProject(row, readStatus) {
  row.state = 'checking'
  try {
    const status = validateStatus(await readStatus(row.id))
    row.count = status.changedCount
    row.state = !status.enabled ? 'empty' : status.conflict ? 'conflict'
      : !status.canCommit || (!status.working && !row.count) ? 'empty' : 'ready'
  } catch { row.state = 'failed' }
}

export async function commitExitProjects(rows, commit, readStatus, isCurrent = () => true) {
  let failed = false
  for (const row of rows.filter(row => row.selected && row.state === 'ready')) {
    if (!isCurrent()) return false
    row.state = 'committing'
    try {
      const result = await commit(row.id)
      if (!result || typeof result.sha !== 'string' || typeof result.notice !== 'string' || result.conflict || result.success === false) throw new Error('commit failed')
      // Record the receipt before verification: a retry must not submit it twice.
      row.selected = false
      row.state = 'committed'
    } catch {
      // Unknown receipts require re-reading before another submission.
      row.selected = false
      await inspectExitProject(row, readStatus)
      failed = true
      continue
    }
    try {
      const status = validateStatus(await readStatus(row.id))
      if (status.conflict || status.changedCount > 0 || (status.working && !status.onDraft)) {
        row.count = status.changedCount
        row.state = status.conflict ? 'conflict' : 'ready'
        failed = true
      }
    } catch { row.state = 'failed'; failed = true }
  }
  return !failed && isCurrent()
}
