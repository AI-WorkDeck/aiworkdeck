// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 会话自愈回归用例（dev-board#142，2026-08-24 mac 插件「SSE 403」事故）。
 *   node --test office-addin/taskpane/lib/chatSession.test.js
 *
 * 病灶：官方云强制服务端签发会话（conversation-issuance-required），而签发登记簿
 * 是进程内存态——后端一重启登记即丢，localStorage 里钉着的存量会话 ID 从此
 * connect 恒 403。旧代码两处放大成永久自锁：
 *   1) connect 403 只 console.warn，不丢弃死 ID，下次还是拿它连；
 *   2) createConversation 任何失败（含 403）都静默回 null，随后把客户端自造的
 *      conv-<毫秒> 落进 localStorage——在强制签发的云上生来就是死的。
 * 下面用例分别还原这两个病灶：把自愈逻辑拿掉（或恢复「失败回退自造 ID」）就会转红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// ---- localStorage 内存桩：settings.js 的持久化走它 ----
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) }
}

// 宿主桩：wordDoc.detectHost() 的兜底路径是「有 Word 全局即判 word 宿主」。
// 会话 ID 的存储键按宿主分作用域（dev-board#285），不打这个桩就落在 'unknown' 上，
// 用例读到的键与真实产品路径不是同一个。
// 文档也要打桩，而且必须是**存过盘**的（有 document.url）：会话按文档绑定后，只有存过盘的
// 文档才落盘（dev-board#767）——新建未保存的文档每次都是新对话，「存量会话」这一整组用例
// 在它上面无从谈起。Word.run 给一个最小可用的桩，免得读正文那一步刷 console.warn。
globalThis.Office = { context: { document: { url: 'file:///C:/cases/主合同.docx' } } }
globalThis.Word = {
  run: async (cb) => cb({ document: { body: { load() {}, text: '' } }, sync: async () => {} })
}

const { activateSession, messages, stop, skillList, send, input, streaming, stopping, notice } = await import('./chatSession.js')
const { createConversation } = await import('./api.js')
// 会话 ID 的存储键除了项目与宿主，还按**文档**分一层（dev-board#717）：同项目里的两份
// Word 必须拿到各自的 conversationId，否则跨文档读写按会话下发时两个窗格分不开。
const { documentKey } = await import('./hostBridge.js')
const convKey = (projectId) => `awd_addin_conv_word_${projectId}_${documentKey()}`

/** 永不出数据的 SSE 响应体（建连成功后读流挂起，不影响用例收尾） */
function sseOkResponse() {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: () => new Promise(() => {}) }) }
  }
}

function jsonReply(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

function stubFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return handler(String(url), options)
  }
  return {
    calls,
    restore: () => { globalThis.fetch = original }
  }
}

test('存量会话 connect 403 时自愈：丢弃死 ID → 重新签发 → 重连成功', async () => {
  store.set(convKey(7), 'conv-dead-123')
  const f = stubFetch((url) => {
    if (url.includes('/api/ai/history')) return jsonReply([])
    if (url.includes('/api/agent/connect/conv-dead-123')) return jsonReply({}, false, 403)
    if (url.endsWith('/api/agent/conversations')) return jsonReply({ conversationId: 'conv-fresh-456' })
    if (url.includes('/api/agent/connect/conv-fresh-456')) return sseOkResponse()
    throw new Error(`未预期的请求: ${url}`)
  })
  try {
    await activateSession({
      settings: { serverUrl: 'https://cloud.example', token: 'awdt_t1' },
      projectId: '7'
    })
    // 死 ID 已被换成服务端新签发的 ID，并落回 localStorage
    assert.equal(store.get(convKey(7)), 'conv-fresh-456')
    // 完整自愈链：403 建连 → 重签发 → 新 ID 建连
    const urls = f.calls.map(c => c.url)
    assert.ok(urls.some(u => u.includes('/connect/conv-dead-123')))
    assert.ok(urls.some(u => u.endsWith('/api/agent/conversations')))
    assert.ok(urls.some(u => u.includes('/connect/conv-fresh-456')))
  } finally {
    await stop()
    f.restore()
  }
})

test('签发被拒（403）不回退自造 conv-* ID，更不落盘', async () => {
  store.delete(convKey(9))
  const f = stubFetch((url) => {
    if (url.includes('/api/ai/history')) return jsonReply([])
    if (url.endsWith('/api/agent/conversations')) return jsonReply({ message: 'denied' }, false, 403)
    if (url.includes('/api/agent/cancel/')) return jsonReply({})
    throw new Error(`未预期的请求: ${url}`)
  })
  try {
    await activateSession({
      settings: { serverUrl: 'https://cloud.example', token: 'awdt_t2' },
      projectId: '9'
    })
    // 预连失败被吞掉（不打断用户），但绝不能把自造 ID 写进 localStorage 锁死后续
    assert.equal(store.get(convKey(9)) || '', '')
    assert.ok(!f.calls.some(c => c.url.includes('/api/agent/connect/conv-')))
  } finally {
    await stop()
    f.restore()
  }
})

test('createConversation：404（旧后端）回退 null，403 抛错带状态码', async () => {
  const f404 = stubFetch(() => jsonReply({}, false, 404))
  try {
    assert.equal(await createConversation({ serverUrl: 'https://x', token: 't' }, 1), null)
  } finally { f404.restore() }

  const f403 = stubFetch(() => jsonReply({}, false, 403))
  try {
    await assert.rejects(
      () => createConversation({ serverUrl: 'https://x', token: 't' }, 1),
      (e) => e.status === 403
    )
  } finally { f403.restore() }
})

test('自愈只针对空会话：有历史消息的会话 403 不重签（那是权限/账号问题）', async () => {
  store.set(convKey(11), 'conv-history-1')
  let issuedCalls = 0
  const f = stubFetch((url) => {
    if (url.includes('/api/ai/history')) {
      return jsonReply([{ role: 'USER', content: '早先的问题' }])
    }
    if (url.includes('/api/agent/connect/conv-history-1')) return jsonReply({}, false, 403)
    if (url.endsWith('/api/agent/conversations')) { issuedCalls++; return jsonReply({ conversationId: 'conv-x' }) }
    if (url.includes('/api/agent/cancel/')) return jsonReply({})
    throw new Error(`未预期的请求: ${url}`)
  })
  try {
    await activateSession({
      settings: { serverUrl: 'https://cloud.example', token: 'awdt_t3' },
      projectId: '11'
    })
    assert.equal(issuedCalls, 0)
    // 历史消息还在，会话 ID 没被丢
    assert.equal(store.get(convKey(11)), 'conv-history-1')
    assert.ok(messages.value.length >= 1)
  } finally {
    await stop()
    f.restore()
  }
})

test('懒人模式：refreshCatalogs 过滤 builtinWorkflow，仅保留额外扩展技能供手动勾选', async () => {
  store.set(convKey(15), 'conv-skills-1')
  const f = stubFetch((url) => {
    if (url.includes('/api/ai/models')) return jsonReply({ models: [], defaultModel: '' })
    if (url.includes('/api/skills/list')) {
      return jsonReply([
        { id: 'contract-review', name: '合同审查', enabled: true, activation: 'auto', builtinWorkflow: true },
        { id: 'evidence-linked-report', name: '证据整理与核查闭环', enabled: true, activation: 'auto', builtinWorkflow: true },
        { id: 'legal-opinion-review', name: '法律意见书核查', enabled: true, activation: 'auto', builtinWorkflow: true },
        { id: 'redaction', name: '敏感信息脱敏', enabled: true, activation: 'auto', builtinWorkflow: false }
      ])
    }
    if (url.includes('/api/ai/history')) return jsonReply([])
    if (url.includes('/api/agent/connect/conv-skills-1')) return sseOkResponse()
    if (url.includes('/api/agent/cancel/')) return jsonReply({})
    throw new Error(`未预期的请求: ${url}`)
  })
  try {
    await activateSession({
      settings: { serverUrl: 'https://cloud.example.skills', token: 'awdt_t4' },
      projectId: '15'
    })
    await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(skillList.value.map(s => s.id), ['redaction'])
  } finally {
    await stop()
    f.restore()
  }
})

// ==================== 运行中插话与停止（用户控制 2） ====================
// 病灶一：canSend 要求 !streaming、send 在 streaming 时直接 return，用户只能干等或停止。
// 病灶二：stop() 先关 SSE 再收尾，后端随后的 cancelled 永远到不了，「到底停没停」不可知。

/** 可脚本推送的 SSE 流（与 chatSessionInlineRetry.test.js 同一路子） */
function scriptedStream() {
  const queue = []
  let pending
  return {
    push(event, data) {
      const chunk = { done: false, value: new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
      if (pending) { const resolve = pending; pending = null; resolve(chunk) } else queue.push(chunk)
    },
    reader: { read: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => { pending = resolve }) }
  }
}

async function until(predicate, label) {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('timed out: ' + label)
}

/** 起一轮正在跑的对话；chatReply 决定第 n 条 POST /chat 的回执，cancelReply 决定取消接口的回包 */
async function startRunningTurn({ projectId, chatReply, cancelReply = { status: 'ok', cancelled: true } }) {
  const ctl = { connection: null, chats: [], cancels: 0, connects: 0 }
  const f = stubFetch((url, options) => {
    if (url.includes('/api/ai/history')) return jsonReply([])
    if (url.endsWith('/api/agent/conversations')) return jsonReply({ conversationId: 'conv-steer-' + projectId })
    if (url.includes('/api/agent/connect/')) {
      ctl.connects++
      ctl.connection = scriptedStream()
      const conn = ctl.connection
      return { ok: true, status: 200, body: { getReader: () => conn.reader } }
    }
    if (url.endsWith('/api/agent/chat')) {
      const body = JSON.parse(options.body)
      ctl.chats.push(body)
      return jsonReply(chatReply(body, ctl.chats.length))
    }
    if (url.includes('/api/agent/cancel/')) { ctl.cancels++; return jsonReply(cancelReply) }
    if (url.includes('/api/ai/models') || url.includes('/api/skills/list')) return jsonReply([], false, 404)
    throw new Error(`未预期的请求: ${url}`)
  })
  await activateSession({ settings: { serverUrl: 'https://cloud.example.steer', token: 'awdt_steer' }, projectId })
  await send('把第三条改短')
  ctl.connection.push('text_delta', { content: '<final>正在改第三条' })
  await until(() => messages.value.at(-1).text.includes('第三条'), 'first delta')
  ctl.restore = f.restore
  return ctl
}

const accepted = (state) => (body, n) => ({ status: 'accepted', messageId: 'inbox-' + n, runId: 'run-1', submissionMode: body.submissionMode || 'steer', state: n === 1 ? 'applied' : state })

test('运行中发送 = 插话：POST 带 steer，回执挂「尚未读取」，input_applied 后切段并落成「已送达」', async () => {
  const ctl = await startRunningTurn({ projectId: '61', chatReply: accepted('pending') })
  try {
    assert.equal(streaming.value, true)
    const before = messages.value.length
    input.value = '另外别动第五条'
    await send()
    assert.equal(ctl.chats.length, 2, '运行中也必须真的发出去，而不是静默丢弃')
    assert.equal(ctl.chats[1].submissionMode, 'steer')
    assert.equal(ctl.chats[1].conversationId, ctl.chats[0].conversationId)
    assert.ok(ctl.chats[1].activeContext, '插话与正常发送同一份请求体（后端按它重新组装上下文）')
    assert.equal(input.value, '', '发出后清空输入框')
    assert.equal(messages.value.length, before + 1, '只多一条用户气泡，不新开助手气泡')
    const steer = messages.value.at(-1)
    assert.equal(steer.role, 'user')
    assert.equal(steer.receipt, 'pending')
    assert.equal(steer.inboxId, 'inbox-2')
    assert.equal(streaming.value, true, '插话不打断这一轮')

    // 后端在安全边界读入：上一段到此为止，后续正文另起一个气泡排在插话之后
    ctl.connection.push('input_applied', { messageId: 'inbox-2', runId: 'run-1', sequence: 2, clientRequestId: steer.clientRequestId })
    await until(() => steer.receipt === 'applied', 'applied')
    ctl.connection.push('text_delta', { content: '<final>好的，第五条不动' })
    await until(() => messages.value.at(-1).role === 'assistant' && messages.value.at(-1).text.includes('第五条'), 'second segment')
    const list = messages.value
    const at = list.indexOf(list.find((m) => m.receipt === 'applied'))
    assert.ok(list[at - 1].text.includes('第三条'), '上一段留在插话之前')
    assert.ok(!list[at - 1].text.includes('第五条'), '插话之后的正文不得续写进上一段')
    assert.equal(list[at - 1].streaming, false)
    ctl.connection.push('bubble_end', { status: 'finished' })
    await until(() => !streaming.value, 'finished')
  } finally {
    await stop()
    ctl.restore()
  }
})

test('回执直接是 applied（轮次刚好收尾、后端拿它起了新一轮）：同样切段，不等 input_applied', async () => {
  const ctl = await startRunningTurn({ projectId: '62', chatReply: accepted('applied') })
  try {
    input.value = '再加一条保密条款'
    await send()
    const steer = messages.value.find((m) => m.steer)
    assert.equal(steer.receipt, 'applied')
    assert.equal(messages.value.at(-1), steer, '插话排在最末，下一段正文接在它后面')
    assert.equal(streaming.value, true)
  } finally {
    ctl.connection.push('cancelled', {})
    await stop()
    ctl.restore()
  }
})

test('停止先不拆 SSE：挂「正在停止」直到 cancelled 到达；未读插话改口为「随下一条送达」', async () => {
  const ctl = await startRunningTurn({ projectId: '63', chatReply: accepted('pending') })
  try {
    input.value = '换成英文'
    await send()
    const steer = messages.value.find((m) => m.steer)
    const stopped = stop()
    assert.equal(stopping.value, true, '点下停止立刻进入「正在停止」')
    await stopped
    assert.equal(ctl.cancels, 1)
    assert.equal(streaming.value, true, '没收到 cancelled 之前不能宣布已停止')
    assert.equal(stopping.value, true)
    input.value = '这条不该发出去'
    await send()
    assert.equal(ctl.chats.length, 2, '停止中不收新消息')
    // 连接还活着：后端的 cancelled 能送到并收尾
    ctl.connection.push('cancelled', {})
    await until(() => !streaming.value, 'cancelled handled')
    assert.equal(stopping.value, false)
    assert.equal(steer.receipt, 'held', '队列随停止暂停，不能还挂着「下一步读取」')
  } finally {
    await stop()
    ctl.restore()
  }
})

test('后端说没打中活跃轮次（cancelled:false）：没有 cancelled 可等，当场收尾', async () => {
  const ctl = await startRunningTurn({ projectId: '64', chatReply: accepted('pending'), cancelReply: { status: 'ok', cancelled: false } })
  try {
    await stop()
    assert.equal(streaming.value, false)
    assert.equal(stopping.value, false)
    assert.equal(notice.value, '')
  } finally {
    ctl.restore()
  }
})
