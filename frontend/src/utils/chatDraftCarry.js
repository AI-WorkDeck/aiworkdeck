// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D11: a question typed into the temporary workspace's chat was lost when the user then
// opened a folder (the workbench re-launches, the chat remounts empty). The unsent draft
// is carried across that one hop and restored into the next chat box.
export const CHAT_DRAFT_CARRY_KEY = 'awd_chat_draft_carry'
export const CHAT_DRAFT_CARRY_MAX_AGE_MS = 10 * 60 * 1000

/** Stash an unsent draft when leaving the temporary workspace. Blank drafts clear the stash. */
export function stashChatDraft(storage, text, now = Date.now()) {
  const value = String(text == null ? '' : text)
  try {
    if (value.trim()) storage.set(CHAT_DRAFT_CARRY_KEY, { text: value, at: now })
    else storage.remove(CHAT_DRAFT_CARRY_KEY)
  } catch (e) { /* storage unavailable: nothing to carry */ }
}

/** Take (and remove) a fresh carried draft; stale or malformed stashes are dropped. */
export function takeChatDraft(storage, now = Date.now(), maxAgeMs = CHAT_DRAFT_CARRY_MAX_AGE_MS) {
  let entry = null
  try { entry = storage.get(CHAT_DRAFT_CARRY_KEY) } catch (e) { return '' }
  if (!entry) return ''
  try { storage.remove(CHAT_DRAFT_CARRY_KEY) } catch (e) { /* ignore */ }
  if (typeof entry !== 'object' || typeof entry.text !== 'string' || !Number.isFinite(entry.at)) return ''
  if (now - entry.at > maxAgeMs || now < entry.at) return ''
  return entry.text
}
