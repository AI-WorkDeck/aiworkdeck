// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 用户控制 3/4/5：撤销本次 AI 修改、停止时的修改计数、暂停/继续。
//
// 纯判据直接 import；useAgentStream / ChatInterface 带 @/ 别名与 uni 全局，
// 与本目录既有用例同口径：pause() 按函数体抽出来真跑，模板与分支做源码契约断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  cancelledEditedDocument,
  formatUndoFiles,
  shouldOfferRunUndo,
  stopNoticeForCancelled,
  undoResultView,
} from '../../src/utils/agentRunControl.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const STREAM = read('../../src/composables/useAgentStream.js')
const CI = read('../../src/components/ChatInterface.vue')
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key)

function bodyOf(code, signature) {
  const start = code.indexOf(signature)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') { depth--; if (depth === 0) return code.slice(start, i + 1) }
  }
  return null
}

// ---- 4. 停止时的结果摘要 ----

test('cancelled 带修改次数时写「已停止。已完成 N 次文档修改」，否则沿用「已停止生成」', () => {
  assert.equal(stopNoticeForCancelled({ documentEdited: true, documentEdits: 3 }, t),
    'agentStream.stopConfirmedWithEdits{"count":3}')
  assert.equal(stopNoticeForCancelled({ documentEdited: false, documentEdits: 0 }, t), 'agentStream.stopConfirmed')
  assert.equal(stopNoticeForCancelled(null, t), 'agentStream.stopConfirmed', '旧后端只给 message')
  assert.equal(cancelledEditedDocument({ documentEdits: 2 }), true)
  assert.equal(cancelledEditedDocument({ documentEdited: true }), true, '只带布尔也认')
  assert.equal(cancelledEditedDocument({ message: 'x' }), false)
})

test('两条 cancelled 分支都把载荷交给 noteStopConfirmed，主分支还给气泡标 documentEdited', () => {
  const code = STREAM
  assert.match(code, /if \(evt === 'cancelled'\) noteStopConfirmed\(d\)/, '气泡指针为空的兜底分支')
  assert.match(code, /noteStopConfirmed\(cancelledPayload\)/, '正常分支')
  assert.match(code, /currentAssistantBubble\.value\.documentEdited = true/, '停止的那一轮同样能撤销')
  const note = bodyOf(code, 'const noteStopConfirmed = (payload) => {')
  assert.ok(note && /stopNoticeForCancelled\(payload, t\)/.test(note))
})

// ---- 3. 撤销本次 AI 修改 ----

test('撤销入口：只在最后一条、流已结束、改过文档的气泡下出现', () => {
  const edited = { documentEdited: true, isStreaming: false }
  assert.equal(shouldOfferRunUndo(edited, { isLatest: true, isStreaming: false }), true)
  assert.equal(shouldOfferRunUndo(edited, { isLatest: false, isStreaming: false }), false, '只挂最后一条')
  assert.equal(shouldOfferRunUndo(edited, { isLatest: true, isStreaming: true }), false, '运行中不给撤销')
  assert.equal(shouldOfferRunUndo({ documentEdited: false }, { isLatest: true }), false, '只读轮次没有可撤销的')
  assert.equal(shouldOfferRunUndo({ documentEdited: true, isStreaming: true }, { isLatest: true }), false)
  assert.equal(shouldOfferRunUndo({ documentEdited: true, stopNotice: 'agentStream.stopConfirmed' },
    { isLatest: true, isStreaming: false }), true, '停止的那一轮已经落地的修改同样可以撤销')
})

test('POST /undo 的结果：成功换成已撤销；部分失败点名并保留入口；快照没了撤掉入口', () => {
  const ok = undoResultView(200, { status: 'ok', restored: ['A.docx', 'B.docx'], failures: [] }, t)
  assert.equal(ok.state, 'done')
  assert.match(ok.message, /A\.docx.*B\.docx/, '多文件逐个点名')

  const partial = undoResultView(200, { status: 'partial', restored: ['A.docx'],
    failures: [{ fileId: 2, name: 'B.docx', error: 'reload failed' }] }, t)
  assert.equal(partial.state, 'idle', '失败的那几份还可以重试')
  assert.match(partial.message, /chat\.undoRunPartial/)
  assert.match(partial.message, /B\.docx/)

  const failed = undoResultView(200, { status: 'failed', restored: [],
    failures: [{ fileId: 1, name: 'A.docx', error: 'editor not ready' }] }, t)
  assert.equal(failed.state, 'idle')
  assert.match(failed.message, /chat\.undoRunFailed/)

  assert.equal(undoResultView(404, { code: 'NO_CHECKPOINT' }, t).state, 'gone')
  assert.equal(undoResultView(409, { code: 'RUN_ACTIVE' }, t).message, 'chat.undoRunBusy')
  assert.equal(undoResultView(409, { code: 'UNDO_IN_PROGRESS' }, t).state, 'running')
  assert.equal(undoResultView(403, { message: 'denied' }, t).state, 'idle')
})

test('确认框文件清单：有名字逐个列出，没有就说「本次运行改过的文档」', () => {
  assert.equal(formatUndoFiles([{ fileId: 1, name: 'A.docx' }, 'B.docx'], t),
    'chat.undoRunFileName{"name":"A.docx"}chat.undoRunFileSeparatorchat.undoRunFileName{"name":"B.docx"}')
  assert.equal(formatUndoFiles([], t), 'chat.undoRunFilesUnknown')
})

test('ChatInterface：撤销行挂在 RootBubble 之后，确认后才 POST，入口出不出先问 GET /undo', () => {
  assert.match(CI, /<view v-if="showRunUndo\(msg, index\)" class="run-undo-row">/)
  assert.match(CI, /\$t\('chat\.undoRun'\)/)
  const handler = bodyOf(CI, 'const handleUndoRun = () => {')
  assert.ok(handler, '找不到 handleUndoRun')
  assert.ok(handler.indexOf('uni.showModal') < handler.indexOf("agentRunApi('undo', 'POST')"),
    '恢复会丢弃本轮全部修改（含此后的手改），必须先确认')
  assert.match(handler, /undoRunConfirmContent/)
  assert.match(CI, /agentRunApi\('undo'\)/, '快照只在后端内存里（24 小时 TTL），出不出入口要问后端')
})

// ---- 5. 暂停 / 继续 ----

function executePause(fetchImpl, streaming = true) {
  const pausePending = { value: false }
  const isStreaming = { value: streaming }
  const build = new Function('currentConversationId', 'isStreaming', 'pausePending', 'fetch',
    'getApiBaseUrl', 'getSessionId', 'setTimeout', 'clearTimeout', 'AbortController', 'console',
    `${bodyOf(STREAM, 'const pause = async () => {')}; return pause`)
  const calls = []
  const pause = build({ value: 'conv-1' }, isStreaming, pausePending,
    async (url, options) => { calls.push([url, options.method]); return fetchImpl(url, options) },
    () => 'http://api', () => 's', setTimeout, clearTimeout, AbortController, { warn: () => {} })
  return { pausePending, isStreaming, calls, promise: pause() }
}

test('暂停打中活跃轮次：POST /api/agent/pause，挂起「正在暂停」等终态事件', async () => {
  const state = executePause(async () => ({ ok: true, json: async () => ({ status: 'ok', paused: true }) }))
  assert.equal(state.pausePending.value, true, '点下就显示「正在暂停」，不等网络')
  assert.equal(await state.promise, 'pending')
  assert.deepEqual(state.calls, [['http://api/api/agent/pause/conv-1', 'POST']])
  assert.equal(state.pausePending.value, true, '要等 bubble_end paused 才撤')
})

test('暂停没打中（轮次已结束）或请求失败：撤掉「正在暂停」', async () => {
  const miss = executePause(async () => ({ ok: true, json: async () => ({ status: 'ok', paused: false }) }))
  assert.equal(await miss.promise, 'finished')
  assert.equal(miss.pausePending.value, false)

  const failed = executePause(async () => ({ ok: false, status: 403 }))
  assert.equal(await failed.promise, 'failed')
  assert.equal(failed.pausePending.value, false)

  const idle = executePause(async () => { throw new Error('should not be called') }, false)
  assert.equal(await idle.promise, 'finished', '没在跑就不发请求')
  assert.equal(idle.calls.length, 0)
})

test('任何终态事件都清掉「正在暂停」；user_pause 走既有「继续」按钮并有自己的提示语', () => {
  assert.match(STREAM, /else if \(evt === 'bubble_end' \|\| evt === 'error'\) \{\s*pausePending\.value = false/)
  const cancelledBranch = STREAM.slice(STREAM.indexOf("} else if (evt === 'cancelled') {"))
  assert.match(cancelledBranch.slice(0, 600), /pausePending\.value = false/)
  assert.match(STREAM, /roundSettled = true\s*pausePending\.value = false/, '气泡指针为空的兜底分支')
  // bubble_end paused 原样把 reason 交给 agentPaused，continue-bar 据此渲染
  assert.match(STREAM, /agentPaused\.value = d\.status === 'paused' \? \{ reason: d\.reason \|\| '' \} : null/)
  const hint = bodyOf(CI, 'const continueHint = computed(() => {')
  assert.match(hint, /reason === 'user_pause'\) return t\('chat\.continueHintUserPaused'\)/)
  assert.match(hint, /t\('chat\.continueHintPausedGeneric'\)/, '原因未知（切回会话的 run_state）不猜成步数上限')
})

test('暂停键紧挨停止键（两处输入区都有），正在暂停时禁用并显示提示条', () => {
  const pairs = CI.match(/class="pause-btn"[^\n]*\n\s*<button[^\n]*class="stop-btn"/g) || []
  assert.equal(pairs.length, 2, '空会话与有消息两套输入区都要有暂停键')
  assert.match(CI, /:disabled="pausePending"/)
  assert.match(CI, /v-if="isStreaming && pausePending"[^>]*>\s*<text class="link-hint">\{\{ \$t\('chat\.pausePending'\) \}\}/)
})

test('新增文案在中英文词条里都有', async () => {
  const zh = (await import('../../src/locales/zh-CN/chat.js')).default
  const en = (await import('../../src/locales/en-US/chat.js')).default
  for (const key of ['pauseRun', 'pausePending', 'pauseFailed', 'continueHintUserPaused', 'continueHintPausedGeneric',
    'undoRun', 'undoRunConfirmContent', 'undoRunDone', 'undoRunPartial', 'undoRunUnavailable']) {
    assert.ok(zh[key] && en[key], key)
  }
  const zhStream = (await import('../../src/locales/zh-CN/agentStream.js')).default
  assert.match(zhStream.stopConfirmedWithEdits, /\{count\}/)
})

// ---- 真跑 composable：事件 → 气泡 / 状态 ----

async function liveStream() {
  const { buildAgentStreamFactory } = await import('../_lib/agent-stream-factory.mjs')
  const s = buildAgentStreamFactory({ expose: 'handleEvent, currentAssistantBubble, createAssistantBubble' })
  const bubble = s.createAssistantBubble()
  bubble.isStreaming = true
  s.bubbles.value.push(bubble)
  s.currentAssistantBubble.value = s.bubbles.value[0]
  s.isStreaming.value = true
  return { s, bubble: s.bubbles.value[0], event: (name, data) => s.handleEvent(name, JSON.stringify(data)) }
}

test('cancelled 带修改次数：气泡标 documentEdited 并写「已完成 N 次文档修改」', async () => {
  const { s, bubble, event } = await liveStream()
  event('cancelled', { message: 'stopped', documentEdited: true, documentEdits: 2 })
  assert.equal(bubble.documentEdited, true)
  assert.equal(bubble.stopNotice, 'agentStream.stopConfirmedWithEdits')
  assert.equal(s.isStreaming.value, false)
  assert.equal(shouldOfferRunUndo(bubble, { isLatest: true, isStreaming: s.isStreaming.value }), true)
})

test('cancelled 没有修改：不标 documentEdited，不出撤销入口', async () => {
  const { bubble, event } = await liveStream()
  event('cancelled', { message: 'stopped', documentEdited: false, documentEdits: 0 })
  assert.equal(bubble.documentEdited, false)
  assert.equal(shouldOfferRunUndo(bubble, { isLatest: true, isStreaming: false }), false)
})

test('bubble_end paused/user_pause：清掉「正在暂停」，挂上「继续」，本轮改过文档则可撤销', async () => {
  const { s, bubble, event } = await liveStream()
  s.pausePending.value = true
  event('bubble_end', { status: 'paused', reason: 'user_pause', documentEdited: true })
  assert.equal(s.pausePending.value, false)
  assert.deepEqual(s.agentPaused.value, { reason: 'user_pause' })
  assert.equal(s.agentRunStatus.value, 'PAUSED')
  assert.equal(bubble.documentEdited, true)
})
