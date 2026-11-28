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

// 进度探针在网络层失败（本机服务冻住 / 崩了）才算「失联」；「正在整理版本」这类业务回答说明服务活着。
const UNREACHABLE = /request:fail|failed to fetch|networkerror|econnrefused|econnreset|net::err_|timeout/i
const unreachable = (e) => !!e && UNREACHABLE.test(`${e.errMsg || ''} ${e.message || ''}`)

/**
 * C32（CEO 2026-11-27）：交稿/取回/取到本机的请求放宽到 30 分钟，慢网大文件不再被 60 秒默认超时误判。
 * 但后端真的死了不能让律师干等 30 分钟：进度探针连续 deadAfter 次网络层失败就中止请求，
 * 以网络错误收尾（界面归为「本机服务没响应」，可重试）。run 收到 AbortSignal，须传给 request。
 */
export async function withTransferProgress(projectId, run, { read, show, hide, t, start, interval = 2000, delay = 1500, deadAfter = 3 } = {}) {
  if (start) start(projectId)
  let shown = false
  let stopped = false
  let timer = null
  let failures = 0
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let declareDead = null
  const dead = new Promise((_, reject) => { declareDead = reject })
  dead.catch(() => {})
  const tick = async () => {
    if (stopped) return
    try {
      const res = await read(projectId)
      failures = 0
      const text = formatTransfer((res && res.data) || res, t)
      if (!stopped && text) { show(text); shown = true }
    } catch (e) {
      // Progress is a courtesy; only a run of network-level failures means the service is gone.
      failures = unreachable(e) ? failures + 1 : 0
      if (!stopped && failures >= deadAfter) {
        stopped = true
        const err = new Error('request:fail local service not responding')
        err.errMsg = err.message
        declareDead(err)
        if (controller) controller.abort()
        return
      }
    }
    if (!stopped) timer = setTimeout(tick, interval)
  }
  timer = setTimeout(tick, delay)
  try {
    return await Promise.race([run(controller ? controller.signal : undefined), dead])
  } finally {
    stopped = true
    clearTimeout(timer)
    if (shown) hide()
  }
}
