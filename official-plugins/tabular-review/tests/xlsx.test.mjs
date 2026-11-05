// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const xlsx = createRequire(import.meta.url)('../web/xlsx.js')

// 读回 stored ZIP：按中央目录逐条取出，校验 CRC
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  assert.equal(view.getUint32(eocd, true), 0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const out = {}
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(p, true), 0x02014b50)
    const crc = view.getUint32(p + 16, true)
    const size = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const offset = view.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const localNameLen = view.getUint16(offset + 26, true)
    const data = bytes.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size)
    assert.equal(xlsx.crc32(data), crc, 'crc mismatch for ' + name)
    out[name] = new TextDecoder().decode(data)
    p += 46 + nameLen
  }
  return out
}

test('CRC32 与列名换算', () => {
  assert.equal(xlsx.crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  assert.deepEqual([0, 25, 26, 51, 701, 702].map(xlsx.colName), ['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA'])
})

test('生成合法的 xlsx 包：两张表、表名清洗去重、正文转义并去掉非法控制字符', () => {
  const bytes = xlsx.buildXlsx([
    { name: '审阅表', rows: [['文件', '问题'], ['a/b.docx', 'A & B <c> "d"\u0001\n第二行']] },
    { name: '证据/明细[1]', rows: [['x']] },
    { name: '审阅表', rows: [] }
  ])
  const files = unzip(bytes)
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'])
  assert.match(files['xl/workbook.xml'], /name="审阅表"/)
  assert.match(files['xl/workbook.xml'], /name="证据 明细 1"/)
  assert.match(files['xl/workbook.xml'], /name="审阅表 2"/)
  const sheet = files['xl/worksheets/sheet1.xml']
  assert.match(sheet, /<c r="B2" t="inlineStr" s="2"><is><t xml:space="preserve">A &amp; B &lt;c&gt; &quot;d&quot;\n第二行<\/t><\/is><\/c>/)
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1">/)
  assert.match(sheet, /state="frozen"/)
  assert.doesNotMatch(sheet, /\u0001/)
})
