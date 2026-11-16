// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 字符级差异（最长公共子序列），给三方合并右栏「共同的上一版 / 主稿 / 稿」三栏用：
// 每一侧相对共同的上一版加了什么、删了什么，轻量标出来（台账 B13 起合并稿里不再有「主线改了哪几处」
// 的修订，律师在这一栏里做决定）。段落级长度，超过上限就整段原样返回、不标。

const MAX_CELLS = 4_000_000

/**
 * @returns {Array<{type: 'same'|'ins'|'del', text: string}>} 按 b 的顺序穿插 a 里被删的字
 */
export function charDiff(a, b) {
  a = String(a == null ? '' : a)
  b = String(b == null ? '' : b)
  if (a === b) return a ? [{ type: 'same', text: a }] : []
  // 去掉公共前后缀再算，段落里通常只改了中间几个字
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf)
  const out = []
  const push = (type, text) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.type === type) last.text += text
    else out.push({ type, text })
  }
  push('same', a.slice(0, pre))
  if ((A.length + 1) * (B.length + 1) > MAX_CELLS) {
    push('del', A)
    push('ins', B)
  } else {
    const n = A.length, m = B.length
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
    let i = 0, j = 0
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('same', A[i]); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++ }
      else { push('ins', B[j]); j++ }
    }
    push('del', A.slice(i))
    push('ins', B.slice(j))
  }
  push('same', a.slice(a.length - suf))
  return out
}
