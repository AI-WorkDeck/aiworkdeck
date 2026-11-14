// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAuditCsv, csvCell, detailText } from '../../src/utils/firmAuditCsv.js'

test('cells are quoted, quotes doubled, formulas neutralised', () => {
  assert.equal(csvCell('a"b'), '"a""b"')
  assert.equal(csvCell(null), '""')
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(csvCell('+1'), '"\'+1"')
  assert.equal(csvCell('-cmd'), '"\'-cmd"')
  assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"')
  assert.equal(csvCell('合同.docx'), '"合同.docx"')
})

test('detail is rendered with stable key order', () => {
  assert.equal(detailText({ shareHistory: true, role: 'CLIENT' }), 'role=CLIENT; shareHistory=true')
  assert.equal(detailText(null), '')
})

test('csv has BOM, header and CRLF rows', () => {
  const csv = buildAuditCsv([{ id: 1, action: 'LOGIN' }, { id: 2, action: 'FILE_DOWNLOADED' }],
    [{ label: 'ID', value: (e) => e.id }, { label: 'Event', value: (e) => e.action }])
  assert.equal(csv, '\uFEFF"ID","Event"\r\n"1","LOGIN"\r\n"2","FILE_DOWNLOADED"\r\n')
})
