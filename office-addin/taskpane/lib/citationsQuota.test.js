// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 引用定位 chip（缺陷 6）与额度币种（缺陷 5）的纯函数回归：
 *   node --test office-addin/taskpane/lib/citationsQuota.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanQuote, extractCitations } from './citations.js'
import { quotaParts, isQuotaLow } from './quota.js'

test('引文剥掉 ** 与反引号，不带 Markdown 标记', () => {
  assert.equal(cleanQuote('**乙方应于三十日内付款**'), '乙方应于三十日内付款')
  assert.equal(cleanQuote('`违约金`   为 合同总额'), '违约金 为 合同总额')
  const out = extractCitations('见「**乙方应于三十日内付款**」与「`第十二条争议解决`」。')
  assert.deepEqual(out, ['乙方应于三十日内付款', '第十二条争议解决'])
})

test('去重、过短丢弃、最多 4 条，已确认找不到的不再出 chip', () => {
  const text = '「短句」「条款一的全文内容」「条款一的全文内容」「条款二的全文内容」「条款三的全文内容」「条款四的全文内容」「条款五的全文内容」'
  const all = extractCitations(text)
  assert.equal(all.length, 4)
  assert.equal(new Set(all).size, 4)
  assert.deepEqual(extractCitations('「条款一的全文内容」「条款二的全文内容」', new Set(['条款一的全文内容'])), ['条款二的全文内容'])
})

test('额度：后端折算出的本币额原样显示（美元 2.39 × 汇率 7.2 × 毛利 1.16 = ¥19.96，不是 ¥2.39）', () => {
  // 后端 PlatformAiKeyService.status 按官网汇率折算后给的字段
  const cny = { hasKey: true, limitUsd: 2.39, usageUsd: 0.39, remainingUsd: 2.0,
    currency: 'CNY', limitAmount: 19.96, usageAmount: 3.26, remainingAmount: 16.7 }
  assert.deepEqual(quotaParts(cny).params, { remaining: '¥16.70', limit: '¥19.96' })
  const usd = { hasKey: true, limitUsd: 10, remainingUsd: 8, currency: 'USD', limitAmount: 10, remainingAmount: 8 }
  assert.deepEqual(quotaParts(usd).params, { remaining: '$8.00', limit: '$10.00' })
})

test('没有折算字段（旧后端 / 官网没给汇率）：显示美元原值并标 US$，不冒充 ¥，也不自己换算', () => {
  const q = { hasKey: true, limitUsd: 2.39, remainingUsd: 2.0, usageUsd: 0.39 }
  assert.deepEqual(quotaParts(q).params, { remaining: 'US$2.00', limit: 'US$2.39' })
  assert.deepEqual(quotaParts({ hasKey: true, usageUsd: 3 }), { key: 'quotaUsed', params: { used: 'US$3.00' } })
  assert.equal(quotaParts({ hasKey: false }), null)
})

test('低额度阈值按本币口径：美元 $1，人民币 ¥7；用折算后的额判断', () => {
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: 0.8, currency: 'CNY', remainingAmount: 5.5, limitAmount: 20 }), true)
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: 0.8, currency: 'CNY', remainingAmount: 16.7, limitAmount: 20 }), false)
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: 0.5 }), true)
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: null }), false)
})
