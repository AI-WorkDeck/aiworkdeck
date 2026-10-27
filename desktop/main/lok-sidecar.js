// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * desktop/main/lok-sidecar.js — Native LibreOfficeKit (LOK) Sidecar Supervisor,
 * binary/JSON length-prefixed framing protocol, tile invalidation coalescer,
 * and `lo-relay` command bridge.
 *
 * Grounded in the proven out-of-process worker design of ElyOffice `crates/ely-lok`
 * (`worker.rs`, `ipc.rs`, `events.rs`, `view.rs`, `view/lane.rs`) while preserving
 * 100% of AI WorkDeck's `lo-relay` + `office_thread.js` UNO command contract.
 */

const { EventEmitter } = require('node:events')
const { spawn: defaultSpawn } = require('node:child_process')

const MAX_FRAME_BYTES = 64 * 1024 * 1024 // 64 MiB cap (matches ely-ipc::MAX_FRAME)
const DEFAULT_TILE_SIZE_PX = 256
const DEFAULT_TWIPS_PER_PX = 15
const DEFAULT_TILE_SIZE_TWIPS = DEFAULT_TILE_SIZE_PX * DEFAULT_TWIPS_PER_PX // 3840 twips
const DEFAULT_REQUEST_TIMEOUT_MS = 30000
const RELAY_TAG = 'lo-relay'

/**
 * Normalize a binary payload input into a Node.js Buffer.
 * @param {Buffer|Uint8Array|ArrayBuffer|null|undefined} binaryPayload
 * @returns {Buffer}
 */
function toBuffer(binaryPayload) {
  if (!binaryPayload) return Buffer.alloc(0)
  if (Buffer.isBuffer(binaryPayload)) return binaryPayload
  if (binaryPayload instanceof Uint8Array) {
    return Buffer.from(binaryPayload.buffer, binaryPayload.byteOffset, binaryPayload.byteLength)
  }
  if (binaryPayload instanceof ArrayBuffer) {
    return Buffer.from(binaryPayload)
  }
  throw new TypeError('binaryPayload must be a Buffer, Uint8Array, ArrayBuffer, or null/undefined')
}

/**
 * Encode a control header object and optional binary payload into a length-prefixed frame:
 *   [0..3]  uint32le headerByteLength
 *   [4..7]  uint32le binaryByteLength
 *   [8..8+H] UTF-8 JSON header bytes
 *   [8+H..8+H+B] Raw binary payload bytes (e.g. RGBA/BGRA tile pixels or DOCX bytes)
 *
 * @param {object} headerObj
 * @param {Buffer|Uint8Array|ArrayBuffer|null} [binaryPayload]
 * @param {{maxFrameBytes?: number}} [opts]
 * @returns {Buffer}
 */
function encodeFrame(headerObj, binaryPayload = null, opts = {}) {
  const maxFrameBytes = Number.isSafeInteger(opts.maxFrameBytes) && opts.maxFrameBytes > 0
    ? opts.maxFrameBytes
    : MAX_FRAME_BYTES
  if (!headerObj || typeof headerObj !== 'object' || Array.isArray(headerObj)) {
    throw new TypeError('encodeFrame requires a plain object headerObj')
  }
  const headerBuf = Buffer.from(JSON.stringify(headerObj), 'utf8')
  const binBuf = toBuffer(binaryPayload)
  const totalPayload = headerBuf.length + binBuf.length
  if (totalPayload > maxFrameBytes) {
    const err = new RangeError(
      `Frame payload (${totalPayload} bytes) exceeds maximum allowed (${maxFrameBytes} bytes)`
    )
    err.code = 'LOK_FRAME_TOO_LARGE'
    throw err
  }
  const prefix = Buffer.allocUnsafe(8)
  prefix.writeUInt32LE(headerBuf.length, 0)
  prefix.writeUInt32LE(binBuf.length, 4)
  return binBuf.length > 0
    ? Buffer.concat([prefix, headerBuf, binBuf], 8 + totalPayload)
    : Buffer.concat([prefix, headerBuf], 8 + headerBuf.length)
}

/**
 * Streaming parser for 8-byte length-prefixed frames (`[u32le headerLen][u32le binLen][header][bin]`).
 * Handles arbitrary chunk boundaries (1-byte drip, split headers, or concatenated multi-frame chunks).
 */
class FrameDecoder {
  /**
   * @param {{maxFrameBytes?: number, onFrame?: (frame: {header: object, binaryPayload: Buffer}) => void}} [opts]
   */
  constructor(opts = {}) {
    this.maxFrameBytes = Number.isSafeInteger(opts.maxFrameBytes) && opts.maxFrameBytes > 0
      ? opts.maxFrameBytes
      : MAX_FRAME_BYTES
    this.onFrame = typeof opts.onFrame === 'function' ? opts.onFrame : null
    this._chunks = []
    this._BufferedBytes = 0
  }

  get pendingByteLength() {
    return this._BufferedBytes
  }

  reset() {
    this._chunks = []
    this._BufferedBytes = 0
  }

  /**
   * Push a new byte chunk into the decoder and extract all complete frames.
   * @param {Buffer|Uint8Array} chunk
   * @returns {Array<{header: object, binaryPayload: Buffer}>}
   */
  push(chunk) {
    const buf = toBuffer(chunk)
    if (buf.length === 0) return []
    this._chunks.push(buf)
    this._BufferedBytes += buf.length

    const frames = []
    while (this._BufferedBytes >= 8) {
      const flat = this._chunks.length === 1
        ? this._chunks[0]
        : Buffer.concat(this._chunks, this._BufferedBytes)
      this._chunks = [flat]

      const headerByteLength = flat.readUInt32LE(0)
      const binaryByteLength = flat.readUInt32LE(4)
      const payloadTotal = headerByteLength + binaryByteLength

      if (payloadTotal > this.maxFrameBytes) {
        this.reset()
        const err = new RangeError(
          `Incoming LOK frame payload (${payloadTotal} bytes) exceeds cap (${this.maxFrameBytes} bytes)`
        )
        err.code = 'LOK_FRAME_TOO_LARGE'
        throw err
      }

      const frameTotal = 8 + payloadTotal
      if (this._BufferedBytes < frameTotal) {
        break
      }

      const headerSlice = flat.subarray(8, 8 + headerByteLength)
      const binarySlice = flat.subarray(8 + headerByteLength, frameTotal)
      // Copy binarySlice into an independent Buffer so retaining a tile does not pin a huge read slab
      const binaryPayload = Buffer.from(binarySlice)

      const remainder = flat.subarray(frameTotal)
      this._chunks = remainder.length > 0 ? [remainder] : []
      this._BufferedBytes = remainder.length

      let header
      try {
        header = headerByteLength > 0 ? JSON.parse(headerSlice.toString('utf8')) : {}
      } catch (e) {
        this.reset()
        const err = new SyntaxError(`Invalid LOK frame JSON header: ${e.message}`)
        err.code = 'LOK_INVALID_HEADER_JSON'
        throw err
      }

      const frame = { header, binaryPayload }
      frames.push(frame)
      if (this.onFrame) {
        this.onFrame(frame)
      }
    }
    return frames
  }
}

/**
 * Parse a rectangle input (object, tuple `[x, y, w, h]`, or LOK CSV `"x, y, w, h"`) into twips.
 * @param {any} raw
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
function normalizeRectTwips(raw) {
  if (!raw) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.toUpperCase() === 'EMPTY') return null
    const parts = trimmed.split(/[,\s]+/).filter(Boolean).map(Number)
    if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return null
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
  }
  if (Array.isArray(raw)) {
    if (raw.length < 4) return null
    const [x, y, width, height] = raw.map(Number)
    if (![x, y, width, height].every(Number.isFinite)) return null
    return { x, y, width, height }
  }
  if (typeof raw === 'object') {
    const x = Number(raw.xTwips ?? raw.x)
    const y = Number(raw.yTwips ?? raw.y)
    const width = Number(raw.widthTwips ?? raw.width ?? raw.w)
    const height = Number(raw.heightTwips ?? raw.height ?? raw.h)
    if (![x, y, width, height].every(Number.isFinite)) return null
    return { x, y, width, height }
  }
  return null
}

/**
 * Normalize optional document dimensions in twips.
 * @param {any} docSizeTwips
 * @returns {{width: number, height: number}|null}
 */
function normalizeDocSizeTwips(docSizeTwips) {
  if (!docSizeTwips) return null
  if (Array.isArray(docSizeTwips) && docSizeTwips.length >= 2) {
    const width = Number(docSizeTwips[0])
    const height = Number(docSizeTwips[1])
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height }
    }
    return null
  }
  if (typeof docSizeTwips === 'object') {
    const width = Number(docSizeTwips.widthTwips ?? docSizeTwips.width ?? docSizeTwips.w)
    const height = Number(docSizeTwips.heightTwips ?? docSizeTwips.height ?? docSizeTwips.h)
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height }
    }
  }
  return null
}

/**
 * Coalesce overlapping or duplicate `LOK_CALLBACK_INVALIDATE_TILES` rectangles into the minimal
 * sorted set of aligned tile grid descriptors `{ col, row, xTwips, yTwips, widthTwips, heightTwips, key }`.
 *
 * @param {Array<object|Array<number>|string>} rects
 * @param {number} [tileSizeTwips=3840]
 * @param {{width?:number, height?:number, widthTwips?:number, heightTwips?:number}|Array<number>|null} [docSizeTwips=null]
 * @returns {Array<{col:number, row:number, xTwips:number, yTwips:number, widthTwips:number, heightTwips:number, key:string}>}
 */
function coalesceInvalidatedTiles(rects, tileSizeTwips = DEFAULT_TILE_SIZE_TWIPS, docSizeTwips = null) {
  const step = Number(tileSizeTwips) > 0 ? Math.floor(Number(tileSizeTwips)) : DEFAULT_TILE_SIZE_TWIPS
  if (!Array.isArray(rects) || rects.length === 0) return []
  const bounds = normalizeDocSizeTwips(docSizeTwips)
  const seen = new Map()

  for (const raw of rects) {
    const r = normalizeRectTwips(raw)
    if (!r || r.width <= 0 || r.height <= 0) continue

    let x0 = Math.max(0, r.x)
    let y0 = Math.max(0, r.y)
    let x1 = r.x + r.width
    let y1 = r.y + r.height

    if (bounds) {
      x1 = Math.min(bounds.width, x1)
      y1 = Math.min(bounds.height, y1)
    }
    if (x1 <= x0 || y1 <= y0) continue

    const startCol = Math.floor(x0 / step)
    const endCol = Math.floor((x1 - 1) / step)
    const startRow = Math.floor(y0 / step)
    const endRow = Math.floor((y1 - 1) / step)

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const key = `${col}:${row}`
        if (!seen.has(key)) {
          seen.set(key, {
            col,
            row,
            xTwips: col * step,
            yTwips: row * step,
            widthTwips: step,
            heightTwips: step,
            key,
          })
        }
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => (a.row - b.row) || (a.col - b.col))
}

/**
 * Determine the active desktop editor engine mode (`'lok'` vs `'webview'`).
 * Defaults to `'webview'` for 100% backward compatibility unless `AWD_EDITOR_ENGINE=lok`
 * or preference `editorEngine === 'lok'` is explicitly set.
 *
 * @param {object} [env=process.env]
 * @param {{editorEngine?: string}|null} [prefs=null]
 * @returns {'lok'|'webview'}
 */
function resolveEditorEngineMode(env = process.env, prefs = null) {
  const fromPref = prefs && typeof prefs.editorEngine === 'string' ? prefs.editorEngine.trim().toLowerCase() : ''
  if (fromPref === 'lok' || fromPref === 'webview') return fromPref
  const fromEnv = env && typeof env.AWD_EDITOR_ENGINE === 'string' ? env.AWD_EDITOR_ENGINE.trim().toLowerCase() : ''
  if (fromEnv === 'lok') return 'lok'
  return 'webview'
}

/**
 * Create the Electron main-process Native LOK Sidecar Supervisor.
 *
 * Responsibilities:
 * - Spawns and supervises the out-of-process `lok-worker` binary;
 * - Multiplexes framed JSON + binary IPC messages over stdio;
 * - Manages multi-document LOK sessions and view IDs (`openSession`, `closeSession`, `requestTiles`, `forwardInput`);
 * - Coalesces `LOK_CALLBACK_INVALIDATE_TILES` rects and tracks per-session `generationId`;
 * - Bridges AI WorkDeck `lo-relay` commands (`executeRelayMessage`, `createSessionRelayBridge`) with
 *   timeouts, progress forwarding, and crash-safe settlement.
 *
 * @param {object} [options]
 * @param {Function} [options.spawnFn] injectable child_process.spawn replacement for unit testing
 * @param {string} [options.workerBin] path to `lok-worker` binary
 * @param {string[]} [options.workerArgs] arguments passed to `lok-worker`
 * @param {'lok'|'webview'} [options.engineMode]
 * @param {object} [options.env]
 * @param {number} [options.requestTimeoutMs=30000]
 * @param {number} [options.tileSizeTwips=3840]
 * @param {number} [options.maxRestarts=2]
 * @param {(evt: object) => void} [options.onEvent]
 */
function createLokSidecarManager(options = {}) {
  const spawnFn = typeof options.spawnFn === 'function' ? options.spawnFn : defaultSpawn
  const workerBin = options.workerBin || (options.env?.AWD_LOK_WORKER_BIN ?? process.env.AWD_LOK_WORKER_BIN) || 'lok-worker'
  const workerArgs = Array.isArray(options.workerArgs) ? options.workerArgs : []
  const engineMode = options.engineMode || resolveEditorEngineMode(options.env || process.env, options.prefs)
  const defaultTimeoutMs = Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS
  const tileSizeTwips = Number(options.tileSizeTwips) > 0 ? Number(options.tileSizeTwips) : DEFAULT_TILE_SIZE_TWIPS
  const maxRestarts = Number.isSafeInteger(options.maxRestarts) && options.maxRestarts >= 0 ? options.maxRestarts : 2

  const bus = new EventEmitter()
  if (typeof options.onEvent === 'function') {
    bus.on('event', options.onEvent)
  }

  let proc = null
  let decoder = null
  let state = 'stopped' // 'stopped' | 'starting' | 'running' | 'failed'
  let stopping = false
  let restarts = 0
  let lastError = null
  let rpcSeq = 0

  // rpcId -> { resolve, reject, timer, kind, sessionId, relayReqId, onProgress }
  const pending = new Map()
  // sessionId -> { sessionId, fileId, docPath, viewId, docSizeTwips, generationId, zoom, dpi }
  const sessions = new Map()
  // Subscribers for lo-relay messages: Set<(msg: object, sessionId?: string) => void>
  const relaySubscribers = new Set()

  function emitEvent(evt) {
    bus.emit('event', evt)
  }

  function emitRelay(msg, sessionId = null) {
    for (const sub of relaySubscribers) {
      try {
        sub(msg, sessionId)
      } catch (_e) {
        // Ignore subscriber errors
      }
    }
  }

  function failAllPending(code, message) {
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer)
      pending.delete(id)
      entry.resolve({
        ok: false,
        success: false,
        code,
        error: message,
        message,
      })
    }
  }

  function handleWorkerFrame({ header, binaryPayload }) {
    if (!header || typeof header !== 'object') return

    // 1. Progress frame for an in-flight lo-relay request
    if (header.type === 'lo-relay:progress' || (header.__lo === RELAY_TAG && header.type === 'progress')) {
      const targetId = header.id || header.reqId
      const entry = pending.get(targetId)
      const relayReqId = (entry && entry.relayReqId) || header.reqId || targetId
      const sessionId = (entry && entry.sessionId) || header.sessionId || null
      const progressPayload = {
        __lo: RELAY_TAG,
        type: 'progress',
        reqId: relayReqId,
        done: Number(header.done) || 0,
        total: Number(header.total) || 0,
        ...(typeof header.stage === 'string' ? { stage: header.stage } : {}),
        ...(sessionId ? { sessionId } : {}),
      }
      if (entry && typeof entry.onProgress === 'function') {
        try { entry.onProgress(progressPayload) } catch (_e) { /* ignore */ }
      }
      emitRelay(progressPayload, sessionId)
      return
    }

    // 2. Unsolicited worker event frames (e.g. LOK_CALLBACK_INVALIDATE_TILES, modified, selection)
    if (typeof header.type === 'string' && header.type.startsWith('event:')) {
      const sessionId = header.sessionId || null
      const session = sessionId ? sessions.get(sessionId) : null
      if (header.type === 'event:invalidate_tiles') {
        if (session) {
          session.generationId += 1
          if (header.docSizeTwips) {
            const normSize = normalizeDocSizeTwips(header.docSizeTwips)
            if (normSize) session.docSizeTwips = normSize
          }
        }
        const tiles = coalesceInvalidatedTiles(
          header.rects || [],
          header.tileSizeTwips || tileSizeTwips,
          (session && session.docSizeTwips) || header.docSizeTwips || null
        )
        const evt = {
          type: 'tile-invalidated',
          sessionId,
          generationId: session ? session.generationId : (Number(header.generationId) || 1),
          all: Boolean(header.all),
          tiles,
        }
        emitEvent(evt)
        return
      }
      if (header.type === 'event:modified' || header.type === 'event:selection' || header.type === 'event:cursor') {
        const relayType = header.type.slice('event:'.length)
        const relayMsg = {
          __lo: RELAY_TAG,
          type: relayType,
          ...(header.payload && typeof header.payload === 'object' ? header.payload : {}),
          ...(sessionId ? { sessionId } : {}),
        }
        emitEvent({ type: header.type, sessionId, payload: header.payload || {} })
        emitRelay(relayMsg, sessionId)
        return
      }
      emitEvent({ ...header, binaryPayload })
      return
    }

    // 3. Solicited RPC / lo-relay response frame correlated by id / reqId
    const id = header.id || header.reqId
    if (!id) {
      emitEvent({ ...header, binaryPayload })
      return
    }
    const entry = pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(id)

    if (entry.kind === 'tile') {
      const ok = header.ok !== false && header.type !== 'error'
      entry.resolve({
        ok,
        header,
        pixels: binaryPayload,
      })
      return
    }

    if (entry.kind === 'relay') {
      const result = header.result !== undefined
        ? header.result
        : {
            success: header.ok !== false && header.success !== false,
            ...(header.data && typeof header.data === 'object' ? header.data : {}),
            ...(header.error ? { error: header.error, message: header.message || header.error } : {}),
          }
      if (binaryPayload && binaryPayload.length > 0 && result && typeof result === 'object') {
        result.bytes = new Uint8Array(binaryPayload.buffer, binaryPayload.byteOffset, binaryPayload.byteLength)
      }
      entry.resolve(result)
      return
    }

    entry.resolve({
      ok: header.ok !== false && header.type !== 'error',
      ...header,
      binaryPayload,
    })
  }

  function spawnWorkerProcess() {
    if (stopping) return null
    state = 'starting'
    decoder = new FrameDecoder({
      onFrame: (frame) => {
        try {
          handleWorkerFrame(frame)
        } catch (err) {
          lastError = err.message
          emitEvent({ type: 'frame-handler-error', error: err.message })
        }
      },
    })

    const child = spawnFn(workerBin, workerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...(options.env || process.env),
        SAL_FORCE_HIDPI_SCALING: '1',
        SAL_SKIA: 'raster',
        SAL_LOK_OPTIONS: 'unipoll,sc_print_twips_msgs',
      },
      windowsHide: true,
    })
    proc = child
    state = 'running'

    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => {
        if (!decoder) return
        try {
          decoder.push(chunk)
        } catch (err) {
          lastError = err.message
          emitEvent({ type: 'protocol-error', code: err.code || 'LOK_PROTOCOL_ERROR', error: err.message })
        }
      })
    }

    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        const line = Buffer.from(chunk).toString('utf8').trim()
        if (line) emitEvent({ type: 'worker-stderr', line })
      })
    }

    if (typeof child.on === 'function') {
      child.on('error', (err) => {
        lastError = err ? err.message : 'worker spawn error'
        emitEvent({ type: 'worker-error', error: lastError })
      })

      child.on('exit', (code, signal) => {
        if (proc !== child) return
        proc = null
        const unexpected = !stopping
        const errMsg = `Editor engine stopped (code=${code ?? 'null'}, signal=${signal ?? 'null'}) / 文档引擎异常停止`
        if (unexpected) {
          lastError = errMsg
          failAllPending('EDITOR_ENGINE_FAILED', errMsg)
          emitRelay({ __lo: RELAY_TAG, type: 'engine-failed', code: 'EDITOR_ENGINE_FAILED', message: errMsg })
          emitEvent({ type: 'worker-exit', code, signal, unexpected: true })
          if (restarts < maxRestarts) {
            restarts += 1
            spawnWorkerProcess()
          } else {
            state = 'failed'
          }
        } else {
          state = 'stopped'
          failAllPending('EDITOR_DISPOSED', 'Editor closed / 编辑器已关闭')
          emitEvent({ type: 'worker-exit', code, signal, unexpected: false })
        }
      })
    }

    emitEvent({ type: 'worker-started', pid: child.pid || null, restarts })
    return child
  }

  function ensureStarted() {
    stopping = false
    if (proc && state === 'running') return proc
    return spawnWorkerProcess()
  }

  function sendRawFrame(headerObj, binaryPayload = null, timeoutMs = defaultTimeoutMs, meta = {}) {
    const child = ensureStarted()
    if (!child || !child.stdin || typeof child.stdin.write !== 'function') {
      return Promise.resolve({
        ok: false,
        success: false,
        code: 'EDITOR_ENGINE_UNAVAILABLE',
        error: 'LOK worker stdin is unavailable',
        message: 'LOK worker stdin is unavailable',
      })
    }

    const id = headerObj.id || `lok_${Date.now()}_${++rpcSeq}`
    const fullHeader = { ...headerObj, id }
    let wire
    try {
      wire = encodeFrame(fullHeader, binaryPayload)
    } catch (err) {
      return Promise.resolve({
        ok: false,
        success: false,
        code: err.code || 'LOK_ENCODE_ERROR',
        error: err.message,
        message: err.message,
      })
    }

    const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : defaultTimeoutMs
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        const message = '等待编辑器结果超时，操作可能仍在执行。请先检查文档和修订记录，确认结果前不要重复执行写入操作。 / Editor result timed out; the operation may still be running. Check the document and tracked changes before repeating any write.'
        resolve({
          ok: false,
          success: false,
          code: 'EDITOR_RESULT_TIMEOUT',
          outcomeUnknown: true,
          retryable: false,
          error: message,
          message,
        })
      }, budget)

      pending.set(id, {
        resolve,
        timer,
        kind: meta.kind || 'rpc',
        sessionId: meta.sessionId || headerObj.sessionId || null,
        relayReqId: meta.relayReqId || headerObj.reqId || id,
        onProgress: meta.onProgress || null,
      })

      try {
        child.stdin.write(wire)
      } catch (err) {
        clearTimeout(timer)
        pending.delete(id)
        resolve({
          ok: false,
          success: false,
          code: 'LOK_WRITE_FAILED',
          error: err.message,
          message: err.message,
        })
      }
    })
  }

  /**
   * Open or attach a document view session inside the single LOK worker process.
   * Replaces multi-<webview> process duplication with lightweight LOK views.
   *
   * @param {{sessionId: string, fileId?: string|number, docPath?: string, authorName?: string, docSizeTwips?: {width:number,height:number}}} params
   */
  async function openSession(params = {}) {
    const sessionId = String(params.sessionId || params.fileId || `sess_${++rpcSeq}`)
    const session = {
      sessionId,
      fileId: params.fileId ?? null,
      docPath: params.docPath ?? null,
      authorName: params.authorName ?? '',
      viewId: 0,
      docSizeTwips: normalizeDocSizeTwips(params.docSizeTwips) || { width: 11906, height: 16838 }, // A4 default in twips
      generationId: 1,
      zoom: 1,
      dpi: 1,
    }
    sessions.set(sessionId, session)

    const resp = await sendRawFrame({
      type: 'session:open',
      sessionId,
      fileId: session.fileId,
      docPath: session.docPath,
      authorName: session.authorName,
    }, null, params.timeoutMs || defaultTimeoutMs, { kind: 'rpc', sessionId })

    if (resp && resp.ok) {
      if (Number.isInteger(resp.viewId)) session.viewId = resp.viewId
      const normSize = normalizeDocSizeTwips(resp.docSizeTwips)
      if (normSize) session.docSizeTwips = normSize
      emitRelay({ __lo: RELAY_TAG, type: 'ready', sessionId }, sessionId)
    }
    return { ...resp, session: { ...session } }
  }

  /**
   * Close a document view session in the worker.
   * @param {string} sessionId
   */
  async function closeSession(sessionId) {
    const existing = sessions.get(sessionId)
    sessions.delete(sessionId)
    if (!existing || !proc) return { ok: true, sessionId }
    return sendRawFrame({
      type: 'session:close',
      sessionId,
      viewId: existing.viewId,
    }, null, defaultTimeoutMs, { kind: 'rpc', sessionId })
  }

  function getSession(sessionId) {
    const s = sessions.get(sessionId)
    return s ? { ...s } : null
  }

  function listSessions() {
    return Array.from(sessions.values()).map((s) => ({ ...s }))
  }

  /**
   * Coalesce and request painted tiles for a session.
   * @param {{sessionId: string, rects?: Array<any>, tiles?: Array<any>, zoom?: number, dpi?: number, tilePixelSize?: number, timeoutMs?: number}} req
   */
  async function requestTiles(req = {}) {
    const sessionId = req.sessionId
    const session = sessions.get(sessionId)
    const generationId = session ? session.generationId : (Number(req.generationId) || 1)
    const docSizeTwips = (session && session.docSizeTwips) || req.docSizeTwips || null
    const targetTiles = Array.isArray(req.tiles) && req.tiles.length > 0
      ? req.tiles
      : coalesceInvalidatedTiles(req.rects || [], req.tileSizeTwips || tileSizeTwips, docSizeTwips)

    const pixelSide = Number(req.tilePixelSize) > 0 ? Math.round(Number(req.tilePixelSize)) : DEFAULT_TILE_SIZE_PX
    const results = []
    for (const tile of targetTiles) {
      // Drop requests immediately if session generation already advanced mid-batch
      if (session && session.generationId !== generationId && req.dropStale !== false) {
        results.push({ ok: false, stale: true, tile, generationId })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      const painted = await sendRawFrame({
        type: 'tile:paint',
        sessionId,
        col: tile.col,
        row: tile.row,
        xTwips: tile.xTwips,
        yTwips: tile.yTwips,
        widthTwips: tile.widthTwips,
        heightTwips: tile.heightTwips,
        pixelWidth: pixelSide,
        pixelHeight: pixelSide,
        generationId,
      }, null, req.timeoutMs || defaultTimeoutMs, { kind: 'tile', sessionId })

      const isStale = Boolean(
        (session && session.generationId > generationId) ||
        (painted.header && painted.header.generationId && painted.header.generationId < (session ? session.generationId : generationId))
      )
      results.push({
        ok: painted.ok && !isStale,
        stale: isStale,
        col: tile.col,
        row: tile.row,
        key: tile.key || `${tile.col}:${tile.row}`,
        generationId: (painted.header && painted.header.generationId) || generationId,
        pixels: painted.pixels || Buffer.alloc(0),
        header: painted.header || {},
      })
    }
    return results
  }

  /**
   * Forward mouse, keyboard, or IME composition input to the LOK worker.
   * @param {{sessionId: string, kind: 'mouse'|'key'|'ime'|'uno', [key: string]: any}} inputEvent
   */
  async function forwardInput(inputEvent = {}) {
    const { sessionId, kind, timeoutMs, ...rest } = inputEvent
    return sendRawFrame({
      type: 'input:event',
      sessionId,
      kind,
      ...rest,
    }, null, timeoutMs || defaultTimeoutMs, { kind: 'rpc', sessionId })
  }

  /**
   * Execute an AI WorkDeck `lo-relay` command (`office_thread.js` contract) over the sidecar worker.
   * Preserves binary payloads (e.g. `load_document` bytes) out-of-band in the binary frame slot.
   *
   * @param {{id?: string, reqId?: string, sessionId?: string, action: string, params?: object, timeoutMs?: number, onProgress?: Function}} msg
   */
  async function executeRelayMessage(msg = {}) {
    const reqId = msg.reqId || msg.id || `rly_${Date.now()}_${++rpcSeq}`
    const action = msg.action
    const rawParams = msg.params && typeof msg.params === 'object' ? { ...msg.params } : {}
    let binaryPayload = null

    if (rawParams.bytes && (Buffer.isBuffer(rawParams.bytes) || rawParams.bytes instanceof Uint8Array || rawParams.bytes instanceof ArrayBuffer)) {
      binaryPayload = toBuffer(rawParams.bytes)
      delete rawParams.bytes
      rawParams.__binaryAttached = true
    }

    return sendRawFrame({
      type: 'lo-relay:request',
      __lo: RELAY_TAG,
      id: reqId,
      reqId,
      sessionId: msg.sessionId || null,
      action,
      params: rawParams,
      ...(msg.waitForCompletion ? { waitForCompletion: true } : {}),
    }, binaryPayload, msg.timeoutMs || defaultTimeoutMs, {
      kind: 'relay',
      sessionId: msg.sessionId || null,
      relayReqId: reqId,
      onProgress: msg.onProgress || null,
    })
  }

  /**
   * Create a `{ send, subscribe, requestReady }` bridge object for `lokSidecarTransport`
   * in `useZetaOfficeWebview.js`, bound to an optional `sessionId`.
   *
   * @param {string|null} [boundSessionId=null]
   */
  function createSessionRelayBridge(boundSessionId = null) {
    return {
      sessionId: boundSessionId,
      send: async (msg) => {
        if (!msg || typeof msg !== 'object') return
        const sessionId = msg.sessionId || boundSessionId || null
        if (msg.__lo === RELAY_TAG && msg.type === 'exec') {
          const result = await executeRelayMessage({
            reqId: msg.reqId,
            sessionId,
            action: msg.action,
            params: msg.params,
            waitForCompletion: msg.waitForCompletion,
          })
          // If the command failed because the engine died, createRelayExecutor already handles engine-failed
          if (result && result.code === 'EDITOR_ENGINE_FAILED') return
          // If it timed out inside sidecar, let createRelayExecutor's own timer or result settle cleanly
          emitRelay({
            __lo: RELAY_TAG,
            type: 'result',
            reqId: msg.reqId,
            sessionId,
            result,
          }, sessionId)
          return
        }
        // Non-exec host->guest relay message (e.g. set-theme, insight-sub, semantic-writing-panel)
        await sendRawFrame({
          type: 'lo-relay:host-message',
          sessionId,
          payload: msg,
        }, null, defaultTimeoutMs, { kind: 'rpc', sessionId })
      },
      subscribe: (handler) => {
        const wrapped = (msg, msgSessionId) => {
          if (boundSessionId && msgSessionId && msgSessionId !== boundSessionId) return
          handler(msg)
        }
        relaySubscribers.add(wrapped)
        return () => relaySubscribers.delete(wrapped)
      },
      notifyReady: () => {
        emitRelay({ __lo: RELAY_TAG, type: 'ready', sessionId: boundSessionId }, boundSessionId)
      },
    }
  }

  function getHealth() {
    return {
      ok: state === 'running' && Boolean(proc),
      state,
      engineMode,
      pid: proc && proc.pid ? proc.pid : null,
      restarts,
      activeSessions: sessions.size,
      pendingRequests: pending.size,
      lastError,
    }
  }

  async function getEditorDescriptor(fallbackWebviewDescriptorFn) {
    if (engineMode === 'lok') {
      ensureStarted()
      return {
        kind: 'lok',
        engine: 'lok-sidecar',
        tileSizePx: DEFAULT_TILE_SIZE_PX,
        tileSizeTwips,
      }
    }
    const fallback = typeof fallbackWebviewDescriptorFn === 'function'
      ? await fallbackWebviewDescriptorFn()
      : {}
    return {
      kind: 'webview',
      ...fallback,
    }
  }

  function stop() {
    stopping = true
    if (decoder) decoder.reset()
    sessions.clear()
    failAllPending('EDITOR_DISPOSED', 'Editor closed / 编辑器已关闭')
    if (proc) {
      const child = proc
      proc = null
      try {
        if (typeof child.kill === 'function') child.kill('SIGTERM')
      } catch (_e) {
        // Ignore kill error on already exited child
      }
    }
    state = 'stopped'
  }

  return {
    ensureStarted,
    stop,
    getHealth,
    getEditorDescriptor,
    openSession,
    closeSession,
    getSession,
    listSessions,
    requestTiles,
    forwardInput,
    executeRelayMessage,
    createSessionRelayBridge,
    on: (event, listener) => bus.on(event, listener),
    off: (event, listener) => bus.off(event, listener),
  }
}

module.exports = {
  MAX_FRAME_BYTES,
  DEFAULT_TILE_SIZE_PX,
  DEFAULT_TWIPS_PER_PX,
  DEFAULT_TILE_SIZE_TWIPS,
  encodeFrame,
  FrameDecoder,
  coalesceInvalidatedTiles,
  resolveEditorEngineMode,
  createLokSidecarManager,
}
