// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Serial imports: a cancelled/expired mutation has an unknown outcome and must
// never be blindly replayed. Successful items and created destination IDs survive retry.
export function createImportBatch(files, parentId, projectId) {
  return { items: files.map(file => ({ ...file, state: 'pending' })), parentId, projectId, folders: new Map(), completed: 0, current: '', running: false, cancelled: false, uncertain: false }
}

export function boundedImport(operation, signal, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      fn(value)
    }
    const unknown = () => Object.assign(new Error('importUncertain'), { uncertain: true })
    const abort = () => finish(reject, unknown())
    const timer = setTimeout(abort, timeoutMs)
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { if (!settled) return operation() }).then(value => finish(resolve, value), error => finish(reject, error))
  })
}

export async function runImportBatch(batch, importItem, { signal, timeoutMs = 60000 } = {}) {
  batch.running = true
  batch.cancelled = false
  try {
    for (const item of batch.items) {
      if (signal?.aborted) { batch.cancelled = true; break }
      if (item.state === 'done' || item.state === 'partial' || item.state === 'uncertain') continue
      batch.current = item.relativePath || item.name
      item.state = 'working'
      try {
        await boundedImport(() => importItem(item, signal), signal, timeoutMs)
        item.state = item.skippedCount > 0 ? 'partial' : 'done'
        batch.completed++
      } catch (error) {
        item.state = error?.uncertain ? 'uncertain' : 'failed'
        item.error = error?.message || ''
        item.dropCode = error?.dropCode || ''
        if (error?.uncertain) { batch.uncertain = true; batch.cancelled = !!signal?.aborted; break }
      }
    }
  } finally {
    batch.running = false
    batch.current = ''
  }
}

// Read drop entry handles while the native event is live; their asynchronous
// iteration then works without retaining DataTransfer (which expires after drop).
export function captureDropEntries(dt) {
  return Array.from(dt?.items || []).map(item => item.webkitGetAsEntry?.()).filter(Boolean)
}

export async function* walkDropEntries(entries, signal, prefix = '') {
  for (const entry of entries) {
    if (signal?.aborted) return
    const relativePath = prefix + entry.name
    if (entry.isFile) {
      const fileObject = await boundedImport(() => new Promise((resolve, reject) => entry.file(resolve, reject)), signal)
      yield { name: fileObject.name, size: fileObject.size, relativePath, fileObject }
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      while (!signal?.aborted) {
        const children = await boundedImport(() => new Promise((resolve, reject) => reader.readEntries(resolve, reject)), signal)
        if (!children.length) break
        yield* walkDropEntries(children, signal, relativePath + '/')
      }
    }
  }
}
