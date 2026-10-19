// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

let startupClaimed = false

export function claimRestartStartup(query = {}, desktop = false) {
  if (!desktop) return false
  // A deep link, system file open, or deliberate project navigation wins over recovery.
  if (Object.keys(query).some(key => key !== 'restartConversation' && key !== 'id')) return false
  if (query.restartConversation) return true
  if (query.id || startupClaimed) return false
  startupClaimed = true
  return true
}

const same = (a, b) => String(a ?? '') === String(b ?? '')

/** Event-driven startup coordinator. Dependencies are injected for lifecycle/race tests. */
export function createRestartRecovery(vm, {
  pending, fileDetail, identity, nextTick, navigate, autoEligible = false,
  chatTimeoutMs = 20000, editorTimeoutMs = 180000,
}) {
  let epoch = 0
  let disposed = false
  let running = false
  const waiters = new Set()
  const cancel = () => {
    epoch++
    for (const wake of [...waiters]) wake()
    vm.restartRestoring = false
  }
  const notify = () => { for (const wake of [...waiters]) wake() }
  function waitUntil(probe, live, timeoutMs) {
    return new Promise(resolve => {
      let timer
      const finish = value => { clearTimeout(timer); waiters.delete(check); resolve(value) }
      const check = () => {
        if (!live()) return finish(false)
        const state = probe()
        if (state === 'failed') return finish(false)
        if (state) finish(true)
      }
      waiters.add(check)
      // A deadline only fails the attempt; it never treats elapsed time as readiness.
      timer = setTimeout(() => finish(false), timeoutMs)
      check()
    })
  }
  function editorState(task) {
    if (!same(vm.currentActiveTab?.id, task.activeFileId)) return 'failed'
    const executor = vm.libreOfficeExecutor
    if (!executor || !same(vm.resolveLibreExecutorFileId(executor), task.activeFileId)) return false
    if (vm.libreLoadFailureOf(executor)) return 'failed'
    const entry = Object.entries(vm.getLibreExecutorMap()).find(([, value]) => value === executor)
    const instance = entry && vm._libreRefs?.[entry[0]]
    if (!instance || !same(instance.file?.id, task.activeFileId)) return false
    if (instance.docLoadFailed || instance._checkpointInvalidated || instance.canWrite === false) return 'failed'
    return !!instance.ready && !instance._reloading
  }
  async function recover(task) {
    if (disposed || running || !task?.conversationId || !task?.projectId) return false
    running = true
    const token = ++epoch
    const account = identity()
    const live = () => !disposed && epoch === token && identity() === account
    vm.restartRestoring = true
    vm.restartRecoveryFailed = false
    try {
      if (!same(vm.projectId, task.projectId)) {
        const url = `/pages/project-overview/project-overview?id=${encodeURIComponent(task.projectId)}`
          + `&restartConversation=${encodeURIComponent(task.conversationId)}`
        return await navigate(url, live)
      }
      if (!vm.projectInfoLoaded || vm.isClientView) throw new Error('project unavailable')
      vm.restoredLastConversation = true
      if (!vm.showAiPanel) vm.toggleAiPanel()
      if (!await waitUntil(() => !!vm.$refs.chatInterface?.resumeAfterRestart, live, chatTimeoutMs)) {
        if (live()) vm.restartRecoveryFailed = true
        return false
      }
      if (!live()) return false
      const loaded = await vm.loadHistoryChat({ conversationId: task.conversationId, restartRecovery: true })
      if (!live() || !same(vm.currentConversationId, task.conversationId)) return false
      if (!loaded) { vm.restartRecoveryFailed = true; return false }
      if (task.activeFileId != null) {
        const file = await fileDetail(Number(task.projectId), task.activeFileId)
        if (!live() || !same(vm.currentConversationId, task.conversationId)) return false
        if (!file || !same(file.id, task.activeFileId) || file.isFolder || file.isDeleted || file.deleted
            || (file.projectId != null && !same(file.projectId, task.projectId))) throw new Error('file unavailable')
        vm.openFile(file, { restartRecovery: true })
        await nextTick()
        if (!live()) return false
        if (vm.isEditorOpenableFile(file)) {
          if (!await waitUntil(() => editorState(task), live, editorTimeoutMs)) {
            if (live()) vm.restartRecoveryFailed = true
            return false
          }
        } else if (!same(vm.currentActiveTab?.id, task.activeFileId)) return false
      } else {
        // Keep restored tabs, but do not bind an unrelated active document to a task
        // that had no editor target. Both panes must be inactive before opening welcome.
        vm.activeFileIdLeft = null
        vm.activeFileIdRight = null
        vm.openWelcomeTab()
        await nextTick()
      }
      if (!live() || !same(vm.currentConversationId, task.conversationId)) return false
      const resumed = await vm.$refs.chatInterface.resumeAfterRestart(task.activeFileId ?? null, live)
      if (!live()) return false
      if (resumed) vm.restartPendingTasks = vm.restartPendingTasks.filter(item => !same(item.conversationId, task.conversationId))
      else vm.restartRecoveryFailed = true
      return resumed
    } catch (error) {
      if (live()) vm.restartRecoveryFailed = true
      return false
    } finally {
      running = false
      if (epoch === token) vm.restartRestoring = false
    }
  }
  return {
    cancel, notify, recover,
    async start(query = {}) {
      if (disposed) return false
      const token = epoch
      const account = identity()
      try {
        const tasks = await pending()
        if (disposed || identity() !== account) return false
        vm.restartPendingTasks = Array.isArray(tasks) ? tasks : []
        if (!autoEligible || epoch !== token || token !== 0) return false
        const task = query.restartConversation
          ? vm.restartPendingTasks.find(item => same(item.conversationId, query.restartConversation) && same(item.projectId, vm.projectId))
          : vm.restartPendingTasks[0]
        return task ? await recover(task) : false
      } catch (error) {
        // Authentication/permissions remain authoritative; never recover cached tasks.
        if (!disposed) vm.restartPendingTasks = []
        return false
      }
    },
    dispose() { disposed = true; cancel() },
  }
}
