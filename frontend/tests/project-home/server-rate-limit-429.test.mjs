// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 服务器按用户限频（UserRateLimiter）回 HTTP 429：对话发送与浏览器端上传要给可读的
// 「操作太频繁，请稍候再试」，而不是「对话请求失败: HTTP 429」/「HTTP 429」。
// 两处都是 fetch/XHR 直连、node 无法直接 import，做源码级契约断言（与本目录既有用例同口径）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const STREAM = read('../../src/composables/useAgentStream.js')
const CHAT = read('../../src/components/ChatInterface.vue')

test('POST /api/agent/chat 的 429 先于通用 HTTP 报错映射成可读文案', () => {
  const rate = STREAM.indexOf("chatResp.status === 429")
  const generic = STREAM.indexOf("t('agentStream.chatRequestFailed', { status: chatResp.status })")
  assert.ok(rate >= 0, '缺少 429 分支')
  assert.ok(generic > rate, '429 分支必须排在通用 HTTP 报错之前')
  assert.match(STREAM.slice(rate, generic), /t\('common\.tooManyRequests'\)/)
})

test('浏览器端上传的 429 映射成可读文案并保留 status（导入项可重试）', () => {
  const at = CHAT.indexOf('xhr.status === 429')
  assert.ok(at >= 0, '缺少上传 429 分支')
  const branch = CHAT.slice(at, at + 300)
  assert.match(branch, /t\('common\.tooManyRequests'\)/)
  assert.match(branch, /status: 429/)
})

test('zh-CN / en-US 都有 common.tooManyRequests', async () => {
  for (const loc of ['zh-CN', 'en-US']) {
    const mod = await import(new URL(`../../src/locales/${loc}/common.js`, import.meta.url))
    assert.ok(mod.default.tooManyRequests, loc)
  }
})
