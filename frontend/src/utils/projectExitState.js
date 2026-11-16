// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Survive cancelling and reopening the chooser: an unknown POST must not become
// an ordinary failed scan that permits terminating the local backend.
const unsettled = new Map()
export const pendingExitProjects = () => [...unsettled.values()].map(row => ({ ...row, state: 'uncertain', selected: false }))

export function selectExitProjectRows(projects, changedIds, pending = []) {
  const changed = new Set(changedIds.map(String))
  const rows = projects.filter(p => changed.has(String(p.id)) && !['SCRATCH', 'LOOSE_FILES'].includes(p.projectType))
    .map(p => ({ id: p.id, name: p.name, selected: false, count: 0, state: 'checking' }))
  for (const pendingRow of pending) {
    const row = rows.find(item => String(item.id) === String(pendingRow.id))
    if (row) Object.assign(row, pendingRow)
    else rows.push({ ...pendingRow })
  }
  return rows
}

function validateStatus(status) {
  if (typeof status?.enabled !== 'boolean' || typeof status?.working !== 'boolean'
    || typeof status?.canCommit !== 'boolean' || !Number.isFinite(status.changedCount) || status.changedCount < 0
    || typeof status.receiptEpoch !== 'string' || !status.receiptEpoch)
    throw new Error('invalid status')
  return status
}

export async function inspectExitProject(row, readStatus) {
  if (unsettled.has(String(row.id))) {
    Object.assign(row, unsettled.get(String(row.id)), { state: 'uncertain', selected: false })
    return
  }
  row.state = 'checking'
  try {
    const status = validateStatus(await readStatus(row.id))
    row.count = status.changedCount
    row.receiptEpoch = status.receiptEpoch
    row.error = ''
    row.errorKind = ''
    row.state = !status.enabled ? 'empty' : status.conflict ? 'conflict'
      : !status.canCommit || !row.count ? 'empty' : 'ready'
  } catch (error) { row.state = 'failed'; row.error = error?.message || ''; row.errorKind = 'status' }
}

export async function settleExitCommit(row, commit, readStatus) {
  row.state = 'committing'
  row.selected = false
  row.error = ''
  row.errorKind = ''
  unsettled.set(String(row.id), { id: row.id, requestId: row.requestId, receiptEpoch: row.receiptEpoch })
  let result
  try { result = await commit(row.id, row.requestId) } catch { row.state = 'uncertain'; return false }
  if (result?.receiptState === 'FAILED') {
    unsettled.delete(String(row.id))
    row.requestId = null
    await inspectExitProject(row, readStatus)
    row.error = result.message || ''
    row.errorKind = 'commit'
    return false
  }
  if (result?.receiptState !== 'SUCCEEDED' || typeof result.sha !== 'string' || typeof result.notice !== 'string') {
    row.state = 'uncertain'
    return false
  }
  unsettled.delete(String(row.id))
  row.requestId = null
  row.error = ''
  row.state = 'committed'
  if (result.conflict || result.success === false) {
    await inspectExitProject(row, readStatus)
    return false
  }
  try {
    const status = validateStatus(await readStatus(row.id))
    if (status.conflict || status.changedCount > 0) {
      row.count = status.changedCount
      row.receiptEpoch = status.receiptEpoch
      row.state = status.conflict ? 'conflict' : 'ready'
      return false
    }
  } catch { row.state = 'failed'; return false }
  return true
}

export async function commitExitProjects(rows, commit, readStatus, isCurrent = () => true) {
  let failed = false
  if (rows.some(row => row.state === 'uncertain')) return false
  for (const row of rows.filter(row => row.selected && row.state === 'ready')) {
    if (!isCurrent()) return false
    row.requestId = `${row.receiptEpoch}:${globalThis.crypto.randomUUID()}`
    if (!await settleExitCommit(row, commit, readStatus)) failed = true
    // Unknown write outcome: stop submitting further projects until resolved.
    if (row.state === 'uncertain') return false
  }
  return !failed && isCurrent()
}
