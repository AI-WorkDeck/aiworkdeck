// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// working can describe a mainline session left active while the user is on a
// draft. Committing that draft only clears its own changed files.
const pendingWork = status => status.enabled && ((status.working && !status.onDraft) || Number(status.changedCount) > 0)
const hasConflict = status => !!(status?.conflict || status?.adoptConflict || status?.sessionEndConflict || status?.cloudConflict)

// Callers unwrap API responses and localize the bounded onBlocked reason.
// save must confirm durable completion with true; commit receives the latest
// status so the caller can select the current work-session or draft operation.
// progress reports real commit-flow stages only; idle releases the caller's UI.
export function createVersionExitGuard({ save, readStatus, choose, commit, onBlocked = () => {}, isCurrent = () => true, progress = () => {} }) {
  let pending = null
  const reportProgress = stage => {
    try { Promise.resolve(progress(stage)).catch(() => {}) } catch {}
  }
  const blocked = async reason => {
    // A notification failure must not turn a blocked exit into an unhandled
    // rejection (or authorize closing the project).
    if (isCurrent()) { try { await onBlocked(reason) } catch {} }
    return false
  }
  const read = async () => {
    const status = await readStatus()
    if (!status || typeof status.enabled !== 'boolean'
      || (status.enabled && (typeof status.working !== 'boolean' || !Number.isFinite(status.changedCount) || status.changedCount < 0)))
      throw new Error('status-failed')
    return status
  }

  async function run() {
    let failure = 'save-failed', progressing = false
    try {
      if (!isCurrent()) return false
      if (await save() !== true) return blocked(failure)
      if (!isCurrent()) return false
      failure = 'status-failed'
      let status = await read()
      if (!isCurrent()) return false
      if (!pendingWork(status)) return true

      failure = 'choice-failed'
      const choice = await choose(status)
      if (!isCurrent()) return false
      if (choice === 'skip') return true
      if (choice !== 'commit') return false

      // The user may have continued editing, or another operation may have
      // changed the work session while the confirmation was open.
      progressing = true
      reportProgress('saving')
      failure = 'save-failed'
      if (await save() !== true) return blocked(failure)
      if (!isCurrent()) return false
      failure = 'status-failed'
      status = await read()
      if (!isCurrent()) return false
      if (hasConflict(status)) return blocked('conflict')
      if (!pendingWork(status)) return true
      reportProgress('committing')
      failure = 'commit-failed'
      const result = await commit(status)
      if (!isCurrent()) return false
      if (hasConflict(result)) return blocked('conflict')
      if (result?.success === false) return blocked(failure)
      reportProgress('checking')
      failure = 'status-failed'
      status = await read()
      if (!isCurrent()) return false
      if (hasConflict(status)) return blocked('conflict')
      if (pendingWork(status)) return blocked('new-changes')
      return true
    } catch {
      return blocked(failure)
    } finally {
      if (progressing) reportProgress('idle')
    }
  }

  return {
    confirm() {
      // Start in a microtask so even a reentrant save callback sees the same
      // in-flight decision. Never impose a timer on an ongoing document save.
      if (!pending) pending = Promise.resolve().then(run).finally(() => { pending = null })
      return pending
    },
  }
}
