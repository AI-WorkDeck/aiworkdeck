// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export const hasTtsText = text => typeof text === 'string' && /[\p{L}\p{N}]/u.test(text)

/** Keep every character; cap even punctuation-free input so the first request stays small. */
export function splitTtsText(text, firstLimit = 36, limit = 120) {
  if (!hasTtsText(text)) return []
  const chars = Array.from(text)
  const segments = []
  let start = 0
  while (start < chars.length && !chars[start].trim()) start++
  const leadingSpace = chars.slice(0, start).join('')
  while (start < chars.length) {
    const end = Math.min(chars.length, start + (segments.length ? limit : firstLimit))
    let cut = end
    let softCut = -1
    let sentenceEnd = false
    for (let i = start; i < end; i++) {
      const decimal = chars[i] === '.' && /\d/.test(chars[i - 1] || '') && /\d/.test(chars[i + 1] || '')
      if (!decimal && /[。！？!?；;\n.]/.test(chars[i])) {
        sentenceEnd = true
        cut = i + 1
        // Closing quotation marks belong to the sentence that was just spoken.
        while (cut < end && /[”’」』】）"')]/.test(chars[cut])) cut++
        break
      }
      if (/[，,、：:\s]/.test(chars[i])) softCut = i + 1
    }
    if (!sentenceEnd && end < chars.length && softCut > start) cut = softCut
    // Do not put a boundary on either side of a decimal point.
    if (cut < chars.length && /\d/.test(chars[cut - 1] || '') && chars[cut] === '.' && /\d/.test(chars[cut + 1] || '')) cut--
    if (cut < chars.length && chars[cut - 1] === '.' && /\d/.test(chars[cut - 2] || '') && /\d/.test(chars[cut])) cut -= 2
    if (cut <= start) cut = end
    const part = chars.slice(start, cut).join('')
    if (!part.trim() && segments.length) segments[segments.length - 1] += part
    else segments.push(part)
    start = cut
  }
  segments[0] = leadingSpace + segments[0]
  // Kokoro may return no audio for punctuation alone. Keep those characters in
  // the adjacent caption/request instead of asking the engine to read a separator.
  const readable = []
  let prefix = ''
  for (const part of segments) {
    if (hasTtsText(part)) { readable.push(prefix + part); prefix = '' }
    else if (readable.length) readable[readable.length - 1] += part
    else prefix += part
  }
  return readable
}
