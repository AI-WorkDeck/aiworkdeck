// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 外部（Finder / 资源管理器 / 微信）文件拖进文件树的纯函数（dev-board#363）。
// 零依赖，便于 node --test 直接导入；单测见 tests/project-home/file-tree-external-drop.test.mjs。
//
// 同步提取外部文件、认领 drop，并为无路径的真实 File 保存字节快照（#1182）。
// 最终统一 import-local：本机路径直接复制，无路径字节由桌面暂存后复制并释放 token。
// 目录仍由后端展开；file URL 文本不授予读取磁盘的权限。
//
// 地雷：uni-h5 把 <view> 上的事件重建成普通对象（$nne → createNativeEvent），只补
// click / mouse / touch 三类字段，drag 系事件的 dataTransfer / relatedTarget 全丢。
// 要读它们必须回到正在派发的原生事件 window.event 上（同 fileOpenTabs.js 的 mouseButtonOf）。

export function nativeEvent(e) {
  if (e && e.dataTransfer) return e
  const native = typeof window !== 'undefined' ? window.event : null
  return native || e || null
}

export function nativeDataTransfer(e) {
  if (e && e.dataTransfer) return e.dataTransfer
  const native = typeof window !== 'undefined' ? window.event : null
  return native && native.dataTransfer ? native.dataTransfer : null
}

// dragover / dragenter 阶段 files 恒为空（浏览器只在 drop 时才给内容），只能看 types
// 里有没有 'Files'；应用内拖拽（text/plain + application/x-checkba-file）原本没有它，
// 但桌面端为支持拖出到微信/Finder 调了 webContents.startDrag 后，OS 会往同一次拖拽里补上
// 'Files' 与 effectAllowed='copy'（dev-board#1288）。因此只要 document.__checkbaDraggedFile
// 仍在（说明是应用内 FileTree / 暂存区自己发起的拖拽），就绝不能当成外部文件导入。
export function isExternalFileDrag(dt) {
  if (!dt) return false
  if (typeof document !== 'undefined' && document.__checkbaDraggedFile) return false
  if (dt.files && dt.files.length > 0) return true
  if (Array.from(dt.items || []).some(item => item && item.kind === 'file')) return true
  const types = dt.types
  if (!types) return false
  return Array.from(types).some(type => type === 'Files' || type === 'text/uri-list')
}

// webContents.startDrag 会把原生拖拽会话的 effectAllowed 锁成 'copy'；此时若内部
// dragover 强设 dropEffect='move' 或 'link'，浏览器会因不兼容而显示禁止光标并吞掉 drop。
export function compatibleDropEffect(dt, preferred = 'move') {
  const allowed = dt && typeof dt.effectAllowed === 'string' ? dt.effectAllowed : ''
  if (!allowed || allowed === 'all' || allowed === 'uninitialized') return preferred
  const low = allowed.toLowerCase()
  if (preferred === 'move' && (low === 'move' || low.includes('move'))) return 'move'
  if (preferred === 'link' && (low === 'link' || low.includes('link'))) return 'link'
  if (preferred === 'copy' && (low === 'copy' || low.includes('copy'))) return 'copy'
  if (low.includes('copy')) return 'copy'
  if (low.includes('move')) return 'move'
  if (low.includes('link')) return 'link'
  return preferred
}

// 同一个原生 drop 事件会先后到达节点与容器两个监听器（uni 的 stopPropagation 只是转发，
// 不依赖它）；在原生事件对象上打一个认领标记，第二次到达直接跳过。
export function claimExternalDrop(native) {
  if (!native || typeof native !== 'object') return true
  if (native.__awdExternalDropClaimed) return false
  try { native.__awdExternalDropClaimed = true } catch (e) { /* ignore */ }
  return true
}

// Snapshot while the native drop is dispatching. Some sources expose files only
// through items; a file URL string alone is never authority to read local disk.
const capturedFiles = new WeakMap()
const directoryFiles = new WeakSet()
export const MAX_DROP_BYTES = 100 * 1024 * 1024

export function captureDroppedFiles(dt, fs) {
  const items = Array.from((dt && dt.items) || []).filter(item => item && item.kind === 'file')
  const files = Array.from((dt && dt.files) || [])
  const useItems = !files.length
  for (let i = 0; i < items.length; i++) {
    try {
      const file = useItems ? items[i].getAsFile() : files[i]
      if (!file) continue
      if (useItems) files.push(file)
      if (items[i].webkitGetAsEntry?.()?.isDirectory) directoryFiles.add(file)
    } catch (_) { /* unavailable source or no entry API */ }
  }
  let remaining = MAX_DROP_BYTES
  for (const file of files) {
    const source = captureLocalFile(file, fs, remaining)
    if (source.bytes) remaining -= file.size
  }
  return files
}

function localFilePath(file, fs) {
  try {
    const value = fs?.getPathForFile?.(file) || ''
    return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value) ? value : ''
  } catch (_) { return '' }
}

// macOS App Sandbox 容器路径（如微信 ~/Library/Containers/com.tencent.xinWeChat/Data/...）
// 受 TCC kTCCServiceSystemPolicyAllFiles（「完全磁盘访问权限」）保护：
// - 未授予完全磁盘访问权限时，后端 import-local 的 stat/open 会被内核以 EPERM 拒绝；
// - 在 drop 同步阶段同时预读 File 字节快照（若 Chromium 持有拖拽期临时读句柄则可走字节暂存兜底），
//   若直读与字节兜底均被 TCC 拒绝，则明确回传 importDropPermissionDenied 并唤起拖拽授权浮窗。
export function isSandboxContainerPath(filePath) {
  return typeof filePath === 'string' && /\/Library\/(?:Group )?Containers\//i.test(filePath)
}

export function isPermissionDeniedImportError(err) {
  const msg = String((err && err.message) || err || '')
  return /EPERM|EACCES|Operation not permitted|Permission denied|无权读取|完全磁盘访问权限|Full Disk Access/i.test(msg)
}

function notifyPermissionRequiredForDrop(payload) {
  try {
    if (typeof uni !== 'undefined' && uni && typeof uni.$emit === 'function') {
      uni.$emit('awd:open-permission-onboarding', payload)
    }
  } catch (_) { /* ignore */ }
}

function captureLocalFile(file, fs, remaining = MAX_DROP_BYTES) {
  if (capturedFiles.has(file)) return capturedFiles.get(file)
  const path = localFilePath(file, fs)
  const sandboxContainer = isSandboxContainerPath(path)
  const source = { path, sandboxContainer }
  if (!path) {
    if (!fs) source.error = 'importDesktopOnly'
    else if (!fs.stageDroppedFile || !fs.releaseDroppedFile || directoryFiles.has(file) || file?.size === 0 || typeof file?.arrayBuffer !== 'function') source.error = 'importDropUnreadable'
    else if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > remaining) source.error = 'importDropTooLarge'
    else {
      // Start reading before any async folder creation/network request can make
      // a transient File unavailable. Resolve errors now to avoid unhandled rejections.
      try { source.bytes = Promise.resolve(file.arrayBuffer()).then(bytes => ({ bytes }), () => ({ error: 'importDropUnreadable' })) }
      catch (_) { source.error = 'importDropUnreadable' }
    }
  } else if (
    sandboxContainer &&
    fs &&
    fs.stageDroppedFile &&
    fs.releaseDroppedFile &&
    !directoryFiles.has(file) &&
    Number.isSafeInteger(file?.size) &&
    file.size > 0 &&
    file.size <= remaining &&
    typeof file?.arrayBuffer === 'function'
  ) {
    try { source.bytes = Promise.resolve(file.arrayBuffer()).then(bytes => ({ bytes }), () => ({ error: 'importDropUnreadable' })) }
    catch (_) { /* fallback remains optional when path is present */ }
  }
  if (file && typeof file === 'object') capturedFiles.set(file, source)
  return source
}

// Every import uses the existing atomic import-local path. Only actual File
// bytes can be staged; callers never pass a destination path to the desktop.
export async function importDroppedFile(file, fs, importPath) {
  const source = captureLocalFile(file, fs)
  const fail = (code, extra = {}) => {
    const error = new Error(code)
    error.dropCode = code
    Object.assign(error, extra)
    throw error
  }
  let staged
  try {
    if (source.path) {
      try {
        return await importPath(source.path)
      } catch (pathErr) {
        if (source.bytes) {
          const read = await source.bytes
          if (read && !read.error && (read.bytes instanceof ArrayBuffer) && read.bytes.byteLength === file.size) {
            try { staged = await fs.stageDroppedFile({ name: file.name, bytes: read.bytes }) }
            catch (_) { staged = null }
            if (staged?.ok && staged.token && staged.path) {
              return await importPath(staged.path)
            }
          }
        }
        if (source.sandboxContainer || isPermissionDeniedImportError(pathErr)) {
          notifyPermissionRequiredForDrop({
            focus: 'fullDiskAccess',
            reason: 'wechat-drop',
            sourcePath: source.path,
          })
          fail('importDropPermissionDenied', { permissionId: 'fullDiskAccess', cause: pathErr })
        }
        throw pathErr
      }
    }
    if (source.error) fail(source.error)
    const read = await source.bytes
    if (read.error) fail(read.error)
    if (!(read.bytes instanceof ArrayBuffer) || read.bytes.byteLength !== file.size) fail('importDropUnreadable')
    try { staged = await fs.stageDroppedFile({ name: file.name, bytes: read.bytes }) }
    catch (_) { fail('importDropPrepareFailed') }
    if (!staged?.ok || !staged.token || !staged.path) fail(staged?.reason === 'too-large' ? 'importDropTooLarge' : 'importDropPrepareFailed')
    return await importPath(staged.path)
  } finally {
    capturedFiles.delete(file)
    if (staged?.token) await fs.releaseDroppedFile(staged.token).catch(() => {})
  }
}
