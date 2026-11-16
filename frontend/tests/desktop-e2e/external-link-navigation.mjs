// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// S26 阶段 1：主窗口导航白名单的真 Electron 回归。
// 源码 Electron + 隔离的后端/H2/HOME/端口 + 本地 OpenAI 兼容假模型（不花钱、不连外网）。
// AI 回复里带一条外部 Markdown 链接，真鼠标点它：主窗口 URL 不变、shell.openExternal（桩）收到该地址。
// 另验：绕过渲染层委托的裸链接也被主进程拦下并外开；window.open(about:blank) 不建子窗口；
// 未登记的 <webview>（任意 preload/分区）挂不上；LOWA 编辑器 webview 照常加载；主窗口与 guest 都是沙箱。
// 先构建 H5（npm run build:h5）、编辑器（build:zetaoffice + LOWA 资源）与后端 JAR；JAVA_HOME 指 JDK 21：
//   JAVA_HOME=<jdk21> node frontend/tests/desktop-e2e/external-link-navigation.mjs
// 可用 AWD_E2E_BACKEND_JAR 指定后端 JAR（默认 backend/target/backend-0.0.1-SNAPSHOT.jar）。
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
// 隔离目录固定放 /tmp（不落用户目录）。
const run = fs.mkdtempSync('/tmp/awd-external-link-')
const home = path.join(run, 'home')
fs.mkdirSync(path.join(home, '.aiworkdeck'), { recursive: true })
const LINK = 'https://example.com/s26-report?from=ai'
const BARE = 'https://example.org/s26-bare'
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const [backendPort, cdpPort, ...servicePorts] = await Promise.all(Array.from({ length: 6 }, freePort))
const base = `http://127.0.0.1:${backendPort}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, timeout = 60000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { try { const result = await fn(); if (result) return result } catch (e) { last = e }; await sleep(200) }
  throw new Error(`timeout: ${label}${last ? ' (' + last.message + ')' : ''}`)
}

// 假模型：账户接口 + chat/completions。主回答（stream）给一段带外部链接的 Markdown。
const modelServer = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
  if (req.url === '/api/account/me') return json({ username: 'fixture', accountId: 'acc_fixture', plan: 'paid' })
  if (req.url === '/api/account/ai-key') return json({ provider: 'bailian', apiKey: 'awdai_fixture_only', baseUrl: `http://${req.headers.host}/api/account/ai/v1`, defaultModel: 'fixture', limitUsd: 100 })
  if (req.url === '/api/account/ai-usage') return json({ configured: true, hasKey: true, creditsCents: 100000, limitUsd: 100, usageUsd: 0, remainingUsd: 100 })
  if (req.url === '/api/account/entitlements') return json({ entitlements: [] })
  if (req.url === '/api/account/membership') return json({ tier: 'pro', creditsCents: 100000 })
  if (req.url.endsWith('/models')) return json({ defaultModel: 'fixture', models: [{ id: 'fixture', name: 'Fixture', contextLength: 131072, maxOutputTokens: 8192, supportsTools: true, supportsVision: false, inputPricePerMillion: 0, outputPricePerMillion: 0 }] })
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return }
  const body = JSON.parse(raw || '{}')
  modelCalls++
  if (body.stream !== true) return json({ id: 'helper', choices: [{ message: { role: 'assistant', content: '外部链接回归' }, finish_reason: 'stop' }] })
  const content = `<final>参考资料见 [S26 报告](${LINK})。</final>`
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }) + '\n\n')
  res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve))
const modelPort = modelServer.address().port
fs.writeFileSync(path.join(home, '.aiworkdeck/account.json'), JSON.stringify({ key: 'awdk_fixture_only', accountId: 'acc_fixture', username: 'fixture' }))

// 壳的包装：桩掉 shell.openExternal（记到文件，不真开浏览器），并记录主窗口与 guest 的实际 webPreferences。
const opened = path.join(run, 'open-external.log')
const prefsFile = path.join(run, 'web-preferences.json')
const wrapper = path.join(run, 'main.cjs')
fs.writeFileSync(wrapper, `const {app, shell, BrowserWindow}=require('electron');const fs=require('fs');
shell.openExternal=async(url)=>{fs.appendFileSync(${JSON.stringify(opened)},url+'\\n')};
// 不抢前台（本机可能有人在录屏）：窗口只做非激活显示，CDP 输入不需要系统焦点。
if(process.platform==='darwin'){try{app.setActivationPolicy('accessory')}catch(e){}}
BrowserWindow.prototype.show=BrowserWindow.prototype.showInactive;BrowserWindow.prototype.focus=function(){};app.focus=()=>{};
const prefs={};const save=()=>fs.writeFileSync(${JSON.stringify(prefsFile)},JSON.stringify(prefs));
app.on('web-contents-created',(_e,wc)=>{wc.on('did-finish-load',()=>{try{const p=wc.getLastWebPreferences();let o='';try{o=new URL(wc.getURL()).origin}catch(e){}prefs[wc.getType()+(wc.getType()==='window'?'':':'+o)]={sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};save()}catch(e){}})});
require(${JSON.stringify(path.join(root, 'desktop/main/main.js'))});
`)
const log = fs.openSync(path.join(run, 'electron.log'), 'w')
const javaLog = fs.openSync(path.join(run, 'backend.log'), 'w')
const electron = path.join(root, 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const env = { ...process.env, AWD_HOME: home, AWD_DISABLE_UPDATES: '1', SPRING_PROFILES_ACTIVE: 'desktop',
  STORAGE_LOCAL_ROOT_PATH: path.join(home, 'storage'),
  SPRING_DATASOURCE_URL: `jdbc:h2:file:${home}/db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE`,
  CHECKBA_BACKEND_PORT: String(backendPort), CHECKBA_PPTX_PORT: String(servicePorts[0]), CHECKBA_MINERU_PORT: String(servicePorts[1]), CHECKBA_KOKORO_PORT: String(servicePorts[2]), CHECKBA_ASR_PORT: String(servicePorts[3]),
  AIWORKDECK_DESKTOP_DEV: '0', AI_SKILLS_BUILTIN_DIR: path.join(root, 'backend/skills') }
const jar = path.join(run, 'backend.jar')
fs.copyFileSync(process.env.AWD_E2E_BACKEND_JAR || path.join(root, 'backend/target/backend-0.0.1-SNAPSHOT.jar'), jar)
const java = spawn(path.join(process.env.JAVA_HOME, 'bin/java'), ['-Duser.home=' + home, '-Dai.account.base-url=http://127.0.0.1:' + modelPort,
  '-Dai.model.open-router.base-url=http://127.0.0.1:' + modelPort + '/v1', '-jar', jar, `--server.port=${backendPort}`], { cwd: run, env, stdio: ['ignore', javaLog, javaLog], detached: true })
let child, browser, page
let modelCalls = 0
const evidence = { run, checks: [] }
console.log(JSON.stringify({ run, backendPort, cdpPort }))
const readOpened = () => (fs.existsSync(opened) ? fs.readFileSync(opened, 'utf8').trim().split('\n').filter(Boolean) : [])
try {
  await until(async () => {
    if (java.exitCode !== null) throw new Error('isolated backend exited')
    return (await fetch(base + '/api/admin/wizard')).ok
  }, 'isolated backend', 180000)
  const project = await (await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'S26 外部链接', projectType: 'BLANK' }) })).json()
  const projectId = (project.data || project).id
  assert.ok(projectId, JSON.stringify(project))
  child = spawn(electron, [wrapper, `--remote-debugging-port=${cdpPort}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], { cwd: root, stdio: ['ignore', log, log], env, detached: true })
  const ws = await until(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl, 'CDP endpoint', 120000)
  browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null })
  page = await until(async () => (await browser.pages()).find(p => p.url().includes('/h5/index.html')), 'main window page')
  await page.waitForFunction(() => window.checkbaDesktop && window.__checkbaActiveOverviewVm, { timeout: 120000 })
  // 进项目工作台：CDP 的 goto 是浏览器发起的导航（不走 will-navigate）；带 id 的工作台路由要整页重载才生效。
  const indexUrl = page.url().split('#')[0]
  await until(async () => {
    const ok = await page.evaluate(id => location.hash.includes('project-overview') && location.hash.includes('id=' + id) && !!document.querySelector('.chat-input-rich'), projectId).catch(() => false)
    if (!ok) {
      await page.goto(indexUrl + '#/pages/project-overview/project-overview?id=' + projectId, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await sleep(5000)
    }
    return ok
  }, 'project workbench with AI input', 180000)
  // 首启引导浮层（macOS 权限引导、启动提示）按真人走法关掉，别挡住后面的点击。
  const dismissOverlays = async () => {
    for (const sel of ['.awd-perm-close', '.ocd-mask .ocd-actions .ocd-btn:not(.primary)']) {
      for (const el of await page.$$(sel)) if (await el.isVisible()) { await el.click(); await sleep(500) }
    }
  }
  await sleep(3000)
  await dismissOverlays()
  const appUrl = page.url()
  await page.evaluate(() => {
    window.__s26 = { newTabs: [] }
    window.checkbaDesktop.browser.onOpenNewTab(data => window.__s26.newTabs.push(data))
  })

  // 假账户连着平台通道，平台通道要求跨境单独同意：以本机管理员会话勾上（等同设置页里勾选）。
  const consent = await page.evaluate(async () => {
    const raw = localStorage.getItem('checkba_session_id') || ''
    let sid = raw
    try { const v = JSON.parse(raw); sid = (v && typeof v === 'object') ? v.data : v } catch (e) { /* plain string */ }
    const r = await fetch(window.checkbaDesktop.apiBaseUrl + '/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Id': sid || '' }, body: JSON.stringify({ ai: { crossBorderConsent: true } }) })
    return { status: r.status, body: (await r.text()).slice(0, 200) }
  })
  assert.equal(consent.status, 200, JSON.stringify(consent))

  // 1) 真实 AI 回复里的外部链接，真鼠标点击。
  const input = await until(async () => { for (const el of await page.$$('.chat-input-rich')) if (await el.isVisible()) return el }, 'visible AI input')
  await input.click()
  await input.type('请给我参考资料链接')
  // 点可见且未被遮挡的发送键；没发出去（假模型没收到请求）就回车再试一次。
  const clickSend = async () => {
    const hit = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.send-btn')].find(b => b.getBoundingClientRect().width > 0)
      if (!btn) return null
      const r = btn.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2
      const top = document.elementFromPoint(x, y)
      return top && (top === btn || btn.contains(top)) ? { x, y } : null
    })
    assert.ok(hit, 'visible, unobstructed send button')
    await page.mouse.click(hit.x, hit.y)
  }
  await dismissOverlays()
  await clickSend()
  try { await until(() => modelCalls > 0, 'model request after send', 45000) } catch (e) {
    const again = await until(async () => { for (const el of await page.$$('.chat-input-rich')) if (await el.isVisible()) return el }, 'AI input for retry')
    await again.click(); await page.keyboard.press('Enter')
    await until(() => modelCalls > 0, 'model request after Enter', 30000)
  }
  const linkSel = `.markdown-body a[href="${LINK}"]`
  const link = await until(async () => { for (const el of await page.$$(linkSel)) if (await el.isVisible()) return el }, 'rendered AI link', 120000)
  const attrs = await link.evaluate(a => ({ target: a.getAttribute('target'), rel: a.getAttribute('rel') }))
  assert.deepEqual(attrs, { target: '_blank', rel: 'noopener noreferrer' })
  await page.screenshot({ path: path.join(run, '1-ai-link-before-click.png') })
  // 失败时留证：点击是否被正文委托 preventDefault。
  await page.evaluate(() => {
    window.__s26.clicks = []
    document.addEventListener('click', e => { setTimeout(() => window.__s26.clicks.push({ target: e.target && e.target.tagName, prevented: e.defaultPrevented }), 0) }, true)
  })
  const box = await link.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  try { await until(() => readOpened().some(u => u === LINK), 'openExternal called with the AI link', 10000) } finally { evidence.clickDiag = await page.evaluate(() => window.__s26.clicks).catch(e => String(e)) }
  await sleep(1000)
  assert.equal(page.url(), appUrl, 'main window must stay on the app page')
  assert.equal(await page.evaluate(() => typeof window.checkbaDesktop), 'object')
  assert.deepEqual(await page.evaluate(() => window.__s26.newTabs.length), 0, 'AI link goes to the system browser, not an in-app tab')
  await page.screenshot({ path: path.join(run, '2-ai-link-after-click.png') })
  evidence.checks.push('AI Markdown link click: main window URL unchanged, shell.openExternal received the link, no in-app tab')

  // 2) 绕过渲染层委托：裸 <a>（无 target）被真鼠标点击 → 主进程 will-navigate 拦下并外开。
  await page.evaluate(url => {
    const a = document.createElement('a'); a.id = 's26-bare'; a.href = url; a.textContent = 'bare link'
    a.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147483647;background:#ff0;padding:8px'
    document.body.appendChild(a)
  }, BARE)
  const bare = await (await page.$('#s26-bare')).boundingBox()
  await page.mouse.click(bare.x + bare.width / 2, bare.y + bare.height / 2)
  await until(() => readOpened().some(u => u === BARE), 'main-process guard opened the bare link externally', 10000)
  await sleep(1000)
  assert.equal(page.url(), appUrl)
  evidence.checks.push('Bare anchor (no renderer delegate): will-navigate blocked, opened externally')

  // 3) 页面脚本把主窗口导航到 file:// 外部文件 → 拦下、不外开。
  const before = readOpened().length
  const outside = path.join(run, 'outside.html')
  fs.writeFileSync(outside, '<p>outside the app directory</p>')
  await page.evaluate(url => { location.href = url }, 'file://' + outside)
  await sleep(1500)
  assert.equal(page.url(), appUrl)
  assert.equal(readOpened().length, before)
  // 4) window.open(about:blank) 不建继承 preload 的子窗口。
  assert.equal(await page.evaluate(() => window.open('about:blank') === null), true)
  assert.equal((await browser.pages()).filter(p => p.url() === 'about:blank').length, 0)
  // 5) 未登记的 <webview>（主 preload + 任意分区）挂不上。
  const rogue = await page.evaluate(() => new Promise(resolve => {
    const w = document.createElement('webview')
    w.setAttribute('preload', window.location.href.replace(/frontend\/dist\/build\/h5\/index\.html.*$/, 'desktop/preload/preload.js'))
    w.setAttribute('partition', 'persist:s26-rogue')
    w.src = 'https://example.com/'
    w.addEventListener('dom-ready', () => resolve('attached'))
    document.body.appendChild(w)
    setTimeout(() => { w.remove(); resolve('not-attached') }, 4000)
  }))
  assert.equal(rogue, 'not-attached')
  // 人机验证形态（captcha preload + 默认分区）照常挂载；src 用本机假服务，不连外网。
  const captcha = await page.evaluate(src => new Promise(async resolve => {
    const cfg = await window.checkbaDesktop.captchaEmbed.getConfig()
    const w = document.createElement('webview')
    w.setAttribute('preload', cfg.preload)
    w.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')
    w.src = src
    w.addEventListener('dom-ready', () => { w.remove(); resolve('attached') })
    document.body.appendChild(w)
    setTimeout(() => { w.remove(); resolve('not-attached') }, 8000)
  }), `http://127.0.0.1:${modelPort}/captcha-embed`)
  assert.equal(captcha, 'attached')
  evidence.checks.push('file:// navigation denied; window.open(about:blank) denied; unregistered <webview> not attached; captcha-shaped <webview> attaches')

  // 6) 已登记的 LOWA 编辑器 <webview> 照常挂载并加载文档（白名单不误伤）。
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>S26 webview allowlist</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
  const docxPath = path.join(run, 'S26.docx')
  fs.writeFileSync(docxPath, await zip.generateAsync({ type: 'nodebuffer' }))
  const imported = await (await fetch(`${base}/api/projects/${projectId}/files/import-local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourcePath: docxPath }) })).json()
  const docFile = imported.data || imported
  assert.ok(docFile.id, JSON.stringify(imported))
  await page.evaluate(file => window.__checkbaActiveOverviewVm.openFile(file), docFile)
  await page.waitForFunction(() => Object.values(window.__checkbaActiveOverviewVm._libreRefs || {}).some(e => e.file?.name === 'S26.docx' && e.ready && e.statusKey === 'ready' && !e.docLoadFailed), { timeout: 180000 })
  await sleep(1500)
  await page.screenshot({ path: path.join(run, '3-lowa-editor.png') })
  evidence.checks.push('Registered LOWA editor <webview> attached and loaded a .docx')

  // 7) 主窗口与 guest 的实际 webPreferences。
  const prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'))
  evidence.webPreferences = prefs
  assert.equal(prefs.window?.sandbox, true)
  assert.equal(prefs.window?.contextIsolation, true)
  assert.equal(prefs.window?.nodeIntegration, false)
  const guest = Object.entries(prefs).find(([k]) => k.startsWith('webview:http://127.0.0.1'))
  assert.ok(guest, 'LOWA guest preferences recorded')
  assert.equal(guest[1].sandbox, true)
  assert.equal(guest[1].nodeIntegration, false)
  evidence.opened = readOpened()
  evidence.passed = true
} catch (e) {
  evidence.error = String(e && e.stack || e)
  evidence.modelCalls = modelCalls
  try { await page?.screenshot({ path: path.join(run, 'failure.png') }); evidence.failureText = (await page?.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(-600))) } catch (x) { /* ignore */ }
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(run, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
  try { await browser?.disconnect() } catch (e) { /* ignore */ }
  // 整组收：只杀主进程会留下 Electron helper / JVM 孤儿。
  for (const p of [child, java]) { try { if (p?.pid) process.kill(-p.pid, 'SIGTERM') } catch (e) { /* gone */ } }
  await sleep(3000)
  for (const p of [child, java]) { try { if (p?.pid) process.kill(-p.pid, 'SIGKILL') } catch (e) { /* gone */ } }
  modelServer.close()
}
