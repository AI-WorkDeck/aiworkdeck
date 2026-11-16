// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/** 引文里的 Markdown 标记（加粗/行内代码）不是文档原文的一部分，定位前先剥掉 */
export function cleanQuote(raw) {
  return String(raw || '')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 回答里被「」或 “” 包住的原文引用（清理后 6-80 字符），去重，最多 4 条。
 * `skip` 是已确认文档里找不到的引文：点过一次定位失败就不再出现，
 * 不在建 chip 时预先搜全文（异步且逐条要读文档），改成点击时懒验证。
 */
export function extractCitations(text, skip) {
  if (!text) return []
  const out = []
  const seen = new Set()
  const re = /「([^「」\n]{6,120})」|“([^“”\n]{6,120})”/g
  let m
  while ((m = re.exec(text)) && out.length < 4) {
    const q = cleanQuote(m[1] || m[2])
    if (q.length < 6 || q.length > 80 || seen.has(q)) continue
    seen.add(q)
    if (skip && skip.has(q)) continue
    out.push(q)
  }
  return out
}
