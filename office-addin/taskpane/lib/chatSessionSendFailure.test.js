// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 发送失败的收尾（real-host QA 缺陷 3 / 7）：
 *   node --test office-addin/taskpane/lib/chatSessionSendFailure.test.js
 *
 * - 离线/失败后不留空白助手气泡，用户消息放回输入框并给重试标记；
 * - 401 / code 4010：横幅说「登录已失效」（不是裸 HTTP 401），通知 App 清令牌回登录，
 *   键入的消息不丢；
 * - 重试（再次 send）成功后清掉失败标记。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) }
}
globalThis.Office = { context: { document: { url: 'file:///C:/cases/主合同.docx' } } }
globalThis.Word = {
  run: async (cb) => cb({ document: { body: { load() {}, text: '' } }, sync: async () => {} })
}

const { activateSession, send, messages, stop, banner, input, sendFailed } = await import('./chatSession.js')
const { setAuthExpiredHandler } = await import('./api.js')
const { t } = await import('./i18n.js')

function sseOkResponse() {
  return { ok: true, status: 200, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }
}
function jsonReply(body, ok = true, status = 200) {
  return {
    ok, status, headers: { get: () => 'application/json' },
    json: async () => body, clone() { return this }, text: async () => JSON.stringify(body)
  }
}
function stubFetch(chatHandler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    url = String(url)
    if (url.includes('/api/ai/history')) return jsonReply([])
    if (url.endsWith('/api/agent/conversations')) return jsonReply({ conversationId: 'conv-x' })
    if (url.includes('/api/agent/connect/')) return sseOkResponse()
    if (url.includes('/api/agent/cancel/')) return jsonReply({ cancelled: false })
    if (url.endsWith('/api/agent/chat')) return chatHandler()
    throw new Error(`未预期的请求: ${url}`)
  }
  return () => { globalThis.fetch = original }
}

const SETTINGS = { serverUrl: 'https://cloud.example', token: 'awdt_t' }

test('离线失败：无空助手气泡、无悬空用户气泡，消息放回输入框并可重试', async () => {
  store.clear()
  let online = false
  const restore = stubFetch(() => {
    if (!online) throw new TypeError('Failed to fetch')
    return jsonReply({ status: 'ok' })
  })
  try {
    await activateSession({ settings: SETTINGS, projectId: '31' })
    input.value = '请审查第三条'
    await send()

    assert.equal(messages.value.filter((m) => m.role === 'assistant').length, 0, '不许留空白助手气泡')
    assert.equal(messages.value.filter((m) => m.role === 'user').length, 0, '没送达的消息不留在会话里')
    assert.equal(input.value, '请审查第三条')
    assert.equal(sendFailed.value, true)
    assert.equal(banner.value, t('apiChatUnreachable'))

    // 联网后重试：同一条消息发出，失败标记清零
    online = true
    await send()
    assert.equal(sendFailed.value, false)
    assert.equal(input.value, '')
    assert.equal(messages.value.filter((m) => m.role === 'user').map((m) => m.text).join(), '请审查第三条')
  } finally {
    await stop()
    restore()
  }
})

test('用户已在输入框打了新内容时，失败不覆盖草稿', async () => {
  store.clear()
  const restore = stubFetch(() => { throw new TypeError('Failed to fetch') })
  try {
    await activateSession({ settings: SETTINGS, projectId: '32' })
    await send('快捷提问')
    assert.equal(input.value, '快捷提问')
    input.value = '我另外写的草稿'
    await send('第二个快捷提问')
    assert.equal(input.value, '我另外写的草稿')
  } finally {
    await stop()
    restore()
  }
})

for (const [label, reply] of [
  ['HTTP 401', () => jsonReply({ message: 'x' }, false, 401)],
  ['code 4010', () => jsonReply({ code: 4010, message: 'x' }, false, 400)]
]) {
  test(`${label}：令牌失效 → 通知 App、横幅为「登录已失效」，键入的消息保留`, async () => {
    store.clear()
    const expired = []
    setAuthExpiredHandler((tok) => expired.push(tok))
    const restore = stubFetch(reply)
    try {
      await activateSession({ settings: SETTINGS, projectId: '33' })
      input.value = '别丢了这条'
      await send()
      assert.deepEqual(expired, ['awdt_t'])
      assert.equal(banner.value, t('sessionExpired'))
      assert.ok(!/401/.test(banner.value))
      assert.equal(input.value, '别丢了这条')
    } finally {
      setAuthExpiredHandler(null)
      await stop()
      restore()
    }
  })
}
