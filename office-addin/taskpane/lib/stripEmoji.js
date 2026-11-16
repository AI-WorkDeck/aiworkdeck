// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 去掉助手回答里的 emoji（用户明确，2026-11-12：律师读者眼里 emoji 不专业）。
 *
 * 系统提示里已要求不用 emoji，这里是兜底：模型不听话时用户也看不到。加载项里 renderMarkdown 只渲染模型写的内容（回答、计划、提问），所以直接在那里调用。
 * 与 frontend/src/utils/stripEmoji.js 同一份规则，改一处要同步另一处。
 *
 * 只认「默认按彩色图标显示」的字符（Emoji_Presentation，如 ✅ ❌ 📊），以及后面跟了
 * 变体选择符 U+FE0F 的符号（如 ⚠️）。不带 FE0F 的 © ® ™ ↔ ▶ 这类在法律文书里正常使用的
 * 文字符号原样保留。连字序列（👨‍⚖️）、肤色修饰、键帽（1️⃣ 只留 1）一并处理。
 */
const EMOJI_SEQ = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[\u26A0\u2714\u2716\u2611])[\u{1F3FB}-\u{1F3FF}]?\uFE0F?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?)*[ \t]*/gu
const KEYCAP = /\uFE0F?\u20E3/g

export function stripEmoji(text) {
  if (!text) return text || ''
  return String(text).replace(EMOJI_SEQ, '').replace(KEYCAP, '')
}
