// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

function parseVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(String(value || ''))
  if (!match) return null
  const pre = match[4]?.split('.') || []
  if (pre.some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return null
  return { core: match.slice(1, 4).map(BigInt), pre }
}

export function isPluginUpdateAvailable(market, installed) {
  if (market?.revokedReason || installed?.revokedReason) return false
  const local = installed?.version || market?.installedVersion
  const latest = parseVersion(market?.version)
  const current = parseVersion(local)
  if (!latest || !current) return false
  for (let i = 0; i < 3; i++) {
    if (latest.core[i] !== current.core[i]) return latest.core[i] > current.core[i]
  }
  if (!latest.pre.length || !current.pre.length) return !latest.pre.length && !!current.pre.length
  for (let i = 0; i < Math.max(latest.pre.length, current.pre.length); i++) {
    const a = latest.pre[i], b = current.pre[i]
    if (a === b) continue
    if (a === undefined || b === undefined) return b === undefined
    const an = /^\d+$/.test(a), bn = /^\d+$/.test(b)
    if (an && bn) return BigInt(a) > BigInt(b)
    if (an !== bn) return !an
    return a > b
  }
  return false
}

// Bundled entries are an offline installation source, not the latest registry.
export function mergePluginCatalog(remote = [], bundled = []) {
  const remoteIds = new Set(remote.map(item => item.id))
  const bundledById = new Map(bundled.map(item => [item.id, item]))
  const online = remote.map(item => {
    const local = bundledById.get(item.id)
    // A newer shipped package can be installed offline, but must never be
    // offered as an upgrade over an independently installed plugin directory.
    return item.installed === false && local?.installed === false && isPluginUpdateAvailable(local, { version: item.version }) ? local : item
  })
  return [...online, ...bundled.filter(item => !remoteIds.has(item.id))]
}
