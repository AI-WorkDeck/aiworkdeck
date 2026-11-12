// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 演示文稿冷启动预览（office-tier1）：引擎冷启动期间显示「上次打开时引擎自己渲染的前几页」，
// 按文件字节的 SHA-256 命中——文件变了就不命中、不显示旧画面。第一次打开没有缓存时宿主仍显示进度卡片。
// 此前用 pptx-preview 在前端解析 pptx，真实课件的整页背景图按原图像素绘制、版式错位裁切（用户截图反馈），
// 宁可不显示也不显示错的画面。图片在本机 IndexedDB，不出网。

export const PREVIEW_SLIDES = 3
export const PREVIEW_WIDTH = 960
const MAX_ENTRIES = 40
const DB_NAME = 'awd-slide-preview'
const STORE = 'decks'

export async function fingerprint(bytes) {
  const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** IndexedDB 键值存储；不可用（隐私模式等）时返回 null，调用方当作没有缓存。 */
export function indexedDbStore(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return null
  let dbPromise = null
  const open = () => dbPromise || (dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
  const tx = async (mode, fn) => {
    const db = await open()
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const store = t.objectStore(STORE)
      let out
      Promise.resolve(fn(store, v => { out = v })).catch(reject)
      t.oncomplete = () => resolve(out)
      t.onerror = () => reject(t.error)
    })
  }
  return {
    get: key => tx('readonly', (s, set) => { const r = s.get(key); r.onsuccess = () => set(r.result || null) }),
    put: (key, value) => tx('readwrite', s => { s.put(value, key) }),
    delete: key => tx('readwrite', s => { s.delete(key) }),
    keys: () => tx('readonly', (s, set) => { const r = s.getAllKeys(); r.onsuccess = () => set(r.result || []) }),
  }
}

export function createSlidePreviewCache({ store = indexedDbStore(), now = () => Date.now() } = {}) {
  async function load(key) {
    if (!store || !key) return null
    try {
      const entry = await store.get(key)
      if (!entry || !Array.isArray(entry.slides) || !entry.slides.length) return null
      store.put(key, { ...entry, usedAt: now() }).catch(() => {})
      return entry
    } catch { return null }
  }
  /** slides: [{ bytes: Uint8Array, width, height }]；只保留最近使用的 MAX_ENTRIES 份。 */
  async function save(key, slides, total) {
    if (!store || !key || !slides.length) return
    try {
      await store.put(key, { slides, total, usedAt: now() })
      const keys = await store.keys()
      if (keys.length <= MAX_ENTRIES) return
      const aged = await Promise.all(keys.map(async k => ({ k, at: (await store.get(k))?.usedAt || 0 })))
      aged.sort((a, b) => a.at - b.at)
      for (const { k } of aged.slice(0, keys.length - MAX_ENTRIES)) await store.delete(k)
    } catch { /* 缓存失败不影响编辑 */ }
  }
  /**
   * 从引擎抓前几页（后台、只读）。documentSeq 用于丢弃换文档后的迟到结果；
   * isCurrent() 为假时立即停（用户开始输入、文档切换）。
   */
  async function capture(execute, { key, documentSeq, total, isCurrent = () => true }) {
    if (!store || !key || !(total > 0)) return false
    if (await load(key)) return true
    const slides = []
    for (let n = 1; n <= Math.min(PREVIEW_SLIDES, total); n++) {
      if (!isCurrent()) return false
      const r = await execute('slide_get_thumbnail', { slideNumber: n, width: PREVIEW_WIDTH, format: 'jpeg', preview: true, documentSeq }, { background: true })
      if (!r?.success || !r.bytes) return false
      slides.push({ bytes: r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes), width: r.width, height: r.height })
    }
    if (!isCurrent()) return false
    await save(key, slides, total)
    return true
  }
  return { load, save, capture }
}
