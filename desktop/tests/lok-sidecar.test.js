// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  DEFAULT_TILE_SIZE_TWIPS,
  encodeFrame,
  FrameDecoder,
  coalesceInvalidatedTiles,
  resolveEditorEngineMode,
  createLokSidecarManager,
} = require('../main/lok-sidecar')

/**
 * Create a fake child process with EventEmitter stdin/stdout/stderr and helper to inspect
 * incoming frames from `lok-sidecar` and push outgoing worker frames back.
 */
function createFakeWorkerProcess(pid = 4201) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.signals = []

  const receivedFrames = []
  const stdinDecoder = new FrameDecoder({
    onFrame: (frame) => {
      receivedFrames.push(frame)
      child.emit('frame', frame)
    },
  })

  child.stdin = {
    write(buf) {
      stdinDecoder.push(buf)
      return true
    },
  }

  child.kill = (sig = 'SIGTERM') => {
    child.killed = true
    child.signals.push(sig)
  }

  child.sendFrame = (headerObj, binaryPayload = null) => {
    const raw = encodeFrame(headerObj, binaryPayload)
    child.stdout.emit('data', raw)
  }

  child.receivedFrames = receivedFrames
  return child
}

test('encodeFrame and FrameDecoder round-trip JSON control + binary tile payloads across arbitrary chunk splits', () => {
  const header1 = { type: 'tile:paint:ok', id: 'req_1', col: 2, row: 5, generationId: 7 }
  const pixels1 = Buffer.alloc(256 * 4, 0x7f)
  pixels1[0] = 0x12
  pixels1[pixels1.length - 1] = 0xfe

  const header2 = { type: 'lo-relay:result', id: 'req_2', result: { success: true, text: '第一条 合同标的' } }
  const wire1 = encodeFrame(header1, pixels1)
  const wire2 = encodeFrame(header2, null)
  const combined = Buffer.concat([wire1, wire2])

  const collected = []
  const decoder = new FrameDecoder({ onFrame: (f) => collected.push(f) })

  // Feed 3 bytes at a time to exercise split 8-byte prefixes, split UTF-8 multibyte chars, and split binary payloads
  for (let offset = 0; offset < combined.length; offset += 3) {
    decoder.push(combined.subarray(offset, Math.min(combined.length, offset + 3)))
  }

  assert.equal(decoder.pendingByteLength, 0)
  assert.equal(collected.length, 2)
  assert.deepEqual(collected[0].header, header1)
  assert.deepEqual(collected[0].binaryPayload, pixels1)
  assert.deepEqual(collected[1].header, header2)
  assert.equal(collected[1].binaryPayload.length, 0)
})

test('encodeFrame and FrameDecoder enforce maxFrameBytes cap and reject malformed JSON headers', () => {
  assert.throws(
    () => encodeFrame({ type: 'oversized' }, Buffer.alloc(1024), { maxFrameBytes: 512 }),
    (err) => err.code === 'LOK_FRAME_TOO_LARGE'
  )

  const decoder = new FrameDecoder({ maxFrameBytes: 128 })
  const fakePrefix = Buffer.alloc(8)
  fakePrefix.writeUInt32LE(64, 0)
  fakePrefix.writeUInt32LE(100, 4) // 164 > 128
  assert.throws(
    () => decoder.push(fakePrefix),
    (err) => err.code === 'LOK_FRAME_TOO_LARGE'
  )

  const badJsonBody = Buffer.from('{not-valid-json', 'utf8')
  const badHeaderPrefix = Buffer.alloc(8)
  badHeaderPrefix.writeUInt32LE(badJsonBody.length, 0)
  badHeaderPrefix.writeUInt32LE(0, 4)
  assert.throws(
    () => decoder.push(Buffer.concat([badHeaderPrefix, badJsonBody])),
    (err) => err.code === 'LOK_INVALID_HEADER_JSON'
  )
})

test('coalesceInvalidatedTiles deduplicates overlapping rects, parses LOK CSV strings, and clamps to docSizeTwips', () => {
  const step = DEFAULT_TILE_SIZE_TWIPS // 3840
  const rects = [
    // Two overlapping rects inside tile (0, 0)
    { x: 100, y: 120, width: 500, height: 400 },
    [250, 200, 800, 600],
    // LOK CSV rect crossing from tile (0, 1) into tile (1, 1)
    '3000, 4000, 1200, 500',
    // Empty / invalid LOK payloads that must be ignored
    'EMPTY',
    { x: 0, y: 0, width: 0, height: 500 },
    // Rect extending beyond document bounds (doc width = 7680 => cols 0..1, height = 7680 => rows 0..1)
    { x: 7000, y: 7000, width: 5000, height: 5000 },
    // Rect completely outside document bounds
    { x: 9000, y: 9000, width: 1000, height: 1000 },
  ]

  const tiles = coalesceInvalidatedTiles(rects, step, { widthTwips: 7680, heightTwips: 7680 })
  assert.deepEqual(
    tiles.map((t) => ({ col: t.col, row: t.row, key: t.key, xTwips: t.xTwips, yTwips: t.yTwips })),
    [
      { col: 0, row: 0, key: '0:0', xTwips: 0, yTwips: 0 },
      { col: 0, row: 1, key: '0:1', xTwips: 0, yTwips: 3840 },
      { col: 1, row: 1, key: '1:1', xTwips: 3840, yTwips: 3840 },
    ]
  )
})

test('resolveEditorEngineMode defaults to webview and activates lok only when explicitly configured', () => {
  assert.equal(resolveEditorEngineMode({}, null), 'webview')
  assert.equal(resolveEditorEngineMode({ AWD_EDITOR_ENGINE: 'webview' }, null), 'webview')
  assert.equal(resolveEditorEngineMode({ AWD_EDITOR_ENGINE: 'lok' }, null), 'lok')
  assert.equal(resolveEditorEngineMode({ AWD_EDITOR_ENGINE: 'LOK' }, null), 'lok')
  assert.equal(resolveEditorEngineMode({}, { editorEngine: 'lok' }), 'lok')
})

test('createLokSidecarManager manages sessions, coalesces tile invalidations, and bridges lo-relay commands with binary payloads', async () => {
  const workers = []
  const events = []
  const manager = createLokSidecarManager({
    engineMode: 'lok',
    spawnFn: (_bin, _args, opts) => {
      const w = createFakeWorkerProcess(5000 + workers.length)
      w.spawnOpts = opts
      workers.push(w)
      return w
    },
    onEvent: (e) => events.push(e),
  })

  const desc = await manager.getEditorDescriptor(async () => ({ url: 'http://127.0.0.1:47613/editor.html' }))
  assert.equal(desc.kind, 'lok')
  assert.equal(workers.length, 1)
  assert.equal(workers[0].spawnOpts.env.SAL_SKIA, 'raster')
  assert.equal(workers[0].spawnOpts.env.SAL_FORCE_HIDPI_SCALING, '1')

  const worker = workers[0]
  worker.on('frame', ({ header, binaryPayload }) => {
    if (header.type === 'session:open') {
      worker.sendFrame({
        id: header.id,
        ok: true,
        viewId: 3,
        docSizeTwips: { width: 11906, height: 33676 },
      })
    } else if (header.type === 'tile:paint') {
      const pixelBuf = Buffer.alloc(16, header.col + header.row + 1)
      worker.sendFrame({
        id: header.id,
        type: 'tile:paint:ok',
        ok: true,
        col: header.col,
        row: header.row,
        generationId: header.generationId,
      }, pixelBuf)
    } else if (header.type === 'lo-relay:request') {
      if (header.action === 'load_document') {
        assert.equal(header.params.__binaryAttached, true)
        assert.equal(binaryPayload.length, 4)
        worker.sendFrame({
          id: header.id,
          result: { success: true, byteLength: binaryPayload.length, kind: 'writer' },
        })
      } else if (header.action === 'find_replace') {
        worker.sendFrame({
          type: 'lo-relay:progress',
          id: header.id,
          reqId: header.reqId,
          sessionId: header.sessionId,
          done: 25,
          total: 50,
          stage: 'replacing',
        })
        worker.sendFrame({
          id: header.id,
          result: { success: true, replaced: 50 },
        })
      }
    }
  })

  // 1. Open session & verify ready signal on session relay bridge
  const bridge = manager.createSessionRelayBridge('left:doc-1')
  const bridgeMessages = []
  const unsub = bridge.subscribe((m) => bridgeMessages.push(m))

  const opened = await manager.openSession({
    sessionId: 'left:doc-1',
    fileId: 'doc-1',
    authorName: '张律师',
  })
  assert.equal(opened.ok, true)
  assert.equal(opened.session.viewId, 3)
  assert.deepEqual(opened.session.docSizeTwips, { width: 11906, height: 33676 })
  assert.ok(bridgeMessages.some((m) => m.__lo === 'lo-relay' && m.type === 'ready'))

  // 2. Unsolicited LOK_CALLBACK_INVALIDATE_TILES from worker bumps generationId & coalesces rects
  worker.sendFrame({
    type: 'event:invalidate_tiles',
    sessionId: 'left:doc-1',
    rects: ['100, 100, 400, 400', '200, 200, 600, 600', '4000, 100, 500, 500'],
  })
  const invEvt = events.find((e) => e.type === 'tile-invalidated')
  assert.ok(invEvt)
  assert.equal(invEvt.generationId, 2)
  assert.deepEqual(invEvt.tiles.map((t) => t.key), ['0:0', '1:0'])

  // 3. Request tiles for the invalidated rects
  const paintedTiles = await manager.requestTiles({
    sessionId: 'left:doc-1',
    tiles: invEvt.tiles,
    tilePixelSize: 256,
  })
  assert.equal(paintedTiles.length, 2)
  assert.equal(paintedTiles[0].ok, true)
  assert.equal(paintedTiles[0].stale, false)
  assert.equal(paintedTiles[0].pixels.length, 16)

  // 4. Execute lo-relay command with binary payload (`load_document`)
  const loadRes = await manager.executeRelayMessage({
    sessionId: 'left:doc-1',
    action: 'load_document',
    params: { authorName: '张律师', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) },
  })
  assert.deepEqual(loadRes, { success: true, byteLength: 4, kind: 'writer' })

  // 5. Execute lo-relay command with progress frames (`find_replace`)
  const progressFrames = []
  const replaceRes = await manager.executeRelayMessage({
    sessionId: 'left:doc-1',
    reqId: 'rly_find_1',
    action: 'find_replace',
    params: { findText: '甲方', replaceText: '委托方' },
    onProgress: (p) => progressFrames.push(p),
  })
  assert.deepEqual(replaceRes, { success: true, replaced: 50 })
  assert.equal(progressFrames.length, 1)
  assert.equal(progressFrames[0].done, 25)
  assert.equal(progressFrames[0].total, 50)
  assert.equal(progressFrames[0].stage, 'replacing')

  unsub()
  manager.stop()
})

test('createLokSidecarManager recovers from worker crash and settles in-flight requests cleanly', async () => {
  const workers = []
  const manager = createLokSidecarManager({
    engineMode: 'lok',
    maxRestarts: 1,
    requestTimeoutMs: 50,
    spawnFn: () => {
      const w = createFakeWorkerProcess(6000 + workers.length)
      workers.push(w)
      return w
    },
  })

  manager.ensureStarted()
  assert.equal(workers.length, 1)

  // Issue a command that never gets answered before the worker crashes
  const pendingRelay = manager.executeRelayMessage({
    sessionId: 'left:doc-crash',
    action: 'get_document_text',
    params: {},
  })

  // Simulate unexpected worker crash
  workers[0].emit('exit', 139, 'SIGSEGV')
  const crashResult = await pendingRelay
  assert.equal(crashResult.success, false)
  assert.equal(crashResult.code, 'EDITOR_ENGINE_FAILED')

  // Supervisor should have auto-restarted once (restarts === 1, workers.length === 2)
  const healthAfterFirstCrash = manager.getHealth()
  assert.equal(healthAfterFirstCrash.restarts, 1)
  assert.equal(healthAfterFirstCrash.state, 'running')
  assert.equal(workers.length, 2)

  // A command that exceeds requestTimeoutMs resolves with EDITOR_RESULT_TIMEOUT
  const timeoutRes = await manager.executeRelayMessage({
    sessionId: 'left:doc-timeout',
    action: 'get_paragraph',
    params: { index: 0 },
    timeoutMs: 25,
  })
  assert.equal(timeoutRes.success, false)
  assert.equal(timeoutRes.code, 'EDITOR_RESULT_TIMEOUT')
  assert.equal(timeoutRes.retryable, false)

  manager.stop()
})
