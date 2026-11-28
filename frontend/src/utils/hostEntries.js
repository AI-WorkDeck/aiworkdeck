// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// C1: generic host entry points that a plugin view can serve (today only "reviews").
// A plugin declares `entryPoint` on its global workspace view and reports, through
// awd.ui.setEntry, whether the entry applies to the signed-in account and its badge.
// The host keeps the last report per account ON THIS DEVICE only (a count of pending legal
// matters must not leave the machine) and renders the entry itself.
// Pure functions only (node --test); storage and account lookup live in services/hostEntryStore.js.

import { VIEW_ENTRY_POINTS } from './pluginViews.js'

export const MAX_BADGE = 99
const MAX_ACCOUNTS = 20

/** Strict check of awd.ui.setEntry params: no coercion, unknown keys refused. */
export function parseSetEntryParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return { error: 'invalid_params' }
  const keys = Object.keys(params)
  if (keys.some(k => !['entry', 'visible', 'badge'].includes(k))) return { error: 'invalid_params' }
  if (!VIEW_ENTRY_POINTS.includes(params.entry)) return { error: 'invalid_params' }
  if (typeof params.visible !== 'boolean') return { error: 'invalid_params' }
  const badge = params.badge === undefined ? 0 : params.badge
  if (!Number.isInteger(badge) || badge < 0 || badge > MAX_BADGE) return { error: 'invalid_params' }
  return { value: { entry: params.entry, visible: params.visible, badge } }
}

/** The plugin's (already normalized) view that serves this entry, or null. */
export function entryViewOf(plugin, entry) {
  const views = Array.isArray(plugin?.views) ? plugin.views : []
  return views.find(v => v && v.entryPoint === entry && v.placement === 'workspace' && v.scope === 'global') || null
}

/** Returns a new store with this account's report for (plugin, entry) replaced. */
export function withEntryState(store, accountKey, pluginId, value, now = Date.now()) {
  const base = store && typeof store === 'object' && !Array.isArray(store) ? store : {}
  if (!accountKey || !pluginId || !value) return base
  const account = { ...(base[accountKey] || {}) }
  account[pluginId + '::' + value.entry] = { visible: value.visible, badge: value.badge, at: now }
  const next = { ...base, [accountKey]: account }
  // Bounded: keep the most recently updated accounts only.
  const ranked = Object.keys(next).sort((a, b) => lastAt(next[b]) - lastAt(next[a]))
  for (const key of ranked.slice(MAX_ACCOUNTS)) delete next[key]
  return next
}

function lastAt(account) {
  return Math.max(0, ...Object.values(account || {}).map(x => Number(x && x.at) || 0))
}

/**
 * Enabled plugins whose declared view serves `entry` and that reported visible:true for this account.
 * Each item: { pluginId, key, label, badge }. Order follows `plugins`.
 */
export function qualifyingEntries(plugins, store, accountKey, entry) {
  if (!accountKey || !store || typeof store !== 'object') return []
  const account = store[accountKey] || {}
  return (Array.isArray(plugins) ? plugins : []).flatMap(p => {
    if (!p || !p.pluginId || !entryViewOf(p, entry)) return []
    const state = account[p.pluginId + '::' + entry]
    if (!state || state.visible !== true) return []
    const badge = Number.isInteger(state.badge) ? Math.min(Math.max(state.badge, 0), MAX_BADGE) : 0
    return [{ pluginId: p.pluginId, key: p.key, label: p.label, badge }]
  })
}
