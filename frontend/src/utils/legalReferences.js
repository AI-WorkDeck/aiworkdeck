// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { unwrapResult, resultRecords, lawArticle, caseRecord, authoritative, caseRecognition } from './insightDetail.js'

import { markdownInstance } from './markdownRenderer.js'

const KINDS = new Set(['LAW', 'CASE', 'PENALTY'])
const FAILED = new Set(['ERROR', 'FAILED', 'NOT_FOUND', 'UNAVAILABLE'])
const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const pick = (obj, keys) => keys.map(key => scalar(obj?.[key])).find(Boolean) || ''
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null } }
const field = (key, value) => ({ labelKey: `legalReference.${key}`, value })
const section = (key, text) => ({ labelKey: `legalReference.${key}`, text })

export function safeLegalUrl(value) {
  const input = scalar(value).replace(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/, '$1')
  try {
    const url = new URL(input)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

// Include the evidence snapshot: two versions of one law must never overwrite each other.
export function legalReferenceId(reference) {
  const identity = JSON.stringify([reference.kind, reference.title, reference.url, reference.metadata, reference.sections, reference.status, reference.source, reference.retrievedAt, reference.note])
  let hash = 2166136261
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619)
  return `legal-reference_${reference.kind}_${(hash >>> 0).toString(36)}`
}

function finish(reference) {
  reference.metadata = reference.metadata.filter(item => item.value)
  reference.sections = reference.sections.filter(item => item.text)
  reference.id = legalReferenceId(reference)
  return reference
}

/** Trusted REST retrieval is still a source response, never an assertion of legal validity. */
export function referencesFromEntity(entity = {}) {
  const kind = entity.kind === 'ARTICLE' ? 'LAW' : entity.kind
  if (!KINDS.has(kind)) return []
  const detail = parse(entity.detail) || {}
  const source = scalar(entity.retrievalSource || detail.source)
  const base = { kind, source, retrievedAt: scalar(entity.fetchedAt), note: scalar(entity.retrievalNote) }
  if (FAILED.has(entity.retrievalStatus)) return [finish({ ...base, title: scalar(entity.name), url: '', status: 'unavailable', metadata: [], sections: [] })]
  let payload = unwrapResult(detail)
  // Common API envelopes; do not interpret arbitrary nested objects as records.
  for (let depth = 0; depth < 4 && payload && !Array.isArray(payload); depth++) {
    const nested = payload.data ?? payload.Data ?? payload.result
    if (nested && typeof nested === 'object') payload = nested
    else break
  }
  let { records, text } = resultRecords(payload)
  const recognition = caseRecognition(detail)
  const authority = authoritative(detail)
  if (recognition) records.push(recognition)
  if (authority) records.push({ title: authority.title, content: authority.text, url: authority.url, effectiveDate: authority.date })
  if (!records.length && text) records = [{ title: entity.name, content: text }]
  return records.map(record => {
    const url = safeLegalUrl(pick(record, ['url', 'Url', 'URL', 'link', 'Link', '链接', 'sourceUrl']))
    const metadata = [field('documentNumber', pick(record, ['DocumentNO', 'documentNumber', 'doc_no', 'documentNo', '文号'])),
      field(kind === 'PENALTY' ? 'penaltyAuthority' : 'authority', pick(record, ['IssueDepartment', 'issueDepartment', 'authority', '发布部门', '处罚机关'])),
      field('publishedDate', pick(record, ['IssueDate', 'issueDate', 'issue_date', '发布日期']))]
    let title = pick(record, ['title', 'Title', 'name', '标题']) || scalar(entity.name)
    let sections = []
    if (kind === 'LAW') {
      const law = lawArticle({ result: record })
      title = law.title || title
      metadata.push(field('article', law.article), field('validity', pick(record, ['timeliness', 'TimelinessDic', 'validity', '时效性'])),
        field('level', pick(record, ['EffectivenessDic', 'effectiveness', '效力级别'])),
        field('effectiveDate', pick(record, ['ImplementDate', 'implementDate', 'implement_date', 'effectiveDate', '实施日期'])))
      // lawArticle's metadata-only fallback is NOT original statutory text.
      const body = pick(record, ['content', 'text', 'articleContent', 'body', 'fullText', 'original_text', '条文内容', '正文', '内容'])
      const inline = pick(record, ['article'])
      if (body) sections.push(section('body', body))
      else if (inline && inline !== law.article) sections.push(section('body', law.content))
    } else if (kind === 'CASE') {
      const item = caseRecord({ result: record })
      title = item.title || title
      metadata.push(field('caseNumber', item.caseNumber), field('court', item.court), field('judgmentDate', item.date), field('cause', pick(record, ['cause', 'causeOfAction', '案由'])))
      const labels = { ascertain: 'facts', reason: 'reasoning', result: 'decision', gist: 'summary', fullText: 'body' }
      sections = item.sections.map(item => section(labels[item.key], item.text))
    } else {
      metadata.push(field('decisionDate', pick(record, ['date', 'decisionDate', '处罚日期'])), field('parties', pick(record, ['parties', '当事人'])))
      for (const [key, aliases] of [['facts', ['facts', '违法事实']], ['basis', ['basis', '处罚依据']], ['penalty', ['penalty', '处罚内容']], ['body', ['content', 'text', '正文']]]) {
        sections.push(section(key, pick(record, aliases)))
      }
    }
    return finish({ ...base, title, url, status: sections.some(s => s.text) ? 'retrieved' : 'metadata', metadata, sections })
  }).filter(item => item.title && (item.sections.length || item.metadata.length || item.url))
}

/** Model-authored presentation data cannot claim authentication, even with a government URL. */
export function referenceFromModel(value) {
  if (!value || typeof value !== 'object' || !KINDS.has(value.kind) || !scalar(value.title)) return null
  return finish({ kind: value.kind, title: scalar(value.title), source: scalar(value.source), url: safeLegalUrl(value.url),
    retrievedAt: '', status: 'unverified', note: '',
    metadata: [field(value.kind === 'CASE' ? 'caseNumber' : 'documentNumber', scalar(value.caseNumber || value.documentNumber)),
      field(value.kind === 'CASE' ? 'court' : value.kind === 'PENALTY' ? 'penaltyAuthority' : 'authority', scalar(value.court || value.authority)),
      ...['effectiveDate', 'validity', 'parties'].map(key => field(key, scalar(value[key]))),
      field(value.kind === 'LAW' ? 'publishedDate' : value.kind === 'CASE' ? 'judgmentDate' : 'decisionDate', scalar(value.date))],
    sections: [section('aiSummary', scalar(value.summary)), section('excerpt', scalar(value.excerpt || value.content))] })
}

/** Keep malformed/unknown blocks visible as ordinary Markdown; only consume complete valid blocks. */
export function legalMessageParts(content = '', streaming = false) {
  if (!content.includes('legal-reference')) return content ? [{ type: 'text', text: content }] : []
  const parts = []
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) || []
  const offsets = [0]
  for (const line of lines) offsets.push(offsets.at(-1) + line.length)
  let cursor = 0
  // Use the shared Markdown parser so quoted examples inside other code fences stay examples.
  for (const token of markdownInstance().parse(content, {})) {
    if (token.type !== 'fence' || token.info.trim() !== 'legal-reference' || !token.map) continue
    const [start, end] = token.map
    const closed = lines[end - 1]?.trim() === token.markup
    if (!closed) {
      if (streaming) {
        if (offsets[start] > cursor) parts.push({ type: 'text', text: content.slice(cursor, offsets[start]) })
        cursor = content.length
      }
      continue
    }
    const value = parse(token.content)
    const values = Array.isArray(value) ? value : [value]
    const references = values.map(referenceFromModel)
    if (!references.length || references.some(item => !item)) continue
    if (offsets[start] > cursor) parts.push({ type: 'text', text: content.slice(cursor, offsets[start]) })
    parts.push(...references.map(reference => ({ type: 'reference', reference })))
    cursor = offsets[end]
  }
  if (cursor < content.length) parts.push({ type: 'text', text: content.slice(cursor) })
  return parts
}

export function referencesFromTools(processes = []) {
  const found = new Map()
  for (const process of processes) for (const item of process.items || []) {
    if (item.type !== 'tool' || item.status !== 'success') continue
    const tool = /\b(law_search_keyword|law_search|law_recognition|get_law_article|case_search)\s*\(/.exec(item.code || '')?.[1]
    const result = parse(item.output)
    if (!tool || !result || result.error || result.isError) continue
    for (const reference of referencesFromEntity({ kind: tool === 'case_search' ? 'CASE' : 'LAW', retrievalStatus: 'OK', detail: { source: 'pkulaw', result } })) {
      // Legacy chat XML can also be emitted by a model. Do not promote its provenance.
      reference.status = 'unverified'
      reference.id = legalReferenceId(reference)
      found.set(reference.id, reference)
    }
  }
  return [...found.values()]
}

/** Keep presentation JSON out of copy, insert, replacement and exported documents. */
export function legalReadableText(content, translate = key => key) {
  return legalMessageParts(content).map(part => {
    if (part.type === 'text') return part.text
    const r = part.reference
    return [r.title, translate('legalReference.status.unverified'),
      ...r.metadata.map(item => `${translate(item.labelKey)}: ${item.value}`),
      ...r.sections.map(item => `${translate(item.labelKey)}\n${item.text}`),
      r.source, r.url].filter(Boolean).join('\n\n') + '\n'
  }).join('')
}
