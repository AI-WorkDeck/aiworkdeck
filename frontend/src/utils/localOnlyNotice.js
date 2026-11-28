// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * C12：交稿成功、但有文件超出免费共享额度留在了本机时，说一次是哪几份、同事会看到占位、怎么共享。
 * 同一份案卷、同一组文件只说一次（之后每次交稿都弹会很烦）；集合变了再说。
 */
const shown = new Map()

export function noticeLocalOnly(projectId, files, { t, showModal, openBackup }) {
  const names = (Array.isArray(files) ? files : []).filter(Boolean)
  if (!names.length) { shown.delete(String(projectId)); return false }
  const key = names.slice().sort().join('\u0000')
  if (shown.get(String(projectId)) === key) return false
  shown.set(String(projectId), key)
  showModal({
    title: t('version.localOnlyNoticeTitle'),
    content: t('version.localOnlyNoticeBody', { files: names.slice(0, 3).join('、') + (names.length > 3 ? t('version.localOnlyNoticeMore', { count: names.length }) : '') }),
    confirmText: t('version.localOnlyNoticeAction'),
    cancelText: t('version.localOnlyNoticeOk'),
    success: (r) => { if (r && r.confirm) openBackup() },
  })
  return true
}

export function resetLocalOnlyNotice() { shown.clear() }
