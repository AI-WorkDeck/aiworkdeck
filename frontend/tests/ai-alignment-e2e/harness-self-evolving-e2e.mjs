#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness² / VeriHarness / 用户可掌舵自进化 真浏览器 + 真后端端到端走查（dev-board#1481）。
//
// 覆盖完整用户链路：
// 1) 在隔离后端（独立 user.home + H2 文件库）与真实前端（H5 dev + 无头 Chromium）中创建项目并打开 AI 助手面板；
// 2) 第 1 轮模型先调失败的检索工具（extract_file_text 不存在的文件 ID），真实触发后端
//    HarnessDiagnosticService（SSE harness_adaptation）→ 过程卡内联渲染「Harness 自愈」诊断与处方；
// 3) 第 2 轮模型结合自愈处方收敛输出 <final>，真实触发后端 HarnessEvolutionService（SSE harness_evolution）
//    写入记忆空间 topics/harness-evo-*.md 并落库 ai_harness_evolution 表 → 根气泡渲染自进化卡片；
// 4) 在浏览器中真实点击自进化卡片：
//    a) 展开「查看进化前后对比」（[data-evolution-contrast]）；
//    b) 点击「设为跨项目全局生效」（[data-evolution-scope-btn]）→ 验证前后端 scope 变为 user；
//    c) 点击「升格为专属技能」（[data-evolution-promote-btn]）→ 验证显示「已升格技能：user-evo-*」且 /api/skills/list 查得到该技能；
// 5) 刷新页面（重走历史回放 getAiHistory + restoreHarnessEvolutions），验证自进化卡按 assistantMessageId
//    精准挂回原历史气泡，且仍保持 PROMOTED_SKILL 状态；
// 6) 在刷新后的历史气泡上真实点击「撤销此次学习」（[data-evolution-revert-btn]），验证状态变为 REVERTED 且技能目录被清理。

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

  // 5. 发送指令：触发 Round 1 工具失败 → Harness 自愈（harness_adaptation）→ Round 2 收尾 → 自进化卡片（harness_evolution）
  const promptText = `${MARKER} 请按「违约金条款」专项规范核查补充协议`
  await click('.side-panel-ai .chat-input-rich')
  await page.keyboard.type(promptText, { delay: 2 })
  await sleep(150)
  await click('.send-btn')

  // 等待本轮完成并渲染出 HarnessEvolutionCard
  await page.waitForSelector('[data-harness-evolution-card]', { visible: true, timeout: 45000 })
  console.log('PASS 1: 根气泡已渲染 Harness 自进化卡片 [data-harness-evolution-card]')

  // 展开执行过程摘要，核实 ProcessCard 内联渲染了 [data-harness-adaptation-list]
  const hasActivitySummary = await page.$('.activity-summary')
  if (hasActivitySummary) {
    const isExpanded = await page.$eval('.activity-summary', (btn) => btn.getAttribute('aria-expanded') === 'true')
    if (!isExpanded) {
      await page.$eval('.activity-summary', (btn) => btn.click())
    }
  }
  const collapsedProcHeader = await page.$('.process-card:not(.is-expanded) .process-header')
  if (collapsedProcHeader) {
    await page.$eval('.process-card:not(.is-expanded) .process-header', (hdr) => hdr.click())
  }
  await page.waitForSelector('[data-harness-adaptation-list]', { visible: true, timeout: 15000 })
  const adaptationText = await page.$eval('[data-harness-adaptation-list]', (el) => el.innerText)
  if (!adaptationText.includes('Harness 自愈') && !adaptationText.includes('Harness Self-Healing')) {
    throw new Error(`Unexpected adaptation card text: ${adaptationText}`)
  }
  console.log('PASS 2: 过程卡内联展示「Harness 自愈」诊断与处方:', adaptationText.replace(/\s+/g, ' ').slice(0, 80))

  // 6. 在自进化卡片上交互：展开前后对比 → 切换作用域为跨项目全局 → 升格为专属技能
  await click('[data-evolution-contrast-toggle]')
  await page.waitForSelector('[data-evolution-contrast]', { visible: true, timeout: 10000 })
  console.log('PASS 3: 自进化卡展开「进化前后对比」成功')

  await click('[data-evolution-scope-btn]')
  await until(async () => {
    const list = dataOf(await api(`/api/agent/harness/evolutions?projectId=${project.id}`))
    return Array.isArray(list) && list.length > 0 && list[0].scope === 'user' ? list[0] : false
  }, 15000, 'evolution scope switched to user')
  console.log('PASS 4: 切换进化规则作用域（project -> user）成功并已落库')

  await click('[data-evolution-promote-btn]')
  await page.waitForSelector('[data-evolution-promoted-pill]', { visible: true, timeout: 15000 })
  const pillText = await page.$eval('[data-evolution-promoted-pill]', (el) => el.innerText)
  if (!pillText.includes('user-evo-')) {
    throw new Error(`Expected promoted skill pill to contain user-evo-*, got: ${pillText}`)
  }
  const skills = await api('/api/skills/list')
  const promotedSkill = Array.isArray(skills) && skills.find((s) => s.id && s.id.startsWith('user-evo-'))
  if (!promotedSkill) {
    throw new Error('Promoted skill not found in /api/skills/list')
  }
  console.log('PASS 5: 一键升格为专属技能成功，SkillRegistry 已注册:', promotedSkill.id)
  await page.screenshot({ path: path.join(OUT, 'harness-evolved-promoted.png') })

  // 7. 刷新页面并重新打开历史会话，验证持久化与 restoreHarnessEvolutions 历史回放
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await hardenPageInput(page)
  await page.waitForSelector('[title="AI 助手"], [title="AI Assistant"]', { timeout: 60000 })
  const aiPanelVisible = await page.$('.side-panel-ai .chat-input-rich')
  if (!aiPanelVisible) {
    await click('[title="AI 助手"], [title="AI Assistant"]')
    await page.waitForSelector('.side-panel-ai .chat-input-rich', { visible: true, timeout: 30000 })
  }
  // 从 History 下拉切回刚才的会话
  const cardAlreadyVisible = await page.$('[data-harness-evolution-card]')
  if (!cardAlreadyVisible) {
    await click('[title="History"], [title="历史对话"], [title="历史记录"]')
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('.ai-dropdown-panel .menu-item:not(.header)')]
      return rows.length > 0 && !rows.some((n) => /加载中|Loading/i.test(n.innerText))
    }, { timeout: 15000 })
    const histPoint = await page.evaluate((marker) => {
      const rows = [...document.querySelectorAll('.ai-dropdown-panel .menu-item:not(.header)')]
      const row = rows.find((n) => n.innerText.includes(marker)) || rows[0]
      if (!row) return null
      const box = row.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }, MARKER)
    if (!histPoint) throw new Error('Conversation entry missing from History dropdown')
    await page.mouse.click(histPoint.x, histPoint.y)
  }

  await page.waitForSelector('[data-harness-evolution-card]', { visible: true, timeout: 25000 })
  await page.waitForSelector('[data-evolution-promoted-pill]', { visible: true, timeout: 10000 })
  console.log('PASS 6: 页面刷新并回放历史后，自进化卡片按 assistantMessageId 恢复挂载且保留已升格状态')

  // 8. 在历史气泡上点击「撤销此次学习」，验证状态变为 REVERTED 且升格技能被移除
  await click('[data-evolution-revert-btn]')
  await page.waitForSelector('[data-evolution-reverted-notice]', { visible: true, timeout: 15000 })
  const evolutionsAfterRevert = dataOf(await api(`/api/agent/harness/evolutions?projectId=${project.id}`))
  if (!Array.isArray(evolutionsAfterRevert) || evolutionsAfterRevert[0]?.status !== 'REVERTED') {
    throw new Error(`Expected REVERTED status in DB after revert, got: ${JSON.stringify(evolutionsAfterRevert)}`)
  }
  const skillsAfterRevert = await api('/api/skills/list')
  if (Array.isArray(skillsAfterRevert) && skillsAfterRevert.some((s) => s.id === promotedSkill.id)) {
    throw new Error(`Promoted skill ${promotedSkill.id} should be removed after revert`)
  }
  await page.screenshot({ path: path.join(OUT, 'harness-reverted-after-reload.png') })
  console.log('PASS 7: 刷新后点击「撤销此次学习」成功，数据库状态已更新为 REVERTED 且技能目录已清理')
  console.log(`Harness² Self-Evolving E2E ALL PASSED. Screenshots saved to: ${OUT}`)
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
