// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 桌面端用户点了「暂停」（bubble_end paused / reason=user_pause），同一会话镜像到任务窗格时
 * 要说「已按你的要求暂停」，不能沿用步数用尽的那句（那会让用户以为任务出了故障）。
 * 窗格自己没有暂停键；续跑仍是发一条「继续」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// ---- localStorage / Office 环境桩（须在 import 被测模块之前就位） ----
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) }
}
globalThis.Word = globalThis.Word || {}

const { activateSession, messages, input, send, stop } = await import('./chatSession.js')
const { t } = await import('./i18n.js')

function jsonReply(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** 依次吐出 chunks 后**挂起**（流不结束，模拟一条健康连接） */
function openStream(chunks) {
  const queue = [...chunks]
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () => (queue.length
          ? Promise.resolve({ done: false, value: new TextEncoder().encode(queue.shift()) })
          : new Promise(() => {}))
      })
    }
  }
}

async function until(cond, ms = 6000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return cond()
}

async function startSession(name) {
  const boot = async (url) => {
    if (url.includes('/api/ai/history')) return jsonReply([])
    if (url.endsWith('/api/agent/conversations')) return jsonReply({ conversationId: 'conv-' + name })
    if (url.includes('/api/agent/connect/')) return openStream([])
    if (url.includes('/api/ai/models') || url.includes('/api/skills/list')) return jsonReply([], false, 404)
    return jsonReply({}, false, 404)
  }
  globalThis.fetch = async (url) => boot(String(url))
  await activateSession({
    settings: { serverUrl: 'https://x.example', token: 'awdt_' + name }, projectId: '77'
  })
  // 换掉预连建好的那条连接，让 send 的兜底 preconnect 拿到本用例脚本化的流
  await stop()
}

for (const [reason, key] of [['user_pause', 'pausedByUser'], ['max_tokens', 'pausedMaxTokens'], ['no_progress', 'pausedMaxDepth']]) {
  test(`paused/${reason} 收尾提示用 ${key}`, async () => {
    store.clear()
    const original = globalThis.fetch
    try {
      await startSession('pause-' + reason)
      globalThis.fetch = async (url) => {
        const u = String(url)
        if (u.includes('/api/agent/connect/')) {
          return openStream([
            sseEvent('text_delta', { content: '<final>已改完第一节。</final>' }),
            sseEvent('bubble_end', { status: 'paused', reason, documentEdited: true })
          ])
        }
        if (u.endsWith('/api/agent/chat')) return jsonReply({ code: 0 })
        if (u.includes('/api/ai/history')) return jsonReply([])
        return jsonReply({}, false, 404)
      }
      input.value = 'revise section one'
      await send()
      assert.ok(await until(() => {
        const last = messages.value[messages.value.length - 1]
        return last && last.role === 'assistant' && last.notice
      }), '等待暂停提示超时')
      assert.equal(messages.value[messages.value.length - 1].notice, t(key))
    } finally {
      await stop()
      globalThis.fetch = original
    }
  })
}
