// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const origins = new Set(['https://addin.aiworkdeck.com', 'https://addin.workdeck.ai'])
export function needsCloudEpoch(url, method = 'GET', headers = {}) {
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (!origins.has(parsed.origin) || parsed.username || parsed.password || !headers['X-Session-Id']) return false
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method).toUpperCase())) return false
  return parsed.pathname.startsWith('/api/') && !/^\/api\/(?:auth(?:\/|$)|account(?:\/|$)|mobile\/billing(?:\/|$)|feedback(?:\/|$)|addin\/panes(?:\/|$))/.test(parsed.pathname)
}

/** In-memory, identity-scoped snapshot. A rejected write never refreshes or replays itself. */
export function createCloudEpochGate(loadState) {
  const snapshots = new Map()
  let generation = 0
  return {
    clear() { generation++; snapshots.clear() },
    async headers(url, method, auth) {
      if (!needsCloudEpoch(url, method, auth)) return {}
      const origin = new URL(url).origin
      const key = origin + '\n' + auth['X-Session-Id']
      const started = generation
      let pending = snapshots.get(key)
      if (!pending) {
        pending = Promise.resolve().then(() => loadState(origin, { ...auth })).then(state => {
          // Only a real 404 from an older server may use the old protocol.
          if (state === null) return null
          const epoch = state?.cloudAccess?.epoch
          if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('CLOUD_EPOCH_UNAVAILABLE')
          return String(epoch)
        })
        snapshots.set(key, pending)
        pending.catch(() => { if (snapshots.get(key) === pending) snapshots.delete(key) })
      }
      const epoch = await pending
      if (started !== generation) throw new Error('CLOUD_EPOCH_CHANGED')
      return epoch === null ? {} : { 'X-Cloud-Epoch': epoch }
    },
  }
}
