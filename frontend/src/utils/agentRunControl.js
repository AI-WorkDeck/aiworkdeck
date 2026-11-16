// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 用户对一轮 AI 运行的控制（暂停 / 停止后的结果 / 撤销本次修改）的纯判据。
// 网络调用在 useAgentStream 与 ChatInterface 里，这里只放可单测的规则。

/**
 * cancelled 事件的终态文案：本轮已经改过文档时说清「已完成 N 次文档修改」，
 * 否则沿用原来的「已停止生成」。旧后端不带 documentEdits 时退回 documentEdited 布尔。
 */
export function stopNoticeForCancelled(payload, t) {
  const edits = Number(payload && payload.documentEdits) || 0
  if (edits > 0) return t('agentStream.stopConfirmedWithEdits', { count: edits })
  return t('agentStream.stopConfirmed')
}

/** cancelled 载荷里「本轮改过文档」的判据（新字段优先，兼容只带布尔的情形）。 */
export function cancelledEditedDocument(payload) {
  if (!payload) return false
  return Number(payload.documentEdits) > 0 || payload.documentEdited === true
}

/**
 * 「撤销本次 AI 修改」入口出不出（只看气泡本身；快照还在不在由后端 GET /undo 回答）：
 * 最后一条助手气泡、流已结束、本轮改过文档、还没撤销过。
 * 停止（stopNotice）与暂停的轮次同样适用——已经落地的修改不会因为停止而回滚。
 */
export function shouldOfferRunUndo(bubble, { isLatest, isStreaming } = {}) {
  if (!bubble || !isLatest || isStreaming) return false
  if (bubble.isStreaming) return false
  return bubble.documentEdited === true
}

/** 确认框与结果提示里的文件清单：《A》、《B》 / "A", "B"。 */
export function formatUndoFiles(names, t) {
  const list = (names || []).map(n => (typeof n === 'string' ? n : n && n.name)).filter(Boolean)
  if (!list.length) return t('chat.undoRunFilesUnknown')
  return list.map(n => t('chat.undoRunFileName', { name: n })).join(t('chat.undoRunFileSeparator'))
}

/**
 * POST /undo 的结果 → 提示文案与入口的下一状态。
 * done：全部恢复，入口换成「已撤销」；partial / failed：保留入口可重试；
 * gone：快照已不在（过期或新一轮已开始），入口撤掉。
 */
export function undoResultView(httpStatus, body, t) {
  const b = body || {}
  if (httpStatus === 404 || b.code === 'NO_CHECKPOINT') {
    return { state: 'gone', message: t('chat.undoRunUnavailable') }
  }
  if (b.code === 'RUN_ACTIVE') return { state: 'idle', message: t('chat.undoRunBusy') }
  if (b.code === 'UNDO_IN_PROGRESS') return { state: 'running', message: t('chat.undoRunInProgress') }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { state: 'idle', message: t('chat.undoRunFailed', { error: b.message || String(httpStatus) }) }
  }
  const failures = Array.isArray(b.failures) ? b.failures : []
  const failureText = failures
    .map(f => t('chat.undoRunFailureItem', { name: f.name || String(f.fileId || ''), error: f.error || '' }))
    .join(t('chat.undoRunFileSeparator'))
  if (b.status === 'ok' || (!failures.length && (b.restored || []).length)) {
    return { state: 'done', message: t('chat.undoRunDone', { files: formatUndoFiles(b.restored, t) }) }
  }
  if (b.status === 'partial') {
    return { state: 'idle', message: t('chat.undoRunPartial', { files: formatUndoFiles(b.restored, t), failures: failureText }) }
  }
  return { state: 'idle', message: t('chat.undoRunFailed', { error: failureText || b.message || '' }) }
}
