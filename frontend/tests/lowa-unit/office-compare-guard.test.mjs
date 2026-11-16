// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 版本比对 / 三方合并入口对带打开密码文件的预判（B3），以及旧格式「过旧」与「损坏」的区分（B6）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import CFB from 'cfb'
import { assertNotPasswordProtected, isPasswordProtectedError } from '../../src/utils/officeCompareGuard.js'
import { detectLegacyFormat } from '../../src/utils/legacyOfficeDecrypt.js'

const ENC = new URL('../lowa-e2e/fixtures/encrypted/', import.meta.url)
const read = (u) => new Uint8Array(fs.readFileSync(u))
// 只含主数据流的最小复合文档：结构完整、引擎未必收，足够代表「格式老但没坏」
function oleWith(stream) {
  const c = CFB.utils.cfb_new()
  CFB.utils.cfb_add(c, '/' + stream, new Uint8Array(600).fill(1))
  return new Uint8Array(CFB.write(c, { type: 'array' }))
}
const plainDocx = read(new URL('../lowa-e2e/fixtures/flexmark-table.docx', import.meta.url))

test('B3: 加密的 docx/xlsx/pptx 在比对/合并入口被识别，抛稳定错误码', () => {
  for (const [f, name] of [['flexmark-table.docx', 'a/b.docx'], ['case-ledger.xlsx', 'c.xlsx'], ['case-report.pptx', 'd.pptx']]) {
    assert.throws(() => assertNotPasswordProtected(name, plainDocx, read(new URL(f, ENC))), (e) => isPasswordProtectedError(e) && e.code === 'DOC_ENCRYPTED', f)
  }
})

test('B3: 带密码的旧格式 .doc/.xls/.ppt 同样被识别', () => {
  for (const f of ['rc4cryptoapi_password.doc', 'rc4cryptoapi_password.xls', 'rc4cryptoapi_password.ppt']) {
    assert.throws(() => assertNotPasswordProtected(f, read(new URL('legacy/' + f, ENC))), isPasswordProtectedError, f)
  }
})

test('B3: 普通文件 / 空字节 / 未加密旧格式不误伤', () => {
  assert.doesNotThrow(() => assertNotPasswordProtected('x.docx', plainDocx, plainDocx))
  assert.doesNotThrow(() => assertNotPasswordProtected('x.docx', null, undefined, new Uint8Array(0)))
  assert.doesNotThrow(() => assertNotPasswordProtected('old.doc', oleWith('WordDocument'), read(new URL('legacy/plain.ppt', ENC)).subarray(0, 0)))
  assert.doesNotThrow(() => assertNotPasswordProtected('plain.ppt', read(new URL('legacy/plain.ppt', ENC))))
})

test('B3: 扩展名不符的 CFB 字节不判为加密 OOXML（与编辑器同口径）', () => {
  assert.doesNotThrow(() => assertNotPasswordProtected('notes.txt', read(new URL('flexmark-table.docx', ENC))))
})

test('B6: 结构完整的旧格式 = 过旧；截断/垃圾/扩展名或主流不符 = 不算', () => {
  const doc = oleWith('WordDocument')
  assert.equal(detectLegacyFormat(doc, 'old.doc'), 'doc')
  assert.equal(detectLegacyFormat(oleWith('Workbook'), 'old.xls'), 'xls')
  assert.equal(detectLegacyFormat(oleWith('Book'), 'older.xls'), 'xls')
  assert.equal(detectLegacyFormat(read(new URL('legacy/plain.ppt', ENC)), 'plain.ppt'), 'ppt')
  assert.equal(detectLegacyFormat(doc.subarray(0, 300), 'old.doc'), null, '截断 = 损坏')
  assert.equal(detectLegacyFormat(new Uint8Array(2048).fill(7), 'x.doc'), null)
  assert.equal(detectLegacyFormat(doc, 'old.docx'), null)
  assert.equal(detectLegacyFormat(doc, 'old.xls'), null, 'Word 流放在 .xls 名下不认')
})
