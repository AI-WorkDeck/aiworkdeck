// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 引用定位 chip（缺陷 6）与额度币种（缺陷 5）的纯函数回归：
 *   node --test office-addin/taskpane/lib/citationsQuota.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanQuote, extractCitations } from './citations.js'
import { quotaParts, isQuotaLow, quotaCurrency } from './quota.js'
import { siteCurrency } from './site.js'

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

test('额度币种：大陆站 ¥、国际站 $，接口给 currency 时以接口为准', () => {
  const q = { hasKey: true, limitUsd: 100, remainingUsd: 80, usageUsd: 20 }
  assert.equal(siteCurrency('https://addin.aiworkdeck.com'), 'CNY')
  assert.equal(siteCurrency('https://addin.workdeck.ai'), 'USD')
  assert.equal(siteCurrency('https://addin.yourfirm.com'), 'USD')
  assert.deepEqual(quotaParts(q, 'https://addin.aiworkdeck.com').params, { remaining: '¥80.00', limit: '¥100.00' })
  assert.deepEqual(quotaParts(q, 'https://addin.workdeck.ai').params, { remaining: '$80.00', limit: '$100.00' })
  assert.equal(quotaCurrency({ ...q, currency: 'cny' }, 'https://addin.workdeck.ai'), 'CNY')
  assert.deepEqual(quotaParts({ hasKey: true, usageUsd: 3 }, 'https://addin.aiworkdeck.com'), { key: 'quotaUsed', params: { used: '¥3.00' } })
  assert.equal(quotaParts({ hasKey: false }, 'https://addin.aiworkdeck.com'), null)
})

test('低额度阈值本地化：美元站 $1，人民币站 ¥7', () => {
  const cn = 'https://addin.aiworkdeck.com'
  const intl = 'https://addin.workdeck.ai'
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: 5 }, cn), true)
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: 5 }, intl), false)
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: 0.5 }, intl), true)
  assert.equal(isQuotaLow({ hasKey: true, remainingUsd: null }, cn), false)
})
