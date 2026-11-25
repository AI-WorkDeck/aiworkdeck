// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fonts served next to editor.html (baked by desktop/scripts/fetch-lowa-assets.js), one per typeface
// category. family = the name LibreOffice registers; the boot's fontconfig alias rules point 宋体/黑体/
// 楷体/仿宋/… at these. bootZetaOffice skips any that 404.
export const BUNDLED_FONTS = Object.freeze([
  { url: './cjk.ttc', family: 'Noto Sans SC', category: 'sans' },
  { url: './cjk-serif.otf', family: 'Noto Serif SC', category: 'serif' },
  { url: './cjk-kai.ttf', family: '霞鹜文楷', category: 'kai' },
  { url: './cjk-fangsong.ttf', family: '朱雀仿宋（预览测试版）', category: 'fangsong' },
  // 多语种字体（dev-board#1478）：韩文无衬线/衬线、泰语无衬线/衬线及东南亚/CTL 主流文字
  { url: './cjk-kr.otf', family: 'Noto Sans KR', category: 'kr' },
  { url: './cjk-kr-serif.otf', family: 'Noto Serif KR', category: 'kr-serif' },
  { url: './cjk-thai.ttf', family: 'Noto Sans Thai', category: 'thai' },
  { url: './cjk-thai-serif.ttf', family: 'Noto Serif Thai', category: 'thai-serif' },
  { url: './cjk-khmer.ttf', family: 'Noto Sans Khmer', category: 'khmer' },
  { url: './cjk-lao.ttf', family: 'Noto Sans Lao', category: 'lao' },
  { url: './cjk-myanmar.ttf', family: 'Noto Sans Myanmar', category: 'myanmar' },
  { url: './cjk-arabic.ttf', family: 'Noto Sans Arabic', category: 'arabic' },
  { url: './cjk-devanagari.ttf', family: 'Noto Sans Devanagari', category: 'devanagari' },
])

/**
 * Bundled fonts for this boot. Fonts are registered only at boot (MEMFS + fontconfig alias conf before
 * soffice starts), so a host that knows the document can ask for just its categories with
 * `?fonts=sans,serif` (the web version: ~33 MB of CJK fonts on a cold first visit, POLISH W6).
 * No parameter = every bundled font, exactly as before (desktop). Unknown categories are ignored.
 * @param {string|null} param value of the `fonts` query parameter, or null when absent
 */
export function bundledFontsFor(param) {
  if (param == null) return [...BUNDLED_FONTS]
  const wanted = new Set(String(param).split(',').map(s => s.trim()).filter(Boolean))
  return BUNDLED_FONTS.filter(f => wanted.has(f.category))
}
