// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export const MARK_OPTIONS = [
  { key: 'paragraphMarks', label: 'paragraphMarks' },
  { key: 'lineBreaks', label: 'lineBreaks' },
  { key: 'spaces', label: 'spaces' },
  { key: 'tabs', label: 'tabs' },
]
const MARK_DEFAULTS = Object.fromEntries(MARK_OPTIONS.map(o => [o.key, true]))
const VIEW_PREFS_KEY = 'awd_editor_view_prefs'
// 格式标记（¶ 等）默认隐藏：律师打开文档看到的应是成稿样子，需要时从工具栏「¶⌄」打开。
const VIEW_PREFS_DEFAULT = { formattingMarks: false, ruler: true, ...MARK_DEFAULTS }

export function readViewPrefs() {
  try {
    const v = uni.getStorageSync(VIEW_PREFS_KEY)
    const o = typeof v === 'string' && v ? JSON.parse(v) : (v && typeof v === 'object' ? v : {})
    return Object.assign({}, VIEW_PREFS_DEFAULT, o)
  } catch (e) { return Object.assign({}, VIEW_PREFS_DEFAULT) }
}
export function writeViewPrefs(p) { uni.setStorageSync(VIEW_PREFS_KEY, JSON.stringify(p)) }
export function getWriterViewOptions(prefs = readViewPrefs()) {
  // Keep the toolbar request identical for native initialization and later updates.
  return { ...prefs, formattingMarks: !!prefs.formattingMarks, ruler: !!prefs.ruler, textBoundaries: false }
}
