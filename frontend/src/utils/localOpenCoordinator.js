// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// System requests and the File menu share one queue. Navigation must finish restoring
// the destination's tabs before appending a file, and must save the old editors first.
export function createLocalOpenCoordinator({ openFile, navigate, ready, failedMessage, timeoutMs = 30000 }) {
  let active = null
  let tail = Promise.resolve()
  const waiters = new Set()
  const matches = (vm, id) => vm && String(vm.projectId) === String(id)

  function register(vm) {
    active = vm
    for (const waiter of [...waiters]) {
      if (matches(vm, waiter.id)) waiter.finish(vm)
    }
    ready()
  }

  function waitFor(id) {
    let waiter
    let timer
    let settled = false
    const promise = new Promise((resolve, reject) => {
      waiter = {
        id,
        arm() {
          if (settled) return
          timer = setTimeout(() => {
            settled = true
            waiters.delete(waiter)
            reject(new Error(failedMessage()))
          }, timeoutMs)
        },
        finish(value) { settled = true; clearTimeout(timer); waiters.delete(waiter); resolve(value) },
      }
      waiters.add(waiter)
    })
    // Navigation can itself take time. Keep timeout rejection handled until awaited.
    promise.catch(() => {})
    return { promise, arm: () => waiter.arm(), cancel: () => waiter.finish(null) }
  }

  async function enter(projectId, loose) {
    if (matches(active, projectId)) return active
    const target = waitFor(projectId)
    const url = `/pages/project-overview/project-overview?id=${encodeURIComponent(projectId)}` + (loose ? '&loose=1' : '')
    try {
      const result = active ? await active.leaveWorkbench(url) : await navigate(url)
      if (result === false) { target.cancel(); return null }
      target.arm() // Saving the old editors is not part of the destination readiness timeout.
      return await target.promise
    } catch (error) {
      target.cancel()
      throw error
    }
  }

  function enqueue(action) {
    const result = tail.then(action)
    tail = result.catch(() => {})
    return result
  }

  return {
    register,
    unregister(vm) { if (active === vm) active = null },
    enqueue,
    enter,
    open(path) {
      return enqueue(async () => {
        const response = await openFile({ path })
        const data = response?.data
        if (!data?.projectId || !data.file?.id) throw new Error(failedMessage())
        const vm = await enter(data.projectId, true)
        if (!vm) return false
        vm.openFile(data.file)
        return true
      })
    },
  }
}
