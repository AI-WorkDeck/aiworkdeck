// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  authoritative,
  caseRecognition,
  caseRecord,
  companyRows,
  lawArticle,
  resultRecords,
  retrievalSourceLabel,
  unwrapResult,
} from './insightDetail.js'

const ERROR_STATUSES = new Set(['ERROR', 'FAILED', 'NOT_FOUND', 'UNAVAILABLE'])

function parseDetail(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function pick(record, keys) {
  if (!record || typeof record !== 'object') return ''
  for (const key of keys) {
    const value = record[key]
    if (value != null && typeof value !== 'object' && String(value).trim()) {
      const s = String(value).trim()
      const mdLink = /^\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/u.exec(s)
      return mdLink ? mdLink[1] : s
    }
  }
  return ''
}

function isEnLang() {
  try {
    const l = (typeof localStorage !== 'undefined' && localStorage.getItem('checkba_app_language'))
      || (typeof document !== 'undefined' && document.documentElement?.lang)
      || ''
    if (l && !l.startsWith('zh')) return true
  } catch (_) { /* ignore */ }
  return false
}

/**
 * 查询日期写进文书用本地化日期（中文「2026年11月4日」），不写 ISO 时间戳（教程反馈 107）。
 * 只取后端时间串的年月日部分，不经时区换算：fetchedAt 是服务端本地时间。
 */
export function formatQueryDate(value, locale = '') {
  if (value == null || value === '') return ''
  const s = String(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return s
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  try {
    return new Intl.DateTimeFormat(locale || (isEnLang() ? 'en-US' : 'zh-CN'), { year: 'numeric', month: 'long', day: 'numeric' }).format(day)
  } catch {
    return `${m[1]}-${m[2]}-${m[3]}`
  }
}

// 来源 / 日期行与工商表题走宿主语言包（editor.writingAssist.*）；没有 translate 时
// （纯函数单测）按界面语言给中文或英文，中文界面不再写「来源 / Source」（教程反馈 45）。
function textFor(translate) {
  if (typeof translate === 'function') {
    return (key, params) => translate(`editor.writingAssist.${key}`, params)
  }
  const en = isEnLang()
  const fallback = en
    ? { sourceLine: 'Source: {source}', dateLine: 'Queried on: {date}', companyTable: 'Business registration information (Source: {source}; queried on {date})', companyTableNoDate: 'Business registration information (Source: {source})', replaceFullName: 'Replace with full legal name only: {name}' }
    : { sourceLine: '来源：{source}', dateLine: '查询日期：{date}', companyTable: '工商登记信息（来源：{source}，查询日期：{date}）', companyTableNoDate: '工商登记信息（来源：{source}）', replaceFullName: '仅替换为正确全称：{name}' }
  return (key, params = {}) => fallback[key].replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '')
}

function insertionText(content, meta) {
  if (!content) return undefined
  const footer = [
    meta.source ? meta.text('sourceLine', { source: meta.source }) : '',
    meta.date ? meta.text('dateLine', { date: meta.date }) : '',
  ].filter(Boolean)
  return footer.length ? `${content}\n\n${footer.join('\n')}` : content
}

function citationText(lines, content, meta) {
  if (!content) return undefined
  return insertionText(`${lines.filter(Boolean).join('\n')}\n\n${content}`, meta)
}

function recordDetails(detail) {
  return resultRecords(unwrapResult(detail)).records
}

function lawVariants(detail, meta, fallbackTitle) {
  const en = isEnLang()
  const rawRecords = recordDetails(detail)
  if (!rawRecords.length) {
    const law = lawArticle(detail)
    if (!law.content) return []
    const title = [law.title, law.article].filter(Boolean).join(' ') || fallbackTitle
    return [{
      title,
      text: citationText([law.title || fallbackTitle, law.article], law.content, meta),
    }]
  }
  const activeIdx = rawRecords.findIndex((r) => lawArticle({ result: r }).timeliness.includes('现行有效'))
  const records = activeIdx > 0
    ? [rawRecords[activeIdx], ...rawRecords.slice(0, activeIdx), ...rawRecords.slice(activeIdx + 1)]
    : rawRecords
  return records.map((record) => {
    const law = lawArticle({ result: record })
    const url = pick(record, ['url', 'Url', 'link', '链接'])
    const title = [law.title, law.article].filter(Boolean).join(' ') || law.title || law.article
    return {
      title,
      ...(law.content ? { text: citationText([
        law.title,
        law.article,
        law.timeliness ? (en ? `Validity: ${law.timeliness}` : `时效性：${law.timeliness}`) : '',
        url ? (en ? `URL: ${url}` : `URL：${url}`) : '',
      ], law.content, meta) } : {}),
    }
  }).filter((variant) => variant.text)
}

function caseVariants(detail, meta, fallbackTitle) {
  const en = isEnLang()
  const records = recordDetails(detail)
  if (!records.length) {
    const item = caseRecord(detail)
    const content = item.sections.map((section) => section.text).filter(Boolean).join('\n\n')
    if (!content) return []
    const title = item.title || item.caseNumber || fallbackTitle
    return [{
      title,
      text: citationText([
        item.title || fallbackTitle,
        item.caseNumber ? (en ? `Case No.: ${item.caseNumber}` : `案号：${item.caseNumber}`) : '',
        item.court ? (en ? `Court: ${item.court}` : `法院：${item.court}`) : '',
        item.date ? (en ? `Decision Date: ${item.date}` : `裁判日期：${item.date}`) : '',
      ], content, meta),
    }]
  }
  return records.map((record) => {
    const item = caseRecord({ result: record })
    const content = item.sections.map((section) => section.text).filter(Boolean).join('\n\n')
    const url = pick(record, ['url', 'Url', 'link', '链接'])
    return {
      title: item.title || item.caseNumber,
      ...(content ? { text: citationText([
        item.title,
        item.caseNumber ? (en ? `Case No.: ${item.caseNumber}` : `案号：${item.caseNumber}`) : '',
        item.court ? (en ? `Court: ${item.court}` : `法院：${item.court}`) : '',
        item.date ? (en ? `Decision Date: ${item.date}` : `裁判日期：${item.date}`) : '',
        url ? (en ? `URL: ${url}` : `URL：${url}`) : '',
      ], content, meta) } : {}),
    }
  }).filter((variant) => variant.text)
}

function authoritativeVariant(detail, meta) {
  const en = isEnLang()
  const item = authoritative(detail)
  if (!item) return null
  return {
    title: item.title,
    ...(item.text ? { text: citationText([
      item.title,
      item.date ? (en ? `Effective Date: ${item.date}` : `实施日期：${item.date}`) : '',
      item.url ? (en ? `URL: ${item.url}` : `URL：${item.url}`) : '',
    ], item.text, meta) } : {}),
  }
}

function recognitionNote(detail) {
  const item = caseRecognition(detail)
  if (!item) return ''
  return [item.title, item.caseNumber, item.court, item.url].filter(Boolean).join(' / ')
}

/**
 * translate / locale 由宿主注入（LibreOfficeEditor → writingAssistanceHost）：来源内部名
 * （pkulaw-semantic / qichacha+mcp）映射成用户名称，日期按界面语言本地化。
 */
export function completionDetails(entityView, { translate = null, locale = '' } = {}) {
  const entity = entityView && typeof entityView === 'object' ? entityView : {}
  const detail = parseDetail(entity.detail)
  const rawSource = entity.retrievalSource || (detail && typeof detail.source === 'string' ? detail.source : '')
  const source = retrievalSourceLabel(rawSource, translate)
  const date = formatQueryDate(entity.fetchedAt, locale)
  const text = textFor(translate)
  const meta = { source, date, text }
  const note = entity.retrievalNote == null ? '' : String(entity.retrievalNote)
  // Configuration-class failures carry a structured reason code (dev-board#458). The card
  // decides its next step from this code only: the note is bilingual, so matching Chinese
  // substrings would break the moment the English build ships.
  const hint = entity.retrievalHint == null ? '' : String(entity.retrievalHint)
  const base = { title: entity.name == null ? '' : String(entity.name), source, date, note, ...(hint ? { hint } : {}), variants: [] }
  if (!detail) return base

  const failed = ERROR_STATUSES.has(String(entity.retrievalStatus || '').toUpperCase())
  if (entity.kind === 'COMPANY') {
    if (!failed) {
      const rows = companyRows(detail)
      const matchedName = String(detail.matchedName || detail.basic?.['企业名称'] || '').trim()
      const queriedName = String(detail.queriedName || base.title || '').trim()
      const fuzzy = Boolean(
        detail.fuzzyMatched ||
        (rawSource === 'qichacha+mcp' && matchedName && queriedName && matchedName !== queriedName)
      )
      const en = isEnLang()
      if (fuzzy && matchedName && !base.note) {
        base.note = en
          ? `Fuzzy match note: No exact match for "${queriedName}". Matched "${matchedName}" instead; please verify the company name in the document.`
          : `模糊匹配提示：未精准命中「${queriedName}」，已为您匹配「${matchedName}」，正文中的企业名称可能书写有误，请核对。`
      }
      if (rows.length) {
        // 工商表写进文书要带出处：表前一行表题（教程反馈 46）。
        const caption = source ? text(date ? 'companyTable' : 'companyTableNoDate', { source, date }) : ''
        base.variants.push({
          title: fuzzy && matchedName ? (en ? `${matchedName} (Registration Profile)` : `${matchedName}（工商信息表）`) : base.title,
          ...(caption ? { text: caption } : {}),
          rows: rows.map(({ label, value }) => [label, value]),
        })
      }
      if (fuzzy && matchedName) {
        // 真替换选区（教程反馈 43）：客体按 mode 让引擎先删选区再写入，同一撤销步骤。
        base.variants.push({
          title: text('replaceFullName', { name: matchedName }),
          text: matchedName,
          mode: 'replace-selection',
        })
      }
    }
  } else if (entity.kind === 'LAW' || entity.kind === 'ARTICLE') {
    if (!failed) {
      base.variants.push(...lawVariants(detail, meta, base.title))
    }
    const authority = authoritativeVariant(detail, meta)
    if (authority?.text) base.variants.push(authority)
  } else if (entity.kind === 'CASE') {
    if (!failed) {
      base.variants.push(...caseVariants(detail, meta, base.title))
    }
    const recognition = recognitionNote(detail)
    if (recognition) base.note = [base.note, recognition].filter(Boolean).join('\n')
  }
  return base
}
