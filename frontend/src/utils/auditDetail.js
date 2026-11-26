// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C7 (lane C S1): the audit log 详情 column showed raw machine text to the firm admin
// (`firmAdmin=false; fromRole=ADMIN; teamName=澄川所-总部; toRole=MEMBER`). This turns the detail
// object into plain sentences: 「由管理员改为成员；团队：澄川所-总部」. The CSV export keeps the raw
// key=value form (it is for records, and stays stable for comparison).
// Pure module: node --test runs it with a stub translator.

// Internal ids: useful in the export, meaningless on screen.
const HIDDEN = new Set(['actorAccountId', 'teamId', 'conversationId', 'deviceTokenId', 'removedUserId'])

function roleText(t, role) {
  const key = 'auditLog.detail.roleName.' + String(role)
  const out = t(key)
  return out === key ? String(role) : out
}

/**
 * @param {(key: string, params?: object) => string} t
 * @param {object} detail
 * @param {(value: string) => string} [formatDate] local date-time for expiresAt
 * @returns {string}
 */
export function auditDetailSentence(t, detail, formatDate = (v) => String(v)) {
  if (!detail || typeof detail !== 'object') return ''
  const d = { ...detail }
  const parts = []
  const take = (k) => { const v = d[k]; delete d[k]; return v }
  if (d.fromRole != null && d.toRole != null) {
    parts.push(t('auditLog.detail.roleChanged', { from: roleText(t, take('fromRole')), to: roleText(t, take('toRole')) }))
  }
  if (d.role != null) parts.push(t('auditLog.detail.role', { role: roleText(t, take('role')) }))
  if (d.teamName != null) parts.push(t('auditLog.detail.team', { name: take('teamName') }))
  if (d.firmAdmin != null) { if (String(take('firmAdmin')) === 'true') parts.push(t('auditLog.detail.firmAdmin')) }
  if (d.memberCount != null) parts.push(t('auditLog.detail.memberCount', { count: take('memberCount') }))
  if (d.removedBy != null) parts.push(t('auditLog.detail.removedBy', { name: take('removedBy') }))
  if (d.issuedBy != null) parts.push(t('auditLog.detail.issuedBy', { name: take('issuedBy') }))
  if (d.keyPrefix != null) parts.push(t('auditLog.detail.keyPrefix', { prefix: take('keyPrefix') }))
  if (d.label != null) parts.push(t('auditLog.detail.label', { label: take('label') }))
  if (d.via != null) parts.push(t('auditLog.detail.via', { via: take('via') }))
  if (d.shareHistory != null) parts.push(t(String(take('shareHistory')) === 'true' ? 'auditLog.detail.shareHistoryOn' : 'auditLog.detail.shareHistoryOff'))
  if (d.enabled != null) parts.push(t(String(take('enabled')) === 'true' ? 'auditLog.detail.enabledOn' : 'auditLog.detail.enabledOff'))
  if (d.expiresAt != null) parts.push(t('auditLog.detail.expiresAt', { date: formatDate(take('expiresAt')) }))
  if (d.suppressedRepeats != null) parts.push(t('auditLog.detail.suppressedRepeats', { count: take('suppressedRepeats') }))
  if (d.purgedRows != null) parts.push(t('auditLog.detail.purgedRows', { count: take('purgedRows') }))
  if (d.reason != null) parts.push(t('auditLog.detail.reason', { reason: take('reason') }))
  // Anything else (new keys from the site, kind, inline, invitationType): keep it readable, never drop it.
  for (const k of Object.keys(d).sort()) {
    if (HIDDEN.has(k) || d[k] == null || d[k] === '') continue
    parts.push(t('auditLog.detail.other', { key: k, value: d[k] }))
  }
  return parts.join(t('auditLog.detail.sep'))
}
