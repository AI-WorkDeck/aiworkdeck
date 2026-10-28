// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from './i18n.js'

// Public Style.paragraphFormat is WordApi 1.5. It has no lineSpacingRule.
// Unsupported profile dimensions are rejected before modifying ANY style or paragraph.
// Scope selection still updates document style definitions, matching the desktop contract.
const LIMIT = 5000
const ALIGN = { left: 'Left', center: 'Centered', right: 'Right', justify: 'Justified', both: 'Justified', start: 'Left', end: 'Right' }
const WPS_ALIGN = { Left: 0, Centered: 1, Right: 2, Justified: 3 }
function reject(fields, key = 'wordStyleUnsupported') {
  const error = new Error(t(key, { fields: fields.join(', ') }))
  error.unsupportedFields = fields
  throw error
}
function length(value, size, path) {
  if (value == null) return undefined
  const n = Number(value.value)
  const factors = { pt: 1, chars: size, lines: size * 1.2, mm: 72 / 25.4, cm: 720 / 25.4, twips: 1 / 20 }
  if (!Number.isFinite(n)) reject([path], 'fileOperationInvalidArguments')
  const factor = factors[value.unit || 'pt']
  if (factor == null) reject([path], 'fileOperationInvalidArguments')
  return n * factor
}
function plan(args, host) {
  const profile = args?.profile
  const scope = args?.scope || 'document'
  if (!profile || profile.schemaVersion !== 1 || !profile.body || !['document', 'selection', 'styles-only'].includes(scope)) reject(['profile', 'scope'], 'fileOperationInvalidArguments')
  const unsupported = []
  // Schema v1 includes these dimensions, but this adapter has no faithful native
  // implementation for them. Keep unrelated provenance/schema metadata intact.
  for (const field of ['page', 'headerFooter', 'numbering']) {
    const value = profile[field]
    if (value != null && (typeof value !== 'object' || Object.keys(value).some(key => key !== 'source'))) unsupported.push(field)
  }
  // Table paragraph styles and table layout are a separate contract, not body formatting.
  if (host === 'office' && profile.table && Object.keys(profile.table).length) unsupported.push('table')
  if (host === 'office' && profile.toc) unsupported.push('toc')
  const blocks = [{ ...profile.body, level: 0 }, ...(profile.headings || [])]
  const levels = new Set()
  const styles = blocks.map((block) => {
    const level = Number(block.level)
    if (!Number.isInteger(level) || level < 0 || level > 9 || levels.has(level)) reject(['headings.level'], 'fileOperationInvalidArguments')
    levels.add(level)
    const path = level ? `headings.${level}` : 'body'
    const known = new Set(['level', 'styleId', 'source', 'font', 'size', 'bold', 'color', 'alignment', 'lineSpacing', 'spaceBefore', 'spaceAfter', 'firstLineIndent', 'leftIndent', 'afterTableSpaceBefore', 'numbering'])
    for (const key of Object.keys(block)) if (!known.has(key)) unsupported.push(`${path}.${key}`)
    const defaults = profile.defaults || {}
    const size = length(block.size || defaults.size || { value: 12, unit: 'pt' }, 12, `${path}.size`)
    if (size <= 0 || size > 1638) reject([`${path}.size`], 'fileOperationInvalidArguments')
    const font = { ...defaults.font, ...block.font }
    if (font.theme != null && font.theme !== '') unsupported.push(`${path}.font.theme`)
    const color = block.color ?? defaults.color
    if (color != null && !/^#?[0-9a-f]{6}$/i.test(color)) reject([`${path}.color`], 'fileOperationInvalidArguments')
    if (block.bold != null && typeof block.bold !== 'boolean') reject([`${path}.bold`], 'fileOperationInvalidArguments')
    const alignment = ALIGN[block.alignment || 'justify']
    if (!alignment) unsupported.push(`${path}.alignment`)
    if (block.numbering && block.numbering.kind !== 'none') unsupported.push(`${path}.numbering`)
    if (host === 'office' && block.afterTableSpaceBefore != null && scope !== 'styles-only') unsupported.push(`${path}.afterTableSpaceBefore`)
    const spacing = block.lineSpacing
    let lineSpacing, lineRule
    if (spacing) {
      if (!['atLeast', 'exactly', 'auto'].includes(spacing.rule)) unsupported.push(`${path}.lineSpacing.rule`)
      if (spacing.rule === 'auto') {
        lineSpacing = Number(spacing.value) * (spacing.unit === 'percent' ? 0.12 : 12)
        lineRule = 5
      } else {
        lineSpacing = length(spacing, size, `${path}.lineSpacing`)
        lineRule = spacing.rule === 'atLeast' ? 3 : 4
      }
      if (!Number.isFinite(lineSpacing) || lineSpacing <= 0) reject([`${path}.lineSpacing`], 'fileOperationInvalidArguments')
      if (host === 'office' && spacing.rule !== 'exactly') unsupported.push(`${path}.lineSpacing.rule`)
    }
    if (host === 'office' && new Set(Object.values(font).filter(Boolean)).size > 1) unsupported.push(`${path}.font`)
    return {
      level, name: (block.styleId || (level ? `Heading ${level}` : 'Normal')).replace(/^Heading(\d)$/, 'Heading $1'), size, font,
      bold: block.bold, color: color == null ? undefined : `#${color.replace('#', '')}`, alignment,
      lineSpacing, lineRule,
      before: length(block.spaceBefore, size, `${path}.spaceBefore`),
      after: length(block.spaceAfter, size, `${path}.spaceAfter`),
      indent: length(block.firstLineIndent, size, `${path}.firstLineIndent`),
      left: length(block.leftIndent || { value: 0, unit: 'pt' }, size, `${path}.leftIndent`),
    }
  })
  if (unsupported.length) reject(unsupported)
  return { profileName: profile.name, scope, styles, profile, afterTable: length(profile.body.afterTableSpaceBefore, styles[0].size, 'body.afterTableSpaceBefore') }
}
function classify(text, outline, numbered, index) {
  if (outline >= 1 && outline <= 9) return outline
  const s = String(text || '').trim()
  if (index === 0 && s && s.length <= 60) return 1
  if (s.length <= 45 && !/[。；;！!？?：:]$/.test(s)) {
    if (/^第[一二三四五六七八九十百千零〇0-9１-９]+\s*[章节编]/.test(s)) return 2
    if (/^(第[一二三四五六七八九十百千零〇0-9１-９]+\s*条|[一二三四五六七八九十]{1,3}\s*、)/.test(s)) return 3
  }
  return numbered ? -1 : 0
}
function specFor(styles, level) {
  return styles.find(s => s.level === level) || [...styles].reverse().find(s => s.level > 0 && s.level <= level) || styles[0]
}
function officeSet(font, paragraph, spec, keepWeight, numbered) {
  const name = spec.font.western || spec.font.eastAsia || spec.font.cs
  if (name) font.name = name
  font.size = spec.size
  if (spec.color != null) font.color = spec.color
  if (!keepWeight && spec.bold != null) font.bold = spec.bold
  paragraph.alignment = spec.alignment
  for (const [key, value] of Object.entries({ lineSpacing: spec.lineSpacing, spaceBefore: spec.before, spaceAfter: spec.after, firstLineIndent: numbered ? 0 : spec.indent, leftIndent: spec.left, rightIndent: 0 })) if (value != null) paragraph[key] = value
}
function partial(error, result) {
  const wrapped = new Error(t('wordStructurePartial'), { cause: error })
  wrapped.partialResult = { ...result, possiblyApplied: true }
  throw wrapped
}
export async function applyOfficeWordStyleProfile(context, args) {
  const p = plan(args, 'office')
  if (!globalThis.Office?.context?.requirements?.isSetSupported('WordApi', '1.5')) reject(['WordApi1.5'])
  const collection = context.document.getStyles()
  const targets = p.styles.map(spec => {
    const target = collection.getByNameOrNullObject(spec.name)
    target.load('isNullObject')
    return { target, spec }
  })
  const paragraphs = p.scope === 'styles-only' ? null : (p.scope === 'selection' ? context.document.getSelection() : context.document.body).paragraphs
  if (paragraphs) paragraphs.load('items/text,items/styleBuiltIn,items/isListItem')
  await context.sync()
  if (targets.some(x => x.target.isNullObject)) reject(targets.filter(x => x.target.isNullObject).map(x => `style:${x.spec.name}`))
  if (paragraphs && paragraphs.items.length > LIMIT) reject(['paragraphs'], 'wordStructureTooLarge')
  const result = { scope: p.scope, profileName: p.profileName, styles: [], paragraphs: 0, tables: 0 }
  try {
    for (const { target, spec } of targets) {
      officeSet(target.font, target.paragraphFormat, spec, false, false)
      result.styles.push(spec.name)
    }
    for (const [i, paragraph] of (paragraphs?.items || []).entries()) {
      const level = classify(paragraph.text, Number(/^Heading(\d)$/.exec(paragraph.styleBuiltIn || '')?.[1]), paragraph.isListItem, p.scope === 'selection' ? -1 : i)
      officeSet(paragraph.font, paragraph, specFor(p.styles, level), level <= 0, paragraph.isListItem)
      result.paragraphs++
    }
    await context.sync()
    return result
  } catch (error) { partial(error, result) }
}
function wpsSet(font, paragraph, spec, keepWeight, numbered) {
  if (spec.font.eastAsia) font.NameFarEast = spec.font.eastAsia
  if (spec.font.western) font.NameAscii = spec.font.western
  if (spec.font.cs || spec.font.western) font.NameOther = spec.font.cs || spec.font.western
  font.Size = spec.size
  if (spec.color) { const c = parseInt(spec.color.slice(1), 16); font.Color = ((c & 255) << 16) | (c & 65280) | ((c >> 16) & 255) }
  if (!keepWeight && spec.bold != null) font.Bold = spec.bold ? -1 : 0
  paragraph.Alignment = WPS_ALIGN[spec.alignment]
  if (spec.lineSpacing != null) { paragraph.LineSpacingRule = spec.lineRule; paragraph.LineSpacing = spec.lineSpacing }
  for (const [key, value] of Object.entries({ SpaceBefore: spec.before, SpaceAfter: spec.after, FirstLineIndent: numbered ? 0 : spec.indent, LeftIndent: spec.left, RightIndent: 0 })) if (value != null) paragraph[key] = value
}
function colorBgr(value) {
  const c = parseInt(value.replace('#', ''), 16)
  return ((c & 255) << 16) | (c & 65280) | ((c >> 16) & 255)
}
function tablePlan(p) {
  const table = p.profile.table
  if (!table) return null
  const cell = table.cell || {}, header = table.header || {}
  for (const key of Object.keys(table)) if (!['source', 'borders', 'header', 'cell'].includes(key)) reject([`table.${key}`])
  for (const key of Object.keys(header)) if (!['rows', 'repeatOnEachPage', 'bold', 'alignment', 'verticalAlign', 'fill'].includes(key)) reject([`table.header.${key}`])
  const { byContentType, verticalAlign, ...paragraph } = cell
  const spec = plan({ profile: { schemaVersion: 1, defaults: p.profile.defaults, body: { ...paragraph, alignment: paragraph.alignment || 'left' } }, scope: 'styles-only' }, 'wps').styles[0]
  const vAlign = { top: 0, center: 1, bottom: 3 }
  if (vAlign[verticalAlign || 'center'] == null || vAlign[header.verticalAlign || 'center'] == null) reject(['table.verticalAlign'])
  const headerRows = header.rows == null ? 1 : Number(header.rows)
  if (!Number.isInteger(headerRows) || headerRows < 0) reject(['table.header.rows'], 'fileOperationInvalidArguments')
  const headerAlign = ALIGN[header.alignment || 'center']
  if (!headerAlign || (header.fill != null && !/^#?[0-9a-f]{6}$/i.test(header.fill))) reject(['table.header'])
  const aligns = {}
  for (const kind of ['text', 'number', 'date', 'serial']) {
    aligns[kind] = ALIGN[byContentType?.[kind]?.alignment || (['number', 'serial'].includes(kind) ? 'right' : 'left')]
    if (!aligns[kind]) reject([`table.cell.byContentType.${kind}`])
  }
  for (const [kind, entry] of Object.entries(byContentType || {})) {
    if (!['text', 'number', 'date', 'serial'].includes(kind) || Object.keys(entry || {}).some(key => key !== 'alignment')) reject([`table.cell.byContentType.${kind}`])
  }
  for (const key of Object.keys(table.borders || {})) if (!['source', 'outside', 'insideH', 'insideV'].includes(key)) reject([`table.borders.${key}`])
  const borders = []
  for (const [name, sides] of [['outside', [-1, -2, -3, -4]], ['insideH', [-5]], ['insideV', [-6]]]) {
    const border = table.borders?.[name]
    if (!border) continue
    const width = length(border.width || { value: 1.5, unit: 'pt' }, spec.size, `table.borders.${name}.width`)
    if (!['single', 'none'].includes(border.style || 'single') || ![0.25, 0.5, 0.75, 1, 1.5, 2.25, 3].includes(width)) reject([`table.borders.${name}`])
    const color = border.color || '#000000'
    if (!/^#?[0-9a-f]{6}$/i.test(color)) reject([`table.borders.${name}.color`])
    for (const side of sides) borders.push({ side, style: border.style === 'none' ? 0 : 1, width: width * 8, color: colorBgr(color) })
  }
  return { spec, header: { ...spec, bold: header.bold !== false, alignment: headerAlign }, headerRows,
    repeat: header.repeatOnEachPage !== false, fill: header.fill, vertical: vAlign[verticalAlign || 'center'],
    headerVertical: vAlign[header.verticalAlign || 'center'], aligns, borders }
}
function countOf(collection, field) {
  const count = Number(collection?.Count)
  if (!Number.isInteger(count) || count < 0 || count > LIMIT) reject([field], 'wordStructureTooLarge')
  return count
}
// WPS official Styles.Add(Name, Type), Row.HeadingFormat, Cell.VerticalAlignment.
// See https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/wps/Styles/obj
export function applyWpsWordStyleProfile(doc, app, args) {
  const p = plan(args, 'wps'), tp = tablePlan(p)
  if (!doc.Styles || typeof doc.Styles.Item !== 'function') reject(['Styles.Item'])
  const targets = p.styles.map(spec => ({ spec, target: doc.Styles.Item(spec.name === 'Normal' ? -1 : /^Heading [1-9]$/.test(spec.name) ? -1 - spec.level : spec.name) }))
  const extraStyles = []
  if (tp) extraStyles.push({ spec: { ...tp.spec, bold: false }, name: 'AWD Table Contents' }, { spec: tp.header, name: 'AWD Table Heading' })
  if (p.profile.toc) {
    const title = p.profile.toc.titleStyle || {}
    const spec = plan({ profile: { schemaVersion: 1, defaults: p.profile.defaults, body: { size: { value: 16, unit: 'pt' }, bold: true, alignment: 'center', ...title } }, scope: 'styles-only' }, 'wps').styles[0]
    extraStyles.push({ spec, name: 'TOC Heading', lookup: -267 })
  }
  for (const extra of extraStyles) {
    try { extra.target = doc.Styles.Item(extra.lookup ?? extra.name) } catch { extra.target = null }
    if (!extra.target && typeof doc.Styles.Add !== 'function') reject(['Styles.Add'])
    if (extra.target && (!extra.target.Font || !extra.target.ParagraphFormat)) reject([`style:${extra.name}`])
  }
  if (targets.some(x => !x.target?.Font || !x.target?.ParagraphFormat)) reject(['Style.Font', 'Style.ParagraphFormat'])
  const range = p.scope === 'selection' ? app.Selection?.Range : doc.Content
  const paragraphs = p.scope === 'styles-only' ? null : range?.Paragraphs
  if (p.scope !== 'styles-only' && !paragraphs) reject(['Paragraphs'])
  const count = paragraphs ? countOf(paragraphs, 'paragraphs') : 0
  const tables = [], bounds = []
  if (p.scope === 'document' && doc.Tables) {
    const n = countOf(doc.Tables, 'tables')
    let cellCount = 0
    for (let i = 1; i <= n; i++) {
      const table = doc.Tables.Item(i), tr = table.Range
      if (!Number.isFinite(Number(tr?.Start)) || !Number.isFinite(Number(tr?.End))) reject(['Table.Range'])
      bounds.push({ start: Number(tr.Start), end: Number(tr.End) })
      if (!tp) continue
      const rows = [], cells = [], borders = []
      const rc = countOf(table.Rows, 'table.rows')
      for (let j = 1; j <= rc; j++) {
        const row = table.Rows.Item(j), cc = countOf(row.Cells, 'table.cells')
        rows.push({ row, header: j <= tp.headerRows })
        for (let k = 1; k <= cc; k++) {
          if (++cellCount > LIMIT) reject(['table.cells'], 'wordStructureTooLarge')
          const cell = row.Cells.Item(k), r = cell.Range
          if (!r?.Font || !r?.ParagraphFormat) reject(['Cell.Range'])
          if (j <= tp.headerRows && tp.fill != null && !cell.Shading) reject(['Cell.Shading'])
          const text = String(r.Text || '').replace(/[\r\u0007]+$/, '').trim()
          const kind = /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(text) ? 'date' : /^[-+]?\d[\d,]*(?:\.\d+)?%?$/.test(text) ? 'number' : 'text'
          cells.push({ cell, range: r, header: j <= tp.headerRows, kind })
        }
      }
      for (const b of tp.borders) {
        const target = table.Borders?.Item(b.side)
        if (!target) reject(['Table.Borders'])
        borders.push({ target, ...b })
      }
      tables.push({ rows, cells, borders })
    }
  }
  const rows = []
  for (let i = 1; i <= count; i++) {
    const item = paragraphs.Item(i), r = item.Range
    if (!r?.Font || !item.Format) reject(['Paragraph.Range', 'Paragraph.Format'])
    const start = Number(r.Start)
    if (p.scope === 'document' && bounds.some(b => start >= b.start && start < b.end)) continue
    const afterTable = bounds.some(b => start === b.end)
    const numbered = Number(r.ListFormat?.ListType) > 0
    rows.push({ item, r, afterTable, numbered, level: classify(r.Text, Number(item.OutlineLevel), numbered, p.scope === 'selection' ? -1 : i - 1) })
  }
  const result = { scope: p.scope, profileName: p.profileName, styles: [], paragraphs: 0, tables: 0 }
  try {
    for (const extra of extraStyles) {
      const target = extra.target || doc.Styles.Add(extra.name, 1)
      wpsSet(target.Font, target.ParagraphFormat, extra.spec, false, false)
      result.styles.push(extra.name)
    }
    for (const { spec, target } of targets) { wpsSet(target.Font, target.ParagraphFormat, spec, false, false); result.styles.push(spec.name) }
    for (const { item, r, level, afterTable, numbered } of rows) {
      const spec = specFor(p.styles, level)
      wpsSet(r.Font, item.Format, afterTable && p.afterTable != null ? { ...spec, before: p.afterTable } : spec, level <= 0, numbered)
      result.paragraphs++
    }
    for (const table of tables) {
      for (const b of table.borders) { b.target.LineStyle = b.style; b.target.LineWidth = b.width; b.target.Color = b.color }
      for (const { row, header } of table.rows) row.HeadingFormat = header && tp.repeat ? -1 : 0
      for (const { cell, range, header, kind } of table.cells) {
        wpsSet(range.Font, range.ParagraphFormat, header ? tp.header : { ...tp.spec, alignment: tp.aligns[kind] }, !header, false)
        cell.VerticalAlignment = header ? tp.headerVertical : tp.vertical
        if (header && tp.fill != null) cell.Shading.BackgroundPatternColor = colorBgr(tp.fill)
      }
      result.tables++
    }
    return result
  } catch (error) { partial(error, result) }
}

// Call this before enabling revision tracking: a rejected profile must not even
// toggle document settings. Host object checks remain in the execution functions.
export function validateWordStyleProfile(args, host) {
  if (!['office', 'wps'].includes(host)) reject(['host'], 'fileOperationInvalidArguments')
  const p = plan(args, host)
  if (host === 'wps') tablePlan(p)
  return true
}
