// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// /status compares cached refs; it cannot prove that the library is reachable or
// still permits access. Keep failed network observations until a newer successful
// network operation verifies access. Shared by every status surface via api.js.
export function createCloudConnectivity(getScope = () => '') {
  const observations = new Map()
  let sequence = 0
  let scope
  let generation = 0
  const currentGeneration = () => {
    const next = getScope()
    if (next !== scope) {
      scope = next
      generation++
      observations.clear()
    }
    return generation
  }
  const record = (id, seq, offline) => {
    if (seq >= (observations.get(id)?.sequence || 0)) observations.set(id, { sequence: seq, offline })
  }
  return async function observe(projectId, operation, send) {
    const sentGeneration = currentGeneration()
    const id = String(projectId)
    const seq = ++sequence
    try {
      const response = await send()
      // A reply from a previous account/backend must not update this session.
      if (sentGeneration !== currentGeneration()) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError', aborted: true })
      }
      const data = response?.data
      if (operation === 'check') {
        // Merging deliberately skips fetch; that cached response is not recovery.
        if (data?.offline) record(id, seq, true)
        else if (data?.linked && !data.merging) record(id, seq, false)
      } else if (operation !== 'status') {
        const verified = operation === 'update'
          ? ['UP_TO_DATE', 'UPDATED', 'CONFLICT']
          : ['UPLOADED', 'CONFLICT']
        if (verified.includes(data?.status)) record(id, seq, false)
        else if (data?.status === 'OFFLINE' || data?.status === 'OFFLINE_PENDING') record(id, seq, true)
        // REMOTE_AHEAD may be the local merging guard before any network I/O.
        // Unknown results, NOT_LINKED and NOTHING_TO_SUBMIT are not observations
        // of remote connectivity either; preserve the last known state.
      }
      const latest = observations.get(id)
      if ((operation === 'status' || operation === 'check') && data?.linked && latest
          && (latest.offline || latest.sequence > seq)) {
        return { ...response, data: { ...data, offline: latest.offline } }
      }
      return response
    } catch (error) {
      // The same rejection channel includes local requireClean guards, local
      // permission checks, and transport failures. None proves remote outage.
      // Preserve the prior observation and the original error without guessing.
      throw error
    }
  }
}
