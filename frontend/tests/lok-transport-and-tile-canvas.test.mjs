// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test'
import assert from 'node:assert/strict'
import { host, isDesktopHost } from '../src/services/host.js'
import {
  webviewTransport,
  iframeTransport,
  lokSidecarTransport,
  createLokSidecarEditorExecutor,
} from '../src/composables/useZetaOfficeWebview.js'
import {
  DEFAULT_TILE_SIZE_PX,
  DEFAULT_TILE_SIZE_TWIPS,
  twipsToCssPx,
  cssPxToTwips,
  tilePhysicalPixels,
  coalesceDirtyTileRects,
  computeVisibleTileGrid,
  TileCache,
  createLokTileViewportController,
} from '../src/composables/useLokTileCanvas.js'

test('host.zetaoffice.getEditor preserves kind: "lok" when AWD_EDITOR_ENGINE=lok is active and defaults to "webview" otherwise', async (t) => {
  const prevWindow = globalThis.window
  t.after(() => {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
  })

  // 1. Default desktop descriptor without kind -> defaults to 'webview'
  globalThis.window = {
    checkbaDesktop: {
      zetaoffice: {
        getEditor: async () => ({
          url: 'http://127.0.0.1:47613/editor.html',
          preload: '/path/to/preload.js',
          partition: 'persist:zetaoffice',
        }),
      },
    },
  }
  assert.equal(isDesktopHost(), true)
  const webviewDesc = await host.zetaoffice.getEditor()
  assert.equal(webviewDesc.kind, 'webview')
  assert.equal(webviewDesc.url, 'http://127.0.0.1:47613/editor.html')
  assert.equal(webviewDesc.partition, 'persist:zetaoffice')

  // 2. Native LOK Sidecar descriptor -> preserves kind: 'lok'
  globalThis.window = {
    checkbaDesktop: {
      zetaoffice: {
        getEditor: async () => ({
          kind: 'lok',
          engine: 'lok-sidecar',
          tileSizePx: 256,
          tileSizeTwips: 3840,
        }),
      },
    },
  }
  const lokDesc = await host.zetaoffice.getEditor()
  assert.equal(lokDesc.kind, 'lok')
  assert.equal(lokDesc.engine, 'lok-sidecar')
  assert.equal(lokDesc.tileSizePx, 256)

  // 3. Falsy/empty kind -> safely falls back to 'webview'
  globalThis.window = {
    checkbaDesktop: {
      zetaoffice: {
        getEditor: async () => ({
          kind: '',
          url: 'http://127.0.0.1:47613/editor.html',
        }),
      },
    },
  }
  const fallbackDesc = await host.zetaoffice.getEditor()
  assert.equal(fallbackDesc.kind, 'webview')
})

test('lokSidecarTransport and createLokSidecarEditorExecutor isolate multi-tab sessions and drive lo-relay commands', async () => {
  const sent = []
  const subscribers = new Set()
  const fakeSidecarBridge = {
    send(msg) {
      sent.push(msg)
    },
    subscribe(fn) {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    deliver(msg) {
      for (const fn of subscribers) fn(msg)
    },
  }

  let readyLeft = false
  let readyRight = false
  const progressLeft = []

  const execLeft = createLokSidecarEditorExecutor(fakeSidecarBridge, {
    sessionId: 'left:file-101',
    timeoutMs: 5000,
    onReady: () => { readyLeft = true },
    onProgress: (reqId, p) => progressLeft.push({ reqId, ...p }),
  })
  const execRight = createLokSidecarEditorExecutor(fakeSidecarBridge, {
    sessionId: 'right:file-202',
    timeoutMs: 5000,
    onReady: () => { readyRight = true },
  })

  // Ready signal for left session should only trigger left's onReady
  fakeSidecarBridge.deliver({ __lo: 'lo-relay', type: 'ready', sessionId: 'left:file-101' })
  assert.equal(readyLeft, true)
  assert.equal(readyRight, false)

  // Dispatch concurrent commands from left and right panes
  const pLeft = execLeft.executeCommand('find_replace', { findText: '甲方', replaceText: '买方', __agent: true })
  const pRight = execRight.executeCommand('get_document_text', { offset: 0, limit: 50 })

  assert.equal(sent.length, 2)
  assert.equal(sent[0].sessionId, 'left:file-101')
  assert.equal(sent[0].action, 'find_replace')
  assert.equal(sent[1].sessionId, 'right:file-202')
  assert.equal(sent[1].action, 'get_document_text')

  // Progress for left session
  fakeSidecarBridge.deliver({
    __lo: 'lo-relay',
    type: 'progress',
    sessionId: 'left:file-101',
    reqId: sent[0].reqId,
    done: 15,
    total: 30,
    stage: 'replacing',
  })
  assert.equal(progressLeft.length, 1)
  assert.equal(progressLeft[0].done, 15)
  assert.equal(progressLeft[0].stage, 'replacing')

  // Resolve both commands
  fakeSidecarBridge.deliver({
    __lo: 'lo-relay',
    type: 'result',
    sessionId: 'right:file-202',
    reqId: sent[1].reqId,
    result: { success: true, paragraphs: [{ index: 0, text: '右侧文档首段' }] },
  })
  fakeSidecarBridge.deliver({
    __lo: 'lo-relay',
    type: 'result',
    sessionId: 'left:file-101',
    reqId: sent[0].reqId,
    result: { success: true, replaced: 30 },
  })

  assert.deepEqual(await pLeft, { success: true, replaced: 30 })
  assert.deepEqual(await pRight, { success: true, paragraphs: [{ index: 0, text: '右侧文档首段' }] })

  execLeft.dispose()
  execRight.dispose()
  assert.equal(subscribers.size, 0)
})

test('webviewTransport and iframeTransport remain 100% compatible alongside lokSidecarTransport', () => {
  const sentWebview = []
  const listeners = new Map()
  const fakeWebviewEl = {
    send: (ch, msg) => sentWebview.push({ ch, msg }),
    addEventListener: (ev, fn) => listeners.set(ev, fn),
    removeEventListener: (ev) => listeners.delete(ev),
  }
  const wt = webviewTransport(fakeWebviewEl)
  const received = []
  const off = wt.subscribe((m) => received.push(m))
  wt.send({ hello: 1 })
  assert.deepEqual(sentWebview, [{ ch: 'lo-relay', msg: { hello: 1 } }])
  listeners.get('ipc-message')({ channel: 'lo-relay', args: [{ reply: 2 }] })
  assert.deepEqual(received, [{ reply: 2 }])
  off()
  assert.equal(listeners.size, 0)
  assert.equal(typeof iframeTransport, 'function')
  assert.equal(typeof lokSidecarTransport, 'function')
})

test('useLokTileCanvas twips <-> CSS px math, visible grid calculation, and dirty rect coalescing', () => {
  // At zoom 1.0, 3840 twips === 256 CSS px
  assert.equal(twipsToCssPx(DEFAULT_TILE_SIZE_TWIPS, 1.0), DEFAULT_TILE_SIZE_PX)
  assert.equal(cssPxToTwips(DEFAULT_TILE_SIZE_PX, 1.0), DEFAULT_TILE_SIZE_TWIPS)

  // At zoom 2.0, 3840 twips === 512 CSS px, and 512 CSS px === 3840 twips
  assert.equal(twipsToCssPx(3840, 2.0), 512)
  assert.equal(cssPxToTwips(512, 2.0), 3840)

  // HiDPI backing texture pixels
  assert.equal(tilePhysicalPixels(256, 1), 256)
  assert.equal(tilePhysicalPixels(256, 2), 512)
  assert.equal(tilePhysicalPixels(256, 1.25), 320)

  // Visible tile grid for a 600x400 px viewport scrolled to (128, 256) at zoom 1.0
  // scrollLeft=128px (1920 twips) .. right=728px (10920 twips) -> cols 0..2
  // scrollTop=256px (3840 twips) .. bottom=656px (9840 twips) -> rows 1..2
  const grid = computeVisibleTileGrid({
    scrollLeftPx: 128,
    scrollTopPx: 256,
    viewportWidthPx: 600,
    viewportHeightPx: 400,
    zoom: 1.0,
    docWidthTwips: 11906,
    docHeightTwips: 16838,
  })
  assert.equal(grid.startCol, 0)
  assert.equal(grid.endCol, 2)
  assert.equal(grid.startRow, 1)
  assert.equal(grid.endRow, 2)
  assert.equal(grid.tiles.length, 6)
  assert.deepEqual(
    grid.tiles.map((t) => t.key),
    ['0:1', '1:1', '2:1', '0:2', '1:2', '2:2']
  )
  // First visible tile (0:1) is at yTwips=3840 => cssTopPx = 256 - 256 = 0, cssLeftPx = 0 - 128 = -128
  assert.equal(grid.tiles[0].cssLeftPx, -128)
  assert.equal(grid.tiles[0].cssTopPx, 0)

  // Dirty rect coalescing
  const coalesced = coalesceDirtyTileRects([
    '0, 0, 1000, 1000',
    { x: 500, y: 500, width: 2000, height: 2000 },
    [3800, 100, 200, 200], // crosses x=3840 into col 1
  ])
  assert.deepEqual(coalesced.map((t) => t.key), ['0:0', '1:0'])
})

test('TileCache and createLokTileViewportController enforce generation safety, LRU eviction, and IME input guard', () => {
  const cache = new TileCache({ maxEntries: 3 })
  assert.equal(cache.put('0:0', { pixels: new Uint8Array([1]), generationId: 1 }), true)
  assert.equal(cache.put('1:0', { pixels: new Uint8Array([2]), generationId: 1 }), true)
  assert.equal(cache.put('0:1', { pixels: new Uint8Array([3]), generationId: 1 }), true)

  // Touch '0:0' so '1:0' becomes the oldest LRU entry
  assert.ok(cache.get('0:0'))
  assert.equal(cache.put('1:1', { pixels: new Uint8Array([4]), generationId: 1 }), true)
  assert.equal(cache.size, 3)
  assert.equal(cache.peek('1:0'), null, 'oldest untouched entry 1:0 must be evicted first')
  assert.ok(cache.peek('0:0'), 'recently accessed entry 0:0 must remain in cache')

  // Mark tile 0:0 dirty -> bumps generation to 2 and marks 0:0 stale while keeping its old pixels
  cache.markDirtyRects(['100, 100, 500, 500'])
  assert.equal(cache.currentGeneration, 2)
  assert.equal(cache.peek('0:0').stale, true)
  assert.deepEqual(cache.peek('0:0').pixels, new Uint8Array([1]))

  // Late tile from generation 1 must be rejected
  assert.equal(cache.put('0:0', { pixels: new Uint8Array([99]), generationId: 1 }), false)
  assert.equal(cache.peek('0:0').stale, true)

  // Current generation 2 tile lands and clears stale flag
  assert.equal(cache.put('0:0', { pixels: new Uint8Array([42]), generationId: 2 }), true)
  assert.equal(cache.peek('0:0').stale, false)
  assert.deepEqual(cache.peek('0:0').pixels, new Uint8Array([42]))

  // Viewport controller: pan/zoom, tile requests, mouse twips conversion, and IME composition guard
  const tileRequests = []
  const inputs = []
  const controller = createLokTileViewportController({
    sessionId: 'left:doc-9',
    viewportWidthPx: 500,
    viewportHeightPx: 400,
    docWidthTwips: 11906,
    docHeightTwips: 16838,
    zoom: 1.0,
    devicePixelRatio: 2.0,
    onRequestTiles: (req) => tileRequests.push(req),
    onInput: (evt) => inputs.push(evt),
  })

  const initialMissing = controller.syncVisibleTiles()
  assert.equal(initialMissing.length, 4) // cols 0..1, rows 0..1
  assert.equal(tileRequests.length, 1)
  assert.equal(tileRequests[0].tilePixelSize, 512) // 256 * dpr(2.0)

  // Land tile 0:0
  assert.equal(
    controller.receiveTile({
      key: '0:0',
      col: 0,
      row: 0,
      generationId: controller.getState().generationId,
      pixels: new Uint8Array([10, 20, 30, 40]),
    }),
    true
  )

  // Mouse click at (100, 80) after scrolling to (50, 40) -> (150*15=2250, 120*15=1800) twips
  controller.panTo(50, 40)
  const mouseEvt = controller.forwardMouseEvent('mousedown', { cssX: 100, cssY: 80, button: 1, count: 1 })
  assert.equal(mouseEvt.xTwips, 2250)
  assert.equal(mouseEvt.yTwips, 1800)

  // CJK IME composition blocks raw keydowns until compositionend
  controller.forwardImeEvent('compositionstart', { text: 'zhong' })
  assert.equal(controller.getState().isComposing, true)
  assert.equal(controller.forwardKeyEvent('keydown', { key: 'Process', keyCode: 229 }), null)
  controller.forwardImeEvent('compositionend', { text: '中华人民共和国' })
  assert.equal(controller.getState().isComposing, false)
  const enterEvt = controller.forwardKeyEvent('keydown', { key: 'Enter', keyCode: 13 })
  assert.equal(enterEvt.key, 'Enter')
  assert.ok(inputs.some((i) => i.kind === 'ime' && i.phase === 'compositionend' && i.text === '中华人民共和国'))
})
