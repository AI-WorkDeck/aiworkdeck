// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 律所审计日志（S20）导出 CSV：纯函数，便于单测。
//
// - 每格双引号包裹、内部 " 写成 ""，行尾 CRLF，前置 BOM 让 Excel 按 UTF-8 打开；
// - 公式注入防护：以 = + - @ 制表符或回车开头的格（文件名、项目名、姓名都是用户可控的）
//   前面补一个单引号，Excel/WPS 打开时不会当公式执行。

const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value) {
  let s = value == null ? '' : String(value)
  if (FORMULA_START.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** detail 对象 → "k=v; k=v"（键按字母序，稳定可比）。 */
export function detailText(detail) {
  if (!detail || typeof detail !== 'object') return ''
  return Object.keys(detail).sort().map((k) => `${k}=${detail[k]}`).join('; ')
}

/**
 * @param {Array<object>} events 服务端 cloud.audit.list 的 events
 * @param {Array<{label:string, value:(e:object)=>any}>} columns 表头与取值
 */
export function buildAuditCsv(events, columns) {
  const header = columns.map((c) => csvCell(c.label)).join(',')
  const rows = (events || []).map((e) => columns.map((c) => csvCell(c.value(e))).join(','))
  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n'
}
