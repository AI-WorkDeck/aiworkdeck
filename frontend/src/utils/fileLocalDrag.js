// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 资源管理器 / 暂存区文件向软件外（微信聊天、Finder、资源管理器）原生拖出（dev-board#1288）。
// 零构建别名依赖，便于 node --test 直接导入。

const CACHE_TTL_MS = 60 * 1000
const localPathCache = new Map()
const inflightPrefetch = new Map()

export function clearLocalPathCache(fileId) {
  if (fileId != null) {
    localPathCache.delete(String(fileId))
    inflightPrefetch.delete(String(fileId))
    return
  }
  localPathCache.clear()
  inflightPrefetch.clear()
}

export function cacheLocalFilePath(fileId, filePath, now = Date.now()) {
  if (fileId == null || typeof filePath !== 'string' || !filePath) return ''
  localPathCache.set(String(fileId), { path: filePath, ts: now })
  return filePath
}

export function getCachedLocalFilePath(fileId, now = Date.now()) {
  if (fileId == null) return ''
  const entry = localPathCache.get(String(fileId))
  if (!entry) return ''
  if (now - entry.ts > CACHE_TTL_MS) {
    localPathCache.delete(String(fileId))
    return ''
  }
  return entry.path || ''
}

export function prefetchLocalFilePath(fileId, fetchLocalPath) {
  if (fileId == null || typeof fetchLocalPath !== 'function') return Promise.resolve('')
  const key = String(fileId)
  const cached = getCachedLocalFilePath(key)
  if (cached) return Promise.resolve(cached)
  if (inflightPrefetch.has(key)) return inflightPrefetch.get(key)
  const p = Promise.resolve()
    .then(() => fetchLocalPath(fileId))
    .then((res) => {
      const data = res && res.data ? res.data : res
      const filePath = data && data.exists !== false && typeof data.path === 'string' ? data.path : ''
      if (filePath) cacheLocalFilePath(key, filePath)
      return filePath
    })
    .catch(() => '')
    .finally(() => {
      inflightPrefetch.delete(key)
    })
  inflightPrefetch.set(key, p)
  return p
}

function defaultBaseUrl() {
  try {
    if (typeof window !== 'undefined' && window.checkbaDesktop && window.checkbaDesktop.apiBaseUrl) {
      return String(window.checkbaDesktop.apiBaseUrl)
    }
  } catch (_) {}
  return 'http://localhost:9696'
}

function defaultAuthHeaders() {
  const headers = {}
  try {
    if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
      const sid = uni.getStorageSync('checkba_session_id')
      if (sid) headers['X-Session-Id'] = String(sid)
    }
  } catch (_) {}
  return headers
}

export function resolveLocalFilePathSync(fileId, options = {}) {
  if (fileId == null) return ''
  const now = typeof options.now === 'number' ? options.now : Date.now()
  const cached = getCachedLocalFilePath(fileId, now)
  if (cached) return cached

  const XHR = options.XMLHttpRequest || (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null)
  if (!XHR) return ''

  const baseUrl = String(options.baseUrl != null ? options.baseUrl : defaultBaseUrl()).replace(/\/$/, '')
  const url = `${baseUrl}/api/files/${encodeURIComponent(String(fileId))}/local-path`
  const headers = options.headers || defaultAuthHeaders()

  try {
    const xhr = new XHR()
    xhr.open('GET', url, false)
    Object.keys(headers || {}).forEach((k) => {
      if (headers[k] != null && k.toLowerCase() !== 'content-type') {
        xhr.setRequestHeader(k, String(headers[k]))
      }
    })
    xhr.send(null)
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      const body = JSON.parse(xhr.responseText)
      const data = body && body.data ? body.data : body
      const filePath = data && data.exists !== false && typeof data.path === 'string' ? data.path : ''
      if (filePath) return cacheLocalFilePath(fileId, filePath, now)
    }
  } catch (_) {
    // 静默回退：非本机桌面环境或后端未返回物理路径时不阻塞内部拖拽
  }
  return ''
}

let activeCleanupCancel = null

export function installExternalDragCleanup(onCleanup, win = typeof window !== 'undefined' ? window : null) {
  if (typeof onCleanup !== 'function' || !win || typeof win.addEventListener !== 'function') {
    return () => {}
  }
  if (typeof activeCleanupCancel === 'function') {
    activeCleanupCancel()
  }
  let done = false
  let timer = null
  const detach = () => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    try { win.removeEventListener('dragend', onDragEndOrDrop, true) } catch (_) {}
    try { win.removeEventListener('drop', onDragEndOrDrop, true) } catch (_) {}
    try { win.removeEventListener('mousemove', onMouseMove, true) } catch (_) {}
    try { win.removeEventListener('mousedown', onMouseDown, true) } catch (_) {}
    if (activeCleanupCancel === detach) activeCleanupCancel = null
  }
  const runCleanup = () => {
    if (done) return
    done = true
    detach()
    try { onCleanup() } catch (_) {}
  }
  const onDragEndOrDrop = () => {
    if (done || timer != null) return
    // 让窗口内的 drop 处理器先同步跑完，再清理拖拽态
    timer = setTimeout(runCleanup, 0)
  }
  const onMouseMove = (e) => {
    // 拖到微信/Finder 松手后，鼠标再次移回窗口时 buttons 为 0，说明系统级拖拽已结束
    if (e && typeof e.buttons === 'number' && e.buttons === 0) {
      runCleanup()
    }
  }
  const onMouseDown = () => {
    runCleanup()
  }
  win.addEventListener('dragend', onDragEndOrDrop, true)
  win.addEventListener('drop', onDragEndOrDrop, true)
  win.addEventListener('mousemove', onMouseMove, true)
  win.addEventListener('mousedown', onMouseDown, true)
  activeCleanupCancel = detach
  return detach
}

export function startExternalFileDrag(item, options = {}) {
  if (!item || item.id == null || item.isFolder || item.fileType === 'folder') {
    return { ok: false, reason: 'not-file' }
  }
  const fs = options.fs || (typeof window !== 'undefined' && window.checkbaDesktop && window.checkbaDesktop.fs) || null
  if (!fs || typeof fs.startDrag !== 'function') {
    return { ok: false, reason: 'unsupported' }
  }
  const localPath = (typeof item.localPath === 'string' && item.localPath)
    ? item.localPath
    : resolveLocalFilePathSync(item.id, options)
  if (!localPath) {
    return { ok: false, reason: 'no-local-path' }
  }
  try {
    const res = fs.startDrag(localPath)
    if (res && res.ok === false) return res
    if (typeof options.onCleanup === 'function') {
      installExternalDragCleanup(options.onCleanup, options.win)
    }
    return { ok: true, path: localPath }
  } catch (e) {
    return { ok: false, reason: 'start-drag-error', message: String((e && e.message) || e) }
  }
}
