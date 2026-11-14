#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 产品截图即测试：在虚构演示数据上截取 README / 官网用的产品截图，并与入库基线做像素比对。
// 设计见 docs/plans/stella-alignment/screenshots.md；工作流 .github/workflows/marketing-screenshots.yml。
//
// 前置：
//   1. cd frontend && npm run build:h5（含 build:plugins，会重写 official-plugins/*/web/；后端启动时校验它，先构建再起后端）
//   2. 一个全新 user.home 的 local-mode 后端（SPRING_PROFILES_ACTIVE=desktop，带
//      AI_SKILLS_BUILTIN_DIR / AI_PLUGINS_BUNDLED_DIR / AWD_APP_VERSION），并把在线广场指向本脚本的夹具：
//        AI_SKILLS_REGISTRYURL=http://127.0.0.1:<SHOTS_PORT>/registry/skills
//        AI_PLUGINS_REGISTRYURL=http://127.0.0.1:<SHOTS_PORT>/registry/plugins
//      复用旧 user.home 会让「最近项目」等列表多出历史条目，截图对不上基线。
//   本脚本自己在 SHOTS_PORT 起静态服务（托管 H5 产物 + 广场夹具），只建一个演示项目，不写全局配置。
//
// 模式：SHOTS_MODE=check（默认）比对基线，超出容差退出码 1；
//       SHOTS_MODE=update 只把新截图写进 SHOTS_OUT（不改仓库），由人审后拷进基线目录。
// 基线只认 CI（ubuntu + 固定版本 Chrome + Noto CJK）产出的图，不要提交本机截图。
//
// Env: SHOTS_BACKEND（默认 http://127.0.0.1:9696）/ SHOTS_PORT（默认 18930）/ PUPPETEER_EXECUTABLE_PATH /
//      SHOTS_MODE / SHOTS_OUT（默认 <tmp>/marketing-shots）/ SHOTS_ONLY（逗号分隔的截图 id）
//      SHOTS_PLUGINS_DIR（后端的插件安装目录，即后端 cwd 下的 plugins/；律所管理、项目沟通不随包，
//      版式回归图要把它们从 official-plugins/ 拷进去）
//
// 两组截图：营销图（docs/images/marketing/e2e/，README/官网用，2x）与版式回归图（ui-baselines/，1x）。
// 版式回归图覆盖曾经「静默变丑」的设置分区与插件面板，含窄窗口——见 sdk/plugin-sdk/UI-GUIDELINES.md。

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../..')
const H5_DIR = path.join(REPO, 'frontend/dist/build/h5')
const DEMO_DIR = path.join(REPO, 'fixtures/evidence-demo-1076')
const REGISTRY_DIR = path.join(REPO, 'fixtures/marketing-demo')
const BASELINE_DIRS = { marketing: path.join(REPO, 'docs/images/marketing/e2e'), ui: path.join(HERE, 'ui-baselines') }
const PLUGINS_DIR = process.env.SHOTS_PLUGINS_DIR || ''
const BACKEND = process.env.SHOTS_BACKEND || 'http://127.0.0.1:9696'
const PORT = Number(process.env.SHOTS_PORT || 18930)
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const MODE = process.env.SHOTS_MODE || 'check'
const OUT = process.env.SHOTS_OUT || path.join(os.tmpdir(), 'marketing-shots')
const ONLY = (process.env.SHOTS_ONLY || '').split(',').filter(Boolean)
// 2x 设备像素：文件 2880×1800，与 README 现有截图同规格，高分屏不糊
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 }
// 版式回归图 1x：只看版式，不进 README，基线体积小一半以上；窄档对应「工作台右栏展开、面板被挤窄」
const UI_WIDE = { width: 1440, height: 900, deviceScaleFactor: 1 }
const UI_NARROW = { width: 1100, height: 900, deviceScaleFactor: 1 }
// 容差：单像素任一通道差 > PIXEL_DELTA 记为不同；不同像素占比 > MAX_DIFF_RATIO 判红。
// 基线与比对在同一 runner 镜像、同一 Chrome 上渲染，只需覆盖抗锯齿级的噪声。
const PIXEL_DELTA = 40
const MAX_DIFF_RATIO = 0.002
const DEMO_PROJECT = '示范-设备购销纠纷-虚构'

if (!['check', 'update'].includes(MODE)) { console.error('未知 SHOTS_MODE: ' + MODE); process.exit(2) }
if (!fs.existsSync(path.join(H5_DIR, 'index.html'))) { console.error('缺少 H5 构建产物，先 cd frontend && npm run build:h5'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(ep, opts = {}) {
  const r = await fetch(BACKEND + ep, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${ep} -> HTTP ${r.status}`)
  return r.json()
}

// ---------- 演示数据：虚构项目 + 4 份虚构 docx（fixtures/evidence-demo-1076） ----------
async function seedDemoProject() {
  const proj = await api('/api/projects', { method: 'POST', body: { name: DEMO_PROJECT, projectType: 'BLANK' } })
  if (!proj || !proj.id) throw new Error('建演示项目失败: ' + JSON.stringify(proj).slice(0, 200))
  const files = fs.readdirSync(DEMO_DIR).filter((n) => n.endsWith('.docx')).sort()
  for (const name of files) {
    const bytes = fs.readFileSync(path.join(DEMO_DIR, name))
    const created = await api('/api/projects/' + proj.id + '/files/file', {
      method: 'POST', body: { parentId: null, name, fileType: 'docx', fileSize: bytes.length },
    })
    if (!created || !created.id) throw new Error('建文件失败: ' + name)
    // 新项目的版本库初始化期间写入会回 423 VERSION_BUSY（未开始写），等它让出再写
    for (let attempt = 1; ; attempt++) {
      const form = new FormData()
      form.append('file', new Blob([bytes]), name)
      const r = await fetch(BACKEND + '/api/files/' + created.id + '/upload', { method: 'POST', body: form })
      if (r.status === 423 && attempt < 60) { await sleep(500); continue }
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || j.code !== 0) throw new Error('写字节失败: ' + name + ' HTTP ' + r.status)
      break
    }
  }
  // 版本记录会在后台把这批改动自动记一笔；等它落定再截，否则底栏「N 个文件待提交」与
  // 「改动已自动记录」随时序来回变。
  const settleStart = Date.now()
  const deadline = settleStart + 180000
  for (;;) {
    const s = await api('/api/projects/' + proj.id + '/version/status')
    if (s && s.data && s.data.changedCount === 0) break
    if (Date.now() > deadline) throw new Error('版本记录 180s 内未落定: ' + JSON.stringify(s).slice(0, 200))
    await sleep(1000)
  }
  console.log('版本记录落定用时 ' + Math.round((Date.now() - settleStart) / 1000) + 's')
  return proj.id
}

// ---------- 静态服务：H5 产物（桌面壳加载的同一份）+ 在线广场夹具 ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm' }
const REGISTRY = {
  '/registry/skills': path.join(REGISTRY_DIR, 'registry-skills.json'),
  '/registry/plugins': path.join(REGISTRY_DIR, 'registry-plugins.json'),
}
function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = REGISTRY[rel] || path.normalize(path.join(H5_DIR, rel === '/' ? 'index.html' : rel))
    if (!(REGISTRY[rel] || file.startsWith(H5_DIR + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server)) })
}

// 冻结动效、光标闪烁与滚动条，消掉逐帧噪声
const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
::-webkit-scrollbar{display:none!important}`

// 时间字段归一化：相对时间（N 分钟前）与日期时刻随运行时刻变化，统一改写成固定值。
// 只改时间文本，不动其他内容；设计文档列明了这一处理。
async function normalizeTimes(page) {
  // 插件面板在沙箱 iframe 里（无 same-origin），要逐个 frame 改写
  for (const frame of page.frames()) await frame.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
      const t = n.textContent
      const v = t
        .replace(/\d+\s*(秒|分钟|小时|天)前/g, '刚刚')
        .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?/g, '2026-03-18 09:30')
        .replace(/\d{4}-\d{2}-\d{2}/g, '2026-03-18')
      if (v !== t) n.textContent = v
    }
  }).catch(() => {})
}

// ---------- 像素比对：在浏览器里用 canvas 解码 PNG，不引入额外依赖 ----------
async function comparePng(page, actualFile, baselineFile, diffFile) {
  const toUrl = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64')
  const r = await page.evaluate(async (a, b, delta) => {
    const load = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: [ia.width, ia.height, ib.width, ib.height] }
    const w = ia.width, h = ia.height
    const px = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data }
    const da = px(ia), db = px(ib)
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); const out = x.createImageData(w, h)
    let diff = 0
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
      if (d > delta) { diff++; out.data[i] = 255; out.data[i + 3] = 255 } else { out.data[i] = out.data[i + 1] = out.data[i + 2] = da[i] * 0.3; out.data[i + 3] = 80 }
    }
    x.putImageData(out, 0, 0)
    const blob = await c.convertToBlob({ type: 'image/png' })
    const buf = new Uint8Array(await blob.arrayBuffer())
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { diff, total: w * h, diffPng: btoa(bin) }
  }, toUrl(actualFile), toUrl(baselineFile), PIXEL_DELTA)
  if (r.diffPng) fs.writeFileSync(diffFile, Buffer.from(r.diffPng, 'base64'))
  return r
}

// ---------- 交互小工具（uni-app 的 @tap 只认真实鼠标坐标点击） ----------
async function waitText(page, text, timeout = 20000) {
  await page.waitForFunction((t) => document.body && document.body.innerText.includes(t), { timeout }, text)
}
async function clickTitle(page, title) {
  const el = await page.waitForSelector(`[title="${title}"]`, { visible: true, timeout: 20000 })
  const b = await el.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
}
async function clickText(page, text) {
  await waitText(page, text)
  const p = await page.evaluate((t) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) {
      if (n.textContent.trim() !== t) continue
      const r = n.parentElement.getBoundingClientRect()
      if (r.width && r.height) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    return null
  }, text)
  if (!p) throw new Error('找不到可见文字: ' + text)
  await page.mouse.click(p.x, p.y)
}
// 插件面板在 iframe 里：等某段文字出现在任一 frame，返回那个 frame
async function waitFrameText(page, text, timeout = 30000) {
  const deadline = Date.now() + timeout
  for (;;) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue
      const hit = await frame.evaluate((t) => !!document.body && document.body.innerText.includes(t), text).catch(() => false)
      if (hit) return frame
    }
    if (Date.now() > deadline) throw new Error('插件面板里等不到文字: ' + text)
    await sleep(300)
  }
}
async function clickFrameText(page, text) {
  const frame = await waitFrameText(page, text)
  const handle = await frame.evaluateHandle((t) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) if (n.textContent.trim() === t && n.parentElement.getClientRects().length) return n.parentElement
    return null
  }, text)
  const el = handle.asElement()
  if (!el) throw new Error('插件面板里找不到可点的文字: ' + text)
  await el.click()
}
async function openSettings(page, base, projectId, section) {
  await openWorkbench(page, base, projectId)
  await clickText(page, '设置')
  await waitText(page, '我的工作')
  await clickText(page, section)
}

// 版式回归图的数据：装上不随包的律所管理、项目沟通，填律所样板数据
async function seedUiFixtures() {
  if (!PLUGINS_DIR) throw new Error('缺 SHOTS_PLUGINS_DIR（后端 cwd 下的 plugins/），版式回归图要装律所管理与项目沟通')
  for (const id of ['lawfirm-management', 'project-im']) {
    const target = path.join(PLUGINS_DIR, id)
    fs.rmSync(target, { recursive: true, force: true })
    for (const sub of ['manifest.json', 'web', 'l10n']) {
      const from = path.join(REPO, 'official-plugins', id, sub)
      if (fs.existsSync(from)) fs.cpSync(from, path.join(target, sub), { recursive: true })
    }
    fs.copyFileSync(path.join(REPO, 'sdk/plugin-sdk/awd-plugin-sdk.js'), path.join(target, 'web/awd-plugin-sdk.js'))
  }
  await api('/api/plugins/rescan', { method: 'POST' })
  for (const id of ['lawfirm-management', 'project-im']) await api('/api/plugins/' + id + '/enable', { method: 'POST' })
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: '123' } })
  const session = login && login.data && login.data.sessionId
  if (!session) throw new Error('本机登录失败，填不了律所样板数据')
  const r = await fetch(BACKEND + '/api/lawfirm/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Id': session },
    body: JSON.stringify({ action: 'seedDemoData', params: {} }),
  }).then((x) => x.json())
  if (!r || r.code !== 0) throw new Error('律所样板数据失败: ' + JSON.stringify(r).slice(0, 200))
}

async function openWorkbench(page, base, projectId, extraQuery = '') {
  await page.goto(base + '/#/pages/project-overview/project-overview?id=' + projectId + extraQuery, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForSelector('[title="资源管理器"]', { timeout: 30000 })
  await waitText(page, '01-购销合同.docx')
}

// ---------- 截图清单 ----------
// id = 基线文件名；prepare 把界面摆到可截状态，并断言关键内容已渲染（避免把加载态当成产品截图）。
// 只收浏览器目标与桌面端渲染一致的界面；编辑器（LOWA 跑在 Electron <webview> 里）见设计文档第二期。
const SHOTS = [
  {
    id: 'workspace-welcome',
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickText(page, '打开欢迎页')
      await waitText(page, '上手指南')
      await waitText(page, '当前项目')
    },
  },
  {
    id: 'project-overview',
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickTitle(page, '项目概览')
      await waitText(page, '4 个文件')
      await waitText(page, '初始版本')
    },
  },
  {
    id: 'plugin-market',
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickTitle(page, '插件中心')
      await waitText(page, '插件广场')
      await clickText(page, '创业协议起草')
      await waitText(page, '什么时候用')
      await waitText(page, 'startup-agreement-drafter')
    },
  },

  // ---------- 版式回归图（2026-11 版式排查中出过问题的界面；宽窄两档） ----------
  {
    id: 'ui-settings-team', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openSettings(page, base, projectId, '团队')
      await waitText(page, '按主办律师')
      await waitText(page, '示例资本市场部')
    },
  },
  {
    id: 'ui-settings-mcp', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openSettings(page, base, projectId, '外部工具连接（MCP）')
      await waitText(page, '添加连接')
      await waitText(page, '北大法宝')
    },
  },
  {
    id: 'ui-settings-ai', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openSettings(page, base, projectId, 'AI 功能设置')
      await waitText(page, '扫描件识别')
      await waitText(page, '编辑规则')
    },
  },
  {
    id: 'ui-message-center', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId, '&tab=messages')
      await waitText(page, '消息中心')
      await clickText(page, '新建会话')
      await waitText(page, '会话名称')
    },
  },
  {
    id: 'ui-client-collab', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickTitle(page, '客户协作')
      await waitText(page, '律师发送的邀请码')
    },
  },
  {
    id: 'ui-lawfirm-intake', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickTitle(page, '律所管理')
      await waitFrameText(page, 'LF-2026-0004')
    },
  },
  {
    id: 'ui-lawfirm-intake-narrow', dir: 'ui', viewport: UI_NARROW,
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickTitle(page, '律所管理')
      await waitFrameText(page, 'LF-2026-0004')
    },
  },
  {
    id: 'ui-lawfirm-dashboard', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickTitle(page, '律所管理')
      await waitFrameText(page, 'LF-2026-0004')
      await clickFrameText(page, '决策与业务看板')
      await waitFrameText(page, '示例资本市场部')
    },
  },
  {
    id: 'ui-project-im', dir: 'ui', viewport: UI_WIDE,
    async prepare(page, { base, projectId }) {
      await openWorkbench(page, base, projectId)
      await clickTitle(page, '项目沟通')
      await waitFrameText(page, '请先连接')
    },
  },
]

// ---------- main ----------
const server = await startServer()
const base = 'http://127.0.0.1:' + PORT
const projectId = await seedDemoProject()
if (SHOTS.some((s) => s.dir === 'ui' && (!ONLY.length || ONLY.includes(s.id)))) await seedUiFixtures()
console.log('演示项目 #' + projectId + '，H5 ' + base + '，模式 ' + MODE)
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars'],
  defaultViewport: VIEWPORT,
})
let failed = 0
try {
  for (const shot of SHOTS) {
    if (ONLY.length && !ONLY.includes(shot.id)) continue
    // 每张图一个独立浏览器上下文：工作台会把打开的标签、侧栏面板记在 localStorage，
    // 共用上下文会让上一张图的状态串进下一张。
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    if (shot.viewport) await page.setViewport(shot.viewport)
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
    await page.evaluateOnNewDocument((apiBase) => {
      // 桌面桩：带 fs.showOpenDialog 时欢迎页等按桌面版渲染（判据见 app-e2e J1），截图不会调用它
      window.checkbaDesktop = {
        apiBaseUrl: apiBase,
        shell: { openExternal: () => Promise.resolve() },
        fs: { showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }) },
      }
      try {
        localStorage.setItem('app_language', 'zh-CN')
        localStorage.setItem('app_language_manual', '1')
        localStorage.setItem('awd_site_preselected', '1')
      } catch (e) { /* ignore */ }
    }, BACKEND)
    // 浏览器侧不出站：只放行本机前后端（远端字体、头像等一律拦掉，免得网络抖动进截图）
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const u = req.url()
      if (u.startsWith(base) || u.startsWith(BACKEND) || u.startsWith('data:') || u.startsWith('blob:')) req.continue()
      else req.abort()
    })
    const actual = path.join(OUT, shot.id + '.png')
    try {
      await shot.prepare(page, { base, projectId })
      await page.addStyleTag({ content: FREEZE_CSS })
      await page.mouse.move(0, (shot.viewport || VIEWPORT).height - 1) // 鼠标挪开，避免悬停态进截图
      await page.evaluate(() => document.fonts.ready)
      await sleep(800)
      await normalizeTimes(page)
      await page.screenshot({ path: actual })
    } catch (e) {
      failed++
      await page.screenshot({ path: path.join(OUT, shot.id + '.failed.png') }).catch(() => {})
      console.log('  [FAIL] ' + shot.id + ' 准备失败: ' + e.message + (errors.length ? '\n    pageerror: ' + errors.join(' | ') : ''))
      await context.close()
      continue
    }
    const baseline = path.join(BASELINE_DIRS[shot.dir || 'marketing'], shot.id + '.png')
    if (MODE === 'update') {
      console.log('  [UPDATE] ' + shot.id + ' -> ' + actual)
    } else if (!fs.existsSync(baseline)) {
      failed++
      console.log('  [FAIL] ' + shot.id + ' 缺基线 ' + path.relative(REPO, baseline) + '（跑 update 模式，取 CI 产物入库）')
    } else {
      const r = await comparePng(page, actual, baseline, path.join(OUT, shot.id + '.diff.png'))
      if (r.sizeMismatch) {
        failed++
        console.log('  [FAIL] ' + shot.id + ' 尺寸不符 ' + JSON.stringify(r.sizeMismatch))
      } else {
        const ratio = r.diff / r.total
        const ok = ratio <= MAX_DIFF_RATIO
        if (!ok) failed++
        console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${shot.id} 差异像素 ${r.diff}/${r.total} (${(ratio * 100).toFixed(3)}%，上限 ${(MAX_DIFF_RATIO * 100).toFixed(1)}%)`)
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failed ? `${failed} 张截图未通过，产物见 ${OUT}` : `全部通过，产物见 ${OUT}`)
process.exit(failed ? 1 : 0)
