// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { requestChatSuggestion, recordChatSuggestionFeedback } from '@/services/api.js'
import { isDesktopHost } from '@/services/host.js'

/** A suggestion never mutates the editor until the user selects it. */
export function useChatSuggestions({ conversationId, modelId, projectId, activeFileId, input, inputPrompt,
  streaming, readOnly, identity, onFinished }) {
  const available = isDesktopHost()
  const enabled = ref(true)
  const suggestion = ref(null)
  const loading = ref(false)
  let owner = null
  let revision = 0
  let origin = null
  let alive = true
  let sending = false
  let expiry = null
  let pendingEnabled = null
  const context = () => [identity(), conversationId.value, modelId.value, projectId(), activeFileId()].join('|')
  const reset = () => { revision++; suggestion.value = null; loading.value = false; clearTimeout(expiry) }
  const sync = () => {
    const next = identity()
    if (next !== owner) {
      const adopt = owner == null && next != null && pendingEnabled != null
      owner = next; reset(); origin = null
      try {
        if (adopt) uni.setStorageSync(`awd_chat_suggestions:${owner}`, pendingEnabled)
        enabled.value = !owner || uni.getStorageSync(`awd_chat_suggestions:${owner}`) !== false
      } catch { enabled.value = adopt ? pendingEnabled : true }
      pendingEnabled = null
    }
    return enabled.value
  }
  const empty = () => !input.value?.textContent?.trim() && !inputPrompt.value?.trim()
  const visible = () => !!input.value && input.value.getClientRects().length > 0 && document.visibilityState === 'visible'
  const usable = () => alive && available && sync() && !!owner && !readOnly() && !streaming.value && !sending && visible()
  const show = computed(() => suggestion.value && !streaming.value && !inputPrompt.value.trim() && enabled.value)
  const toggle = () => {
    sync(); enabled.value = !enabled.value; reset(); origin = null
    if (!owner) pendingEnabled = enabled.value
    if (owner) try { uni.setStorageSync(`awd_chat_suggestions:${owner}`, enabled.value) } catch { /* session preference still works */ }
  }
  onFinished(async () => {
    await nextTick()
    if (!usable() || !empty() || !conversationId.value) return
    reset()
    const ticket = revision
    const scope = context()
    loading.value = true
    try {
      const result = await requestChatSuggestion(conversationId.value, modelId.value)
      if (ticket !== revision || scope !== context() || !usable() || !empty()) return
      if (result?.id && typeof result.text === 'string' && result.text.length <= 240) { suggestion.value = { ...result, scope }; expiry = setTimeout(reset, 5 * 60 * 1000) }
    } catch { /* optional suggestion failure never affects the completed conversation */ }
    finally { if (ticket === revision) loading.value = false }
  })
  const edit = () => {
    const current = suggestion.value
    if (!current || current.scope !== context() || !usable() || !empty()) return false
    origin = current
    input.value.textContent = current.text
    inputPrompt.value = current.text
    reset()
    input.value.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(input.value); range.collapse(false)
    selection.removeAllRanges(); selection.addRange(range)
    return true
  }
  const dismiss = () => {
    const current = suggestion.value
    reset()
    if (current && current.scope === context()) recordChatSuggestionFeedback(current.id, { dismissed: true }).catch(() => {})
  }
  const tab = async (event, submit, mentionOpen) => {
    if (!canSendSuggestionWithTab(event, { mentionOpen, focused: document.activeElement === input.value,
      empty: empty(), ready: !!suggestion.value && usable() })) return false
    event.preventDefault()
    if (!edit()) return false
    sending = true
    try { await submit() } finally { sending = false }
    return true
  }
  const capture = () => origin?.scope === context() ? origin : null
  const received = (item, clientRequestId) => {
    if (!item || item.scope !== context()) return
    recordChatSuggestionFeedback(item.id, { clientRequestId }).catch(() => {})
    if (origin?.id === item.id) origin = null
  }
  watch([conversationId, modelId, () => projectId(), () => activeFileId()], () => { reset(); origin = null })
  watch(streaming, value => { if (value) reset() })
  const visibility = () => { if (document.visibilityState !== 'visible') reset() }
  document.addEventListener('visibilitychange', visibility)
  onBeforeUnmount(() => { alive = false; reset(); document.removeEventListener('visibilitychange', visibility) })
  return { available, enabled, suggestion, show, loading, toggle, sync, edit, dismiss, tab, capture, received,
    inputChanged: reset, clear: () => { reset(); origin = null } }
}

export function canSendSuggestionWithTab(event, { mentionOpen, focused, empty, ready }) {
  return event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
    && !event.isComposing && event.keyCode !== 229 && !event.repeat && !mentionOpen && focused && empty && ready
}
