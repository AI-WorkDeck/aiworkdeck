// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { EVIDENCE_METHODS } from './evidenceLocator.js'
import { getCurrentUser } from './auth.js'

export const EVIDENCE_TAGS_CHANGED = 'awd:evidence-tags-changed'
export const MAX_EVIDENCE_TAGS = 12
export const MAX_EVIDENCE_TAG_LENGTH = 32
export const EVIDENCE_TAG_PRESETS = ['verification', 'evidence', 'contract']

// Built-in keys remain stable for existing links and automated verification.
// Custom labels travel with each target, so another user/device can display them.
export function evidenceTagLabel(value, t) {
  if (!value) return t('evidence.method.none')
  return EVIDENCE_METHODS.includes(value) ? t('workbench.evidence.method.' + value) : value
}

export function evidenceTagPreset(name, t) {
  if (name === 'verification') return [...EVIDENCE_METHODS]
  return [0, 1, 2, 3, 4].map(i => t(`workbench.evidence.tags.${name}${i}`))
}

export function normalizeEvidenceTags(values) {
  if (!Array.isArray(values) || values.length > MAX_EVIDENCE_TAGS) throw new Error('tooMany')
  if (values.some(value => typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(value))) throw new Error('invalid')
  const tags = values.map(value => value.trim())
  if (tags.some(value => !value || value.length > MAX_EVIDENCE_TAG_LENGTH)) throw new Error('invalid')
  if (new Set(tags).size !== tags.length) throw new Error('duplicate')
  return tags
}

export function evidenceTagsFromLabels(labels, t) {
  const tags = normalizeEvidenceTags(labels)
  return normalizeEvidenceTags(tags.map(label => EVIDENCE_METHODS.find(key => evidenceTagLabel(key, t) === label) || label))
}

function storageKey() {
  return 'awd_evidence_tags_v1:' + (getCurrentUser()?.id || 'local')
}

// 没有偏好时的默认组跟着当前项目类型走（教程反馈 77，dev-board#1713）：资本市场与并购
// 尽调类项目用「材料核查」组，其余（空白项目、打开文件夹、草稿区、取不到类型）用「证据整理」组。
// 工作台在项目信息到位时写入；标签选择器与拖放建链都经 loadEvidenceTags 读同一份。
const DUE_DILIGENCE_PROJECT_TYPES = new Set(['MAJOR_ASSET_RESTRUCTURING', 'PRIVATE_PLACEMENT', 'PUBLIC_PLACEMENT', 'ACQUISITION'])
let currentProjectType = null
export function setEvidenceProjectType(projectType) {
  currentProjectType = projectType ? String(projectType) : null
}

/** t 缺省时（纯函数调用方拿不到语言包）只能给内置「材料核查」组。 */
export function loadEvidenceTags(t) {
  try {
    const raw = uni.getStorageSync(storageKey())
    if (raw) return normalizeEvidenceTags(JSON.parse(raw))
  } catch (_) { /* Absent/invalid local preferences fall back to the built-ins. */ }
  if (typeof t === 'function' && !DUE_DILIGENCE_PROJECT_TYPES.has(currentProjectType)) return evidenceTagPreset('evidence', t)
  return [...EVIDENCE_METHODS]
}

export function saveEvidenceTags(tags) {
  const normalized = normalizeEvidenceTags(tags)
  uni.setStorageSync(storageKey(), JSON.stringify(normalized))
  uni.$emit(EVIDENCE_TAGS_CHANGED)
  return normalized
}
