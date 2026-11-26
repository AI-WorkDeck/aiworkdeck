// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Q24：一轮对话的实扣金额（国内站平台通道）。规则（CEO：要么精确，要么不显示）：
// - 轮次结束后按 0.5 / 1.5 / 4 / 15 秒查官网账；pending 归零才显示金额，之后不再变；
// - 查询期间显示「结算中…」；还有未结算的调用、端点不可用或失败 → 回到「查看用量」。

/** 每次查询前的等待（毫秒），从轮次结束算起的相对间隔。 */
export const TURN_COST_DELAYS = [500, 1000, 2500, 11000]

/** 金额文案参数：只认分为整数、币种 CNY/USD。 */
export function formatTurnCost(data) {
  if (!data || data.available !== true || data.pending !== 0) return null
  const cents = Number(data.cents)
  if (!Number.isInteger(cents) || cents < 0) return null
  const symbol = data.currency === 'USD' ? '$' : '¥'
  const amount = symbol + (cents / 100).toFixed(2)
  let source = ''
  if (cents > 0 && Number(data.subscriptionCents) === cents) source = 'subscription'
  else if (cents > 0 && Number(data.bqtCents) === cents) source = 'bqt'
  // 这一轮还生成了演示文稿（pptx-service 的调用带不上标记）：金额只是其余部分，页脚注明并给「查看用量」
  return data.excludesPresentation === true ? { amount, source, partial: true } : { amount, source }
}

/**
 * 依次查询直到有确定结果。lookup() 返回接口 data；sleep 可注入以便测试。
 * 返回 { amount, source } 或 null（回退「查看用量」）。stillCurrent() 为假时立刻放弃。
 */
export async function pollTurnCost(lookup, { sleep = ms => new Promise(r => setTimeout(r, ms)), stillCurrent = () => true } = {}) {
  for (const delay of TURN_COST_DELAYS) {
    await sleep(delay)
    if (!stillCurrent()) return null
    let data
    try { data = await lookup() } catch (e) { return null }
    if (!stillCurrent()) return null
    if (!data || data.available !== true) return null
    const shown = formatTurnCost(data)
    if (shown) return shown
  }
  return null
}
