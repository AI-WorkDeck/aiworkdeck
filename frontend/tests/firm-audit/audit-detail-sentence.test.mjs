// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C7 (lane C S1): the audit log 详情 column showed `firmAdmin=false; fromRole=ADMIN; teamName=…; toRole=MEMBER`
// to the firm admin. On screen it reads as plain sentences; the CSV export keeps the raw form.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditDetailSentence } from '../../src/utils/auditDetail.js'
import zh from '../../src/locales/zh-CN/auditLog.js'
import en from '../../src/locales/en-US/auditLog.js'

const tr = (dict) => (key, params = {}) => {
  const v = key.split('.').slice(1).reduce((o, k) => (o == null ? undefined : o[k]), dict)
  return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => params[k]) : key
}

test('C7: role change in plain zh-CN, no key=value left', () => {
  const s = auditDetailSentence(tr(zh), { firmAdmin: false, fromRole: 'ADMIN', teamName: '澄川所-总部', toRole: 'MEMBER', teamId: 't-1', actorAccountId: 'a' })
  assert.equal(s, '由管理员改为成员；团队：澄川所-总部')
  assert.doesNotMatch(s, /=|firmAdmin|fromRole|teamId|actorAccountId/)
  assert.equal(auditDetailSentence(tr(zh), { role: 'READ_ONLY' }), '角色：只读成员')
  assert.equal(auditDetailSentence(tr(zh), { firmAdmin: true, teamName: 'A' }), '团队：A；律所管理员')
})

test('C7: English, unknown keys kept readable, unknown roles shown raw', () => {
  assert.equal(auditDetailSentence(tr(en), { fromRole: 'MEMBER', toRole: 'ADMIN' }), 'Changed from member to admin')
  assert.equal(auditDetailSentence(tr(en), { kind: 'portal', role: 'AUDITOR' }), 'Role: AUDITOR; kind: portal')
  assert.equal(auditDetailSentence(tr(en), { expiresAt: '2026-12-03T01:49:00Z' }, () => '2026-12-03 09:49'), 'Valid until 2026-12-03 09:49')
  assert.equal(auditDetailSentence(tr(en), null), '')
})

test('C7: the panel uses the sentences on screen and keeps the raw form for CSV', () => {
  const panel = readFileSync(new URL('../../src/components/admin/FirmAuditLogPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /return auditDetailSentence\(this\.\$t\.bind\(this\), detail/)
  assert.match(panel, /\{ label: this\.\$t\('auditLog\.colDetail'\), value: \(e\) => detailText\(e\.detail\) \}/)
})
