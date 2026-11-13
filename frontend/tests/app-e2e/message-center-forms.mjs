#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 消息中心表单的真实点击 e2e（QA D1 第二轮）/ message-center forms, real clicks on the real uni-app H5 build.
//
// 为什么单独一支：单测在 jsdom/Chrome 里用原生 <form>/<button>/<textarea> 挂组件，派发 submit 事件就算过；
// 应用里 uni-app 把它们编成 uni-form/uni-button/uni-textarea——按钮不带 form-type 永远不提交，
// textarea 的 input 事件值在 detail.value 里。于是「创建」「确认生成」「发送」在单测全绿、应用里点了没反应。
// 这里驱动 uni 编译后的真页面，用真实鼠标坐标点击（page.mouse 级），断言请求真的发出去、界面真的变了。
//
// 前置：H5 页面可访问（APP_E2E_BASE，默认 http://127.0.0.1:5174，dev:h5 或 dist/build/h5 静态服务），
//       页面的后端可用（local-mode 桌面后端即可，免登）。消息中心接口 /api/message-center/action
//       由本脚本拦截并返回合成数据：不需要账户、不连云端。
// Env：APP_E2E_BASE / PUPPETEER_EXECUTABLE_PATH（请用 Playwright 自带 Chromium，不要用系统 Chrome）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const BASE = process.env.APP_E2E_BASE || 'http://127.0.0.1:5174'
const EXE = process.env.PUPPETEER_EXECUTABLE_PATH
if (!EXE) { console.error('PUPPETEER_EXECUTABLE_PATH is required (Playwright Chromium)'); process.exit(2) }
const OUT = path.join(os.tmpdir(), 'app-e2e-message-center'); fs.mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))

const conversations = [{ id: 'c1', title: '合成客户沟通群', type: 'GROUP', role: 'OWNER', unreadCount: 0 }]
const messages = [], calls = []
function imReply(action, params) {
  if (action === 'self') return { id: 7, displayName: '合成律师' }
  if (action === 'agentScopes') return { agents: [] }
  if (action === 'create') { const c = { id: 'c' + (conversations.length + 1), title: params.title, type: params.type, role: 'OWNER', unreadCount: 0 }; conversations.unshift(c); return c }
  if (action === 'join') { const c = { id: 'joined', title: '凭码加入的群', type: 'GROUP', role: 'CLIENT', unreadCount: 0 }; conversations.unshift(c); return c }
  if (action === 'invite') return { code: 'SyntheticInviteCode0123456789ab', expiresAt: '2026-11-14T08:00:00Z', shareHistory: params.shareHistory === true }
  if (action === 'messages') return { messages: messages.filter(m => m.conversationId === params.conversationId), hasMore: false }
  if (action === 'members') return { humanCount: 2, members: [] }
  if (action === 'send') { const m = { id: messages.length + 1, conversationId: params.conversationId, senderId: 7, senderName: '合成律师', text: params.text, clientMessageId: params.clientMessageId }; messages.push(m); return m }
  return {}
}

const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ['--lang=zh-CN'], defaultViewport: { width: 1400, height: 900 } })
let failed = false
try {
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', e => errors.push(String(e)))
  await page.evaluateOnNewDocument(() => { localStorage.setItem('app_language', 'zh-CN'); window.checkbaDesktop = window.checkbaDesktop || { shell: { openExternal() {} } } })
  await page.setRequestInterception(true)
  page.on('request', req => {
    if (!req.url().includes('/api/message-center/action')) return req.continue()
    // The page and its API are usually on different origins (dev:h5 vs backend port): answer CORS too.
    const cors = { 'Access-Control-Allow-Origin': req.headers().origin || '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() || '{}'); let data = {}
    if (body.action === 'list') data = { conversations, notifications: [], counts: {}, projects: [] }
    else if (body.action === 'counts') data = { unreadMessages: 0, unreadNotifications: 0 }
    else if (body.action === 'im') { calls.push(body.params.action); data = imReply(body.params.action, body.params.params || {}) }
    req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ code: 0, data }) })
  })
  await page.goto(`${BASE.replace(/\/$/, '')}/#/pages/project-overview/project-overview?tab=messages`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.message-center .inbox-row', { timeout: 60000 })
  const press = async (scope, label) => {
    const handle = await page.evaluateHandle((scope, label) => [...document.querySelectorAll(scope + ' uni-button, ' + scope + ' button')].find(b => b.innerText.trim() === label), scope, label)
    const el = handle.asElement(); assert.ok(el, `button ${label} in ${scope}`)
    const box = await el.boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }
  const until = async (fn, what) => { for (let i = 0; i < 40; i++) { if (await fn()) return; await sleep(250) } throw new Error('timed out: ' + what) }

  // 1. 新建会话 → 创建
  await press('.list-actions', '新建会话'); await page.waitForSelector('.create-form .uni-input-input')
  await page.click('.create-form .uni-input-input'); await page.type('.create-form .uni-input-input', '合成新群', { delay: 60 })
  await press('.create-form', '创建')
  await until(() => calls.includes('create'), 'create request after clicking 创建')
  console.log('ok 1 - 创建 sends create')

  // 2. 邀请码 → 客户 → 确认生成 (default: only messages after joining)
  await page.click('.message-center .inbox-row'); await sleep(800)
  await press('.center-detail', '邀请码'); await page.waitForSelector('.invite-result select')
  await page.select('.invite-result select', 'CLIENT'); await sleep(300)
  await press('.invite-result', '确认生成')
  await until(() => calls.includes('invite'), 'invite request after clicking 确认生成')
  await page.waitForSelector('.invite-result code')
  assert.equal(await page.$eval('.invite-result code', e => e.textContent.trim()), 'SyntheticInviteCode0123456789ab')
  console.log('ok 2 - 确认生成 issues a client code and shows it')
  await press('.invite-result', '完成')

  // 3. 发送 button sends what was typed in the composer
  await page.click('.message-composer textarea'); await page.type('.message-composer textarea', '合成消息', { delay: 40 })
  await press('.message-composer', '发送')
  await until(() => calls.includes('send'), 'send request after clicking 发送')
  assert.equal(messages.at(-1).text, '合成消息')
  console.log('ok 3 - 发送 sends the typed text')

  // 4. 邀请码加入 → 加入
  await press('.list-actions', '邀请码加入'); await page.waitForSelector('.create-form .uni-input-input')
  await page.click('.create-form .uni-input-input'); await page.type('.create-form .uni-input-input', 'AnotherSyntheticCode', { delay: 40 })
  await press('.create-form', '加入')
  await until(() => calls.includes('join'), 'join request after clicking 加入')
  console.log('ok 4 - 加入 sends join')
  assert.deepEqual(errors, [])
} catch (error) {
  failed = true; console.error('not ok -', error.message)
} finally {
  const pages = await browser.pages(); if (pages[1]) await pages[1].screenshot({ path: path.join(OUT, 'last.png') }).catch(() => {})
  await browser.close()
}
console.log('screenshot: ' + path.join(OUT, 'last.png'))
process.exit(failed ? 1 : 0)
