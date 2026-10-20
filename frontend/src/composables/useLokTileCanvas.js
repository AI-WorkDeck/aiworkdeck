// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * useLokTileCanvas.js — Web Canvas Tile Renderer & Input Bridge for Native LOK Sidecar.
 *
 * Implements the renderer-side counterpart of `desktop/main/lok-sidecar.js`, modeled after
 * ElyOffice `crates/ely-lok/src/view.rs` and `view/lane.rs`:
 * - Pure HiDPI coordinate conversion (`twipsToCssPx`, `cssPxToTwips`, `tilePhysicalPixels`);
 * - Viewport tile grid calculation (`computeVisibleTileGrid`) & dirty rect coalescing (`coalesceDirtyTileRects`);
 * - Generation-aware LRU `TileCache` (retains stale tiles until repaint lands to prevent edit flicker,
 *   and drops late tiles from older zoom/edit generations);
 * - High-level `createLokTileViewportController` for pan/zoom, visible tile fetching, and
 *   mouse / keyboard / CJK IME composition forwarding.
 */

export const DEFAULT_TILE_SIZE_PX = 256
export const DEFAULT_TWIPS_PER_PX = 15 // 1440 twips/inch ÷ 96 CSS px/inch = 15 twips/px at zoom 1.0
export const DEFAULT_TILE_SIZE_TWIPS = DEFAULT_TILE_SIZE_PX * DEFAULT_TWIPS_PER_PX // 3840 twips
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4.0

/**
 * Convert document twips to logical CSS pixels at a given zoom level.
 * @param {number} twips
 * @param {number} [zoom=1]
 * @param {number} [twipsPerPx=15]
 * @returns {number}
 */
export function twipsToCssPx(twips, zoom = 1, twipsPerPx = DEFAULT_TWIPS_PER_PX) {
  const t = Number(twips) || 0
  const z = Number(zoom) > 0 ? Number(zoom) : 1
  const scale = Number(twipsPerPx) > 0 ? Number(twipsPerPx) : DEFAULT_TWIPS_PER_PX
  return (t * z) / scale
}

/**
 * Convert logical CSS pixels to document twips (rounded to nearest integer twip).
 * @param {number} cssPx
 * @param {number} [zoom=1]
 * @param {number} [twipsPerPx=15]
 * @returns {number}
 */
export function cssPxToTwips(cssPx, zoom = 1, twipsPerPx = DEFAULT_TWIPS_PER_PX) {
  const px = Number(cssPx) || 0
  const z = Number(zoom) > 0 ? Number(zoom) : 1
  const scale = Number(twipsPerPx) > 0 ? Number(twipsPerPx) : DEFAULT_TWIPS_PER_PX
  return Math.round((px * scale) / z)
}

/**
 * Compute backing texture pixel side for one tile under HiDPI (`devicePixelRatio`).
 * @param {number} [tileSizePx=256]
 * @param {number} [devicePixelRatio=1]
 * @returns {number}
 */
export function tilePhysicalPixels(tileSizePx = DEFAULT_TILE_SIZE_PX, devicePixelRatio = 1) {
  const base = Number(tileSizePx) > 0 ? Number(tileSizePx) : DEFAULT_TILE_SIZE_PX
  const dpr = Number(devicePixelRatio) > 0 ? Number(devicePixelRatio) : 1
  return Math.max(1, Math.round(base * dpr))
}

/**
 * Normalize a dirty rectangle in twips from object, tuple `[x, y, w, h]`, or LOK CSV string.
 * @param {any} raw
 * @returns {{x:number, y:number, width:number, height:number}|null}
 */
export function normalizeRectTwips(raw) {
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
 * Coalesce overlapping or duplicate invalidation rectangles into aligned tile grid coordinates.
 * @param {Array<any>} rects
 * @param {number} [tileSizeTwips=3840]
 * @param {{width?:number, height?:number, widthTwips?:number, heightTwips?:number}|null} [docSizeTwips=null]
 * @returns {Array<{col:number, row:number, key:string, xTwips:number, yTwips:number, widthTwips:number, heightTwips:number}>}
 */
export function coalesceDirtyTileRects(rects, tileSizeTwips = DEFAULT_TILE_SIZE_TWIPS, docSizeTwips = null) {
  const step = Number(tileSizeTwips) > 0 ? Math.floor(Number(tileSizeTwips)) : DEFAULT_TILE_SIZE_TWIPS
  if (!Array.isArray(rects) || rects.length === 0) return []
  const docW = docSizeTwips ? Number(docSizeTwips.widthTwips ?? docSizeTwips.width ?? 0) : 0
  const docH = docSizeTwips ? Number(docSizeTwips.heightTwips ?? docSizeTwips.height ?? 0) : 0
  const hasBounds = docW > 0 && docH > 0

  const seen = new Map()
  for (const raw of rects) {
    const r = normalizeRectTwips(raw)
    if (!r || r.width <= 0 || r.height <= 0) continue
    let x0 = Math.max(0, r.x)
    let y0 = Math.max(0, r.y)
    let x1 = r.x + r.width
    let y1 = r.y + r.height
    if (hasBounds) {
      x1 = Math.min(docW, x1)
      y1 = Math.min(docH, y1)
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
            key,
            xTwips: col * step,
            yTwips: row * step,
            widthTwips: step,
            heightTwips: step,
          })
        }
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => (a.row - b.row) || (a.col - b.col))
}

/**
 * Compute the visible tile grid for a given viewport scroll offset, size, and zoom.
 * @param {object} params
 * @param {number} [params.scrollLeftPx=0]
 * @param {number} [params.scrollTopPx=0]
 * @param {number} [params.viewportWidthPx=800]
 * @param {number} [params.viewportHeightPx=600]
 * @param {number} [params.zoom=1]
 * @param {number} [params.docWidthTwips=11906]
 * @param {number} [params.docHeightTwips=16838]
 * @param {number} [params.tileSizeTwips=3840]
 * @param {number} [params.overscanTiles=0]
 */
export function computeVisibleTileGrid(params = {}) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(params.zoom) || 1))
  const scrollLeftPx = Math.max(0, Number(params.scrollLeftPx) || 0)
  const scrollTopPx = Math.max(0, Number(params.scrollTopPx) || 0)
  const viewportWidthPx = Math.max(0, Number(params.viewportWidthPx) || 0)
  const viewportHeightPx = Math.max(0, Number(params.viewportHeightPx) || 0)
  const docWidthTwips = Math.max(1, Number(params.docWidthTwips) || 11906)
  const docHeightTwips = Math.max(1, Number(params.docHeightTwips) || 16838)
  const tileSizeTwips = Number(params.tileSizeTwips) > 0 ? Math.floor(Number(params.tileSizeTwips)) : DEFAULT_TILE_SIZE_TWIPS
  const overscan = Math.max(0, Math.floor(Number(params.overscanTiles) || 0))

  if (viewportWidthPx === 0 || viewportHeightPx === 0) {
    return {
      zoom,
      visibleRectTwips: { xTwips: 0, yTwips: 0, widthTwips: 0, heightTwips: 0 },
      startCol: 0,
      endCol: -1,
      startRow: 0,
      endRow: -1,
      tiles: [],
    }
  }

  const leftTwips = Math.max(0, Math.min(docWidthTwips, cssPxToTwips(scrollLeftPx, zoom)))
  const topTwips = Math.max(0, Math.min(docHeightTwips, cssPxToTwips(scrollTopPx, zoom)))
  const rightTwips = Math.max(leftTwips, Math.min(docWidthTwips, cssPxToTwips(scrollLeftPx + viewportWidthPx, zoom)))
  const bottomTwips = Math.max(topTwips, Math.min(docHeightTwips, cssPxToTwips(scrollTopPx + viewportHeightPx, zoom)))

  if (rightTwips <= leftTwips || bottomTwips <= topTwips) {
    return {
      zoom,
      visibleRectTwips: { xTwips: leftTwips, yTwips: topTwips, widthTwips: 0, heightTwips: 0 },
      startCol: 0,
      endCol: -1,
      startRow: 0,
      endRow: -1,
      tiles: [],
    }
  }

  const maxCol = Math.max(0, Math.floor((docWidthTwips - 1) / tileSizeTwips))
  const maxRow = Math.max(0, Math.floor((docHeightTwips - 1) / tileSizeTwips))

  const startCol = Math.max(0, Math.floor(leftTwips / tileSizeTwips) - overscan)
  const endCol = Math.min(maxCol, Math.floor((rightTwips - 1) / tileSizeTwips) + overscan)
  const startRow = Math.max(0, Math.floor(topTwips / tileSizeTwips) - overscan)
  const endRow = Math.min(maxRow, Math.floor((bottomTwips - 1) / tileSizeTwips) + overscan)

  const tileCssSide = twipsToCssPx(tileSizeTwips, zoom)
  const tiles = []
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const xTwips = col * tileSizeTwips
      const yTwips = row * tileSizeTwips
      tiles.push({
        col,
        row,
        key: `${col}:${row}`,
        xTwips,
        yTwips,
        widthTwips: tileSizeTwips,
        heightTwips: tileSizeTwips,
        cssLeftPx: twipsToCssPx(xTwips, zoom) - scrollLeftPx,
        cssTopPx: twipsToCssPx(yTwips, zoom) - scrollTopPx,
        cssWidthPx: tileCssSide,
        cssHeightPx: tileCssSide,
      })
    }
  }

  return {
    zoom,
    visibleRectTwips: {
      xTwips: leftTwips,
      yTwips: topTwips,
      widthTwips: rightTwips - leftTwips,
      heightTwips: bottomTwips - topTwips,
    },
    startCol,
    endCol,
    startRow,
    endRow,
    tiles,
  }
}

/**
 * Generation-aware LRU Tile Cache.
 *
 * Key invariants (from ElyOffice `LokView`):
 * 1. Stale tiles remain drawable (`stale: true`) until their replacement lands, so typing never flashes blank.
 * 2. Incoming tiles with `generationId < currentGeneration` or mismatched `zoom` are rejected so slow
 *    paints from an earlier zoom/edit never overwrite newer pixels.
 * 3. Bounded capacity (`maxEntries`) evicts least-recently-used entries automatically.
 */
export class TileCache {
  /**
   * @param {{maxEntries?: number, tileSizeTwips?: number}} [opts]
   */
  constructor(opts = {}) {
    this.maxEntries = Number.isSafeInteger(opts.maxEntries) && opts.maxEntries > 0 ? opts.maxEntries : 128
    this.tileSizeTwips = Number(opts.tileSizeTwips) > 0 ? Math.floor(Number(opts.tileSizeTwips)) : DEFAULT_TILE_SIZE_TWIPS
    this.currentGeneration = 1
    this.zoom = 1
    this.devicePixelRatio = 1
    this._map = new Map()
  }

  get size() {
    return this._map.size
  }

  /**
   * Read a cached tile entry and refresh its LRU position.
   * @param {string} key e.g. `"0:1"`
   */
  get(key) {
    const entry = this._map.get(key)
    if (!entry) return null
    this._map.delete(key)
    this._map.set(key, entry)
    return entry
  }

  /**
   * Peek without updating LRU order.
   * @param {string} key
   */
  peek(key) {
    return this._map.get(key) || null
  }

  /**
   * Insert a painted tile if its `generationId` and `zoom` are still current.
   * @param {string} key
   * @param {{col?:number, row?:number, pixels?:Uint8Array, imageBitmap?:any, generationId?:number, zoom?:number, stale?:boolean}} value
   * @returns {boolean} true if accepted, false if rejected as stale generation/zoom
   */
  put(key, value = {}) {
    const incomingGen = Number(value.generationId ?? this.currentGeneration)
    if (incomingGen < this.currentGeneration) {
      return false
    }
    if (value.zoom !== undefined && Math.abs(Number(value.zoom) - this.zoom) > 1e-6) {
      return false
    }
    const existing = this._map.get(key)
    if (existing && !existing.stale && existing.generationId > incomingGen) {
      return false
    }

    const [parsedCol, parsedRow] = String(key).split(':').map(Number)
    const entry = {
      key: String(key),
      col: Number.isFinite(value.col) ? value.col : parsedCol,
      row: Number.isFinite(value.row) ? value.row : parsedRow,
      pixels: value.pixels || null,
      imageBitmap: value.imageBitmap || null,
      generationId: incomingGen,
      zoom: value.zoom !== undefined ? Number(value.zoom) : this.zoom,
      stale: Boolean(value.stale),
    }

    if (this._map.has(key)) {
      this._map.delete(key)
    }
    this._map.set(key, entry)

    while (this._map.size > this.maxEntries) {
      const oldestKey = this._map.keys().next().value
      if (oldestKey === undefined) break
      this._map.delete(oldestKey)
    }
    return true
  }

  /**
   * Mark tiles intersecting `rects` as stale and bump `currentGeneration`.
   * @param {Array<any>} rects
   * @param {{width?:number, height?:number}|null} [docSizeTwips=null]
   * @param {number} [explicitGeneration]
   */
  markDirtyRects(rects, docSizeTwips = null, explicitGeneration = null) {
    const coalesced = coalesceDirtyTileRects(rects, this.tileSizeTwips, docSizeTwips)
    if (Number.isFinite(explicitGeneration) && explicitGeneration > this.currentGeneration) {
      this.currentGeneration = explicitGeneration
    } else if (coalesced.length > 0) {
      this.currentGeneration += 1
    }
    for (const tile of coalesced) {
      const entry = this._map.get(tile.key)
      if (entry) {
        entry.stale = true
      }
    }
    return coalesced
  }

  /**
   * Mark all cached tiles stale (e.g. on zoom, DPI change, or full-document invalidation).
   * @param {{bumpGeneration?: boolean, zoom?: number, devicePixelRatio?: number, clearPixels?: boolean}} [opts]
   */
  invalidateAll(opts = {}) {
    if (opts.zoom !== undefined && Number(opts.zoom) > 0) {
      this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(opts.zoom)))
    }
    if (opts.devicePixelRatio !== undefined && Number(opts.devicePixelRatio) > 0) {
      this.devicePixelRatio = Number(opts.devicePixelRatio)
    }
    if (opts.bumpGeneration !== false) {
      this.currentGeneration += 1
    }
    if (opts.clearPixels) {
      this._map.clear()
      return
    }
    for (const entry of this._map.values()) {
      entry.stale = true
    }
  }

  clear() {
    this._map.clear()
  }
}

/**
 * Create a high-level LOK Tile Viewport Controller for a document session.
 * Coordinates pan/zoom, dirty tile invalidation, background tile fetching, and
 * mouse/keyboard/IME input forwarding.
 *
 * @param {object} options
 * @param {string} [options.sessionId='default']
 * @param {number} [options.viewportWidthPx=800]
 * @param {number} [options.viewportHeightPx=600]
 * @param {number} [options.docWidthTwips=11906]
 * @param {number} [options.docHeightTwips=16838]
 * @param {number} [options.zoom=1]
 * @param {number} [options.devicePixelRatio=1]
 * @param {number} [options.tileSizeTwips=3840]
 * @param {number} [options.maxCacheEntries=128]
 * @param {(req: object) => Promise<any>|any} [options.onRequestTiles]
 * @param {(evt: object) => Promise<any>|any} [options.onInput]
 * @param {(state: object) => void} [options.onRender]
 */
export function createLokTileViewportController(options = {}) {
  const sessionId = String(options.sessionId || 'default')
  const tileSizeTwips = Number(options.tileSizeTwips) > 0 ? Math.floor(Number(options.tileSizeTwips)) : DEFAULT_TILE_SIZE_TWIPS
  const cache = new TileCache({
    maxEntries: options.maxCacheEntries || 128,
    tileSizeTwips,
  })

  let scrollLeftPx = Math.max(0, Number(options.scrollLeftPx) || 0)
  let scrollTopPx = Math.max(0, Number(options.scrollTopPx) || 0)
  let viewportWidthPx = Math.max(0, Number(options.viewportWidthPx) ?? 800)
  let viewportHeightPx = Math.max(0, Number(options.viewportHeightPx) ?? 600)
  let docWidthTwips = Math.max(1, Number(options.docWidthTwips) || 11906)
  let docHeightTwips = Math.max(1, Number(options.docHeightTwips) || 16838)
  let zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(options.zoom) || 1))
  let devicePixelRatio = Math.max(0.5, Number(options.devicePixelRatio) || 1)
  let isComposing = false
  let preeditText = ''

  cache.zoom = zoom
  cache.devicePixelRatio = devicePixelRatio

  const inFlightKeys = new Set() // `${generationId}:${key}`

  function clampScroll() {
    const maxScrollX = Math.max(0, twipsToCssPx(docWidthTwips, zoom) - viewportWidthPx)
    const maxScrollY = Math.max(0, twipsToCssPx(docHeightTwips, zoom) - viewportHeightPx)
    scrollLeftPx = Math.max(0, Math.min(maxScrollX, scrollLeftPx))
    scrollTopPx = Math.max(0, Math.min(maxScrollY, scrollTopPx))
  }

  function getVisibleGrid(overscanTiles = 0) {
    return computeVisibleTileGrid({
      scrollLeftPx,
      scrollTopPx,
      viewportWidthPx,
      viewportHeightPx,
      zoom,
      docWidthTwips,
      docHeightTwips,
      tileSizeTwips,
      overscanTiles,
    })
  }

  function syncVisibleTiles() {
    const grid = getVisibleGrid(0)
    const missingOrStale = []
    const gen = cache.currentGeneration

    for (const tile of grid.tiles) {
      const cached = cache.peek(tile.key)
      const needsFetch = !cached || cached.stale || cached.zoom !== zoom
      const flightToken = `${gen}:${tile.key}`
      if (needsFetch && !inFlightKeys.has(flightToken)) {
        inFlightKeys.add(flightToken)
        missingOrStale.push(tile)
      }
    }

    if (missingOrStale.length > 0 && typeof options.onRequestTiles === 'function') {
      const reqPayload = {
        sessionId,
        generationId: gen,
        zoom,
        dpi: devicePixelRatio,
        tilePixelSize: tilePhysicalPixels(DEFAULT_TILE_SIZE_PX, devicePixelRatio),
        tiles: missingOrStale,
        visibleRectTwips: grid.visibleRectTwips,
      }
      Promise.resolve(options.onRequestTiles(reqPayload))
        .then((paintedList) => {
          if (Array.isArray(paintedList)) {
            for (const item of paintedList) {
              receiveTile(item)
            }
          }
        })
        .catch(() => {
          for (const t of missingOrStale) {
            inFlightKeys.delete(`${gen}:${t.key}`)
          }
        })
    }

    if (typeof options.onRender === 'function') {
      options.onRender(getState())
    }
    return missingOrStale
  }

  function receiveTile(tileResult) {
    if (!tileResult || typeof tileResult !== 'object') return false
    const key = tileResult.key || `${tileResult.col}:${tileResult.row}`
    const gen = Number(tileResult.generationId ?? cache.currentGeneration)
    inFlightKeys.delete(`${gen}:${key}`)
    if (tileResult.stale || tileResult.ok === false) return false

    const accepted = cache.put(key, {
      col: tileResult.col,
      row: tileResult.row,
      pixels: tileResult.pixels || null,
      imageBitmap: tileResult.imageBitmap || null,
      generationId: gen,
      zoom: tileResult.zoom !== undefined ? tileResult.zoom : zoom,
      stale: false,
    })
    if (accepted && typeof options.onRender === 'function') {
      options.onRender(getState())
    }
    return accepted
  }

  function panTo(nextLeftPx, nextTopPx) {
    scrollLeftPx = Number(nextLeftPx) || 0
    scrollTopPx = Number(nextTopPx) || 0
    clampScroll()
    return syncVisibleTiles()
  }

  function panBy(deltaXPx, deltaYPx) {
    return panTo(scrollLeftPx + (Number(deltaXPx) || 0), scrollTopPx + (Number(deltaYPx) || 0))
  }

  function setZoom(nextZoom, anchorCssPx = null) {
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(nextZoom) || 1))
    if (Math.abs(clampedZoom - zoom) < 1e-6) return []

    if (anchorCssPx && Number.isFinite(anchorCssPx.x) && Number.isFinite(anchorCssPx.y)) {
      const anchorDocTwipsX = cssPxToTwips(scrollLeftPx + anchorCssPx.x, zoom)
      const anchorDocTwipsY = cssPxToTwips(scrollTopPx + anchorCssPx.y, zoom)
      zoom = clampedZoom
      scrollLeftPx = twipsToCssPx(anchorDocTwipsX, zoom) - anchorCssPx.x
      scrollTopPx = twipsToCssPx(anchorDocTwipsY, zoom) - anchorCssPx.y
    } else {
      zoom = clampedZoom
    }

    inFlightKeys.clear()
    cache.invalidateAll({ bumpGeneration: true, zoom })
    clampScroll()
    return syncVisibleTiles()
  }

  function setViewportSize(widthPx, heightPx, nextDpr = devicePixelRatio) {
    viewportWidthPx = Math.max(0, Number(widthPx) || 0)
    viewportHeightPx = Math.max(0, Number(heightPx) || 0)
    const dpr = Math.max(0.5, Number(nextDpr) || 1)
    if (Math.abs(dpr - devicePixelRatio) > 1e-4) {
      devicePixelRatio = dpr
      inFlightKeys.clear()
      cache.invalidateAll({ bumpGeneration: true, devicePixelRatio })
    }
    clampScroll()
    return syncVisibleTiles()
  }

  function handleInvalidateTiles(evt = {}) {
    if (evt.docSizeTwips) {
      const w = Number(evt.docSizeTwips.widthTwips ?? evt.docSizeTwips.width)
      const h = Number(evt.docSizeTwips.heightTwips ?? evt.docSizeTwips.height)
      if (w > 0 && h > 0) {
        docWidthTwips = w
        docHeightTwips = h
        clampScroll()
      }
    }
    inFlightKeys.clear()
    if (evt.all) {
      cache.invalidateAll({ bumpGeneration: true })
      if (Number.isFinite(evt.generationId) && evt.generationId > cache.currentGeneration) {
        cache.currentGeneration = evt.generationId
      }
    } else {
      cache.markDirtyRects(
        evt.rects || evt.tiles || [],
        { width: docWidthTwips, height: docHeightTwips },
        evt.generationId
      )
    }
    return syncVisibleTiles()
  }

  function forwardMouseEvent(mouseType, evt = {}) {
    const cssX = Number(evt.cssX ?? evt.clientX ?? 0)
    const cssY = Number(evt.cssY ?? evt.clientY ?? 0)
    const xTwips = cssPxToTwips(scrollLeftPx + cssX, zoom)
    const yTwips = cssPxToTwips(scrollTopPx + cssY, zoom)
    const payload = {
      sessionId,
      kind: 'mouse',
      mouseType,
      xTwips,
      yTwips,
      button: Number(evt.button ?? 1),
      count: Number(evt.count ?? 1),
      modifiers: Number(evt.modifiers ?? 0),
    }
    if (typeof options.onInput === 'function') {
      options.onInput(payload)
    }
    return payload
  }

  function forwardKeyEvent(keyType, evt = {}) {
    // Guard: while CJK IME composition is active, raw keydowns must not bypass IME commit
    if (isComposing && !evt.allowDuringComposition) {
      return null
    }
    const payload = {
      sessionId,
      kind: 'key',
      keyType,
      key: String(evt.key || ''),
      code: String(evt.code || ''),
      keyCode: Number(evt.keyCode || 0),
      charCode: Number(evt.charCode || 0),
      modifiers: Number(evt.modifiers || 0),
    }
    if (typeof options.onInput === 'function') {
      options.onInput(payload)
    }
    return payload
  }

  function forwardImeEvent(phase, evt = {}) {
    const text = String(evt.text ?? '')
    if (phase === 'compositionstart') {
      isComposing = true
      preeditText = text
    } else if (phase === 'compositionupdate') {
      isComposing = true
      preeditText = text
    } else if (phase === 'compositionend') {
      isComposing = false
      preeditText = ''
    }
    const payload = {
      sessionId,
      kind: 'ime',
      phase,
      text,
      isComposing,
    }
    if (typeof options.onInput === 'function') {
      options.onInput(payload)
    }
    return payload
  }

  function getState() {
    const grid = getVisibleGrid(0)
    return {
      sessionId,
      scrollLeftPx,
      scrollTopPx,
      viewportWidthPx,
      viewportHeightPx,
      docWidthTwips,
      docHeightTwips,
      zoom,
      devicePixelRatio,
      generationId: cache.currentGeneration,
      cacheSize: cache.size,
      isComposing,
      preeditText,
      visibleTiles: grid.tiles.map((t) => ({
        ...t,
        cached: cache.peek(t.key),
      })),
    }
  }

  return {
    cache,
    getState,
    getVisibleGrid,
    syncVisibleTiles,
    receiveTile,
    panTo,
    panBy,
    setZoom,
    setViewportSize,
    handleInvalidateTiles,
    forwardMouseEvent,
    forwardKeyEvent,
    forwardImeEvent,
  }
}
