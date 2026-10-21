// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export const CONVERTIBLE_TO_PDF_EXTENSIONS = new Set([
  'doc', 'docx',
  'ppt', 'pptx',
  'xls', 'xlsx',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
])

export const MERGEABLE_TO_PDF_EXTENSIONS = new Set([
  ...CONVERTIBLE_TO_PDF_EXTENSIONS,
  'pdf',
])

export function resolveFileExtension(item) {
  if (!item || typeof item !== 'object') return ''
  const rawType = typeof item.fileType === 'string' ? item.fileType.trim().toLowerCase() : ''
  if (rawType) return rawType
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const dot = name.lastIndexOf('.')
  if (dot > 0 && dot < name.length - 1) {
    return name.slice(dot + 1).trim().toLowerCase()
  }
  return ''
}

export function canConvertItemToPdf(item, viewMode = 'files') {
  if (viewMode === 'recycle' || !item || item.isFolder || item.readOnly) return false
  return CONVERTIBLE_TO_PDF_EXTENSIONS.has(resolveFileExtension(item))
}

export function canMergeItemsToPdf(items, viewMode = 'files') {
  if (viewMode === 'recycle' || !Array.isArray(items) || items.length < 2) return false
  return items.every((item) => item && !item.isFolder && !item.readOnly && MERGEABLE_TO_PDF_EXTENSIONS.has(resolveFileExtension(item)))
}

// A persistent recovery action reuses the normal file-open route; it never replaces an open editor's bytes.
export function pdfConversionRecoveryOptions({ error, items, t, openFile, exportFile }) {
  const office = (items || []).find(item => ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(resolveFileExtension(item)))
  const guidance = office ? t(items.length > 1 ? 'fileTree.pdfRecoveryMerge' : 'fileTree.pdfRecoveryExport') : ''
  return {
    title: t('fileTree.convertToPdfFailed'),
    content: [(error && error.message) || t('fileTree.convertToPdfFailed'), guidance].filter(Boolean).join('\n\n'),
    showCancel: !!office,
    confirmText: t(office ? (items.length === 1 ? 'fileTree.pdfExportBuiltIn' : 'fileTree.pdfOpenEditor') : 'common.confirm'),
    cancelText: t('common.cancel'),
    success: result => {
      if (result.confirm && office) {
        if (items.length === 1) exportFile(office)
        else openFile(office)
      }
    },
  }
}
