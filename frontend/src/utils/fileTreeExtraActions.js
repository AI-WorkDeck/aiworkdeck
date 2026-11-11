// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// 资源管理器右键的「打印 / 移动到… / 压缩为 ZIP / 解压到此处」判定与打印落地。
import { MERGEABLE_TO_PDF_EXTENSIONS, resolveFileExtension } from './fileTreePdfActions.js'

// 与后端 ProjectFileService.ARCHIVE_TYPES 一致
export const ARCHIVE_EXTENSIONS = new Set(['zip', '7z', 'rar'])

// 打印走后端 print-pdf（Office/图片现转、PDF 原样），所以可打印集合 = 可合并为 PDF 的集合
export function canPrintItem(item, viewMode = 'files') {
  if (viewMode === 'recycle' || !item || item.isFolder) return false
  return MERGEABLE_TO_PDF_EXTENSIONS.has(resolveFileExtension(item))
}

export function canExtractItem(item, viewMode = 'files') {
  if (viewMode === 'recycle' || !item || item.isFolder || item.readOnly) return false
  return ARCHIVE_EXTENSIONS.has(resolveFileExtension(item))
}

export function canMoveItems(items, viewMode = 'files') {
  if (viewMode === 'recycle' || !Array.isArray(items) || !items.length) return false
  return items.every(item => item && !item.readOnly)
}

export function canCompressItems(items, viewMode = 'files') {
  return viewMode !== 'recycle' && Array.isArray(items) && items.length > 0 && items.every(Boolean)
}

/**
 * 把 PDF Blob 放进隐藏 iframe 调起系统打印对话框（Chromium/Electron 内置 PDF 引擎，与预览同路）。
 * PDF 插件不可靠地发 afterprint，iframe 留到下次打印或 60 秒后再清理。
 */
let lastPrintFrame = null
export function printPdfBlob(blob, doc = document) {
  if (lastPrintFrame) lastPrintFrame()
  const url = URL.createObjectURL(blob)
  const frame = doc.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;inset-inline-end:0;bottom:0;visibility:hidden;'
  let timer = null
  const cleanup = () => {
    clearTimeout(timer)
    if (frame.parentNode) frame.parentNode.removeChild(frame)
    URL.revokeObjectURL(url)
    if (lastPrintFrame === cleanup) lastPrintFrame = null
  }
  lastPrintFrame = cleanup
  frame.onload = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } finally {
      timer = setTimeout(cleanup, 60000)
    }
  }
  frame.src = url
  doc.body.appendChild(frame)
}
