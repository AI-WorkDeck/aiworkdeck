// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// The server has one emitter per conversation. Keep independent UI consumers,
// but rotate their shared transport together when a new pane needs a snapshot.
const connections = new Map()
const encoder = new TextEncoder()

export function fetchAgentConnection(url, init, fetchImpl = fetch) {
  const headers = new Headers(init.headers)
  const key = JSON.stringify([url, headers.get('X-Session-Id'), headers.get('X-Client-Instance')])
  const signal = init.signal
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  let connection = connections.get(key)
  if (!connection) {
    connection = { clients: new Set(), controller: null, cursor: null }
    connections.set(key, connection)
  }
  const remove = client => {
    client.cleanup()
    connection.clients.delete(client)
    if (!connection.clients.size) {
      if (connections.get(key) === connection) connections.delete(key)
      connection.controller?.abort()
    }
  }
  const result = new Promise((resolve, reject) => {
    const client = { resolve, reject, controller: null }
    client.body = new ReadableStream({
      start(controller) { client.controller = controller },
      cancel() { remove(client) },
    })
    client.cleanup = () => signal?.removeEventListener('abort', client.abort)
    client.abort = () => {
      const error = new DOMException('Aborted', 'AbortError')
      remove(client)
      client.controller.error(error)
      reject(error)
    }
    connection.clients.add(client)
    signal?.addEventListener('abort', client.abort, { once: true })
  })
  // A late pane needs the server's current run_state/state_recovery, not just
  // future text deltas (the current assistant bubble is not persisted yet).
  // Keep existing readers alive during this intentional transport handoff.
  connection.controller?.abort()
  const controller = new AbortController()
  connection.controller = controller
  const requestedCursor = headers.get('Last-Event-ID')
  const cursor = [connection.cursor, requestedCursor].filter(value => /^\d+$/.test(value || ''))
    .sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)[0]
  if (cursor) headers.set('Last-Event-ID', cursor)
  else headers.delete('Last-Event-ID')
  void (async () => {
    try {
      const response = await fetchImpl(url, { ...init, headers: Object.fromEntries(headers), signal: controller.signal })
      if (connection.controller !== controller) return
      for (const client of connection.clients) client.resolve({ ok: response.ok, status: response.status, body: client.body })
      if (!response.ok) throw new Error(`SSE Connection Failed: ${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      while (true) {
        const { done, value } = await reader.read()
        if (connection.controller !== controller) return
        if (done) break
        pending += decoder.decode(value, { stream: true })
        let boundary
        while ((boundary = /\r?\n\r?\n/.exec(pending))) {
          const frame = pending.slice(0, boundary.index + boundary[0].length)
          pending = pending.slice(frame.length)
          const id = /^id:\s*(\d+)\s*$/m.exec(frame)?.[1]
          if (id) connection.cursor = id
          const bytes = encoder.encode(frame)
          for (const client of connection.clients) client.controller.enqueue(bytes)
        }
      }
    } catch (error) {
      if (connection.controller !== controller) return
      for (const client of connection.clients) {
        client.controller.error(error)
        client.reject(error)
      }
    } finally {
      if (connection.controller === controller) {
        if (connections.get(key) === connection) connections.delete(key)
        for (const client of connection.clients) {
          try { client.controller.close() } catch {}
          client.cleanup()
        }
        connection.clients.clear()
      }
    }
  })()
  return result
}
