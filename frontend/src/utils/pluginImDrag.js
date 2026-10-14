// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const PREFIX = 'application/x-awd-plugin-drag-'
const TTL = 15000
let pending = null

// A prepared file is not a drag. Only a native drop carrying this unpredictable
// MIME type can consume it; never leave a file in document.__checkbaDraggedFile.
export function endPluginImDrag(owner) {
  if (!pending || (owner && pending.owner !== owner)) return
  const old = pending
  pending = null
  clearTimeout(old.timer)
  old.win?.removeEventListener('blur', old.blur)
  old.win?.removeEventListener('pagehide', old.clear)
  old.win?.removeEventListener('resize', old.clear)
  old.win?.removeEventListener('scroll', old.clear, true)
  old.win?.removeEventListener('keydown', old.escape)
  old.handle?.remove()
}

export function preparePluginImDrag(owner, file, projectId, win = globalThis.window, anchor = null) {
  endPluginImDrag()
  const token = globalThis.crypto.randomUUID()
  const descriptor = {
    fileId: file.id, projectId: String(projectId), name: file.name,
    fileType: file.fileType, source: 'plugin-im', dragToken: token,
    dragType: PREFIX + token, expiresAt: Date.now() + TTL
  }
  const clear = () => endPluginImDrag(owner)
  const blur = () => { if (!win?.document?.hasFocus()) clear() }
  const escape = (event) => { if (event.key === 'Escape') clear() }
  pending = { owner, blur, escape, generation: owner.sessionGeneration, descriptor, win, clear, timer: setTimeout(clear, TTL) }
  win?.addEventListener('blur', blur)
  win?.addEventListener('pagehide', clear)
  if (anchor) installNativeDragHandle(pending, anchor)
  return { ...descriptor }
}

// Some Chromium surfaces fail to dispatch an opaque iframe drag into its parent.
// Keep the iframe sandbox intact and host only the small, validated drag handle.
function installNativeDragHandle(record, { frame, rect }) {
  const win = record.win
  if (!win?.document || !frame?.isConnected || !rect) return
  if (!['left', 'top', 'width', 'height'].every((key) => Number.isFinite(rect[key]))) return
  if (rect.width < 24 || rect.width > 240 || rect.height < 24 || rect.height > 64) return
  const box = frame.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return
  const scaleX = box.width / frame.offsetWidth, scaleY = box.height / frame.offsetHeight
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return
  const originX = box.left + frame.clientLeft * scaleX, originY = box.top + frame.clientTop * scaleY
  const left = Math.max(originX, originX + rect.left * scaleX)
  const top = Math.max(originY, originY + rect.top * scaleY)
  const right = Math.min(originX + frame.clientWidth * scaleX, originX + (rect.left + rect.width) * scaleX)
  const bottom = Math.min(originY + frame.clientHeight * scaleY, originY + (rect.top + rect.height) * scaleY)
  if (right - left < 24 || bottom - top < 24) return
  const handle = win.document.createElement('button')
  handle.type = 'button'
  handle.draggable = true
  handle.textContent = '拖到 AI'
  handle.setAttribute('aria-label', '拖拽此项目文件到 AI 对话')
  handle.setAttribute('data-awd-plugin-drag-handle', '')
  Object.assign(handle.style, {
    position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`,
    zIndex: '2900', boxSizing: 'border-box', margin: '0', padding: '4px 6px', cursor: 'grab',
    font: '12px var(--awd-font-sans, sans-serif)', borderRadius: 'var(--awd-radius-sm, 6px)',
    color: 'var(--awd-text, #292d2c)', background: 'var(--awd-surface, #fff)',
    border: '1px solid var(--awd-border, #dce1d9)'
  })
  let dragging = false
  handle.addEventListener('dragstart', (event) => {
    if (pending !== record || record.generation !== record.owner.sessionGeneration || Date.now() >= record.descriptor.expiresAt) {
      event.preventDefault(); record.clear(); return
    }
    dragging = true
    event.dataTransfer.effectAllowed = 'copy'
    const descriptor = record.descriptor, json = JSON.stringify(descriptor)
    event.dataTransfer.setData('application/x-checkba-file', json)
    event.dataTransfer.setData('text/checkba-file-json', json)
    event.dataTransfer.setData(descriptor.dragType, descriptor.dragToken)
  })
  handle.addEventListener('pointerleave', () => { if (!dragging) record.clear() })
  handle.addEventListener('click', record.clear)
  handle.addEventListener('dragend', record.clear)
  record.handle = handle
  record.descriptor.hostHandle = true
  win.addEventListener('resize', record.clear)
  win.addEventListener('scroll', record.clear, true)
  win.addEventListener('keydown', record.escape)
  win.document.body.append(handle)
}

export function consumePluginImDrag(dataTransfer, projectId) {
  const types = Array.from(dataTransfer?.types || [])
  const dragType = types.find(type => type.startsWith(PREFIX))
  let marked = !!dragType
  // A stale/forged plugin payload must not fall through to the legacy file MIME
  // handler, which accepts file ids from file-tree drags.
  for (const type of ['application/x-checkba-file', 'text/checkba-file-json']) {
    try { marked ||= JSON.parse(dataTransfer?.getData(type) || 'null')?.source === 'plugin-im' } catch (_) { /* not JSON */ }
  }
  if (!marked) return { handled: false }
  const record = pending
  endPluginImDrag()
  if (!record || dragType !== record.descriptor.dragType
      || String(projectId) !== record.descriptor.projectId
      || Date.now() >= record.descriptor.expiresAt) return { handled: true, file: null }
  const { fileId, name, fileType } = record.descriptor
  return { handled: true, file: { id: fileId, name, fileType, isDir: false },
    isCurrent: () => record.generation === record.owner.sessionGeneration }
}
