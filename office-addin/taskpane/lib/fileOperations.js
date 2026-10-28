// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from './i18n.js'
import { createProjectFile, uploadFileBytes } from './api.js'

export const FILE_OPERATION_COMMANDS = Object.freeze(['file_create', 'file_open', 'file_save', 'file_export_pdf'])
export const FILE_MAX_BYTES = 50 * 1024 * 1024
const fail = key => { throw new Error(t(key)) }
function requireApi(env, set, version) {
  if (!env.Office?.context?.requirements?.isSetSupported(set, version)) fail('fileOperationUnavailable')
}
function current(env) { return env.readIdentity ? env.readIdentity() : env.identity }
function assertIdentity(env, source) {
  if (!source?.key || current(env)?.key !== source.key) fail('fileOperationStale')
}
function pdfBytes(value) {
  let bytes
  if (typeof value === 'string') bytes = Uint8Array.from(value, c => c.charCodeAt(0) & 255)
  else if (value instanceof Uint8Array) bytes = value
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
  else if (Array.isArray(value)) bytes = Uint8Array.from(value)
  else fail('fileOperationInvalidBytes')
  if (bytes.length < 5 || bytes.length > FILE_MAX_BYTES || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') fail('fileOperationInvalidBytes')
  return bytes
}
function officeResult(Office, run) {
  return new Promise((resolve, reject) => {
    run(result => result?.status === Office.AsyncResultStatus.Succeeded
      ? resolve(result.value) : reject(new Error(result?.error?.message || t('fileOperationUnavailable'))))
  })
}
async function officePdf(env, source) {
  const O = env.Office
  requireApi(env, 'PdfFile', '1.1')
  const platform = String(O.context.platform || '').toLowerCase()
  if (platform === 'officeonline' && env.host !== 'excel') fail('fileOperationUnavailable')
  if (platform === 'ipad' && env.host === 'excel') fail('fileOperationUnavailable')
  assertIdentity(env, source)
  const file = await officeResult(O, cb => O.context.document.getFileAsync(O.FileType.Pdf,
    { sliceSize: platform === 'ipad' ? 65536 : 4194304 }, cb))
  try {
    if (!Number.isInteger(file.size) || file.size < 5 || file.size > FILE_MAX_BYTES || !Number.isInteger(file.sliceCount) || file.sliceCount < 1) fail('fileOperationInvalidBytes')
    assertIdentity(env, source)
    const chunks = []; let size = 0
    for (let i = 0; i < file.sliceCount; i++) {
      assertIdentity(env, source)
      const slice = await officeResult(O, cb => file.getSliceAsync(i, cb))
      const data = slice?.data
      if (!(data instanceof Uint8Array) && !Array.isArray(data) && !(data instanceof ArrayBuffer)) fail('fileOperationInvalidBytes')
      const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data)
      size += bytes.length
      if (size > file.size || size > FILE_MAX_BYTES) fail('fileOperationInvalidBytes')
      chunks.push(bytes)
    }
    if (size !== file.size) fail('fileOperationInvalidBytes')
    const result = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
    return pdfBytes(result)
  } finally { await new Promise(resolve => { try { file.closeAsync(() => resolve()) } catch { resolve() } }) }
}
function wpsDocument(env) {
  const app = env.application
  const doc = env.host === 'word' ? app?.ActiveDocument : env.host === 'excel' ? app?.ActiveWorkbook : app?.ActivePresentation
  if (!doc) fail('fileOperationUnavailable')
  return doc
}
function wpsPdf(env) {
  const app = env.application, doc = wpsDocument(env), fs = app.FileSystem
  if (typeof doc.ExportAsFixedFormat !== 'function' || typeof app.Env?.GetTempPath !== 'function' || typeof fs?.readAsBinaryString !== 'function' || typeof fs?.Remove !== 'function') fail('fileOperationUnavailable')
  const folder = app.Env.GetTempPath()
  if (!folder || typeof globalThis.crypto?.randomUUID !== 'function') fail('fileOperationUnavailable')
  const path = String(folder).replace(/[\\/]?$/, '/') + 'aiworkdeck-' + globalThis.crypto.randomUUID() + '.pdf'
  try {
    if (env.host === 'excel') doc.ExportAsFixedFormat(0, path)
    else if (env.host === 'word') doc.ExportAsFixedFormat(path, 17)
    else doc.ExportAsFixedFormat(path, 2, undefined, undefined, undefined, undefined, undefined, null)
    return pdfBytes(fs.readAsBinaryString(path))
  } finally { try { fs.Remove(path) } catch { /* Export outcome is independent of temporary-file cleanup. */ } }
}

/** env is supplied by the host bridge: no hostBridge import (it imports executors). */
export async function executeFileOperation(command, args = {}, env = {}) {
  if (!['word', 'excel', 'powerpoint'].includes(env.host) || !['office', 'wps'].includes(env.family)) fail('fileOperationUnavailable')
  const sourceIdentity = { ...current(env) }
  if (args.expectedDocumentKey != null && String(args.expectedDocumentKey) !== sourceIdentity?.key) fail('fileOperationStale')
  if (!sourceIdentity?.key) fail('fileOperationStale')
  assertIdentity(env, sourceIdentity)
  if (command === 'file_open') {
    if (args.host != null && args.host !== env.host) fail('fileOperationUnavailable')
    if (args.base64 == null) {
      if (typeof args.path !== 'string' || !args.path.trim() || /[\x00-\x1f]/.test(args.path)) fail('fileOperationInvalidArguments')
      if (env.family === 'wps') {
        const collection = env.host === 'word' ? env.application?.Documents : env.host === 'excel' ? env.application?.Workbooks : env.application?.Presentations
        if (typeof collection?.Open !== 'function') fail('fileOperationUnavailable')
        collection.Open(args.path)
      } else if (env.host === 'word') {
        requireApi(env, 'WordApi', '1.6')
        await env.Word.run(async context => { assertIdentity(env, sourceIdentity); context.application.openDocument(args.path); await context.sync() })
      } else fail('fileOperationUnavailable')
      return { opened: true, openedAs: 'original', sourceIdentity, requiresSessionRebind: true, destination: 'host' }
    }
    if (args.path != null || typeof args.base64 !== 'string' || !args.base64 || args.base64.length > Math.ceil(FILE_MAX_BYTES / 3) * 4) fail('fileOperationInvalidArguments')
    let binary
    try { binary = atob(args.base64) } catch { fail('fileOperationInvalidBytes') }
    if (!binary.startsWith('PK\x03\x04') || binary.length > FILE_MAX_BYTES) fail('fileOperationInvalidBytes')
    if (env.family === 'wps') {
      const app = env.application, fs = app?.FileSystem
      const collection = env.host === 'word' ? app?.Documents : env.host === 'excel' ? app?.Workbooks : app?.Presentations
      if (typeof collection?.Open !== 'function' || typeof app?.Env?.GetTempPath !== 'function' || typeof fs?.writeAsBinaryString !== 'function' || typeof fs?.readAsBinaryString !== 'function' || typeof fs?.Remove !== 'function' || typeof globalThis.crypto?.randomUUID !== 'function') fail('fileOperationUnavailable')
      const folder = app.Env.GetTempPath()
      if (!folder) fail('fileOperationUnavailable')
      const extension = env.host === 'word' ? 'docx' : env.host === 'excel' ? 'xlsx' : 'pptx'
      const path = String(folder).replace(/[\\/]?$/, '/') + 'aiworkdeck-' + globalThis.crypto.randomUUID() + '.' + extension
      let opened = false
      try {
        fs.writeAsBinaryString(path, binary)
        if (fs.readAsBinaryString(path) !== binary) fail('fileOperationInvalidBytes')
        assertIdentity(env, sourceIdentity)
        collection.Open(path)
        opened = true
      } finally {
        // A successfully opened file must remain available for lazy host reads.
        if (!opened) { try { fs.Remove(path) } catch { /* Preserve original open/write error. */ } }
      }
      return { opened: true, openedAs: 'copy', sourceIdentity, requiresSessionRebind: true,
        destination: 'host', temporary: true, requiresSaveAs: true, temporaryPath: path }
    }
    if (env.host === 'word') {
      requireApi(env, 'WordApi', '1.3')
      await env.Word.run(async context => { assertIdentity(env, sourceIdentity); context.application.createDocument(args.base64).open(); await context.sync() })
    } else if (env.host === 'excel') {
      requireApi(env, 'ExcelApi', '1.8'); await env.Excel.createWorkbook(args.base64)
    } else {
      requireApi(env, 'PowerPointApi', '1.1'); await env.PowerPoint.createPresentation(args.base64)
    }
    return { opened: true, openedAs: 'copy', sourceIdentity, requiresSessionRebind: true, destination: 'host' }
  }
  if (command === 'file_create') {
    if (args.host != null && args.host !== env.host) fail('fileOperationUnavailable')
    // This operation creates a blank document, never claims to open an existing file.
    if (args.base64 != null || args.fileId != null || args.path != null) fail('fileOperationInvalidArguments')
    if (env.family === 'wps') {
      const collection = env.host === 'word' ? env.application?.Documents : env.host === 'excel' ? env.application?.Workbooks : env.application?.Presentations
      if (typeof collection?.Add !== 'function') fail('fileOperationUnavailable')
      collection.Add()
    } else if (env.host === 'word') {
      requireApi(env, 'WordApi', '1.3')
      await env.Word.run(async context => { assertIdentity(env, sourceIdentity); context.application.createDocument().open(); await context.sync() })
    } else if (env.host === 'excel') {
      requireApi(env, 'ExcelApi', '1.8'); await env.Excel.createWorkbook()
    } else {
      requireApi(env, 'PowerPointApi', '1.1'); await env.PowerPoint.createPresentation()
    }
    return { created: true, openedAs: 'new', sourceIdentity, requiresSessionRebind: true, destination: 'host' }
  }
  if (command === 'file_save') {
    let saveIssued = false
    try {
    if (env.family === 'wps') {
      const doc = wpsDocument(env)
      if (typeof doc.Save !== 'function') fail('fileOperationUnavailable')
      if (env.host !== 'word' && (!doc.FullName || !/[\\/]/.test(doc.FullName))) fail('fileOperationUnavailable')
      saveIssued = true
      doc.Save()
      // Save can display a dialog; cancellation must not look like persistence.
      if (!(doc.Saved === true || doc.Saved === -1) || !doc.FullName || !/[\\/]/.test(doc.FullName)) fail('fileOperationUnavailable')
    } else if (env.host === 'word') {
      const firstSave = sourceIdentity?.saved !== true
      // save() alone silently assigns a default name to new documents. The
      // SaveBehavior parameter (unlike the enum) requires WordApi 1.5.
      requireApi(env, 'WordApi', firstSave ? '1.5' : '1.1')
      await env.Word.run(async context => {
        assertIdentity(env, sourceIdentity)
        saveIssued = true
        if (firstSave) context.document.save('Prompt')
        else context.document.save()
        await context.sync()
      })
    } else if (env.host === 'excel') {
      requireApi(env, 'ExcelApi', '1.11')
      await env.Excel.run(async context => { assertIdentity(env, sourceIdentity); saveIssued = true; context.workbook.save('Prompt'); await context.sync() })
    } else fail('fileOperationUnavailable')
    } catch (error) {
      // Native Word can persist a first save yet reject sync with the same
      // GeneralException used on cancellation. Never infer either outcome.
      if (saveIssued) error.partialResult = {
        operation: 'save', destination: 'host', outcomeUnknown: true, retryable: false,
        sourceIdentity, currentIdentity: current(env)
      }
      throw error
    }
    const temporary = env.family === 'wps' && /[\\/]aiworkdeck-[0-9a-f-]+\.(docx|xlsx|pptx)$/i.test(String(wpsDocument(env).FullName || ''))
    return { saved: true, destination: 'host', sourceIdentity, currentIdentity: current(env), requiresSessionRebind: true,
      ...(temporary ? { temporary: true, requiresSaveAs: true } : {}) }
  }
  if (command !== 'file_export_pdf') fail('fileOperationInvalidArguments')
  if (!env.projectId || !env.settings) fail('fileOperationInvalidArguments')
  const name = args.fileName == null ? 'document.pdf' : String(args.fileName).trim()
  if (!name || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..') fail('fileOperationInvalidArguments')
  const fileName = /\.pdf$/i.test(name) ? name : name + '.pdf'
  const bytes = env.family === 'office' ? await officePdf(env, sourceIdentity) : wpsPdf(env)
  assertIdentity(env, sourceIdentity)
  const create = env.createProjectFile || createProjectFile
  const upload = env.uploadFileBytes || uploadFileBytes
  const file = await create(env.settings, env.projectId, { name: fileName, fileType: 'pdf', size: bytes.length })
  try {
    await upload(env.settings, file.id, new Blob([bytes], { type: 'application/pdf' }), bytes.length)
  } catch (error) {
    // Existing upload API creates metadata first. Expose the incomplete record for recovery.
    error.partialResult = { fileId: file.id, fileName: file.name || fileName, uploaded: false, exported: false, destination: 'project' }; throw error
  }
  return { exported: true, fileId: file.id, fileName: file.name || fileName, byteLength: bytes.length,
    sourceIdentity, format: 'pdf', destination: 'project' }
}
