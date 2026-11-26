// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 交稿/取回带大文件时，慢网络下一块 32 MiB 可能要传十几分钟（#1764），期间页面什么都不说
 * 就像卡死了。请求在途时每 2 秒读一次 /api/cloud/projects/{id}/transfer（不占仓库锁），
 * 有字节在走就显示「正在上传大文件 12.3 / 30.0 MB」；请求结束收掉。
 */
export function formatTransfer(progress, t) {
  if (!progress || !progress.active || !(progress.totalBytes > 0)) return ''
  const mb = (bytes) => (Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)
  const key = progress.direction === 'download' ? 'version.transferDownloading' : 'version.transferUploading'
  return t(key, { done: mb(Math.min(progress.doneBytes, progress.totalBytes)), total: mb(progress.totalBytes) })
}

export async function withTransferProgress(projectId, run, { read, show, hide, t, start, interval = 2000, delay = 1500 } = {}) {
  if (start) start(projectId)
  let shown = false
  let stopped = false
  let timer = null
  const tick = async () => {
    if (stopped) return
    try {
      const res = await read(projectId)
      const text = formatTransfer((res && res.data) || res, t)
      if (!stopped && text) { show(text); shown = true }
    } catch { /* Progress is a courtesy; the transfer itself reports its own outcome. */ }
    if (!stopped) timer = setTimeout(tick, interval)
  }
  timer = setTimeout(tick, delay)
  try {
    return await run()
  } finally {
    stopped = true
    clearTimeout(timer)
    if (shown) hide()
  }
}
