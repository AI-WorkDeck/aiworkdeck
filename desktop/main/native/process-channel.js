// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { StringDecoder } = require('node:string_decoder')
const { FrameDecoder, encodeFrame } = require('../lok-sidecar')

function createProcessChannel({ command, args, cwd, env, log, framed, onEvent, onFailure, timeoutMs = 45000 }) {
  const fd = fs.openSync(log, 'a')
  const process = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', fd] })
  fs.closeSync(fd)
  let seq = 0, failed, stopping = false, buffer = '', readyResolve, readyReject, stopPromise
  const pending = new Map()
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  ready.catch(() => {})
  const startupTimer = framed ? setTimeout(() => fail(Error('Native worker startup timed out')), timeoutMs) : null
  const utf8 = new StringDecoder('utf8')
  const fail = error => {
    if (failed || stopping) return
    failed = error
    clearTimeout(startupTimer)
    readyReject(error)
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear()
    if (!stopPromise) onFailure?.(error)
  }
  const accept = (header, bytes) => {
    if (header.type === 'engine-ready') { clearTimeout(startupTimer); readyResolve(header); return }
    if (header.type === 'fatal') { fail(Error(header.error || 'Native worker failed')); return }
    const id = framed ? header.reqId : header.id
    if (id == null) { onEvent?.(header); return }
    const item = pending.get(id)
    if (!item) return
    pending.delete(id); clearTimeout(item.timer)
    if (header.outcomeUnknown) { item.reject(Error('OUTCOME_UNKNOWN')); fail(Error('OUTCOME_UNKNOWN')); return }
    if (header.error || header.success === false) item.reject(Object.assign(Error(header.error || 'Native operation failed'), { code: header.code }))
    else item.resolve(framed ? { ...header, bytes } : header.result)
  }
  const decoder = new FrameDecoder({ onFrame: ({ header, binaryPayload }) => accept(header, binaryPayload) })
  process.stdout.on('data', data => {
    try {
      if (framed) decoder.push(data)
      else {
        buffer += utf8.write(data)
        if (buffer.length > 64 * 1024 * 1024) throw Error('Native JSON reply is too large')
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          if (line.trim()) accept(JSON.parse(line))
        }
      }
    } catch (error) { fail(error) }
  })
  process.on('error', fail)
  process.stdin.on('error', fail)
  process.on('exit', (code, signal) => fail(Error(`Native process exited (${signal || code})`)))
  if (!framed) readyResolve()
  const call = (action, params = {}, bytes) => new Promise((resolve, reject) => {
    if (failed || stopping) { reject(failed || Error('Native session closed')); return }
    const id = ++seq
    const timer = setTimeout(() => {
      const error = Object.assign(Error('Native operation outcome unknown; session locked'), { code: 'OUTCOME_UNKNOWN' })
      fail(error)
    }, action === 'shutdown' ? Math.min(timeoutMs, 5000) : timeoutMs)
    pending.set(id, { resolve, reject, timer })
    const header = framed ? { ...params, action, reqId: id } : { id, method: action, params }
    try { process.stdin.write(framed ? encodeFrame(header, bytes) : JSON.stringify(header) + '\n') }
    catch (error) { fail(error) }
  })
  const stop = (shutdown = false) => stopPromise ||= (async () => {
    clearTimeout(startupTimer)
    if (shutdown && !failed && process.exitCode == null) {
      try { await call('shutdown') } catch { /* The caller retains unsaved state. */ }
    }
    stopping = true
    readyReject(Error('Native session closed'))
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Native session closed')) }
    pending.clear()
    process.stdin.end()
    if (process.exitCode == null && process.signalCode == null) await new Promise((resolve, reject) => {
      const terminate = setTimeout(() => { process.kill('SIGTERM') }, 1000)
      const kill = setTimeout(() => { process.kill('SIGKILL') }, 3000)
      const deadline = setTimeout(() => reject(Error('Owned native process did not exit; recovery files retained')), 5000)
      process.once('exit', () => { clearTimeout(terminate); clearTimeout(kill); clearTimeout(deadline); resolve() })
    })
  })()
  return { process, ready, call, stop }
}
module.exports = { createProcessChannel }
