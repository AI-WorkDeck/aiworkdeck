// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Resume only the original live conversation after an authenticated user choice. */
export function createOcrRoutingHandler(deps) {
  let state = null, generation = 0, pending = null
  const publish = () => deps.onState(state && { ...state })
  const valid = () => pending && pending.conversation === deps.conversation()
    && pending.identity === deps.identity() && pending.count === deps.userCount()
  function clear() { generation++; state = null; pending = null; publish() }
  async function revoke(snapshot, mark) {
    if (!snapshot.state || !snapshot.pending) return true
    try {
      await snapshot.pending.cancel?.({ decisionId: snapshot.state.decisionId, conversationId: snapshot.pending.conversation })
      if (mark === generation && state?.phase === 'cancelFailed' && state.decisionId === snapshot.state.decisionId) clear()
      return true
    } catch (_) {
      if (mark === generation && !state) {
        pending = snapshot.pending
        const cancelFailedMsg = typeof deps.t === 'function'
          ? deps.t('admin.ocrChoiceCancelFailedError')
          : '取消尚未确认，请重试。已发出的识别请求无法撤回；确认取消后会停止后续页面。'
        state = { ...snapshot.state, phase: 'cancelFailed', error: cancelFailedMsg }
        publish()
      }
      return false
    }
  }
  function cancel() {
    const snapshot = { state, pending }
    clear()
    return revoke(snapshot, generation)
  }
  function onAction(action) {
    if (action.conversationId !== deps.conversation() || !action.decisionId) return
    if (state?.decisionId === action.decisionId && valid()) return
    cancel()
    pending = { conversation: deps.conversation(), identity: deps.identity(), count: deps.userCount(),
      text: deps.lastUserMessage(), cancel: deps.captureCancel?.() || deps.cancel }
    state = { ...action, phase: 'choose', error: '' }; publish()
  }
  async function continueReady() {
    if (!state || state.phase !== 'ready') return false
    if (!valid()) { await cancel(); return false }
    if (deps.streaming()) return false
    const text = pending.text
    if (!text) { await cancel(); return false }
    clear() // Successful handoff retains the server decision for the resumed run.
    await deps.resend(text)
    return true
  }
  async function choose(choice, remember = false) {
    if (!state || state.phase !== 'choose') return false
    if (!valid()) { await cancel(); return false }
    if (choice === 'local' && !state.localAvailable) return false
    const mark = generation, snapshot = { state: { ...state }, pending }
    state.phase = 'saving'; state.error = ''; publish()
    try {
      await deps.choose({ decisionId: state.decisionId, conversationId: pending.conversation,
        version: state.version, choice, remember: remember === true })
      if (mark !== generation || !valid()) {
        // Cancellation may have reached the server before/after this choice. Repeat safely in either order.
        if (mark === generation) clear()
        await revoke(snapshot, generation)
        return false
      }
      state.phase = 'ready'; publish()
      await continueReady()
      return true
    } catch (error) {
      if (mark === generation && valid()) {
        const saveFailedMsg = typeof deps.t === 'function' ? deps.t('admin.ocrChoiceSaveFailedError') : '选择未保存，请重试'
        state.phase = 'choose'; state.error = error.message || saveFailedMsg; publish()
      }
      return false
    }
  }
  return { onAction, choose, cancel, continueReady }
}
