// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseDocInsight, getDocInsight, getDocInsightEntity, refreshDocInsightEntity } from '@/services/api.js'
import * as reviews from '@/services/contractReview.js'
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const unwrap = data => data && 'code' in data && 'data' in data ? data.data : data
const OPS = ['context', 'get', 'parse', 'entity', 'refreshEntity', 'prepare', 'execute', 'entities', 'openUrl', 'openSettings', 'openHover', 'openDoc', 'standards', 'saveStandard', 'confirmStandard', 'review', 'runReview']
export function createPluginInsightServices({ projectId, permissions, isCurrent, actions, openFile, listFiles }) {
  return { async request(operation, params, signal) {
    const allowed = permission => { if (!permissions().includes(permission)) fail('permission_denied', permission + ' is required') }
    const check = () => { if (signal.aborted || !isCurrent()) fail('cancelled', 'Request cancelled') }
    check(); allowed('file_read')
    if (!projectId()) fail('no_project', 'A project is required')
    if (!OPS.includes(operation)) fail('unknown_operation', 'Unknown insight operation')
    const context = actions.insightContext()
    if (operation === 'context') return context
    const docFileId = context.docFileId
    const checkDocument = () => {
      check()
      if (!docFileId || String(actions.insightContext().docFileId) !== String(docFileId) || (params.docFileId != null && String(params.docFileId) !== String(docFileId))) fail('stale_document', 'Document changed')
    }
    checkDocument()
    if (['parse', 'refreshEntity', 'saveStandard', 'confirmStandard', 'runReview', 'prepare'].includes(operation)) {
      allowed('file_write')
      if (!context.canWrite) fail('permission_denied', 'Document is read only')
    }
    if (['parse', 'refreshEntity', 'runReview'].includes(operation)) {
      allowed('network')
      if (!await actions.prepareInsight(docFileId)) fail('save_required', 'Save this document before continuing')
      checkDocument()
    }
    if (operation === 'prepare') return actions.prepareInsight(docFileId)
    if (operation === 'get') return getDocInsight(projectId(), docFileId)
    if (operation === 'parse') return parseDocInsight(projectId(), docFileId)
    if (operation === 'entity' || operation === 'refreshEntity') {
      const data = unwrap(await getDocInsight(projectId(), docFileId))
      checkDocument()
      const entity = (data?.entities || []).find(row => String(row.id) === String(params.entityId))
      if (!entity) fail('not_found', 'Entity not found in this document')
      return operation === 'entity' ? getDocInsightEntity(projectId(), entity.id) : refreshDocInsightEntity(projectId(), entity.id)
    }
    if (operation === 'execute') {
      allowed('editor')
      const exec = actions.insightExecutor()
      if (!exec) fail('unavailable', 'Document editor unavailable')
      const input = params.params || {}
      if (params.action === 'find_navigate') return exec('find_navigate', { keyword: String(input.keyword || '').slice(0, 10000), direction: 'next' })
      if (params.action !== 'find_replace') fail('unknown_operation', 'Unsupported document action')
      allowed('file_write')
      if (!context.canWrite) fail('permission_denied', 'Document is read only')
      if (typeof input.findText !== 'string' || !input.findText || input.findText.length > 10000 || typeof input.replaceText !== 'string' || input.replaceText.length > 10000) fail('invalid_params', 'Invalid replacement')
      const found = await exec('find_navigate', { keyword: input.findText, direction: 'next' })
      checkDocument()
      if (!found?.success || !found.found || Number(found.total) !== 1) fail('ambiguous_selection', 'Replacement requires one exact match')
      return exec('find_replace', { findText: input.findText, replaceText: input.replaceText, replaceAll: true })
    }
    if (operation === 'entities') {
      // The host uses this index for editor hit-testing; reload authoritative
      // entities instead of trusting arbitrary objects from the iframe.
      const data = unwrap(await getDocInsight(projectId(), docFileId)); checkDocument()
      actions.insightEntities({ docFileId, entities: data?.entities || [] }); return { updated: true }
    }
    if (operation === 'openUrl') {
      let url; try { url = new URL(params.url) } catch { fail('invalid_params', 'Invalid URL') }
      if (!['https:', 'http:'].includes(url.protocol)) fail('invalid_params', 'Unsupported URL')
      actions.openBrowser(url.href); return { opened: true }
    }
    if (operation === 'openSettings') { actions.openAccount(); return { opened: true } }
    if (operation === 'openHover') {
      const data = unwrap(await getDocInsight(projectId(), docFileId)); checkDocument()
      const entity = (data?.entities || []).find(row => String(row.id) === String(params.payload?.entity?.id))
      if (!entity) fail('not_found', 'Entity not found in this document')
      const x = Number(params.payload?.x), y = Number(params.payload?.y)
      actions.insightHover({ entity, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 }); return { opened: true }
    }
    if (operation === 'openDoc') {
      const file = (await listFiles()).find(file => String(file.id) === String(params.fileId)); checkDocument()
      if (!file) fail('not_found', 'File not found in this project')
      openFile(file); return { opened: true }
    }
    if (operation === 'standards') return reviews.listReviewStandards(projectId())
    if (operation === 'review') return reviews.getContractReview(projectId(), docFileId)
    if (operation === 'runReview') return reviews.runContractReview(projectId(), { docFileId, standardId: params.standardId, version: params.version })
    const standards = await reviews.listReviewStandards(projectId()); checkDocument()
    if (params.id && !(standards || []).some(row => String(row.id) === String(params.id))) fail('not_found', 'Review standard not found')
    if (operation === 'confirmStandard') return reviews.confirmReviewStandard(projectId(), params.id, params.version)
    if (JSON.stringify(params).length > 100000) fail('invalid_params', 'Review standard is too large')
    return reviews.saveReviewStandard(projectId(), { id: params.id, expectedVersion: params.expectedVersion, name: params.name, position: params.position, jurisdiction: params.jurisdiction, rules: params.rules })
  } }
}
