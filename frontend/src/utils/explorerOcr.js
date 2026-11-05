// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Explorer right-click「识别文字（OCR）」(tutorial-series#155): pure batch logic, no UI.
// The backend (FileOcrService) owns access, consent version and billing gates; this module owns
// the per-file queue, progress, cancel-between-files, the failure summary and side-by-side opening.
import { resolveFileExtension } from './fileTreePdfActions.js'

// Must match backend ai.context.ocr-extensions (images the existing OCR route accepts + pdf).
export const OCR_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'])

export function isOcrTarget(item) {
  return !!item && !item.isFolder && OCR_EXTENSIONS.has(resolveFileExtension(item))
}

export function canOcrItems(items, viewMode = 'files') {
  return viewMode !== 'recycle' && Array.isArray(items) && items.length > 0 && items.every(isOcrTarget)
}

/** "<stem><suffix><ext>"; the server still renames on conflict ("name (1).ext"). */
export function ocrOutputName(sourceName, ext, suffix) {
  const name = String(sourceName || '').trim().replace(/[\\/]/g, '_')
  const dot = name.lastIndexOf('.')
  const stem = (dot > 0 ? name.slice(0, dot) : name) || 'file'
  return stem + suffix + ext
}

/**
 * Runs files one by one. recognize(item, {consentVersion, name, route}) resolves to the endpoint's data
 * ({status, text, file, notice, version}) or throws; a throw only fails that file unless isFatal(err).
 *
 * Phase 2 statuses: `already_searchable` (text-layer PDF, nothing generated); `local_failed` asks
 * requestCloudFallback({reason, notice, version, item}) once per batch — agreeing doubles as the
 * upload consent and retries that and later local failures with route 'cloud'; `layout_unsupported`
 * stops the batch (every further cloud file would be billed a page for nothing); `component_outdated`
 * fails the file with the server's hint.
 */
export async function runOcrBatch({ items, recognize, requestConsent = async () => false, onProgress = () => {},
  isCancelled = () => false, isFatal = () => false, nameFor = () => undefined, requestCloudFallback = null }) {
  const results = []
  let consentVersion = null
  let consentDeclined = false
  let cloudFallback = null // null = not asked yet, true/false = the user's answer for this batch
  let cancelled = false
  let fatal = null
  let stopped = null
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (cancelled || fatal || stopped || isCancelled()) {
      if (!fatal && !stopped) cancelled = true
      results.push({ item, status: 'notRun' })
      continue
    }
    onProgress({ index, total: items.length, item })
    const name = nameFor(item)
    try {
      let data = await recognize(item, { consentVersion, name })
      if (data && data.status === 'consent_required' && !consentDeclined && !isCancelled()) {
        if (await requestConsent({ notice: data.notice, version: data.version, item })) {
          consentVersion = data.version
          data = await recognize(item, { consentVersion, name })
        } else {
          consentDeclined = true
        }
      }
      if (data && data.status === 'local_failed' && requestCloudFallback && !isCancelled()) {
        const localReason = data.notice || ''
        if (cloudFallback === null) {
          cloudFallback = !!(await requestCloudFallback({ reason: localReason, notice: data.notice, version: data.version, item }))
          if (cloudFallback) consentVersion = data.version
        }
        if (cloudFallback) data = await recognize(item, { consentVersion, name, route: 'cloud' })
        else data = { status: 'failed', notice: localReason }
      }
      const status = data && data.status
      if (status === 'done') results.push({ item, status: 'done', text: data.text || '', file: data.file || null })
      else if (status === 'consent_required') results.push({ item, status: 'skipped' })
      else if (status === 'local_only') results.push({ item, status: 'failed', reason: 'localOnly' })
      else if (status === 'cancelled') { cancelled = true; results.push({ item, status: 'notRun' }) }
      else if (status === 'already_searchable') results.push({ item, status: 'alreadySearchable' })
      else if (status === 'layout_unsupported') {
        stopped = data.notice || ''
        results.push({ item, status: 'failed', error: stopped })
      } else results.push({ item, status: 'failed', error: (data && data.notice) || '' })
    } catch (error) {
      if (isFatal(error)) fatal = error
      results.push({ item, status: 'failed', error: (error && error.message) || '' })
    }
  }
  return { results, cancelled: cancelled && !fatal && !stopped, fatal, stopped }
}

export function summarizeOcrBatch(batch) {
  const pick = s => batch.results.filter(r => r.status === s)
  return {
    done: pick('done'),
    failed: pick('failed').map(r => ({ ...r, name: r.item.name })),
    skipped: pick('skipped'),
    notRun: pick('notRun'),
    alreadySearchable: pick('alreadySearchable'),
  }
}

export function joinCopiedTexts(results) {
  const parts = results.filter(r => r.status === 'done' && String(r.text || '').trim())
  if (parts.length === 1) return parts[0].text.trim()
  return parts.map(r => `【${r.item.name}】\n${r.text.trim()}`).join('\n\n')
}

/** Only the first exported Word is opened side by side; the others are listed in the summary. */
export function sideBySidePlan(batch) {
  const done = batch.results.filter(r => r.status === 'done' && r.file)
  if (!done.length) return { first: null, others: [] }
  return { first: { source: done[0].item, output: done[0].file }, others: done.slice(1).map(r => r.file.name) }
}

/** Original (PDF/image preview) on the left, recognized docx on the right. `vm` is the workbench. */
export async function openOcrSideBySide(vm, source, output) {
  vm.splitMode = true
  // openFile dedupes toward whichever pane already holds the file; a read-only preview on the right
  // would otherwise be re-activated there and the Word would land beside nothing.
  const onRight = vm.rightFiles.find(t => String(t.id) === String(source.id) && !t.tabType)
  const onLeft = vm.leftFiles.find(t => String(t.id) === String(source.id) && !t.tabType)
  if (onRight && !onLeft) vm.moveTabTo(onRight.id, 'right', 'left', null)
  vm.focusedPane = 'left'
  vm.openFile(source)
  vm.focusedPane = 'right'
  vm.openFile(output)
}
