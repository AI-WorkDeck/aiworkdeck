// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// C1: device-local state of plugin-served host entries (awd.ui.setEntry). Kept in uni storage,
// keyed by the connected AI WorkDeck account; never sent to any server. Without a connected
// account nothing is shown and nothing is stored.
import { reactive } from 'vue'
import { loadIdentityProfile, PROFILE_SOURCE } from '@/services/accountProfile.js'
import { ACCOUNT_CHANGED_EVENT } from '@/utils/requireAccount.js'
import { parseSetEntryParams, withEntryState } from '@/utils/hostEntries.js'

const STORAGE_KEY = 'awd.hostEntries.v1'

export const hostEntries = reactive({ accountKey: '', store: {} })

let resolving = null

function readStore() {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY)
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch (e) { return {} }
}

/** Re-read who is signed in. An account switch hides every entry until its plugin reports again. */
export function refreshHostEntryAccount() {
  if (resolving) return resolving
  resolving = (async () => {
    let key = ''
    try {
      const { source, profile } = await loadIdentityProfile()
      if (source === PROFILE_SOURCE.ACCOUNT && profile && profile.accountId != null) key = String(profile.accountId).slice(0, 80)
    } catch (e) { key = '' }
    hostEntries.store = readStore()
    hostEntries.accountKey = key
    return key
  })().finally(() => { resolving = null })
  return resolving
}

/** Bridge handler body for ui.setEntry once the caller is known to declare the entry. */
export async function setHostEntry(pluginId, params) {
  const parsed = parseSetEntryParams(params)
  if (parsed.error) return { error: parsed.error }
  const key = hostEntries.accountKey || await refreshHostEntryAccount()
  if (!key) return { error: 'unavailable' }
  const next = withEntryState(readStore(), key, pluginId, parsed.value)
  try { uni.setStorageSync(STORAGE_KEY, next) } catch (e) { /* storage full: still show this session */ }
  hostEntries.store = next
  return { value: parsed.value }
}

let listening = false
export function startHostEntries() {
  if (!listening) {
    listening = true
    try { uni.$on(ACCOUNT_CHANGED_EVENT, () => { hostEntries.accountKey = ''; refreshHostEntryAccount() }) } catch (e) { /* no event bus in tests */ }
  }
  return refreshHostEntryAccount()
}
