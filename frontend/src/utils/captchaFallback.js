// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 桌面端的 Turnstile（国际站）走官网托管页，在一些机器上控件根本渲染不出来：发码时拿不到 token，
// 用户只看到「请完成安全验证」，唯一出路是不起眼的「改用兼容验证」链接——外国律师注册不了（0.91.0 发布前）。
// 规则：桌面端 + Turnstile 时，人机验证最多等 3 秒；3 秒内没拿到通过的 token（没渲染、加载失败、
// 被判未通过），自动改用兼容验证（图片字符，官网同样接受），不再让用户自己去找那个链接。

export const DESKTOP_TURNSTILE_BUDGET_MS = 3000

/**
 * @param {() => Promise<{token?:string, failure?:object, rejected?:boolean}>} acquire 正常取 token
 * @param {{ desktop: boolean, provider: string, budgetMs?: number, wait?: (ms:number) => Promise<void> }} opts
 * @returns {Promise<object>} acquire 的结果，或 `{ fallback: true }`（调用方改走兼容验证）
 */
export async function acquireOrFallback(acquire, { desktop, provider, budgetMs = DESKTOP_TURNSTILE_BUDGET_MS,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!desktop || provider !== 'turnstile') return acquire()
  const timedOut = wait(budgetMs).then(() => ({ fallback: true }))
  const result = await Promise.race([acquire().catch(() => ({ fallback: true })), timedOut])
  if (result.fallback || result.failure || result.rejected || !result.token) return { fallback: true }
  return result
}
