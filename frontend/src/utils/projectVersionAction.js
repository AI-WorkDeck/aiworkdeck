// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const terminal = state => ['succeeded', 'failed', 'cancelled'].includes(state?.status)
export const versionActionMayWrite = state => !terminal(state)
export const versionActionConflict = status => status?.sessionEndConflict || status?.cloudConflict || status?.adoptConflict || null
export function sameVersionActionConflict(operation, result, status) {
  const before = result?.conflict
  const after = operation === 'commit' ? status?.sessionEndConflict : operation === 'pull' ? status?.cloudConflict : null
  const tip = operation === 'commit' ? 'sessionTip' : 'cloudTip'
  return !!(before && after && before.mainlineTip && before[tip] && before.mainlineTip === after.mainlineTip &&
    before[tip] === after[tip] && (operation !== 'commit' || before.sessionId === after.sessionId))
}

// Each continuation is registered on the original server action. A lost reply
// is reconciled by stepId; the host never resends a possible write.
export function createProjectVersionMergeApi({ operationId, current, state, post, postFile, wait, onStep }) {
  let sequence = 0
  async function step(kind, body = {}) {
    if (!current()) throw Object.assign(new Error('aiActionExpired'), { writeSettled: true })
    const stepId = `${operationId}:merge:${++sequence}`
    onStep?.(stepId)
    let receipt
    try { receipt = await (kind === 'file' ? postFile({ ...body, stepId }) : post({ kind, path: body.path, stepId })) }
    catch { /* Only query the registered step; never retry the POST. */ }
    for (let i = 0; i <= 60; i++) {
      const result = receipt?.lastStep
      if (result?.stepId === stepId && ['succeeded', 'failed'].includes(result.status)) {
        onStep?.(null)
        if (!result.result?.success || result.result?.outcomeUnknown) throw Object.assign(new Error(result.result?.error || 'aiActionFailed'), { writeSettled: true })
        return { data: result.result }
      }
      if (i === 60) break
      if (!current()) throw new Error('aiActionUnknown')
      try { receipt = await state(stepId) } catch { /* Missing state remains unknown. */ }
      if (receipt?.lastStep?.stepId !== stepId || !['succeeded', 'failed'].includes(receipt.lastStep.status)) await wait(1000)
    }
    throw new Error('aiActionUnknown')
  }
  return {
    postMergeResolveFile: (_, body) => step('file', body),
    postMergeResolveStructured: (_, body) => step('structured', body),
    resolveCloudMerge: () => step('finalize'),
    resolveSessionEnd: () => step('finalize'),
  }
}

// The host owns saving and reloads; the server owns identity, authorization and
// exactly-once mutation. Never repeat execute to recover a lost HTTP receipt.
export function createProjectVersionActionRunner(deps) {
  const operations = new Map()
  let active = false
  const failure = code => ({ success: false, code })
  async function run(action) {
    const { operationId, projectId, operation } = action.params || {}
    if (!operationId || !action.requestId || !action.conversationId || !['commit', 'pull', 'restore'].includes(operation)) return failure('aiInvalidAction')
    if (active) return failure('aiActionBusy')
    active = true
    const current = deps.capture(action)
    const assertCurrent = () => { if (!current()) throw new Error('aiActionExpired') }
    let protection, submitted = false, settled = false, blocked = false
    try {
      assertCurrent()
      const initial = await deps.state(action)
      assertCurrent()
      if (!initial?.valid || initial.status !== 'prepared' || String(initial.projectId) !== String(projectId) || initial.operation !== operation) return failure('aiActionExpired')
      if (deps.busy?.()) return failure('aiActionBusy')
      if (deps.unsupportedEditor()) return failure('aiDrawioSaveFirst')
      // Buffered streaming must finish before this project-wide barrier begins.
      if (deps.streaming()) return failure('aiStreamBusy')
      deps.block(true, operationId); blocked = true
      deps.progress('saving')
      if (!await deps.save()) return failure('saveBeforeCommitFailed')
      assertCurrent()
      protection = await deps.protect(action, current)
      assertCurrent()
      const ready = await deps.state(action)
      assertCurrent()
      if (!ready?.valid || ready.status !== 'prepared') throw new Error('aiActionExpired')
      deps.progress('executing')
      submitted = true
      let receipt
      try { receipt = await deps.execute(action) } catch { /* Reconcile the single operation below. */ }
      for (let i = 0; !terminal(receipt) && i < 60; i++) {
        assertCurrent()
        try { receipt = await deps.state(action) } catch { /* An unavailable state is never an acknowledgement. */ }
        if (!terminal(receipt)) await deps.wait(1000)
      }
      if (!terminal(receipt)) throw new Error('aiActionUnknown')
      settled = true
      assertCurrent()
      const result = receipt.result || {}
      let autoMerged = false
      deps.progress('reloading')
      let status = await deps.readStatus()
      assertCurrent()
      if (typeof status?.enabled !== 'boolean') throw new Error('aiActionUnknown')
      if (receipt.status !== 'cancelled' && sameVersionActionConflict(operation, result, status)) {
        const live = await deps.state(action)
        assertCurrent()
        if (live?.canContinue !== true) deps.holdConflict?.(status)
        if (live?.canContinue === true) deps.progress('merging')
        const merged = live?.canContinue === true ? await deps.merge(status) : null
        assertCurrent()
        if (merged?.uncertain) {
          throw new Error('aiActionUnknown')
        }
        status = await deps.readStatus()
        assertCurrent()
        if (typeof status?.enabled !== 'boolean') throw new Error('aiActionUnknown')
        autoMerged = merged?.merged === true && !versionActionConflict(status)
      }
      deps.progress('reloading')
      if (!await protection.reload()) throw new Error('aiReloadFailed')
      assertCurrent()
      await deps.refresh()
      assertCurrent()
      protection.release()
      protection = null
      if (versionActionConflict(status)) { deps.openOverview(); return { ...failure('aiConflictNeedsReview'), hostReloaded: true } }
      if (!result.success && !autoMerged) return { ...failure('aiActionFailed'), message: result.error, hostReloaded: true }
      return { success: true, operationId, hostReloaded: true, ...(autoMerged ? { autoMerged: true } : {}) }
    } catch (error) {
      // A late write or failed reload must never reactivate the old in-memory
      // document. Its barrier reconciles against operation state on a later load.
      if (protection) {
        if (!submitted) {
          try { if (await protection.reload()) protection.release(); else protection.invalidate() }
          catch { protection.invalidate() }
        } else protection.invalidate()
      }
      const code = ['aiActionExpired', 'aiActionUnknown', 'aiReloadFailed', 'aiEditorNotReady', 'aiActionBusy', 'saveBeforeCommitFailed'].includes(error.message) ? error.message : 'aiActionFailed'
      return failure(!settled && submitted ? 'aiActionUnknown' : code)
    } finally {
      if (blocked) deps.block(false, operationId)
      active = false
    }
  }
  return {
    run(action) {
      const id = action.params?.operationId
      // Keep completed receipts too: SSE replay cannot repeat saving or mutation.
      if (!id) return Promise.resolve(failure('aiInvalidAction'))
      if (!operations.has(id)) operations.set(id, Promise.resolve().then(() => run(action)))
      return operations.get(id)
    },
  }
}
