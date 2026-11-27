// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X39 (lane X spec readiness/qa/X-audit/X39-continue-spec.md): when a cut-off answer may be continued
// from where it stopped instead of regenerating the whole turn.
// Pure module (no uni / vue) so node --test can run it.

/** Below this much received text (weighted length, see weightedLength), Retry is just as good. */
export const CONTINUE_MIN_CHARS = 200

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** Length where a CJK character (Han, kana, hangul) counts 2.5 and anything else 1: ~80 Chinese chars = 200 Latin. */
export function weightedLength(text) {
  let n = 0
  for (const ch of String(text || '')) n += CJK.test(ch) ? 2.5 : 1
  return n
}
/** After this many failed continues in a row, offer Retry only. */
export const CONTINUE_MAX_FAILURES = 2

/**
 * @param {object} s
 * @param {string} [s.errorKey]           catalogue key of the turn's failure (toUserMessage().key)
 * @param {string} [s.partialText]        the answer text the user already sees (not tool logs)
 * @param {boolean} [s.stoppedByUser]     the user pressed Stop: a decision, not a failure
 * @param {boolean} [s.toolInFlight]      a tool call was running when it broke
 * @param {boolean} [s.documentChanged]   the active document changed since the cut
 * @param {number} [s.failedContinues]    consecutive continues that also broke
 * @returns {{ offerContinue: boolean, messageKey: string }}
 *          messageKey: 'streamInterruptedResumable' (Continue + Retry), 'streamInterruptedTwice'
 *          (Retry only, after repeated failures) or the plain 'streamInterrupted' (Retry only)
 */
export function continueDecision(s = {}) {
  const plain = { offerContinue: false, messageKey: 'streamInterrupted' }
  if (s.errorKey !== 'streamInterrupted') return { offerContinue: false, messageKey: s.errorKey || 'unknown' }
  if (s.stoppedByUser || s.toolInFlight || s.documentChanged) return plain
  if ((s.failedContinues || 0) >= CONTINUE_MAX_FAILURES) return { offerContinue: false, messageKey: 'streamInterruptedTwice' }
  if (weightedLength(String(s.partialText || '').trim()) < CONTINUE_MIN_CHARS) return plain
  return { offerContinue: true, messageKey: 'streamInterruptedResumable' }
}

/** Fixed instruction sent with a continuation (the backend adds it; exported for the contract test). */
export const CONTINUE_INSTRUCTION = {
  zh: '你上一条回答在上文末尾被截断。请从断开处直接接着写，不要重复、不要总结已写内容，也不要从头开始。',
  en: 'Your previous answer was cut off at the end of the text above. Continue exactly from where it stopped. Do not repeat or summarize what is already written, and do not restart.',
}
