// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// 对账完成后按需重读文件树；心跳只检查连接，不轮询文件。
export function subscribeProjectFileChanges(projectId, { url, getHeaders, onChange, fetchImpl = globalThis.fetch }) {
  let stopped = false
  let controller = null
  let retryTimer = null
  let heartbeatTimer = null
  let retryDelay = 1000

  const keepAlive = () => {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = setTimeout(() => controller?.abort(), 45000)
  }
  const connect = async () => {
    if (stopped) return
    controller = new AbortController()
    const startedAt = Date.now()
    let reader
    try {
      keepAlive()
      const response = await fetchImpl(url, {
        headers: { ...(getHeaders?.() || {}), Accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (stopped) { await response.body?.cancel(); return }
      if ([401, 403, 404].includes(response.status)) { stopped = true; await response.body?.cancel(); return }
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error('File change stream unavailable')
      }
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', event = '', data = ''
      while (!stopped) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (stopped) break
        buffer += decoder.decode(chunk.value, { stream: true })
        let end
        while (!stopped && (end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end).replace(/\r$/, '')
          buffer = buffer.slice(end + 1)
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data += line.slice(5).trim()
          else if (!line) {
            keepAlive()
            if (event === 'ready' || event === 'files_changed') {
              try {
                if (String(JSON.parse(data).projectId) === String(projectId)) {
                  Promise.resolve(onChange()).catch(() => {})
                }
              } catch (_) { /* 不让一条损坏通知终止后续刷新。 */ }
            }
            event = ''; data = ''
          }
        }
      }
    } catch (_) {
      // 连接失效后重连；ready 会补读断线期间的变化。
    } finally {
      clearTimeout(heartbeatTimer)
      try { await reader?.cancel() } catch (_) {}
      reader?.releaseLock()
      if (!stopped) {
        // 短命连接不能靠 ready 把退避不断复位。
        if (Date.now() - startedAt >= 30000) retryDelay = 1000
        retryTimer = setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 30000)
      }
    }
  }
  void connect()
  return () => {
    stopped = true
    clearTimeout(retryTimer)
    clearTimeout(heartbeatTimer)
    controller?.abort()
  }
}
