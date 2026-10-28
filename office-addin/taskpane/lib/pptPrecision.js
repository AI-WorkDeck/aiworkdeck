// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from './i18n.js'

export function pptTarget(args, requireShape = true) {
  const slideNumber = Number(args.slideNumber)
  const shapeId = args.shapeId == null ? '' : String(args.shapeId)
  if (!Number.isInteger(slideNumber) || slideNumber < 1 || (requireShape && !shapeId)) throw new Error(t('pptInvalidTarget'))
  return { slideNumber, shapeId }
}
export function pptExpected(text, args) {
  if (args.expectedText != null && String(args.expectedText) !== text) throw new Error(t('pptStaleTarget'))
}
export function pptGeometry(args) {
  const result = {}
  for (const key of ['left', 'top', 'width', 'height', 'rotation']) {
    if (args[key] == null) continue
    const value = Number(args[key])
    if (!Number.isFinite(value) || ((key === 'width' || key === 'height') && value <= 0)) throw new Error(t('pptInvalidArguments'))
    result[key] = value
  }
  if (!Object.keys(result).length) throw new Error(t('pptInvalidArguments'))
  return result
}
export function pptShapeStyle(args) {
  const result = {}
  for (const key of ['fillColor', 'lineColor']) if (args[key] != null) {
    if (!/^#[0-9a-f]{6}$/i.test(args[key])) throw new Error(t('pptInvalidArguments'))
    result[key] = args[key]
  }
  if (args.lineWidth != null) {
    if (!Number.isFinite(Number(args.lineWidth)) || Number(args.lineWidth) < 0) throw new Error(t('pptInvalidArguments'))
    result.lineWidth = Number(args.lineWidth)
  }
  if (args.transparency != null) {
    const value = Number(args.transparency)
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(t('pptInvalidArguments'))
    result.transparency = value
  }
  if (args.noFill === false && args.fillColor == null) throw new Error(t('pptInvalidArguments'))
  for (const key of ['noFill', 'noLine']) if (args[key] != null) {
    if (typeof args[key] !== 'boolean') throw new Error(t('pptInvalidArguments'))
    result[key] = args[key]
  }
  if (!Object.keys(result).length) throw new Error(t('pptInvalidArguments'))
  return result
}
export async function officePptShape(context, args) {
  const { slideNumber, shapeId } = pptTarget(args)
  const slides = context.presentation.slides
  slides.load('items')
  await context.sync()
  if (slideNumber > slides.items.length) throw new Error(t('pptInvalidTarget'))
  const shapes = slides.items[slideNumber - 1].shapes
  shapes.load('items/id')
  await context.sync()
  const found = shapes.items.filter(shape => String(shape.id) === shapeId)
  if (found.length !== 1) throw new Error(t('pptInvalidTarget'))
  return found[0]
}
export function wpsPptShape(presentation, args) {
  const { slideNumber, shapeId } = pptTarget(args)
  if (slideNumber > presentation.Slides.Count) throw new Error(t('pptInvalidTarget'))
  const shapes = presentation.Slides.Item(slideNumber).Shapes
  const found = []
  for (let i = 1; i <= shapes.Count; i++) { const shape = shapes.Item(i); if (String(shape.Id) === shapeId) found.push(shape) }
  if (found.length !== 1) throw new Error(t('pptInvalidTarget'))
  return found[0]
}

/** Table coordinates are zero-based on every host; dimensions use points. */
export function pptTableStyle(args, rows, cols) {
  const invalid = () => { throw new Error(t('pptInvalidArguments')) }
  const row = args.row == null ? 0 : Number(args.row), col = args.col == null ? 0 : Number(args.col)
  const endRow = args.endRow == null ? (args.row == null ? rows - 1 : row) : Number(args.endRow)
  const endCol = args.endCol == null ? (args.col == null ? cols - 1 : col) : Number(args.endCol)
  if (![row, col, endRow, endCol].every(Number.isInteger) || row < 0 || col < 0 || endRow < row || endCol < col || endRow >= rows || endCol >= cols) invalid()
  const style = {}
  for (const key of ['color', 'fillColor', 'borderColor', 'headerFill']) if (args[key] != null) {
    if (!(key === 'headerFill' && args[key] === 'none') && !/^#[0-9a-f]{6}$/i.test(args[key])) invalid()
    style[key] = args[key]
  }
  for (const key of ['bold', 'headerBold']) if (args[key] != null) {
    if (typeof args[key] !== 'boolean') invalid()
    style[key] = args[key]
  }
  for (const key of ['fontSize', 'borderWidthPt']) if (args[key] != null) {
    const value = Number(args[key]); if (!Number.isFinite(value) || (key === 'fontSize' ? value <= 0 : value < 0)) invalid()
    style[key] = value
  }
  if (args.fontName != null) { if (!String(args.fontName).trim()) invalid(); style.fontName = String(args.fontName) }
  if (args.alignment != null) { if (!['left', 'center', 'right', 'justify'].includes(args.alignment)) invalid(); style.alignment = args.alignment }
  for (const [key, count] of [['columnWidthsPt', cols], ['rowHeightsPt', rows]]) if (args[key] != null) {
    if (!Array.isArray(args[key]) || !args[key].length || args[key].length > count || args[key].some(v => v == null || !Number.isFinite(Number(v)) || Number(v) <= 0)) invalid()
    style[key] = args[key].map(Number)
  }
  if (!Object.keys(style).length) invalid()
  return { row, col, endRow, endCol, style }
}

/** Notes may contain slide images/page numbers; only the body placeholder is editable. */
export function wpsNotesBody(slide) {
  const placeholders = slide.NotesPage?.Shapes?.Placeholders
  if (!placeholders) throw new Error(t('pptCapabilityUnavailable'))
  const bodies = []
  for (let i = 1; i <= placeholders.Count; i++) {
    const shape = placeholders.Item(i)
    if (Number(shape.PlaceholderFormat.Type) === 2) bodies.push(shape)
  }
  if (bodies.length !== 1 || !bodies[0].TextFrame?.TextRange) throw new Error(t('pptInvalidTarget'))
  return bodies[0].TextFrame.TextRange
}

// Validate the entire paragraph request before any character formatting is applied.
export function pptParagraphFormat(raw, family) {
  if (raw == null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(t('pptInvalidArguments'))
  const result = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    if (key === 'alignment') {
      if (!['left', 'center', 'right', 'justify'].includes(value)) throw new Error(t('pptInvalidArguments'))
      result[key] = value
    } else if (['spaceBeforePt', 'spaceAfterPt', 'spaceBeforeLines', 'spaceAfterLines', 'lineSpacingValue'].includes(key)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(t('pptInvalidArguments'))
      result[key] = value
    } else if (key === 'lineSpacingMode') {
      if (!['single', '1.5', 'double', 'multiple', 'proportional', 'exactly'].includes(value)) throw new Error(t('pptCapabilityUnavailable'))
      result[key] = value
    } else throw new Error(t('pptCapabilityUnavailable'))
  }
  if (family === 'office' && Object.keys(result).some(key => key !== 'alignment')) throw new Error(t('pptCapabilityUnavailable'))
  if (result.lineSpacingValue != null && result.lineSpacingMode == null) throw new Error(t('pptInvalidArguments'))
  if (['multiple', 'proportional', 'exactly'].includes(result.lineSpacingMode) && !(result.lineSpacingValue > 0)) throw new Error(t('pptInvalidArguments'))
  return result
}
export function applyWpsParagraphFormat(target, format) {
  if (format.alignment) target.Alignment = { left: 1, center: 2, right: 3, justify: 4 }[format.alignment]
  for (const suffix of ['Before', 'After']) {
    const points = format[`space${suffix}Pt`], lines = format[`space${suffix}Lines`]
    if (points != null || lines != null) {
      target[`LineRule${suffix}`] = points != null ? 0 : -1
      target[`Space${suffix}`] = points ?? lines
    }
  }
  if (format.lineSpacingMode != null) {
    target.LineRuleWithin = format.lineSpacingMode === 'exactly' ? 0 : -1
    target.SpaceWithin = { single: 1, '1.5': 1.5, double: 2 }[format.lineSpacingMode]
      ?? (format.lineSpacingMode === 'proportional' ? format.lineSpacingValue / 100 : format.lineSpacingValue)
  }
}
