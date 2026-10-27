// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
export function ddSubmissionFor(item, submissionsByItem = {}) {
  const value = submissionsByItem[item.id]
  if (Array.isArray(value)) return value.find(s => String(s.id) === String(item.currentSubmissionId)) || value[0] || null
  return value || null
}
export function ddWorkflowStatus(item, submission) {
  if (submission?.appealedAt && submission.reviewStatus === 'UPLOADED' && item.status === 'UPLOADED'
      && (!submission.reviewedAt || new Date(submission.appealedAt) > new Date(submission.reviewedAt))) return 'APPEALED'
  if (item.status === 'APPROVED' || submission?.reviewStatus === 'APPROVED') return 'APPROVED'
  if (item.status === 'REJECTED' || submission?.reviewStatus === 'REJECTED') return 'REJECTED'
  if (submission?.aiStatus === 'QUEUED' || submission?.aiStatus === 'RUNNING') return 'CHECKING'
  if (submission?.aiStatus === 'FAILED') return 'AI_FAILED'
  if (submission?.aiStatus === 'MANUAL_REQUIRED') return 'MANUAL_REQUIRED'
  if (submission?.aiStatus === 'PASSED') return 'AI_PASSED'
  if (submission || item.uploadedFileId) return 'REVIEW'
  return 'PENDING'
}
export function ddIsCategory(item, items, submissions = {}) {
  return !!item && items.some(child => String(child.parentId) === String(item.id))
    && !item.currentSubmissionId && !item.uploadedFileId && !ddSubmissionFor(item, submissions)
}
export function ddWorkflowCounts(items, submissions) {
  const actionable = items.filter(item => !ddIsCategory(item, items, submissions))
  const counts = { ALL: actionable.length, PENDING: 0, REVIEW: 0, APPROVED: 0, CHANGES: 0, APPEALED: 0 }
  for (const item of actionable) {
    const status = ddWorkflowStatus(item, ddSubmissionFor(item, submissions))
    if (['REVIEW', 'AI_PASSED', 'CHECKING', 'MANUAL_REQUIRED'].includes(status)) counts.REVIEW++
    else if (['REJECTED', 'AI_FAILED'].includes(status)) counts.CHANGES++
    else if (status in counts) counts[status]++
  }
  return counts
}
export function ddMatchesFilter(item, submission, filter) {
  const status = ddWorkflowStatus(item, submission)
  if (filter === 'ALL') return true
  if (filter === 'REVIEW') return ['REVIEW', 'AI_PASSED', 'CHECKING', 'MANUAL_REQUIRED'].includes(status)
  if (filter === 'CHANGES') return ['REJECTED', 'AI_FAILED'].includes(status)
  return filter === status
}
export function ddPublishIssues(name, items) {
  const issues = []
  if (!String(name || '').trim()) issues.push('name')
  if (!items.length) issues.push('items')
  if (items.some(i => !String(i.title || '').trim())) issues.push('titles')
  return issues
}
export function ddAiResult(submission) {
  if (!submission?.aiResultJson) return null
  try { return typeof submission.aiResultJson === 'string' ? JSON.parse(submission.aiResultJson) : submission.aiResultJson } catch { return null }
}
export function ddSubmissionFiles(submission) { return Array.isArray(submission?.files) ? submission.files : [] }

export function ddJobResult(job) {
  if (job?.result && typeof job.result === 'object') return job.result
  try { return JSON.parse(job?.resultJson || '{}') } catch { return {} }
}

/** Poll an existing job after a network interruption; never re-submit an AI operation. */
export async function waitForDdJob(job, load, { signal, onUpdate = () => {}, interval = 1500, timeout = 600000 } = {}) {
  const started = Date.now()
  let current = job
  while (true) {
    if (signal?.aborted) throw Object.assign(new Error('Job observation stopped'), { name: 'AbortError' })
    onUpdate(current)
    if (current?.status === 'SUCCEEDED') return ddJobResult(current)
    if (['FAILED', 'CANCELED', 'CANCELLED'].includes(current?.status)) throw new Error(current.error || current.errorMessage || 'Task failed')
    if (!current?.id) throw new Error('The server did not return a task ID')
    if (Date.now() - started >= timeout) throw Object.assign(new Error('The task is still running. Refresh its status to continue.'), { name: 'TimeoutError' })
    await new Promise((resolve, reject) => {
      const finish = () => { signal?.removeEventListener('abort', abort); resolve() }
      const timer = setTimeout(finish, interval)
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(Object.assign(new Error('Job observation stopped'), { name: 'AbortError' })) }
      signal?.addEventListener('abort', abort, { once: true })
    })
    current = await load(current.id)
  }
}

/** All rows remain in their original hierarchy while filters only remove unrelated leaves. */
export function ddOrderedItems(items) {
  const result = [], seen = new Set()
  const sorted = [...items].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  const ids = new Set(items.map(i => String(i.id)))
  const visit = (item, depth) => {
    if (seen.has(String(item.id))) return
    seen.add(String(item.id)); result.push({ ...item, depth })
    sorted.filter(i => String(i.parentId) === String(item.id)).forEach(i => visit(i, depth + 1))
  }
  sorted.filter(i => i.parentId == null || !ids.has(String(i.parentId))).forEach(i => visit(i, 0))
  sorted.forEach(i => visit(i, 0))
  return result
}
