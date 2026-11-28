// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C32 复测（lane C，11-28）：交稿时冻住后端，提示条直接显示了英文原文
// 「request:fail local service not responding」。uni.request 的 request:fail 文本是传输层原文，
// 任何语言下都必须换成目录里的「本机服务没响应」那句。
import test from 'node:test'
import assert from 'node:assert/strict'
import { errorTextFor } from '../../src/utils/userMessage.js'

const catalogue = async (locale) => (await import(`../../src/locales/${locale}/errors.js`)).default
const translator = (errors) => (key) => {
  const k = key.replace(/^errors\./, '')
  assert.ok(errors[k], `errors.${k} exists`)
  return errors[k]
}

for (const locale of ['zh-CN', 'en-US']) {
  test(`${locale}: a raw request:fail from the transfer watchdog shows the localized local-service message`, async () => {
    const errors = await catalogue(locale)
    const t = translator(errors)
    const watchdog = Object.assign(new Error('request:fail local service not responding'),
      { errMsg: 'request:fail local service not responding' })
    const text = errorTextFor(watchdog, 'fallback', t, { desktop: true })
    assert.equal(text, errors.localServiceDown)
    assert.doesNotMatch(text, /request:fail/)
  })

  test(`${locale}: other raw uni transport failures are never shown verbatim either`, async () => {
    const t = translator(await catalogue(locale))
    for (const err of [new Error('request:fail'), new Error('request:fail abort'), { errMsg: 'request:fail timeout' }]) {
      assert.doesNotMatch(errorTextFor(err, '', t, { desktop: true }), /request:fail/, JSON.stringify(err.message || err))
    }
  })
}
