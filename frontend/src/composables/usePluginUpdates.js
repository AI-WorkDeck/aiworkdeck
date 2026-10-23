// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { reactive } from 'vue'
import { getPluginMarket, getBundledPlugins, getPlugins } from '@/services/api.js'
import { isPluginUpdateAvailable, mergePluginCatalog } from '@/utils/marketUpdates.js'

export const pluginUpdates = reactive({
  catalog: [], installed: [], count: 0, checking: false, error: '', checkedAt: 0, accountConnected: false,
})
const CHECK_INTERVAL = 30 * 60 * 1000
const FOCUS_INTERVAL = 5 * 60 * 1000
let inflight = null
let invalidated = false
let attemptedAt = 0
let remoteCatalog = []
let bundledCatalog = []
let owners = 0
let timer = null

// Reuse a single request across the rail and marketplace. A mutation during an
// in-flight check queues a fresh read so an old response cannot restore its badge.
export function refreshPluginUpdates(force = false) {
  if (inflight) return inflight
  if (!force && Date.now() - attemptedAt < FOCUS_INTERVAL) return Promise.resolve(pluginUpdates)
  pluginUpdates.checking = true
  inflight = (async () => {
    do {
      invalidated = false
      attemptedAt = Date.now()
      const [remote, bundled, local] = await Promise.allSettled([
        getPluginMarket({ accountPrompt: false }), getBundledPlugins(), getPlugins(),
      ])
      const errors = []
      if (remote.status === 'fulfilled') {
        remoteCatalog = remote.value?.plugins || []
        pluginUpdates.accountConnected = !!remote.value?.accountConnected
      } else errors.push(remote.reason?.message || String(remote.reason))
      if (bundled.status === 'fulfilled') bundledCatalog = bundled.value?.plugins || []
      if (local.status === 'fulfilled') {
        pluginUpdates.installed = Array.isArray(local.value) ? local.value : (local.value?.data || [])
      } else errors.push(local.reason?.message || String(local.reason))
      const installed = new Map(pluginUpdates.installed.map(item => [item.id, item]))
      const bundledIds = new Set(bundledCatalog.map(item => item.id))
      // Keep known updates while offline, but allow a not-yet-installed bundled
      // plugin to use its local package instead of an unreachable cached URL.
      const availableRemote = remote.status === 'fulfilled' ? remoteCatalog
        : remoteCatalog.filter(item => installed.has(item.id) || !bundledIds.has(item.id))
      pluginUpdates.catalog = mergePluginCatalog(availableRemote, bundledCatalog)
      pluginUpdates.count = pluginUpdates.catalog.filter(item => installed.has(item.id) && isPluginUpdateAvailable(item, installed.get(item.id))).length
      pluginUpdates.error = errors.join(' · ')
      if (!errors.length) pluginUpdates.checkedAt = Date.now()
    } while (invalidated)
    uni.$emit('awd:market-update-checked')
    return pluginUpdates
  })().finally(() => { inflight = null; pluginUpdates.checking = false })
  return inflight
}

function onMarketChanged() {
  invalidated = true
  return refreshPluginUpdates(true)
}

function onFocus() {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refreshPluginUpdates()
}

export function startPluginUpdateChecks() {
  if (++owners === 1) {
    uni.$on('awd:market-changed', onMarketChanged)
    uni.$on('awd:market-changed-from-sidebar', onMarketChanged)
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
    timer = setInterval(onFocus, CHECK_INTERVAL)
    refreshPluginUpdates(true)
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    if (--owners > 0) return
    clearInterval(timer)
    timer = null
    uni.$off('awd:market-changed', onMarketChanged)
    uni.$off('awd:market-changed-from-sidebar', onMarketChanged)
    if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
  }
}
