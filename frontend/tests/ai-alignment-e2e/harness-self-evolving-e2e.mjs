#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness² / VeriHarness / 零打扰自动判断自进化 真浏览器 + 真后端端到端走查（dev-board#1481）。
//
// 覆盖完整用户链路：
// 1) 在隔离后端（独立 user.home + H2 文件库）与真实前端（H5 dev + 无头 Chromium）中创建项目并打开 AI 助手面板；
// 2) 第 1 轮模型先调失败的检索工具（extract_file_text 不存在的文件 ID），真实触发后端
//    HarnessDiagnosticService 后台静默自愈；
// 3) 第 2 轮模型结合自愈处方收敛输出 <final>，真实触发后端 HarnessEvolutionService：
//    a) 对话流与过程卡零打扰（严禁渲染 [data-harness-evolution-card] 与 [data-harness-adaptation-list]）；
//    b) 后端自动判定作用域（scope=user）并自动升格为专属技能（status=PROMOTED_SKILL，注册入 /api/skills/list）；
// 4) 验证事后回滚接口 DELETE /api/agent/harness/evolutions/:id 正常清理记忆与自动升格的技能目录。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hardenPageInput } from '../_lib/electron-cdp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendDir = path.resolve(here, '../..')
const backendDir = path.resolve(frontendDir, '../backend')

const FRONTEND_PORT = Number(process.env.HARNESS_E2E_FRONTEND_PORT || 5178)
const BACKEND_PORT = Number(process.env.HARNESS_E2E_BACKEND_PORT || 9897)
const BASE = process.env.HARNESS_E2E_BASE || `http://127.0.0.1:${FRONTEND_PORT}`
const BACKEND = process.env.HARNESS_E2E_BACKEND || `http://127.0.0.1:${BACKEND_PORT}`
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.env.HARNESS_E2E_OUT || path.join(os.tmpdir(), 'harness-self-evolving-e2e')
const MARKER = `HARNESS_E2E_${Date.now()}`
fs.mkdirSync(OUT, { recursive: true })

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  console.error('Missing puppeteer-core; ensure node_modules is available in frontend')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(check, timeout = 30000, label = 'condition') {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch {
      // retry until deadline
    }
    await sleep(250)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function api(endpoint, options = {}) {
  const response = await fetch(BACKEND + endpoint, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${endpoint}: HTTP ${response.status} ${text.slice(0, 240)}`)
  }
  return body
}

const dataOf = (body) => (body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body)

function startModelFixture() {
  let mainStreamRound = 0
  const completeStream = (response, content) => {
    response.write(`data: ${JSON.stringify({
      id: 'fixture',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      id: 'fixture',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`)
    response.end('data: [DONE]\n\n')
  }

  const server = http.createServer(async (request, response) => {
    const urlPath = (request.url || '').split('?')[0]
    if (urlPath === '/api/account/me') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        username: 'harness_e2e',
        accountId: 'acc_harness_e2e',
        displayName: 'Harness E2E User',
        plan: 'paid',
      }))
      return
    }
    if (urlPath === '/api/account/entitlements') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ entitlements: [] }))
      return
    }
    if (urlPath === '/api/account/ai-usage') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        configured: true,
        hasKey: true,
        creditsCents: 100000,
        limitUsd: 100,
        usageUsd: 0,
        remainingUsd: 100,
        keyMasked: 'sk-or-***',
      }))
      return
    }
    if (urlPath === '/api/account/ai-key') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ openrouterKey: 'sk-or-fixture-key', limitUsd: 100 }))
      return
    }
    if (urlPath === '/api/account/membership') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ tier: 'pro', creditsCents: 100000 }))
      return
    }
    if (urlPath === '/api/account/ledger') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ entries: [] }))
      return
    }
    if (urlPath === '/api/auth/awdk-login') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 0, data: { token: 'awdt_fixture_token' } }))
      return
    }
    if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    let raw = ''
    for await (const chunk of request) raw += chunk
    const payload = JSON.parse(raw || '{}')
    const prompt = JSON.stringify(payload.messages || [])
    const isMain = prompt.includes(MARKER)

    if (payload.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.flushHeaders()
      if (isMain) {
        mainStreamRound += 1
        // 第 1 轮：调用 extract_file_text 读取不存在的补充协议，触发后端 HarnessDiagnosticService 自愈诊断
        // 第 2 轮：看到自愈处方后输出 <final>，触发后端 HarnessEvolutionService 自进化沉淀
        const content = mainStreamRound === 1
          ? '<process name="读取补充协议"><tool_code>extract_file_text({"fileId":999999})</tool_code></process>'
          : `<final>已根据「违约金条款」审查规范完成核查，缺失的补充协议已按 Harness 处方标为待核实（${MARKER}）。</final>`
        setTimeout(() => completeStream(response, content), 40)
      } else {
        setTimeout(() => completeStream(response, 'Fixture helper stream'), 20)
      }
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      id: 'fixture',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload.model || 'fixture',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture helper response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
  })

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    resolve({
      server,
      siteUrl: `http://127.0.0.1:${port}`,
      baseUrl: `http://127.0.0.1:${port}/v1`,
    })
  }))
}

const home = path.join(os.tmpdir(), `harness-e2e-home-${Date.now()}`)
fs.mkdirSync(path.join(home, 'cwd'), { recursive: true })
fs.mkdirSync(path.join(home, '.aiworkdeck'), { recursive: true })
fs.writeFileSync(path.join(home, '.aiworkdeck', 'account.json'), JSON.stringify({
  key: 'awdk_harness_e2e_fixture_key',
  username: 'harness_e2e',
  accountId: 'acc_harness_e2e',
  displayName: 'Harness E2E User',
  connectedAt: new Date().toISOString(),
  lastSyncAt: new Date().toISOString(),
}, null, 2))

let backendChild = null
let frontendChild = null
let browser = null
let failed = false

const cleanup = async (fixture) => {
  if (browser) await browser.close().catch(() => {})
  if (frontendChild) {
    try { frontendChild.kill('SIGTERM') } catch {}
  }
  if (backendChild) {
    try { backendChild.kill('SIGTERM') } catch {}
  }
  if (fixture) {
    fixture.server.closeAllConnections?.()
    await new Promise((resolve) => fixture.server.close(resolve))
  }
}

const fixture = await startModelFixture()

try {
  // 1. 若 BACKEND 未就绪则自起隔离后端
  const backendAlreadyUp = await fetch(`${BACKEND}/api/auth/me`).then((r) => r.ok).catch(() => false)
  if (!backendAlreadyUp) {
    const jar = process.env.HARNESS_E2E_JAR
      || fs.readdirSync(path.join(backendDir, 'target'))
        .filter((f) => f.endsWith('.jar') && !f.includes('sources') && !f.includes('original'))
        .map((f) => path.join(backendDir, 'target', f))[0]
    if (!jar || !fs.existsSync(jar)) {
      throw new Error(`Backend jar not found in ${path.join(backendDir, 'target')}; run mvn package -DskipTests first`)
    }
    const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java'
    console.log(`[E2E] Spawning isolated backend on :${BACKEND_PORT} (home=${home})...`)
    backendChild = spawn(javaBin, [
      '-Duser.home=' + home,
      '-Dai.account.base-url=' + fixture.siteUrl,
      '-Dai.model.open-router.base-url=' + fixture.baseUrl,
      '-jar',
      jar,
    ], {
      cwd: path.join(home, 'cwd'),
      env: {
        ...process.env,
        SPRING_PROFILES_ACTIVE: 'desktop',
        SERVER_PORT: String(BACKEND_PORT),
        AI_SKILLS_BUILTIN_DIR: path.join(backendDir, 'skills'),
        SPRING_DATASOURCE_URL: `jdbc:h2:file:${home}/db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const backendLog = fs.createWriteStream(path.join(OUT, 'backend.log'))
    backendChild.stdout.pipe(backendLog)
    backendChild.stderr.pipe(backendLog)
    await until(
      async () => fetch(`${BACKEND}/api/auth/me`).then((r) => r.ok).catch(() => false),
      120000,
      `isolated backend on ${BACKEND}`,
    )
  }

  // 2. 若 FRONTEND 未就绪则自起 H5 dev server
  const frontendAlreadyUp = await fetch(BASE).then((r) => r.ok).catch(() => false)
  if (!frontendAlreadyUp) {
    console.log(`[E2E] Spawning Vite H5 dev server on :${FRONTEND_PORT}...`)
    frontendChild = spawn('npx', ['uni', '--port', String(FRONTEND_PORT)], {
      cwd: frontendDir,
      env: {
        ...process.env,
        VITE_API_BASE_URL: BACKEND,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const frontendLog = fs.createWriteStream(path.join(OUT, 'frontend.log'))
    frontendChild.stdout.pipe(frontendLog)
    frontendChild.stderr.pipe(frontendLog)
    await until(
      async () => fetch(BASE).then((r) => r.ok).catch(() => false),
      90000,
      `frontend dev server on ${BASE}`,
    )
  }

  // 3. 将隔离后端的 OpenRouter 指向本机确定性模型 Fixture
  const config = await api('/api/admin/config')
  config.external ||= {}
  config.external.openRouter = { apiKey: 'fixture-only-key', baseUrl: fixture.baseUrl }
  config.ai ||= {}
  config.ai.activeProvider = 'OPENROUTER'
  config.ai.defaultModel = 'deepseek/deepseek-v4-flash'
  const saved = await api('/api/admin/config', { method: 'POST', body: config })
  if (saved?.code !== 0) throw new Error(`Fixture AI config rejected: ${JSON.stringify(saved)}`)

  const project = await api('/api/projects', {
    method: 'POST',
    body: { name: `Harness² 自进化 E2E ${MARKER}`, projectType: 'BLANK' },
  })
  if (!project?.id) throw new Error(`Project creation failed: ${JSON.stringify(project)}`)

  // 4. 启动真实 Chromium 浏览器打开项目概览与 AI 助手面板
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.HARNESS_E2E_HEADFUL !== '1',
    args: ['--no-first-run'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1360, height: 860 })
  await page.evaluateOnNewDocument((backend) => {
    window.checkbaDesktop = { apiBaseUrl: backend, shell: { openExternal: async () => true } }
  }, BACKEND)
  await hardenPageInput(page)
  await page.goto(`${BASE}/#/pages/project-overview/project-overview?id=${project.id}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  })
  await hardenPageInput(page)

  const click = async (selector) => {
    await page.waitForSelector(selector, { visible: true, timeout: 30000 })
    const point = await page.$eval(selector, (el) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const box = el.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })
    await page.mouse.click(point.x, point.y)
  }

  await page.waitForSelector('[title="AI 助手"], [title="AI Assistant"]', { timeout: 90000 })
  // 项目打开时右栏 AI 面板默认展开（ai-panel-default-open）；若未展开再点按钮切换
  const initialAiInput = await page.$('.side-panel-ai .chat-input-rich')
  if (!initialAiInput) {
    await click('[title="AI 助手"], [title="AI Assistant"]')
  }
  await page.waitForSelector('.side-panel-ai .chat-input-rich', { visible: true, timeout: 30000 })

  // 5. 发送指令：触发 Round 1 工具失败 → Harness 后台静默自愈 → Round 2 收尾 → 后台自动判定全局作用域并自动升格为专属技能
  const promptText = `${MARKER} 请按「违约金条款」专项规范核查补充协议`
  await click('.side-panel-ai .chat-input-rich')
  await page.keyboard.type(promptText, { delay: 2 })
  await sleep(150)
  await click('.send-btn')

  // 等待本轮正文完成渲染
  await page.waitForFunction((marker) => {
    const answers = [...document.querySelectorAll('[data-chat-answer]')]
    return answers.some((el) => (el.innerText || '').includes(marker))
  }, { timeout: 45000 }, MARKER)
  console.log('PASS 1: 真实浏览器完成自愈闭环并渲染最终正文回答')

  // 6. 验证零打扰 UI：对话流与过程卡中严禁弹出打扰用户的三选一卡片或底层自愈归因块
  const botheringCard = await page.$('[data-harness-evolution-card]')
  if (botheringCard) {
    throw new Error('Chat stream must NOT render bothering [data-harness-evolution-card]')
  }
  const botheringAdaptationList = await page.$('[data-harness-adaptation-list]')
  if (botheringAdaptationList) {
    throw new Error('ProcessCard must NOT render noisy [data-harness-adaptation-list]')
  }
  console.log('PASS 2: 对话流零打扰验证通过（无自进化选择卡、无底层自愈噪音块）')

  // 7. 验证后端自动判断并处理（无需人工点击：自动判定 scope=user 且自动升格 status=PROMOTED_SKILL）
  const autoEvolved = await until(async () => {
    const list = dataOf(await api(`/api/agent/harness/evolutions?projectId=${project.id}`))
    return Array.isArray(list) && list.length > 0 ? list[0] : false
  }, 15000, 'autonomous evolution record persisted')

  if (autoEvolved.scope !== 'user') {
    throw new Error(`Expected automatic scope judgment to select 'user', got: ${autoEvolved.scope}`)
  }
  if (autoEvolved.status !== 'PROMOTED_SKILL' || !autoEvolved.promotedSkillId?.startsWith('user-evo-')) {
    throw new Error(`Expected automatic skill promotion to PROMOTED_SKILL, got: ${JSON.stringify(autoEvolved)}`)
  }
  console.log('PASS 3: 后端自动判断作用域（scope=user）并自动升格为专属技能（status=PROMOTED_SKILL）:', autoEvolved.promotedSkillId)

  const skills = await api('/api/skills/list')
  const promotedSkill = Array.isArray(skills) && skills.find((s) => s.id === autoEvolved.promotedSkillId)
  if (!promotedSkill) {
    throw new Error(`Auto-promoted skill ${autoEvolved.promotedSkillId} not found in /api/skills/list`)
  }
  console.log('PASS 4: SkillRegistry 已自动注册新技能:', promotedSkill.id)
  await page.screenshot({ path: path.join(OUT, 'harness-silent-auto-evolved.png') })

  // 8. 验证事后回滚接口仍可正常清理记忆与自动升格的技能目录
  await api(`/api/agent/harness/evolutions/${autoEvolved.id}`, { method: 'DELETE' })
  const evolutionsAfterRevert = dataOf(await api(`/api/agent/harness/evolutions?projectId=${project.id}`))
  if (!Array.isArray(evolutionsAfterRevert) || evolutionsAfterRevert[0]?.status !== 'REVERTED') {
    throw new Error(`Expected REVERTED status in DB after DELETE, got: ${JSON.stringify(evolutionsAfterRevert)}`)
  }
  const skillsAfterRevert = await api('/api/skills/list')
  if (Array.isArray(skillsAfterRevert) && skillsAfterRevert.some((s) => s.id === promotedSkill.id)) {
    throw new Error(`Auto-promoted skill ${promotedSkill.id} should be removed after revert`)
  }
  console.log('PASS 5: 事后撤销接口验证通过，状态已更新为 REVERTED 且技能目录已清理')
  console.log(`Harness² Silent Auto-Evolving E2E ALL PASSED. Screenshots saved to: ${OUT}`)
} catch (err) {
  failed = true
  if (browser) {
    const pages = await browser.pages().catch(() => [])
    const page = pages[pages.length - 1]
    if (page) {
      await page.screenshot({ path: path.join(OUT, 'failure.png'), fullPage: true }).catch(() => {})
    }
  }
  console.error('[E2E FAILED]', err.stack || err)
} finally {
  await cleanup(fixture)
  try {
    fs.rmSync(home, { recursive: true, force: true })
  } catch {}
}

process.exit(failed ? 1 : 0)
