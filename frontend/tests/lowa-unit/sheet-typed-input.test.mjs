// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// sheet_write_cells 的字符串类型判定：长编号保文本、千分位/百分比/日期/金额落数值并配格式。
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const start = source.indexOf('const SHEET_NUMERIC_RE')
const end = source.indexOf('\nfunction sheetCellIsGeneral(')
const inRealm = vm.runInNewContext(source.slice(start, end) + '; sheetTypedInput')
const typed = s => JSON.parse(JSON.stringify(inRealm(s)))

test('long digit strings stay text so ID-card and account numbers keep every digit', () => {
  assert.deepEqual(typed('110101199003071234'), { text: '110101199003071234' })
  assert.deepEqual(typed('6222021234567890123'), { text: '6222021234567890123' })
  assert.deepEqual(typed('123456789012345'), { value: 123456789012345, format: null })
  assert.deepEqual(typed('001'), { text: '001' })
})
test('thousands separators and currency become numbers with a matching format', () => {
  assert.deepEqual(typed('10,000'), { value: 10000, format: '#,##0' })
  assert.deepEqual(typed('1,234.56'), { value: 1234.56, format: '#,##0.00' })
  assert.deepEqual(typed('¥1,000.00'), { value: 1000, format: '"¥"#,##0.00' })
  assert.deepEqual(typed('￥3500'), { value: 3500, format: '"¥"#,##0' })
  assert.deepEqual(typed('-2,500'), { value: -2500, format: '#,##0' })
  assert.deepEqual(typed('1,23'), { text: '1,23' })
})
test('percentages and dates become values with formats; ambiguous input is left alone', () => {
  assert.deepEqual(typed('15%'), { value: 0.15, format: '0%' })
  assert.deepEqual(typed('12.5%'), { value: 0.125, format: '0.0%' })
  assert.deepEqual(typed('2024-01-01'), { value: 45292, format: 'yyyy-mm-dd' })
  assert.deepEqual(typed('2024/1/5'), { value: 45296, format: 'yyyy-mm-dd' })
  assert.deepEqual(typed('2024年1月5日'), { value: 45296, format: 'yyyy"年"m"月"d"日"' })
  assert.deepEqual(typed('2024-02-30'), { text: '2024-02-30' })
  for (const s of ['3/4', 'TRUE', '12:30', '张三', '(2025)示0105民初1001号', '2024-1/5']) assert.ok(typed(s).text != null, s)
})
