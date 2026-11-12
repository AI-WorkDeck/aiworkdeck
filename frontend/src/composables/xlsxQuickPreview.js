// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 表格冷启动预览（office-tier1 O10）：引擎冷启动期间，直接从 xlsx 读出「打开后第一屏」——
// 活动工作表、保存时的滚动位置（topLeftCell / 冻结窗格）、前 ~60 行 × 26 列的值与基本样式，
// 画成与 Calc 相近的只读网格。第一次打开就有，不需要缓存。
// 流式解压、读够行数就停：5000 行台账与 50 行清单的耗时同档。
// 第一屏里有图片/图表/按钮这类网格画不出来的东西时，返回 null（宿主保持进度卡片）——
// 与演示文稿预览同一原则：宁可不显示，也不显示错的画面。

import JSZip from 'jszip'

export const PREVIEW_ROWS = 60
export const PREVIEW_COLS = 26
const MAX_SHEET_BYTES_SCANNED = 8 * 1024 * 1024
const MAX_SHARED_STRING_BYTES = 16 * 1024 * 1024

const attr = (tag, name) => {
  const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag)
  return m ? m[1] : null
}
const unescapeXml = s => s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-fA-F]+|#\d+);/g, (m, e) => {
  if (e === 'lt') return '<'
  if (e === 'gt') return '>'
  if (e === 'quot') return '"'
  if (e === 'apos') return "'"
  if (e === 'amp') return '&'
  const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
  return Number.isFinite(code) ? String.fromCodePoint(code) : m
})
// 富文本 <r><t> 与 <rPh>（拼音注音，不显示）
const textOf = xml => {
  let out = ''
  const re = /<t(?:\s[^>]*)?>([^<]*)<\/t>|<t(?:\s[^>]*)?\/>|<rPh\b[\s\S]*?<\/rPh>/g
  let m
  while ((m = re.exec(xml))) if (m[1] != null) out += m[1]
  return unescapeXml(out)
}

export function colIndex(letters) {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export function colName(i) {
  let s = ''
  for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}
const parseRef = ref => {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref || '')
  return m ? { col: colIndex(m[1]), row: Number(m[2]) - 1 } : null
}

// zip 路径：rels 的 Target 相对所在目录，也可能是以 / 开头的绝对路径
const resolvePath = (baseDir, target) => {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (baseDir + target).split('/')
  const out = []
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p) }
  return out.join('/')
}
async function rels(zip, partPath) {
  const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1)
  const file = zip.file(dir + '_rels/' + partPath.slice(dir.length) + '.rels')
  const map = {}
  if (!file) return map
  const xml = await file.async('string')
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) || []) {
    map[attr(tag, 'Id')] = { type: (attr(tag, 'Type') || '').split('/').pop(), path: resolvePath(dir, attr(tag, 'Target') || '') }
  }
  return map
}

// 流式读一个部件，onChunk 返回 true 就停（不再解压剩下的部分）
function streamPart(file, onChunk) {
  return new Promise((resolve, reject) => {
    const s = file.internalStream('string')
    let done = false
    s.on('data', chunk => {
      if (done) return
      if (onChunk(chunk)) { done = true; s.pause(); resolve() }
    }).on('end', () => { if (!done) { done = true; resolve() } })
      .on('error', e => { if (!done) { done = true; reject(e) } })
      .resume()
  })
}

// ---- 数字格式（覆盖法律台账里常见的那几类；其余按常规显示） ----
const BUILTIN_FORMATS = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  // 14/22 是「区域短日期」：引擎固定 zh-CN 区域，Calc 显示 2025-03-02（O10 与引擎截图对照）
  14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 49: '@',
  // 中文区域内置日期
  31: 'yyyy"年"m"月"d"日"', 57: 'yyyy"年"m"月"', 58: 'm"月"d"日"',
}
const pad2 = n => String(n).padStart(2, '0')
function general(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v)
  if (Math.abs(v) >= 1e11 || (v !== 0 && Math.abs(v) < 1e-9)) return v.toExponential(5).replace(/\.?0+e/, 'e').toUpperCase()
  return String(Number(v.toPrecision(10)))
}
// 日期/时间格式逐个记号替换：引号与反斜杠转义是字面量（LO 存 yyyy\-mm\-dd），m 紧跟 h 或后接 s 时是分钟
function formatDate(v, section) {
  const d = new Date(Math.round((v - 25569) * 86400000))
  if (Number.isNaN(d.getTime())) return ''
  const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1, D = d.getUTCDate()
  const H = d.getUTCHours(), MI = d.getUTCMinutes(), S = d.getUTCSeconds()
  const ampm = /AM\/PM|A\/P/i.test(section)
  const tokens = section.match(/"[^"]*"|\\.|\[[^\]]*\]|AM\/PM|A\/P|y+|m+|d+|h+|s+|./gi) || []
  let out = '', lastWasHour = false
  tokens.forEach((t, i) => {
    const low = t.toLowerCase()
    if (t.startsWith('"')) { out += t.slice(1, -1); return }
    if (t.startsWith('\\')) { out += t.slice(1); return }
    if (t.startsWith('[')) return // 颜色、区域标记
    if (/^(am\/pm|a\/p)$/.test(low)) { out += H < 12 ? 'AM' : 'PM'; return }
    const c = low[0]
    if (c === 'y') out += low.length <= 2 ? pad2(Y % 100) : String(Y)
    else if (c === 'd') out += low.length >= 3 ? ['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()] : low.length === 2 ? pad2(D) : String(D)
    else if (c === 'h') { const h = ampm ? (H % 12 || 12) : H; out += low.length >= 2 ? pad2(h) : String(h) }
    else if (c === 's') out += low.length >= 2 ? pad2(S) : String(S)
    else if (c === 'm') {
      const next = tokens.slice(i + 1).find(x => /^[a-z]/i.test(x) && !/^(am\/pm|a\/p)$/i.test(x))
      const minutes = lastWasHour || (next && /^s/i.test(next))
      if (minutes) out += low.length >= 2 ? pad2(MI) : String(MI)
      else out += low.length >= 3 ? String(M) + '月' : low.length === 2 ? pad2(M) : String(M)
    } else out += t
    if (/^[a-z]/i.test(t)) lastWasHour = c === 'h'
  })
  return out
}

export function formatNumber(v, code) {
  if (!Number.isFinite(v)) return ''
  if (!code || /^general$/i.test(code) || code === '@') return general(v)
  const section = code.split(';')[v < 0 && code.includes(';') ? 1 : 0] || code
  const bare = section.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')
  if (/[ymdhs]/i.test(bare) && !/[#0]/.test(bare.replace(/\.0+/, ''))) {
    return formatDate(v, section) || general(v)
  }
  const percent = bare.includes('%')
  let x = percent ? v * 100 : v
  if (code.includes(';') && v < 0) x = Math.abs(x) // 负数段自带括号或负号
  const decimals = (/\.([0#]+)/.exec(bare) || [, ''])[1].length
  const grouped = /#,##0|0,0/.test(bare)
  let num = /E\+/i.test(bare)
    ? x.toExponential(decimals).toUpperCase().replace(/E\+?(-?)(\d)$/, 'E+$10$2')
    : x.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped })
  // 字面量前后缀：引号文本与 [$¥-804] 货币符号
  const literal = part => (part.match(/"([^"]*)"|\[\$([^\]-]*)[^\]]*\]|\\(.)|([¥$€£])/g) || [])
    .map(t => t.startsWith('"') ? t.slice(1, -1) : t.startsWith('[$') ? t.slice(2).split('-')[0].replace(']', '') : t.startsWith('\\') ? t.slice(1) : t).join('')
  // 引号文本、[$¥-804] 这类方括号里的字符不是数字占位符（804 里的 0 曾被当成数字起点）
  const masked = section.replace(/"[^"]*"|\[[^\]]*\]|\\./g, m => ' '.repeat(m.length))
  const firstDigit = masked.search(/[#0?]/)
  const lastDigit = Math.max(masked.lastIndexOf('0'), masked.lastIndexOf('#'))
  const prefix = firstDigit > 0 ? literal(section.slice(0, firstDigit)) : ''
  const suffix = lastDigit >= 0 ? literal(section.slice(lastDigit + 1).replace('%', '')) : ''
  num = prefix + num + (percent ? '%' : '') + suffix
  if (code.includes(';') && v < 0) {
    const neg = section.replace(/"[^"]*"/g, '')
    if (/\(/.test(neg)) num = '(' + num.replace(/[()]/g, '') + ')'
    else if (/^-|[^\\]-/.test(neg)) num = '-' + num
  } else if (v < 0 && !num.startsWith('-') && !code.includes(';')) num = '-' + num.replace('-', '')
  return num
}

// ---- 样式 ----
// 同名元素逐个切出：自闭合 <xf/> 与带子元素的 <xf>…</xf> 混排时，
// 「先找 </xf>」的写法会把前一个自闭合的吞进来，样式序号整体错位
const elements = (xml, name) => xml.match(new RegExp('<' + name + '\\b[^>]*?(?:/>|>[\\s\\S]*?</' + name + '>)', 'g')) || []
async function readStyles(zip, path) {
  const file = path && zip.file(path)
  if (!file) return { xfs: [], fonts: [], fills: [], numFmts: {} }
  const xml = await file.async('string')
  const block = name => (new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>').exec(xml) || [, ''])[1]
  const numFmts = {}
  for (const tag of block('numFmts').match(/<numFmt\b[^>]*>/g) || []) numFmts[attr(tag, 'numFmtId')] = unescapeXml(attr(tag, 'formatCode') || '')
  const color = x => {
    const rgb = /<color\b[^>]*\brgb="([0-9A-Fa-f]{6,8})"/.exec(x)
    return rgb ? '#' + rgb[1].slice(-6) : null
  }
  const fonts = (elements(block('fonts'), 'font') || []).map(f => ({
    size: Number((/<sz\s+val="([\d.]+)"/.exec(f) || [, 0])[1]) || null,
    bold: /<b\/>|<b\s+val="(1|true)"/.test(f), italic: /<i\/>|<i\s+val="(1|true)"/.test(f), color: color(f),
  }))
  const fills = (elements(block('fills'), 'fill') || []).map(f => {
    if (!/patternType="solid"/.test(f)) return null
    const fg = /<fgColor\b[^>]*\brgb="([0-9A-Fa-f]{6,8})"/.exec(f)
    return fg ? '#' + fg[1].slice(-6) : null
  })
  const xfs = (elements(block('cellXfs'), 'xf') || []).map(x => {
    const open = /<xf\b[^>]*>/.exec(x)[0]
    const align = /<alignment\b[^>]*>/.exec(x)
    return {
      numFmtId: attr(open, 'numFmtId') || '0', fontId: Number(attr(open, 'fontId') || 0), fillId: Number(attr(open, 'fillId') || 0),
      horizontal: align ? attr(align[0], 'horizontal') : null, wrap: align ? attr(align[0], 'wrapText') === '1' : false,
    }
  })
  return { xfs, fonts, fills, numFmts }
}

// 第一屏里有没有网格画不出来的对象（图片/图表/形状/按钮）。批注只是角标，不算。
// 走工作表的 rels：绘图引用写在 sheetData 之后，大表不必为了找它把整个工作表读完。
async function visibleObjects(zip, sheetRels, window) {
  const inWindow = (col, row) => col <= window.lastCol && row <= window.lastRow
    && (row >= window.firstRow || row < window.frozenRows) && (col >= window.firstCol || col < window.frozenCols)
  for (const rel of Object.values(sheetRels)) {
    if (rel.type !== 'drawing' && rel.type !== 'vmlDrawing') continue
    const file = zip.file(rel.path)
    if (!file) continue
    const xml = await file.async('string')
    if (rel.type === 'drawing') {
      if (/<xdr:absoluteAnchor/.test(xml)) return true
      for (const a of xml.matchAll(/<xdr:from>\s*<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/g)) {
        if (inWindow(Number(a[1]), Number(a[2]))) return true
      }
      continue
    }
    for (const shape of xml.match(/<x:ClientData\b[\s\S]*?<\/x:ClientData>/g) || []) {
      if (/ObjectType="Note"/.test(shape)) continue
      const anchor = /<x:Anchor>\s*([\d\s,]+)<\/x:Anchor>/.exec(shape)
      const n = anchor ? anchor[1].split(',').map(v => Number(v.trim())) : null
      if (!n || inWindow(n[0], n[2])) return true
    }
  }
  return false
}

// 打开后可见的行列范围：保存时的滚动位置（topLeftCell），冻结窗格的行列始终在前
function screenWindow(head, maxRows, maxCols) {
  const sv = /<sheetView\b[^>]*>/.exec(head)
  const pane = /<pane\b[^>]*>/.exec(head)
  const frozen = !!pane && /state="frozen(Split)?"/.test(pane[0])
  const top = parseRef((frozen && attr(pane[0], 'topLeftCell')) || (sv && attr(sv[0], 'topLeftCell')) || 'A1') || { col: 0, row: 0 }
  const frozenRows = frozen ? Number(attr(pane[0], 'ySplit') || 0) : 0
  const frozenCols = frozen ? Number(attr(pane[0], 'xSplit') || 0) : 0
  const firstRow = Math.max(top.row, frozenRows), firstCol = Math.max(top.col, frozenCols)
  return {
    firstRow, firstCol, frozenRows, frozenCols,
    lastRow: firstRow + Math.max(1, maxRows - frozenRows) - 1,
    lastCol: firstCol + Math.max(1, maxCols - frozenCols) - 1,
  }
}

/**
 * 读出 xlsx 打开后的第一屏。返回 null 表示「不预览」（加密、无工作表、第一屏有对象、解析失败）。
 * @returns {Promise<null | { sheets: string[], active: number, columns: {index,width}[], rows: {index,height,cells:{}}[], merges: {}[] }>}
 */
export async function readXlsxFirstScreen(buf, { rows: maxRows = PREVIEW_ROWS, cols: maxCols = PREVIEW_COLS } = {}) {
  let zip
  try { zip = await JSZip.loadAsync(buf) } catch { return null }
  const wbPath = 'xl/workbook.xml'
  const wbFile = zip.file(wbPath)
  if (!wbFile) return null
  const wb = await wbFile.async('string')
  const wbRels = await rels(zip, wbPath)
  const sheetTags = (wb.match(/<sheet\b[^>]*>/g) || []).map(t => ({
    name: unescapeXml(attr(t, 'name') || ''), rid: attr(t, 'r:id'), hidden: (attr(t, 'state') || 'visible') !== 'visible',
  }))
  const visible = sheetTags.filter(s => !s.hidden)
  if (!visible.length) return null
  const view = /<workbookView\b[^>]*>/.exec(wb)
  const activeTab = Number((view && attr(view[0], 'activeTab')) || 0)
  let sheet = sheetTags[activeTab]
  if (!sheet || sheet.hidden) sheet = visible[0]
  const sheetPath = wbRels[sheet.rid] && wbRels[sheet.rid].path
  const sheetFile = sheetPath && zip.file(sheetPath)
  if (!sheetFile) return null

  // 状态机：head = sheetData 之前（视图、列宽）；rows = 第一屏要的完整 <row>；after = sheetData 之后（合并单元格）。
  // 读过第一屏最后一行就停，不解压剩下的部分。
  let head = '', pending = '', after = null, scanned = 0, rowsXml = '', nextRow = 0
  let window = null
  const rowRe = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g
  await streamPart(sheetFile, chunk => {
    scanned += chunk.length
    if (after != null) { after += chunk; return after.length > MAX_SHEET_BYTES_SCANNED }
    if (!window) {
      head += chunk
      const at = head.indexOf('<sheetData')
      if (at < 0) return scanned > MAX_SHEET_BYTES_SCANNED
      window = screenWindow(head.slice(0, at), maxRows, maxCols)
      pending = head.slice(at)
      head = head.slice(0, at)
    } else pending += chunk
    let last = 0, m
    rowRe.lastIndex = 0
    while ((m = rowRe.exec(pending))) {
      const open = m[0].slice(0, m[0].indexOf('>') + 1)
      const r = Number(attr(open, 'r') || nextRow + 1) - 1
      nextRow = r + 1
      last = rowRe.lastIndex
      if (r > window.lastRow) return true
      if (r <= window.lastRow && (r >= window.firstRow || r < window.frozenRows)) rowsXml += m[0]
    }
    const rest = pending.slice(last)
    const end = rest.search(/<\/sheetData>|<sheetData[^>]*\/>/)
    if (end >= 0) { after = rest.slice(end); pending = ''; return false }
    pending = rest
    return scanned > MAX_SHEET_BYTES_SCANNED
  })
  if (!window) return null
  const sheetRels = await rels(zip, sheetPath)
  if (await visibleObjects(zip, sheetRels, window)) return null

  const wbStylesRel = Object.values(wbRels).find(r => r.type === 'styles')
  const styles = await readStyles(zip, wbStylesRel && wbStylesRel.path)
  const colsBlock = (/<cols>([\s\S]*?)<\/cols>/.exec(head) || [, ''])[1]
  const fmtPr = /<sheetFormatPr\b[^>]*>/.exec(head)
  const defaultColWidth = Number((fmtPr && (attr(fmtPr[0], 'defaultColWidth'))) || 0) || (Number((fmtPr && attr(fmtPr[0], 'baseColWidth')) || 8) + 0.71)
  const defaultRowHeight = Number((fmtPr && attr(fmtPr[0], 'defaultRowHeight')) || 15)
  const colWidth = {}
  const colHidden = {}
  for (const tag of colsBlock.match(/<col\b[^>]*>/g) || []) {
    const min = Number(attr(tag, 'min')) - 1, max = Math.min(Number(attr(tag, 'max')) - 1, window.lastCol)
    for (let c = min; c <= max; c++) {
      colWidth[c] = Number(attr(tag, 'width') || defaultColWidth)
      if (attr(tag, 'hidden') === '1' || attr(tag, 'hidden') === 'true') colHidden[c] = true
    }
  }
  const colList = []
  for (let c = 0; c <= window.lastCol; c++) {
    if (c >= window.frozenCols && c < window.firstCol) continue
    if (colHidden[c]) continue
    colList.push({ index: c, width: Math.round((colWidth[c] ?? defaultColWidth) * 7 + 5) })
  }

  // 共享字符串只读到用到的最大序号为止
  const fitRowPt = ((styles.fonts[0] && styles.fonts[0].size) || 11) * 1.5
  const gapRowPt = fmtPr && attr(fmtPr[0], 'customHeight') === '1' ? defaultRowHeight : Math.max(defaultRowHeight, fitRowPt)
  let formulaWithoutValue = false
  const rowsOut = []
  const hiddenRows = new Set()
  const needed = new Set()
  // 新建正则：matchAll 会沿用 lastIndex，流式循环中途停下时留着的偏移会把行全部跳过
  for (const rm of rowsXml.matchAll(new RegExp(rowRe.source, 'g'))) {
    const open = rm[0].slice(0, rm[0].indexOf('>') + 1)
    const index = Number(attr(open, 'r')) - 1
    if (attr(open, 'hidden') === '1' || attr(open, 'hidden') === 'true') { hiddenRows.add(index); continue }
    // 没有 customHeight 的行，Calc 打开时按字体重新算最优行高（约 1.5 倍字号），不用文件里记的 ht
    const ht = attr(open, 'customHeight') === '1' || attr(open, 'customHeight') === 'true'
      ? Number(attr(open, 'ht') || defaultRowHeight) : Math.max(Number(attr(open, 'ht') || 0), fitRowPt)
    const cells = {}
    for (const cm of rm[0].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = parseRef(attr(' ' + cm[1], 'r'))
      if (!ref || ref.col > window.lastCol || colHidden[ref.col]) continue
      if (ref.col >= window.frozenCols && ref.col < window.firstCol) continue
      const t = attr(' ' + cm[1], 't') || 'n'
      const s = Number(attr(' ' + cm[1], 's') || 0)
      const inner = cm[2] || ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
      // 脚本生成的文件常有公式没缓存值：引擎打开时会算出来，预览只能留空——留空的合计就是错的画面
      if (!v && /<f[\s>/]/.test(inner)) formulaWithoutValue = true
      const raw = v ? unescapeXml(v[1]) : null
      const cell = { type: t, style: s, raw }
      if (t === 's' && raw != null) needed.add(Number(raw))
      else if (t === 'inlineStr') cell.text = textOf(inner)
      cells[ref.col] = cell
    }
    rowsOut.push({ index, height: Math.round(ht * 96 / 72), cells })
  }
  if (formulaWithoutValue) return null
  const shared = []
  const maxNeeded = needed.size ? Math.max(...needed) : -1
  const ssRel = Object.values(wbRels).find(r => r.type === 'sharedStrings')
  const ssFile = maxNeeded >= 0 && ssRel && zip.file(ssRel.path)
  if (ssFile) {
    let buffer = '', bytes = 0
    await streamPart(ssFile, chunk => {
      bytes += chunk.length
      buffer += chunk
      let last = 0
      for (const m of buffer.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
        shared.push(m[1] == null ? '' : textOf(m[1]))
        last = m.index + m[0].length
      }
      buffer = buffer.slice(last)
      return shared.length > maxNeeded || bytes > MAX_SHARED_STRING_BYTES
    })
  }

  for (const row of rowsOut) {
    for (const [col, cell] of Object.entries(row.cells)) {
      const xf = styles.xfs[cell.style] || {}
      const font = styles.fonts[xf.fontId] || {}
      let text = '', numeric = false
      if (cell.type === 's') text = shared[Number(cell.raw)] ?? ''
      else if (cell.type === 'inlineStr') text = cell.text
      else if (cell.type === 'str' || cell.type === 'e') text = cell.raw ?? ''
      else if (cell.type === 'b') text = cell.raw === '1' ? 'TRUE' : 'FALSE'
      else if (cell.raw != null && cell.raw !== '') {
        const n = Number(cell.raw)
        const code = styles.numFmts[xf.numFmtId] ?? BUILTIN_FORMATS[xf.numFmtId] ?? 'General'
        text = Number.isFinite(n) ? formatNumber(n, code) : cell.raw
        numeric = Number.isFinite(n)
      }
      row.cells[col] = {
        text, bold: !!font.bold, italic: !!font.italic, color: font.color && font.color !== '#000000' ? font.color : null,
        fill: styles.fills[xf.fillId] || null, wrap: !!xf.wrap,
        align: xf.horizontal && xf.horizontal !== 'general' ? xf.horizontal : (numeric ? 'right' : cell.type === 'b' ? 'center' : 'left'),
      }
    }
  }
  const merges = after ? [...after.matchAll(/<mergeCell\s+ref="([A-Z]+\d+):([A-Z]+\d+)"/g)]
    .map(m => ({ from: parseRef(m[1]), to: parseRef(m[2]) })).filter(m => m.from && m.to) : []
  return {
    sheets: visible.map(s => s.name), active: visible.indexOf(sheet),
    // 工作簿默认字号（fonts[0]，常见 11pt）决定 Calc 画布的字大小
    fontPx: Math.round(((styles.fonts[0] && styles.fonts[0].size) || 11) * 96 / 72 * 10) / 10,
    columns: colList, rows: fillRowGaps(rowsOut, window, gapRowPt, hiddenRows), merges,
  }
}

// 文件里没写的行（空行）按默认行高补上，网格才和 Calc 一样连续
function fillRowGaps(rows, window, defaultRowHeight, hiddenRows) {
  const byIndex = new Map(rows.map(r => [r.index, r]))
  const out = []
  const push = r => hiddenRows.has(r) || out.push(byIndex.get(r) || { index: r, height: Math.round(defaultRowHeight * 96 / 72), cells: {} })
  for (let r = 0; r < window.frozenRows; r++) push(r)
  for (let r = window.firstRow; r <= window.lastRow; r++) push(r)
  return out
}

/** 把 readXlsxFirstScreen 的结果画成只读网格（DOM，样式类见 LibreOfficeEditor.vue 的 .awd-sheet-preview）。 */
export function renderSheetPreview(container, screen, doc = globalThis.document) {
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  const root = el('div', 'awd-sheet-preview')
  const scroller = el('div', 'awd-sheet-preview__grid')
  const table = el('table')
  if (screen.fontPx) table.style.fontSize = screen.fontPx + 'px'
  const colgroup = el('colgroup')
  const rowHeaderCol = el('col'); rowHeaderCol.style.width = '44px'; colgroup.appendChild(rowHeaderCol)
  for (const c of screen.columns) { const col = el('col'); col.style.width = c.width + 'px'; colgroup.appendChild(col) }
  table.appendChild(colgroup)
  const headRow = el('tr')
  headRow.appendChild(el('th', 'awd-sheet-preview__corner'))
  for (const c of screen.columns) headRow.appendChild(el('th', null, colName(c.index)))
  table.appendChild(headRow)
  const covered = new Set()
  const spanAt = new Map()
  const visibleCols = new Set(screen.columns.map(c => c.index))
  const visibleRows = new Set(screen.rows.map(r => r.index))
  for (const m of screen.merges) {
    const cols = screen.columns.filter(c => c.index >= m.from.col && c.index <= m.to.col).length
    const rows = screen.rows.filter(r => r.index >= m.from.row && r.index <= m.to.row).length
    if (!visibleCols.has(m.from.col) || !visibleRows.has(m.from.row) || cols * rows <= 1) continue
    spanAt.set(m.from.row + ':' + m.from.col, { cols, rows })
    for (let r = m.from.row; r <= m.to.row; r++) for (let c = m.from.col; c <= m.to.col; c++) if (r !== m.from.row || c !== m.from.col) covered.add(r + ':' + c)
  }
  for (const row of screen.rows) {
    const tr = el('tr')
    tr.style.height = row.height + 'px'
    tr.appendChild(el('th', null, String(row.index + 1)))
    for (const c of screen.columns) {
      const key = row.index + ':' + c.index
      if (covered.has(key)) continue
      const cell = row.cells[c.index]
      const td = el('td', null, cell ? cell.text : '')
      const span = spanAt.get(key)
      if (span) { if (span.cols > 1) td.colSpan = span.cols; if (span.rows > 1) td.rowSpan = span.rows }
      if (cell) {
        if (cell.bold) td.style.fontWeight = '700'
        if (cell.italic) td.style.fontStyle = 'italic'
        if (cell.color) td.style.color = cell.color
        if (cell.fill) td.style.background = cell.fill
        if (cell.wrap) td.style.whiteSpace = 'normal'
        td.style.textAlign = cell.align === 'centerContinuous' ? 'center' : cell.align
      }
      tr.appendChild(td)
    }
    table.appendChild(tr)
  }
  scroller.appendChild(table)
  root.appendChild(scroller)
  const tabs = el('div', 'awd-sheet-preview__tabs')
  screen.sheets.forEach((name, i) => tabs.appendChild(el('span', i === screen.active ? 'is-active' : null, name)))
  root.appendChild(tabs)
  container.appendChild(root)
  return root
}
