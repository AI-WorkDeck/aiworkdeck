// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pause model/tool writes first; only then can editor saves form an exit barrier.
export function createDesktopQuitGuard({ prepare, abort, flush, progress, errorText,
  now = Date.now, timeoutMs = 50000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let generation = 0
  let pending = null
  let attemptId = null
  let abortPending = null
  const abortOnce = () => {
    if (!abortPending && attemptId) abortPending = Promise.resolve().then(() => abort({ attemptId }))
    return abortPending
  }
  const cancel = async () => {
    generation++
    return await abortOnce()
  }
  return {
    cancel,
    prepare() {
      if (pending) return pending
      const current = ++generation
      attemptId = globalThis.crypto.randomUUID()
      abortPending = null
      const attempt = { attemptId }
      pending = (async () => {
        const started = now()
        const check = () => {
          if (current !== generation) throw new Error(errorText('cancelled'))
          if (now() - started >= timeoutMs) throw new Error(errorText('timeout'))
        }
        try {
          progress('pausing')
          while (true) {
            check()
            const state = await prepare(attempt)
            check()
            if (state?.ready === true) break
            await wait(300)
          }
          progress('saving')
          const result = await flush()
          check()
          if (result.failed) throw new Error(errorText('saveFailed'))
          return { ok: true }
        } catch (error) {
          let recoveryPending = false
          try { recoveryPending = (await abortOnce())?.paused > 0 } catch (_) { recoveryPending = true }
          return { ok: false, error: (error.message || errorText('saveFailed'))
            + (recoveryPending ? '\n' + errorText('recoveryPending') : '') }
        } finally {
          pending = null
        }
      })()
      return pending
    },
  }
}

const workbenches = new Map()
export function registerQuitSave(owner, save) { workbenches.set(owner, save) }
export function unregisterQuitSave(owner) { workbenches.delete(owner) }
export async function flushQuitWorkbenches() {
  let failed = 0
  for (const save of workbenches.values()) {
    try { failed += (await save()).failed || 0 } catch (_) { failed++ }
  }
  return { failed }
}
