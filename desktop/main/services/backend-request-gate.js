// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const installed = new WeakMap()

function coreReadMatchers(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 32) return null
  const matchers = []
  for (const path of paths) {
    if (typeof path !== 'string' || path.length > 160 || !/^\/api\/(?:[a-zA-Z0-9_-]+|:id)(?:\/(?:[a-zA-Z0-9_-]+|:id))*$/.test(path)) return null
    matchers.push(new RegExp('^' + path.replaceAll(':id', '[0-9]+') + '$'))
  }
  return matchers
}

/**
 * Hold optional work before Chromium allocates a connection. Waiting inside the HTTP gateway
 * instead fills the origin's six sockets and queues even the independent core file reads.
 * This is scheduling, not authorization; every released request still passes backend admission.
 * Enable only for a build-verified startup response advertising its actual early read routes.
 * This session has no other onBeforeRequest listener; Electron permits only one per event.
 */
function installBackendRequestGate(session, { getState }) {
  if (installed.has(session)) return installed.get(session)
  const pending = new Set()
  let timer = null
  const finish = (entry, cancel) => {
    pending.delete(entry)
    try { entry.callback({ cancel }) } catch (e) { /* A navigation may already have cancelled it. */ }
  }
  const invalid = (state, launch) => state.closing || state.launch !== launch ||
    !launch.process || launch.process.exitCode != null || launch.process.signalCode != null
  const flush = () => {
    const state = getState()
    for (const entry of pending) {
      if (invalid(state, entry.launch) || state.port !== entry.port) finish(entry, true)
      else if (entry.launch.fullReady) finish(entry, false)
      else if (!Number.isFinite(entry.launch.deadline) || Date.now() >= entry.launch.deadline) finish(entry, true)
    }
    if (pending.size === 0 && timer) { clearInterval(timer); timer = null }
  }
  session.webRequest.onBeforeRequest((details, callback) => {
    const state = getState(), launch = state.launch
    if (!launch || launch.fullReady || !launch.coreReadPaths) { callback({ cancel: false }); return }
    let url
    try { url = new URL(details.url) } catch { callback({ cancel: false }); return }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        Number(url.port || 80) !== state.port || !url.pathname.startsWith('/api/')) {
      callback({ cancel: false }); return
    }
    const matchers = coreReadMatchers(launch.coreReadPaths)
    // Old/invalid advertisements keep the existing transport, never a fabricated ready state.
    if (!matchers) { callback({ cancel: false }); return }
    if (invalid(state, launch)) { callback({ cancel: true }); return }
    const method = details.method.toUpperCase()
    const content = launch.coreContentProtocol === 1 &&
      (/^\/api\/local-core\/projects\/[1-9][0-9]*\/files\/[1-9][0-9]*\/content$/.test(url.pathname)
        ? ['GET', 'HEAD', 'PUT'].includes(method)
        : ['GET', 'DELETE'].includes(method) && /^\/api\/local-core\/projects\/[1-9][0-9]*\/files\/[1-9][0-9]*\/content\/receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(url.pathname))
    if (content || method === 'OPTIONS' || ((method === 'GET' || method === 'HEAD') &&
        matchers.some(pattern => pattern.test(url.pathname)))) {
      callback({ cancel: false }); return
    }
    pending.add({ launch, port: state.port, callback })
    if (!timer) { timer = setInterval(flush, 100); timer.unref?.() }
    flush()
  })
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (timer) clearInterval(timer)
    timer = null
    for (const entry of pending) finish(entry, true)
    session.webRequest.onBeforeRequest(null)
    installed.delete(session)
  }
  installed.set(session, dispose)
  return dispose
}

module.exports = { installBackendRequestGate, coreReadMatchers }
