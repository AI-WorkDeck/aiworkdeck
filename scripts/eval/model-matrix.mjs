#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 真实模型 A/B 矩阵：before/after 两个 git ref × N 个模型 × 句子集，并行跑 Agent，直接走后端 HTTP/SSE。
// 用法与设计见 scripts/eval/README.md。密钥只从环境变量 OPENROUTER_API_KEY 读取，只传给子进程环境，从不打印、落盘。

import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: HERE, encoding: 'utf8' }).trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------- 参数 ----------
function parseArgs(argv) {
  const o = { lowaDir: path.join(os.homedir(), '.cache/awd-matrix/lowa'), runs: 1, concurrency: 4, apiOnly: false, keep: false, runTimeout: 300, out: path.join(HERE, 'out') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--before') o.before = next()
    else if (a === '--after') o.after = next()
    else if (a === '--models') o.models = next().split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--sentences') o.sentences = next()
    else if (a === '--only') o.only = next().split(',')
    else if (a === '--runs') o.runs = Number(next())
    else if (a === '--concurrency') o.concurrency = Number(next())
    else if (a === '--run-timeout') o.runTimeout = Number(next())
    else if (a === '--out') o.out = path.resolve(next())
    else if (a === '--api-only') o.apiOnly = true
    else if (a === '--lowa-dir') o.lowaDir = path.resolve(next())
    else if (a === '--profile') o.profile = next()
    else if (a === '--tier') o.tier = next()
    else if (a === '--keep') o.keep = true
    else if (a === '--workdir') { o.workdir = path.resolve(next()); o.keep = true }
    else if (a === '--help' || a === '-h') o.help = true
    else throw new Error('未知参数：' + a)
  }
  return o
}
// 档位：profile 决定语言/站点配置与默认句集；tier 决定默认模型（cheap = 日常门禁，release = 再加贵模型做发版前抽检）。
// 价格（美元 / 1M token：输入 / 输出 / 缓存读）用于报告里的成本估算，来自 OpenRouter 标价。
const PROFILES = {
  cn: { lang: 'zh-CN', accountBaseUrl: null, sentences: 'sentences/gate-35.json', cheap: ['deepseek/deepseek-v4-flash', 'qwen/qwen3.7-flash'], extra: ['qwen/qwen3.8-max-0902', 'deepseek/deepseek-v4-pro'] },
  intl: { lang: 'en-US', accountBaseUrl: 'https://www.workdeck.ai', sentences: 'sentences/gate-35-en.json', cheap: ['google/gemini-3.6-flash', 'anthropic/claude-haiku-4.5'], extra: ['anthropic/claude-sonnet-5', 'openai/gpt-5.6-terra'] },
}
const PRICES = {
  'deepseek/deepseek-v4-flash': [0.09, 0.18, 0.02], 'qwen/qwen3.7-flash': [0.03, 0.13, 0.01],
  'google/gemini-3.6-flash': [0.75, 3.75, 0.07], 'anthropic/claude-haiku-4.5': [1, 5, 0.10],
  'qwen/qwen3.8-max-0902': [2, 6, 0.25], 'deepseek/deepseek-v4-pro': [0.96, 1.91, 0.08],
  'anthropic/claude-sonnet-5': [2, 10, 0.20], 'openai/gpt-5.6-terra': [2, 12, 0.20],
}
const costOf = (model, prompt, cached, completion) => {
  const p = PRICES[model]; if (!p) return null
  return ((prompt - cached) * p[0] + cached * p[2] + completion * p[1]) / 1e6
}
const USAGE = `用法：node scripts/eval/model-matrix.mjs --before <ref> --after <ref> [--profile cn|intl] [--tier cheap|release] [--models a,b] [--sentences <file.json>]
        profile 缺省 cn；未给 --models 时按 profile+tier 取默认模型，未给 --sentences 时按 profile 取 gate-35 / gate-35-en
        [--runs N] [--concurrency K] [--only id1,id2] [--api-only] [--run-timeout 秒] [--out 目录] [--keep]
环境变量：OPENROUTER_API_KEY（必需）；PG_BIN（可选，PostgreSQL bin 目录）；JAVA_HOME（需要 JDK 21，缺省自动找）`

// ---------- 小工具 ----------
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { out += d })
    p.on('error', reject)
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} 退出码 ${code}\n${out.slice(-1500)}`)))
  })
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
    s.on('error', reject)
  })
}
function findJava21() {
  if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin/java'))) return process.env.JAVA_HOME
  try { return execFileSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8' }).trim() } catch { /* 非 macOS */ }
  throw new Error('找不到 JDK 21，请设置 JAVA_HOME')
}
function findPgBin() {
  const c = [process.env.PG_BIN, '/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin', '/usr/local/opt/postgresql@17/bin'].filter(Boolean)
  for (const d of c) if (fs.existsSync(path.join(d, 'initdb'))) return d
  try { const d = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); if (fs.existsSync(path.join(d, 'initdb'))) return d } catch { /* 无 pg_config */ }
  try { return path.dirname(execFileSync('which', ['initdb'], { encoding: 'utf8' }).trim()) } catch { /* ignore */ }
  throw new Error('找不到 PostgreSQL（initdb），请设置 PG_BIN')
}
// 兜底：产物目录里的任何文件若含密钥原文（后端日志、模型回显）一律替换，产物会被上传到 CI。
function scrubSecret(dir) {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return
  for (const f of fs.readdirSync(dir)) {
    const file = path.join(dir, f)
    try { const t = fs.readFileSync(file, 'utf8'); if (t.includes(key)) fs.writeFileSync(file, t.split(key).join('***')) } catch { /* 非文本/已删除 */ }
  }
}
const sanitize = s => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase()

// ---------- 句子集 ----------
function loadSentences(file, only) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'))
  let list = Array.isArray(j) ? j : j.sentences
  if (!Array.isArray(list)) throw new Error('句子文件需为数组或 {sentences:[...]}')
  if (only) list = list.filter(s => only.includes(s.id))
  for (const s of list) {
    if (!s.id || !s.text) throw new Error('句子缺 id/text：' + JSON.stringify(s).slice(0, 80))
    s.hostState = s.hostState || 'nofile'
    s.expect = s.expect || {}
  }
  return list
}
const needsEditor = s => s.hostState !== 'nofile'
// docx:<夹具> 的宿主文件：种子里自动加一份 合同.docx（hostFile 可改名）
function withHostFile(s) {
  const m = /^docx:(.+)$/.exec(s.hostState)
  if (!m) throw new Error(`hostState=${s.hostState} 暂不支持（目前只支持 nofile 与 docx:<夹具>）`)
  const seed = { ...(s.seed || {}) }
  seed.files = [{ name: s.hostFile || '合同.docx', fixture: m[1] + '.docx' }, ...(seed.files || [])]
  return { ...s, seed }
}
const editorSupported = s => s.hostState === 'nofile' || s.hostState.startsWith('docx:')

// ---------- 评分 ----------
const nameMatch = (pat, tool) => (pat.startsWith('/') && pat.lastIndexOf('/') > 0)
  ? new RegExp(pat.slice(1, pat.lastIndexOf('/')), pat.slice(pat.lastIndexOf('/') + 1)).test(tool) : pat === tool
const anyOf = (pats, tools) => (Array.isArray(pats) ? pats : [pats]).some(p => tools.some(t => nameMatch(p, t)))

async function judge(sentence, rec, ctx) {
  const e = sentence.expect
  const r = {}
  if (e.firstToolAnyOf?.length) {
    r.firstTool = rec.tools.length ? anyOf(e.firstToolAnyOf, [rec.tools[0]]) : e.firstToolAnyOf.includes('<none>')
  }
  if (e.mustUse?.length) r.mustUse = e.mustUse.every(g => anyOf(g, rec.tools))
  if (e.mustNotUse?.length) r.mustNotUse = !anyOf(e.mustNotUse, rec.tools)
  if (e.status) r.status = rec.status === e.status // 可选：要求本轮以指定状态结束（如 finished = 没有停在确认卡；awaiting_input = 停在确认卡/反问）
  if (e.maxRounds != null) r.maxRounds = (rec.rounds ?? 0) <= e.maxRounds // 可选：轮数上限（防循环：编辑器句子曾因 doc_* 反复重试而空转）
  if (e.finalTextIncludes?.length) r.finalText = e.finalTextIncludes.every(t => (rec.finalText || '').includes(t))
  if (e.outcomeCheck) {
    try {
      const fn = new (Object.getPrototypeOf(async function () {}).constructor)('ctx', e.outcomeCheck)
      r.outcome = !!(await fn(ctx))
    } catch (err) { r.outcome = false; r.outcomeError = String(err.message || err).slice(0, 200) }
  }
  const checks = Object.entries(r).filter(([k]) => ['firstTool', 'mustUse', 'mustNotUse', 'status', 'maxRounds', 'finalText', 'outcome'].includes(k))
  r.pass = (rec.status === 'finished' || rec.status === 'awaiting_input') && checks.every(([, v]) => v === true)
  return r
}

// ---------- PostgreSQL（自带临时集群，不碰任何现有库） ----------
async function startPg(tmp) {
  const bin = findPgBin()
  const data = path.join(tmp, 'pgdata')
  const port = await freePort()
  await run(path.join(bin, 'initdb'), ['-D', data, '-U', 'awd', '--auth=trust', '-E', 'UTF8', '--locale=C'])
  await run(path.join(bin, 'pg_ctl'), ['-D', data, '-o', `-p ${port} -h 127.0.0.1 -k ${tmp} -c max_connections=300 -c fsync=off`, '-l', path.join(tmp, 'pg.log'), '-w', 'start'])
  const psql = async (db, sql) => (await run(path.join(bin, 'psql'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'awd', '-d', db, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql])).trim()
  return { bin, data, port, psql, stop: () => run(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']).catch(() => {}) }
}

// ---------- 构建每个 ref ----------
async function buildRef(ref, tmp, java, o, needFrontend) {
  const sha = execFileSync('git', ['rev-parse', '--verify', ref + '^{commit}'], { cwd: REPO, encoding: 'utf8' }).trim()
  const wt = path.join(tmp, 'wt-' + sha.slice(0, 10))
  if (!fs.existsSync(wt)) await run('git', ['worktree', 'add', '--detach', wt, sha], { cwd: REPO })
  const jarsDone = () => fs.existsSync(path.join(wt, 'backend/target')) && fs.readdirSync(path.join(wt, 'backend/target')).some(f => /^backend-.*\.jar$/.test(f))
  const feDone = !needFrontend || fs.existsSync(path.join(wt, 'frontend/dist/zetaoffice/lowa/soffice.wasm'))
  log(`构建 ${ref} (${sha.slice(0, 10)}) ...`)
  const t0 = Date.now()
  const backend = jarsDone() ? Promise.resolve() : run('mvn', ['-q', '-B', '-DskipTests', 'package'], { cwd: path.join(wt, 'backend'), env: { ...process.env, JAVA_HOME: java, PATH: path.join(java, 'bin') + ':' + process.env.PATH } })
  const frontend = needFrontend && !feDone ? buildFrontend(wt, o) : Promise.resolve()
  await Promise.all([backend, frontend])
  const jars = fs.readdirSync(path.join(wt, 'backend/target')).filter(f => /^backend-.*\.jar$/.test(f) && !f.includes('original'))
  if (!jars.length) throw new Error('未找到后端 jar：' + ref)
  log(`构建 ${ref} 完成 ${Math.round((Date.now() - t0) / 1000)}s`)
  return { ref, sha, wt, jar: path.join(wt, 'backend/target', jars[0]), h5: needFrontend ? path.join(wt, 'frontend/dist/build/h5') : null, zeta: needFrontend ? path.join(wt, 'frontend/dist/zetaoffice') : null }
}

// H5 以占位符 API 地址静态构建（构建时烘焙），每个实例的静态服务器在响应里把占位符替换成自己后端的地址；
// LOWA 运行时（~100MB）从缓存目录拷入，缓存缺失时用 desktop/scripts/fetch-lowa-assets.js 拉取一次。
const API_PLACEHOLDER = 'http://awd-matrix-api.invalid'
async function buildFrontend(wt, o) {
  const fe = path.join(wt, 'frontend')
  try { await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: fe }) } catch { await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: fe }) }
  const env = { ...process.env, VITE_API_BASE_URL: API_PLACEHOLDER }
  await run('npx', ['uni', 'build'], { cwd: fe, env })
  await run('npm', ['run', 'build:zetaoffice'], { cwd: fe, env })
  const dest = path.join(fe, 'dist/zetaoffice')
  if (!fs.existsSync(path.join(o.lowaDir, 'lowa/soffice.wasm'))) {
    log('LOWA 缓存缺失，拉取运行时（一次性）...')
    await run('node', [path.join(wt, 'desktop/scripts/fetch-lowa-assets.js')], { cwd: wt })
    fs.mkdirSync(o.lowaDir, { recursive: true })
    fs.cpSync(path.join(dest, 'lowa'), path.join(o.lowaDir, 'lowa'), { recursive: true })
    for (const f of fs.readdirSync(dest).filter(f => f.startsWith('cjk'))) fs.copyFileSync(path.join(dest, f), path.join(o.lowaDir, f))
  } else fs.cpSync(o.lowaDir, dest, { recursive: true })
}

// 每实例一个静态 H5 服务：带 COOP/COEP（LOWA 需要 SharedArrayBuffer），/zetaoffice/* 回放 .encodings.json 里的 Content-Encoding
function serveH5(build, apiBase) {
  const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection', '.woff2': 'font/woff2' }
  const H = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'cross-origin' }
  let enc = {}
  try { enc = JSON.parse(fs.readFileSync(path.join(build.zeta, 'lowa/.encodings.json'), 'utf8')) } catch { /* 无 */ }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    let root = build.h5, rel = decodeURIComponent(u.pathname)
    if (rel.startsWith('/zetaoffice/')) { root = build.zeta; rel = rel.slice('/zetaoffice/'.length) } else rel = rel.slice(1)
    let f = path.resolve(root, rel || 'index.html')
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, H); return res.end() }
    const ext = path.extname(f)
    const h = { ...H, 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' }
    if (root === build.zeta && rel.startsWith('lowa/') && enc[path.basename(f)]) h['Content-Encoding'] = enc[path.basename(f)]
    if (['.js', '.html', '.mjs'].includes(ext) && root === build.h5) { res.writeHead(200, h); return res.end(fs.readFileSync(f, 'utf8').split(API_PLACEHOLDER).join(apiBase)) }
    res.writeHead(200, h); fs.createReadStream(f).pipe(res)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

// Playwright 自带 Chromium（headless，绝不启用系统 Chrome）；包装在缓存目录里按需安装
async function loadPlaywright() {
  const dir = path.join(os.homedir(), '.cache/awd-matrix/pw')
  if (!fs.existsSync(path.join(dir, 'node_modules/playwright'))) {
    log('安装 playwright（一次性）...')
    fs.mkdirSync(dir, { recursive: true })
    await run('npm', ['install', '--no-audit', '--no-fund', '--prefix', dir, 'playwright@1.65'])
  }
  const { createRequire } = await import('node:module')
  const { chromium } = createRequire(path.join(dir, 'x.js'))('playwright')
  try { return await chromium.launch({ headless: true }) } catch {
    await run('npx', ['--prefix', dir, 'playwright', 'install', 'chromium'], { cwd: dir })
    return chromium.launch({ headless: true })
  }
}

// ---------- 后端实例 ----------
class Instance {
  constructor({ label, build, model, pg, tmp, java, outDir, profile }) {
    Object.assign(this, { label, build, model, pg, tmp, java, outDir, profile })
    this.db = 'awd_' + sanitize(label)
    this.dir = path.join(tmp, 'inst-' + sanitize(label))
    this.logFile = path.join(outDir, 'backend-' + sanitize(label) + '.log')
  }
  get base() { return `http://127.0.0.1:${this.port}` }
  async start() {
    await this.pg.psql('postgres', `create database ${this.db}`)
    this.port = await freePort()
    for (const d of ['home', 'storage', 'plugins']) fs.mkdirSync(path.join(this.dir, d), { recursive: true })
    const env = {
      ...process.env, // OPENROUTER_API_KEY 随环境继承给子进程，不经过任何日志
      JAVA_HOME: this.java,
      SPRING_PROFILES_ACTIVE: 'dev', SECURITY_LOCAL_MODE: 'false', AI_MOCK_ENABLED: 'false',
      SERVER_PORT: String(this.port),
      // 国际站 = 账户站点指向 workdeck.ai（OfficialCloudEndpoint.isInternationalSite 按主机判定）；cn 保持默认的 aiworkdeck.com
      ...(this.profile.accountBaseUrl ? { AI_ACCOUNT_BASE_URL: this.profile.accountBaseUrl } : {}),
      SPRING_DATASOURCE_URL: `jdbc:postgresql://127.0.0.1:${this.pg.port}/${this.db}`,
      SPRING_DATASOURCE_USERNAME: 'awd', SPRING_DATASOURCE_PASSWORD: 'x',
      STORAGE_LOCAL_ROOT_PATH: path.join(this.dir, 'storage'), AI_PLUGINS_DIR: path.join(this.dir, 'plugins'),
      AI_SKILLS_BUILTIN_DIR: path.join(this.build.wt, 'backend/skills'), AI_PLUGINS_BUNDLED_DIR: path.join(this.build.wt, 'official-plugins'),
    }
    const out = fs.openSync(this.logFile, 'w')
    this.proc = spawn(path.join(this.java, 'bin/java'), [`-Duser.home=${path.join(this.dir, 'home')}`, '-Xmx1g', '-jar', this.build.jar], { env, stdio: ['ignore', out, out] })
    this.proc.on('exit', () => { this.exited = true })
    for (let i = 0; i < 150; i++) {
      if (this.exited) throw new Error(`后端 ${this.label} 启动失败，见 ${this.logFile}`)
      try { if ((await fetch(this.base + '/api/admin/wizard')).ok) break } catch { /* 还没起 */ }
      await sleep(2000)
      if (i === 149) throw new Error(`后端 ${this.label} 300 秒内未就绪`)
    }
    const user = 'matrix_' + Math.random().toString(36).slice(2, 8), password = 'Matrix-Pass-12345'
    let r = await this.http('POST', '/api/auth/register', { username: user, password, displayName: user })
    if (r?.code !== 0) throw new Error(`注册测试用户失败（${this.label}）：${JSON.stringify(r).slice(0, 200)}`)
    this.sid = r.data.sessionId
    this.userId = r.data.user.id
    this.username = user
    this.cursor = 0
  }
  async http(method, url, body) {
    const isForm = body instanceof FormData
    const res = await fetch(this.base + url, {
      method,
      headers: { 'X-App-Language': this.profile.lang, ...(this.sid ? { 'X-Session-Id': this.sid } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    try { return JSON.parse(text) } catch { return { _status: res.status, _text: text.slice(0, 300) } }
  }
  sql(q) { return this.pg.psql(this.db, q) }
  async rows(q) { const t = await this.sql(`select coalesce(json_agg(t),'[]'::json) from (${q}) t`); return JSON.parse(t) }
  async stop() {
    if (this.proc && !this.exited) { this.proc.kill('SIGTERM'); for (let i = 0; i < 20 && !this.exited; i++) await sleep(250); if (!this.exited) this.proc.kill('SIGKILL') }
  }

  // 每个句子一个全新项目；用户级/项目级记忆表整体清空，保证互不污染
  async reset() {
    await this.sql('delete from memory_entry; delete from memory_document; delete from project_memory; delete from user_memory;').catch(() => {})
    // 前几次运行留下的项目改成不可能被点名的名字：带 projectName/otherProjects 的句子（同名项目歧义、按名建事项）
    // 才不会被上一次运行的同名项目污染
    await this.sql(`update project set name = 'zz-prev-' || id where user_id = ${this.userId} and project_type = 'BLANK'`).catch(() => {})
  }
  async seed(sentence) {
    const seed = sentence.seed || {}
    const isoDay = off => { const d = new Date(Date.now() + off * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    // seed.otherProjects：同一用户名下的其它项目（先建，当前项目最后建 = 最新），用来造「名字相近的两个项目」
    for (const op of seed.otherProjects || []) {
      const o = await this.http('POST', '/api/projects', { projectType: 'BLANK', name: op.name })
      if (!o?.id) throw new Error('创建其它项目失败：' + JSON.stringify(o).slice(0, 200))
      for (const t of op.tasks || []) await this.http('POST', '/api/tasks', { projectId: o.id, title: t.title, dueDate: isoDay(t.dueInDays ?? 0) })
    }
    const proj = await this.http('POST', '/api/projects', { projectType: 'BLANK', name: seed.projectName || 'matrix-' + sentence.id + '-' + Date.now() })
    if (!proj?.id) throw new Error('创建项目失败：' + JSON.stringify(proj).slice(0, 200))
    const pid = proj.id
    const folders = {}
    for (const name of seed.folders || []) {
      const f = await this.http('POST', `/api/projects/${pid}/files/folder`, { name, parentId: null })
      if (!f?.id) throw new Error('建文件夹失败：' + JSON.stringify(f).slice(0, 200))
      folders[name] = f.id
    }
    for (const f of seed.files || []) {
      const bytes = fs.readFileSync(path.join(HERE, 'fixtures', f.fixture))
      const created = await this.http('POST', `/api/projects/${pid}/files/file`,
        { name: f.name, fileType: path.extname(f.name).slice(1), fileSize: bytes.length, parentId: f.folder ? folders[f.folder] : null })
      if (!created?.id) throw new Error('建文件失败：' + JSON.stringify(created).slice(0, 200))
      for (let a = 0; a < 30; a++) { // 新项目版本库刚建时会回 VERSION_BUSY
        const form = new FormData()
        form.append('file', new Blob([bytes]), f.name)
        const r = await this.http('POST', `/api/files/${created.id}/upload`, form)
        if (r?.code === 0) break
        if (r?.reason !== 'VERSION_BUSY' || a === 29) throw new Error('上传失败：' + JSON.stringify(r).slice(0, 200))
        await sleep(1000)
      }
    }
    for (const t of seed.tasks || []) {
      const d = new Date(Date.now() + (t.dueInDays ?? 0) * 86400000)
      const dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const r = await this.http('POST', '/api/tasks', { projectId: pid, title: t.title, dueDate })
      if (r?.code !== undefined && r.code !== 0 && !r.data) throw new Error('建任务失败：' + JSON.stringify(r).slice(0, 200))
    }
    for (const m of seed.memory || []) {
      const q = s => "'" + String(s).replace(/'/g, "''") + "'"
      await this.sql(`insert into memory_entry (uid, user_id, project_id, memory_type, memory_key, memory_value, is_protected, importance_score, scope, created_at, updated_at)
        values (gen_random_uuid()::text, ${this.userId}, ${pid}, ${q(m.type || 'preference')}, ${q(m.key)}, ${q(m.content)}, false, 0.7, ${q(m.scope || 'user')}, now(), now())`)
    }
    // 会议夹具（V5）：直接写本实例库里的内置表——录音 meeting_recording、腾讯会议同步表 tencent_meeting_record。
    // 只用虚构数据，绝不触达任何真实腾讯会议账号或 tmeet CLI。dayOffset 相对今天（-1 = 昨天）。
    for (const m of seed.meetings || []) {
      const q = s => "'" + String(s).replace(/'/g, "''") + "'"
      const at = `((now() at time zone 'Asia/Shanghai') + interval '${m.dayOffset ?? 0} day')` // 北京时间的本地时刻：工具按日期过滤、模型按北京日期说「昨天」
      const transcript = JSON.stringify((m.transcript || [{ speaker: '1', start: 1000, end: 4000, text: '同意按分期付款方案推进。' }]))
      await this.sql(`insert into meeting_recording (project_id, title, status, duration_ms, transcript_json, created_by, created_at, updated_at)
        values (${pid}, ${q(m.title)}, 'transcribed', ${m.durationMs ?? 1800000}, ${q(transcript)}, ${this.userId}, ${at}, ${at})`)
    }
    for (const m of seed.tencentMeetings || []) {
      const q = s => "'" + String(s).replace(/'/g, "''") + "'"
      const at = `((now() at time zone 'Asia/Shanghai') + interval '${m.dayOffset ?? 0} day')` // 北京时间的本地时刻：工具按日期过滤、模型按北京日期说「昨天」
      const para = JSON.stringify([{ startTime: '00:00:05', speakerName: m.speaker || '张三', text: m.text || '本次会议确认股权激励方案，下周五前出协议草稿。' }])
      await this.sql(`insert into tencent_meeting_record (project_id, user_id, meeting_id, meeting_code, record_file_id, subject, start_time, duration, status, transcript_json, smart_minutes_text, synced_at, created_at, updated_at)
        values (${pid}, ${this.userId}, ${q('fx-' + Math.random().toString(36).slice(2, 10))}, ${q(m.meetingCode || '888-000-111')}, ${q('rf-' + Math.random().toString(36).slice(2, 10))}, ${q(m.subject)}, ${at}, ${q(m.duration || '30分钟')}, 'SYNCED', ${q(para)}, ${q(m.minutes || '')}, now(), now(), now())`)
    }
    return pid
  }

  // 编辑器句子：client_action 经页面自己的 SSE 会话桥到 LOWA 执行，所以必须由页面发消息、持有 SSE。
  // 流程：打开项目 → 点开文件 → 等编辑器就绪 → 在聊天框发送；会话 id 从页面发出的 /api/agent/chat 请求里取；
  // 结束判据是后端日志里的 "Agent Loop Finished for <conv>"（编排循环真正收尾），不是静默等待。
  async chatInEditor(browser, pid, sentence, hostFile, timeoutSec) {
    const t0 = Date.now()
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } })
    const rec = { pageText: null, conversationId: null, status: null, error: null, text: '', events: [], logOffset: fs.statSync(this.logFile).size }
    try {
      // 护栏：只放行本机请求（页面里有写死的外链图片等），也绝不触达默认端口 9696 上别人的后端
      await ctx.route(u => !/^(http:\/\/(localhost|127\.0\.0\.1):\d+\/|data:|blob:)/.test(u.href) || /:9696\//.test(u.href), r => r.abort())
      // 纯浏览器 H5 没有桌面壳：让「本地内容协议」探针按 404 回退到普通下载路径（与既有 e2e 做法一致）
      await ctx.route('**/api/desktop/startup-health', r => r.fulfill({ status: 404, body: '' }))
      const user = { id: this.userId, username: this.username }
      await ctx.addInitScript(([sid, u, m, lang]) => {
        localStorage.setItem('checkba_app_language', lang)
        localStorage.setItem('checkba_session_id', JSON.stringify({ type: 'string', data: sid }))
        localStorage.setItem('checkba_user', JSON.stringify({ type: 'object', data: u }))
        localStorage.setItem('ai_selected_model', JSON.stringify({ type: 'string', data: m }))
      }, [this.sid, user, this.model, this.profile.lang])
      const page = await ctx.newPage()
      const diag = []
      page.on('requestfailed', rq => diag.push('FAIL ' + rq.url().slice(0, 120) + ' ' + rq.failure()?.errorText))
      page.on('response', rs => { if (rs.status() >= 400) diag.push(rs.status() + ' ' + rs.url().slice(0, 120)) })
      page.on('console', m => { if (m.type() === 'error') diag.push('console ' + m.text().slice(0, 150)) })
      rec.diag = diag
      page.on('request', rq => {
        if (rq.method() === 'POST' && rq.url().endsWith('/api/agent/chat')) { try { rec.conversationId = JSON.parse(rq.postData()).conversationId } catch { /* ignore */ } }
      })
      await page.goto(`http://localhost:${this.h5.port}/#/pages/project-overview/project-overview?id=${pid}`)
      await page.getByText(hostFile).first().click({ timeout: 60000 })
      // 编辑器就绪：状态栏出现 Saved/Saving/Unsaved 且不再显示引擎启动文案
      const deadline = Date.now() + 120000
      for (;;) {
        const body = await page.locator('body').innerText()
        if (/Saved|Saving|Unsaved|已保存|保存中|未保存/.test(body) && !/Starting the document engine|正在启动文档引擎/.test(body)) break
        if (Date.now() > deadline) throw new Error('编辑器 120 秒内未就绪')
        await sleep(500)
      }
      rec.editorReadyMs = Date.now() - t0
      const t1 = Date.now()
      const box = page.locator('.chat-input-rich').last()
      await box.click()
      await page.keyboard.insertText(sentence.text)
      await page.keyboard.press('Enter')
      for (let i = 0; i < 100 && !rec.conversationId; i++) await sleep(100)
      if (!rec.conversationId) throw new Error('页面没有发出 /api/agent/chat 请求')
      const needle = `Agent Loop Finished for ${rec.conversationId}`
      // ask_user 停机（等用户回答）不会打印 "Agent Loop Finished"，只有 "Detected <question> for"；
      // 只认前者会把每次合法的反问记成 300 秒 timeout
      const askNeedle = `Detected <question> for ${rec.conversationId}`
      for (;;) {
        const fd = fs.openSync(this.logFile, 'r'); const size = fs.fstatSync(fd).size
        const buf = Buffer.alloc(size - rec.logOffset); fs.readSync(fd, buf, 0, buf.length, rec.logOffset); fs.closeSync(fd)
        const logText = buf.toString('utf8')
        if (logText.includes(needle)) { rec.status = 'finished'; break }
        if (logText.includes(askNeedle)) { rec.status = 'awaiting_input'; break }
        // 模型流报错（如供应商返回空响应）后编排循环不会再打印 Finished，不识别的话每次白等到超时
        if (logText.includes(`Stream error for ${rec.conversationId}`)) { rec.status = 'stream_error'; rec.error = '模型流报错（见后端日志 Stream error）' + (UNREACHABLE_RE.test(logText) ? ' prohibited due to a violation of provider Terms Of Service' : ''); break }
        if (Date.now() - t1 > timeoutSec * 1000) { rec.status = 'timeout'; await this.http('POST', `/api/agent/cancel/${rec.conversationId}`); break }
        await sleep(500)
      }
      rec.durationMs = Date.now() - t1
      rec.text = (await this.rows(`select content from project_ai_message where conversation_id='${rec.conversationId}' and role='ASSISTANT' order by id desc limit 1`))[0]?.content || ''
    } catch (e) {
      try { const pg = ctx.pages()[0]; if (pg) { await pg.screenshot({ path: path.join(this.outDir, `fail-${sanitize(this.label)}-${Date.now()}.png`) }); rec.pageText = (rec.diag || []).slice(0, 12).join('\n') } } catch { /* ignore */ }
      rec.status = rec.status || 'harness_error'; rec.error = String(e.message).slice(0, 300); rec.durationMs = rec.durationMs ?? Date.now() - t0 } finally { await ctx.close().catch(() => {}) }
    return rec
  }

  // 发一条消息，消费 SSE 直到 bubble_end（真实的「本轮结束」事件）；无任何固定静默等待
  async chat(pid, text, timeoutSec) {
    const conversationId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
    const ac = new AbortController()
    const events = []
    let text_ = '', status = null, error = null
    const t0 = Date.now()
    const sse = await fetch(`${this.base}/api/agent/connect/${conversationId}`, { headers: { 'X-Session-Id': this.sid, Accept: 'text/event-stream' }, signal: ac.signal })
    if (!sse.ok) throw new Error('SSE 连接失败 HTTP ' + sse.status)
    const done = new Promise(resolve => {
      const timer = setTimeout(() => { status = 'timeout'; resolve() }, timeoutSec * 1000)
      ;(async () => {
        const dec = new TextDecoder(); let buf = ''
        try {
          for await (const chunk of sse.body) {
            buf += dec.decode(chunk, { stream: true })
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2)
              let ev = 'message', data = ''
              for (const line of block.split('\n')) {
                if (line.startsWith('event:')) ev = line.slice(6).trim()
                else if (line.startsWith('data:')) data += line.slice(5).trim()
              }
              if (ev === 'heartbeat' || ev === 'connected') continue
              events.push(ev)
              let j = null; try { j = JSON.parse(data) } catch { /* 非 JSON */ }
              if (ev === 'text_delta') text_ += typeof j === 'string' ? j : (j?.content ?? j?.text ?? j?.delta ?? '')
              if (ev === 'error') { error = data.slice(0, 300) }
              if (ev === 'bubble_end') { status = j?.status || 'finished'; clearTimeout(timer); return resolve() }
              if (ev === 'error' || ev === 'cancelled') { status = ev; clearTimeout(timer); return resolve() }
            }
          }
        } catch (e) { if (!status) { status = 'sse_error'; error = String(e.message) } }
        clearTimeout(timer); resolve()
      })()
    })
    const logOffset = fs.statSync(this.logFile).size
    const r = await this.http('POST', '/api/agent/chat', { projectId: pid, conversationId, message: text, mode: 'AGENT', model: this.model, clientCapability: 'none', appLanguage: this.profile.lang })
    if (r?.status === 'error' || r?._status >= 400) { ac.abort(); return { status: 'rejected', error: JSON.stringify(r).slice(0, 300), conversationId, events, durationMs: Date.now() - t0, logOffset } }
    await done
    if (status === 'timeout') await this.http('POST', `/api/agent/cancel/${conversationId}`)
    ac.abort()
    return { status, error, conversationId, events, text: text_, durationMs: Date.now() - t0, logOffset }
  }
}

// ---------- 从后端日志/库里抽取指标 ----------
function parseLogSlice(slice, conversationId) {
  const tools = []
  const rounds = []
  let m
  // toolsHash = 本轮下发工具名（排序后）的哈希，toolsOrderHash = 按下发顺序的哈希；旧版本日志没有这两项
  const re = /\[Round\] conv=(\S+) depth=(\d+) round=(\d+) tools=(\d+)(?:.*? toolsHash=(\S+) toolsOrderHash=(\S+))?|name = "([a-zA-Z_0-9]+)", arguments|Parsed XML tool: ([a-zA-Z_0-9]+)/g
  while ((m = re.exec(slice))) {
    if (m[1]) { if (m[1] === conversationId) rounds.push({ depth: +m[2], round: +m[3], toolsOffered: +m[4], toolsHash: m[5] || null, toolsOrderHash: m[6] || null }) }
    else tools.push(m[7] || m[8])
  }
  return { tools, rounds }
}

async function runOne(inst, sentence, runIdx, opts) {
  const rec = { instance: inst.label, ref: inst.build.ref, model: inst.model, sentence: sentence.id, run: runIdx }
  const t0 = Date.now()
  try {
    await inst.reset()
    const pid = await inst.seed(needsEditor(sentence) ? withHostFile(sentence) : sentence)
    const c = needsEditor(sentence)
      ? await inst.chatInEditor(opts.browser, pid, sentence, sentence.hostFile || '合同.docx', opts.runTimeout)
      : await inst.chat(pid, sentence.text, opts.runTimeout)
    await sleep(300) // 让日志/用量落盘（落盘延迟，不是等模型）
    const fd = fs.openSync(inst.logFile, 'r'); const size = fs.fstatSync(fd).size
    const buf = Buffer.alloc(size - c.logOffset); fs.readSync(fd, buf, 0, buf.length, c.logOffset); fs.closeSync(fd)
    const { tools, rounds } = parseLogSlice(buf.toString('utf8'), c.conversationId)
    // cached_tokens / cache_write_tokens 列自本 PR 起才有；旧 ref 的库没有这两列时回退到不带缓存的查询（缓存数记 0）
    let usage = (await inst.rows(`select coalesce(sum(prompt_tokens),0)::int as p, coalesce(sum(completion_tokens),0)::int as c, count(*)::int as calls, coalesce(sum(cached_tokens),0)::int as cached, coalesce(sum(cache_write_tokens),0)::int as cache_write, count(cached_tokens)::int as cache_reported from token_usage where conversation_id='${c.conversationId}'`).catch(() => null))?.[0]
    usage = usage || (await inst.rows(`select coalesce(sum(prompt_tokens),0)::int as p, coalesce(sum(completion_tokens),0)::int as c, count(*)::int as calls from token_usage where conversation_id='${c.conversationId}'`).catch(() => []))[0] || {}
    Object.assign(rec, {
      status: c.status, error: c.error, tools, firstTool: tools[0] || null,
      rounds: rounds.length, toolsOffered: rounds.map(r => r.toolsOffered),
      maxToolsRound2plus: rounds.length > 1 ? Math.max(...rounds.slice(1).map(r => r.toolsOffered)) : null,
      promptTokens: usage.p ?? 0, completionTokens: usage.c ?? 0, llmCalls: usage.calls ?? 0,
      cachedTokens: usage.cached ?? 0, cacheWriteTokens: usage.cache_write ?? 0, cacheReportedCalls: usage.cache_reported ?? 0,
      billedEq: billedEq(usage.p ?? 0, usage.cached ?? 0),
      todoWrites: tools.filter(t => t === 'todo_write').length, askUser: tools.includes('ask_user'),
      lookAround: isLookAround(tools[0], sentence.expect.firstToolAnyOf),
      toolSetChanges: countChanges(rounds.map(r => r.toolsHash)), toolOrderChanges: countChanges(rounds.map(r => r.toolsOrderHash)),
      durationMs: c.durationMs, editorReadyMs: c.editorReadyMs, pageText: c.pageText, finalText: (c.text || '').slice(0, 1500), events: summarizeEvents(c.events || []), conversationId: c.conversationId,
    })
    const ctx = {
      projectId: pid, tools, finalText: c.text || '', api: (m, u, b) => inst.http(m, u, b), sql: q => inst.sql(q), rows: q => inst.rows(q),
      files: () => inst.rows(`select id, name, parent_id, is_folder, is_deleted from project_file where project_id=${pid} order by id`),
      tasks: () => inst.rows(`select id, title, due_date, source from project_task where project_id=${pid} order by id`),
      memory: () => inst.rows('select memory_type, memory_key, memory_value, scope from memory_entry'),
      // 二进制产物校验：下载项目文件字节、夹具 sha256、docx 的 word/document.xml
      bytes: async id => Buffer.from(await (await fetch(`${inst.base}/api/files/${id}/download`, { headers: { 'X-Session-Id': inst.sid } })).arrayBuffer()),
      sha256: buf => crypto.createHash('sha256').update(buf).digest('hex'),
      fixtureSha256: name => crypto.createHash('sha256').update(fs.readFileSync(path.join(HERE, 'fixtures', name))).digest('hex'),
      docxXml: buf => {
        const tmp = path.join(os.tmpdir(), `matrix-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`)
        fs.writeFileSync(tmp, buf)
        try { return execFileSync('unzip', ['-p', tmp, 'word/document.xml'], { maxBuffer: 64 << 20 }).toString('utf8') } finally { fs.unlinkSync(tmp) }
      },
    }
    rec.checks = await judge(sentence, rec, ctx)
    rec.pass = rec.checks.pass
  } catch (e) {
    Object.assign(rec, { status: 'harness_error', error: String(e.message).slice(0, 400), tools: rec.tools || [], pass: false, checks: { pass: false } })
  }
  rec.wallMs = Date.now() - t0
  return rec
}
// 相邻两轮哈希不同的次数（第 1 轮没有「上一轮」，不计）；日志里没有哈希（旧 ref）时返回 null
function countChanges(hashes) {
  if (!hashes.length || hashes.some(h => !h)) return null
  let n = 0
  for (let i = 1; i < hashes.length; i++) if (hashes[i] !== hashes[i - 1]) n++
  return n
}
const INFRA_RETRIES = 2
// OpenRouter 对该模型/出口直接 403（地域或供应商条款）：不是模型行为，也不会因重试好转。连续 3 次后该实例剩余句子整体 SKIPPED
const UNREACHABLE_RE = /prohibited due to a violation|No endpoints found|region/i
const MAX_UNREACHABLE = 3
const isInfraFailure = rec => !UNREACHABLE_RE.test(rec.error || '') && (rec.status === 'stream_error' || rec.status === 'harness_error' || (rec.status === 'error' && /Stream ended without usable/.test(rec.error || ''))
  || (rec.status === 'timeout' && (rec.rounds ?? 0) <= 1))
// 「四处看看」：第一个工具是列清单/目录类工具，且不在句子声明的 firstToolAnyOf 里（没声明 firstToolAnyOf 的句子不计）
const LOOK_AROUND_RE = /^(list_[a-z_]+|doc_list_project_files|search_project_files|search_across_projects|search_project_summaries|task_list|meeting_list[a-z_]*|tmeet_list_meetings|memory_list|get_law_list)$/
function isLookAround(first, allowed) {
  if (!first || !allowed?.length) return false
  return LOOK_AROUND_RE.test(first) && !anyOf(allowed, [first])
}
function summarizeEvents(evs) { const c = {}; for (const e of evs) c[e] = (c[e] || 0) + 1; return c }

// ---------- 报告 ----------
// billed-equivalent（计费等价输入 token）= prompt − 0.9·cached：假设缓存读按输入价的 1/10 计（DeepSeek / Qwen 隐式缓存的典型比例，
// 对 Anthropic 缓存读也是 0.1x）；忽略缓存写溢价（1.25x，只在显式缓存的模型上有）和输出 token 的价差。
// 只是同口径对比用的代理指标，不是账单；真实账单以平台对账为准。
const CACHE_READ_DISCOUNT = 0.9
function billedEq(prompt, cached) { return Math.round(prompt - CACHE_READ_DISCOUNT * cached) }
const pct = (cached, prompt) => prompt ? (100 * cached / prompt).toFixed(1) + '%' : '-'
const med = xs => { const v = xs.filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null }
// 第 2 轮起每轮下发工具数的最大值（后端 [Round] 日志的 tools=N）；单次运行见 results.json 的 maxToolsRound2plus
const maxLater = rs => { const v = rs.map(r => r.maxToolsRound2plus).filter(x => x != null); return v.length ? Math.max(...v) : '-' }

function buildReport(meta, results, sentences) {
  const L = []
  const models = meta.models
  const total = results.filter(r => r.status !== 'SKIPPED')
  L.push(`# 模型矩阵报告 ${meta.timestamp}`, '',
    `- before: \`${meta.before.ref}\` (${meta.before.sha.slice(0, 10)})`, `- after: \`${meta.after.ref}\` (${meta.after.sha.slice(0, 10)})`,
    `- profile: ${meta.profile}（${PROFILES[meta.profile].lang}）/ tier: ${meta.tier}；模型: ${models.join(', ')}；每句 ${meta.runs} 次；并发实例 ${meta.concurrency}`,
    `- 总墙钟: ${(meta.wallMs / 1000).toFixed(0)}s（其中构建+启动 ${(meta.setupMs / 1000).toFixed(0)}s，跑题 ${(meta.runMs / 1000).toFixed(0)}s）`, '')
  const skipped = sentences.filter(s => results.some(r => r.sentence === s.id && r.status === 'SKIPPED'))
  if (skipped.length) L.push(`SKIPPED（需要编辑器或插件但本次未运行）：${skipped.map(s => s.id).join(', ')}`, '')
  L.push('## 汇总', '', '| 模型 | 版本 | 通过 | 首工具正确 | mustUse 满足 | 结果校验 | 提示词 tokens | 缓存命中 tokens | 命中率 | 计费等价 | 补全 tokens | 轮数 | 工具集变化轮数 | 顺序变化轮数 | ≥2轮最大工具数 | 耗时(s) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const m of models) for (const side of ['before', 'after']) {
    // before=after 同 ref 时 results 里靠 side 区分
    const rs = results.filter(r => r.side === side && r.model === m && r.status !== 'SKIPPED')
    const f = k => rs.filter(r => r.checks?.[k] === true).length, g = k => rs.filter(r => r.checks && k in r.checks).length
    const sum = k => rs.reduce((a, r) => a + (r[k] || 0), 0)
    L.push(`| ${m} | ${side} | ${rs.filter(r => r.pass).length}/${rs.length} | ${f('firstTool')}/${g('firstTool')} | ${f('mustUse')}/${g('mustUse')} | ${f('outcome')}/${g('outcome')} | ${sum('promptTokens')} | ${sum('cachedTokens')} | ${pct(sum('cachedTokens'), sum('promptTokens'))} | ${sum('billedEq')} | ${sum('completionTokens')} | ${sum('rounds')} | ${rs.some(r => r.toolSetChanges == null) ? '-' : sum('toolSetChanges')} | ${rs.some(r => r.toolOrderChanges == null) ? '-' : sum('toolOrderChanges')} | ${maxLater(rs)} | ${(sum('durationMs') / 1000).toFixed(0)} |`)
  }
  L.push('', `> 计费等价 = 提示词 tokens − ${CACHE_READ_DISCOUNT}·缓存命中 tokens（假设缓存读按输入价 0.1x，忽略缓存写溢价与输出价差；代理指标，非账单）。工具集变化轮数 = 与上一轮下发工具名集合不同的轮数（[Round] 日志 toolsHash）；旧 ref 无该日志记 -。`, '', '## 逐句对比', '')
  for (const m of models) {
    L.push(`### ${m}`, '', '| 句子 | before 通过 | after 通过 | before 首工具 | after 首工具 | before 轮/tokens | after 轮/tokens | before 命中率/计费等价/集变化 | after 命中率/计费等价/集变化 | ≥2轮最大工具数 before/after | 差异 |', '|---|---|---|---|---|---|---|---|---|---|---|')
    for (const s of sentences) {
      const pick = side => results.filter(r => r.side === side && r.model === m && r.sentence === s.id)
      const b = pick('before'), a = pick('after')
      if (b[0]?.status === 'SKIPPED') { L.push(`| ${s.id} | SKIPPED | SKIPPED | | | | | | | | ${b[0].reason || '需要编辑器'} |`); continue }
      const pr = rs => `${rs.filter(r => r.pass).length}/${rs.length}`
      const ft = rs => rs.map(r => r.firstTool || '-').join(' / ')
      const rt = rs => rs.map(r => `${r.rounds}r/${(r.promptTokens || 0) + (r.completionTokens || 0)}t`).join(' / ')
      const cm = rs => `${pct(rs.reduce((x, r) => x + (r.cachedTokens || 0), 0), rs.reduce((x, r) => x + (r.promptTokens || 0), 0))} / ${rs.map(r => r.billedEq ?? 0).join(',')} / ${rs.map(r => r.toolSetChanges ?? '-').join(',')}`
      const bp = b.filter(r => r.pass).length / (b.length || 1), ap = a.filter(r => r.pass).length / (a.length || 1)
      L.push(`| ${s.id} | ${pr(b)} | ${pr(a)} | ${ft(b)} | ${ft(a)} | ${rt(b)} | ${rt(a)} | ${cm(b)} | ${cm(a)} | ${maxLater(b)} / ${maxLater(a)} | ${ap < bp ? '**退步**' : ap > bp ? '进步' : ''} |`)
    }
    L.push('')
  }
  L.push('## 逐次运行（每次运行一行）', '', '| 模型 | 版本 | 句子 | run | 通过 | 轮数 | LLM 调用 | 提示词 | 缓存命中 | 命中率 | 计费等价 | 补全 | 工具集变化 | 顺序变化 |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of total) L.push(`| ${r.model} | ${r.side} | ${r.sentence} | ${r.run} | ${r.pass ? 'Y' : 'N'} | ${r.rounds ?? '-'} | ${r.llmCalls ?? '-'} | ${r.promptTokens ?? 0} | ${r.cachedTokens ?? 0} | ${pct(r.cachedTokens || 0, r.promptTokens || 0)} | ${r.billedEq ?? 0} | ${r.completionTokens ?? 0} | ${r.toolSetChanges ?? '-'} | ${r.toolOrderChanges ?? '-'} |`)
  L.push('', '## 中位数（按运行）', '', '| 模型 | 版本 | 轮数 | 提示词 | 计费等价 | 命中率 |', '|---|---|---|---|---|---|')
  for (const m of models) for (const side of ['before', 'after']) {
    const rs = total.filter(r => r.side === side && r.model === m)
    L.push(`| ${m} | ${side} | ${med(rs.map(r => r.rounds))} | ${med(rs.map(r => r.promptTokens))} | ${med(rs.map(r => r.billedEq))} | ${med(rs.map(r => r.promptTokens ? 100 * (r.cachedTokens || 0) / r.promptTokens : null))?.toFixed(1)}% |`)
  }
  L.push('')
  const fails = total.filter(r => !r.pass)
  if (fails.length) {
    L.push('## 未通过明细', '')
    for (const r of fails) L.push(`- [${r.side}/${r.model}] ${r.sentence} run${r.run}: status=${r.status}${r.error ? ' error=' + String(r.error).replace(/\s+/g, ' ').slice(0, 120) : ''} tools=[${(r.tools || []).join(',')}] checks=${JSON.stringify(Object.fromEntries(Object.entries(r.checks || {}).filter(([k]) => k !== 'pass')))}`)
    L.push('')
  }
  const allOk = models.every(m => {
    const p = side => results.filter(r => r.side === side && r.model === m && r.status !== 'SKIPPED')
    const rate = rs => rs.length ? rs.filter(r => r.pass).length / rs.length : 0
    return rate(p('after')) >= rate(p('before'))
  })
  L.push(`**AFTER ≥ BEFORE on correctness for all models: ${allOk ? 'yes' : 'no'}**`, '')
  L.push(...buildGateSection(meta, results, sentences))
  L.push(...buildCostSection(meta, results))
  return L.join('\n')
}

// ---------- 门禁（gate）汇总：逐句中位数、通过率、四处看看率、todo 次数、ask_user 率、判定与回退清单 ----------
// 判定：每个模型的「通过句数当量」= Σ(句内通过次数 / 运行次数)；AFTER ≥ BEFORE − 1（容忍一句话的波动）才算该模型通过。
// 回退清单：同一句子同一模型 AFTER 比 BEFORE 少通过 ≥2 次（--runs 1 时不可能触发）。
const GATE_TOLERANCE_SENTENCES = 1
const GATE_REGRESSION_RUNS = 2
function buildGateSection(meta, results, sentences) {
  const L = ['', '## 门禁汇总（逐句中位数，按模型）', '']
  const verdicts = []
  const regressions = []
  const f1 = x => x == null ? '-' : (Math.round(x * 10) / 10).toString()
  for (const m of meta.models) {
    L.push(`### ${m}`, '', '| 句子 | 通过 B→A | 轮数中位 B/A | 计费等价中位 B/A | 命中率中位 B/A | 四处看看率 B/A | todo_write 中位 B/A | ask_user 率 B/A |', '|---|---|---|---|---|---|---|---|')
    let eqB = 0, eqA = 0, n = 0
    for (const s of sentences) {
      const pick = side => results.filter(r => r.side === side && r.model === m && r.sentence === s.id)
      const b = pick('before'), a = pick('after')
      if (!b.length || !a.length || b[0].status === 'SKIPPED' || a[0].status === 'SKIPPED') { L.push(`| ${s.id} | SKIPPED | | | | | | |`); continue }
      const pb = b.filter(r => r.pass).length, pa = a.filter(r => r.pass).length
      eqB += pb / b.length; eqA += pa / a.length; n++
      if (pb - pa >= GATE_REGRESSION_RUNS) regressions.push(`${m} / ${s.id}: ${pb}/${b.length} → ${pa}/${a.length}`)
      const rate = (rs, k) => rs.length ? Math.round(100 * rs.filter(r => r[k]).length / rs.length) + '%' : '-'
      const cache = rs => f1(med(rs.map(r => r.promptTokens ? 100 * (r.cachedTokens || 0) / r.promptTokens : null)))
      L.push(`| ${s.id} | ${pb}/${b.length} → ${pa}/${a.length}${pb - pa >= GATE_REGRESSION_RUNS ? ' **回退**' : ''} | ${f1(med(b.map(r => r.rounds)))} / ${f1(med(a.map(r => r.rounds)))} | ${f1(med(b.map(r => r.billedEq)))} / ${f1(med(a.map(r => r.billedEq)))} | ${cache(b)}% / ${cache(a)}% | ${rate(b, 'lookAround')} / ${rate(a, 'lookAround')} | ${f1(med(b.map(r => r.todoWrites)))} / ${f1(med(a.map(r => r.todoWrites)))} | ${rate(b, 'askUser')} / ${rate(a, 'askUser')} |`)
    }
    const ok = eqA >= eqB - GATE_TOLERANCE_SENTENCES
    verdicts.push(ok)
    L.push('', `通过句数当量：BEFORE ${f1(eqB)} / ${n}，AFTER ${f1(eqA)} / ${n}（容忍 ${GATE_TOLERANCE_SENTENCES} 句）→ **${ok ? 'PASS' : 'FAIL'}**`, '')
  }
  L.push('### 回退清单（同句同模型 AFTER 少通过 ≥' + GATE_REGRESSION_RUNS + ' 次）', '')
  if (meta.runs < GATE_REGRESSION_RUNS) L.push(`本次 --runs ${meta.runs} < ${GATE_REGRESSION_RUNS}，回退清单不适用。`)
  else if (!regressions.length) L.push('无。')
  else for (const r of regressions) L.push('- ' + r)
  L.push('', `**GATE: ${verdicts.every(Boolean) ? 'PASS' : 'FAIL'}**（逐模型 ${meta.models.map((m, i) => `${m}=${verdicts[i] ? 'PASS' : 'FAIL'}`).join('，')}；回退 ${regressions.length} 句）`, '')
  return L
}

// ---------- 成本与耗时估算：按本次实测外推到「全量门禁」（每句 TARGET_RUNS 次，before+after 两侧）----------
const TARGET_RUNS = 3
function buildCostSection(meta, results) {
  const L = ['', `## 成本与耗时估算（外推到每句 ${TARGET_RUNS} 次、before+after 两侧）`, '',
    '| 模型 | 本次实测每次运行均价(USD) | 实测总花费(USD) | 全量门禁估算(USD) | 备注 |', '|---|---|---|---|---|']
  let sumEst = 0, unknown = false
  const liveCount = results.filter(r => r.status !== 'SKIPPED').length
  for (const m of meta.models) {
    const rs = results.filter(r => r.model === m && r.status !== 'SKIPPED')
    if (!rs.length) { L.push(`| ${m} | - | - | - | 全部 SKIPPED |`); continue }
    const costs = rs.map(r => costOf(m, r.promptTokens || 0, r.cachedTokens || 0, r.completionTokens || 0))
    if (costs.some(c => c == null)) { unknown = true; L.push(`| ${m} | - | - | - | 无标价，未估算 |`); continue }
    const total = costs.reduce((a, b) => a + b, 0), avg = total / rs.length
    const perSide = meta.sentenceCount // 近似：未跳过句数 ≈ 句集大小
    const est = avg * perSide * TARGET_RUNS * 2
    sumEst += est
    L.push(`| ${m} | ${avg.toFixed(4)} | ${total.toFixed(3)} | ${est.toFixed(2)} | 不含辅助模型（起标题/记忆抽取）与 provider 重试 |`)
  }
  const factor = TARGET_RUNS / meta.runs
  const estRun = meta.runMs * factor
  L.push('', `- 全量门禁成本合计约 **$${sumEst.toFixed(2)}**${unknown ? '（不含无标价模型）' : ''}（价格：OpenRouter 标价，输入/输出/缓存读 每 1M token；缓存读按实测 cached_tokens 计）。`,
    `- 耗时：本次跑题 ${(meta.runMs / 60000).toFixed(1)} min（每句 ${meta.runs} 次）；实例并行、同实例串行，外推到每句 ${TARGET_RUNS} 次 ≈ **${(estRun / 60000).toFixed(0)} min**，另加构建+启动约 ${(meta.setupMs / 60000).toFixed(1)} min（构建缓存命中时更短）。`, '')
  return L
}

// ---------- 主流程 ----------
async function main() {
  const o = parseArgs(process.argv.slice(2))
  o.profile = o.profile || 'cn'
  o.tier = o.tier || 'cheap'
  const prof = PROFILES[o.profile]
  if (!prof) { console.error('--profile 只能是 cn 或 intl'); process.exit(2) }
  if (!['cheap', 'release'].includes(o.tier)) { console.error('--tier 只能是 cheap 或 release'); process.exit(2) }
  o.models = o.models?.length ? o.models : (o.tier === 'release' ? [...prof.cheap, ...prof.extra] : prof.cheap)
  o.sentences = o.sentences || path.join(HERE, prof.sentences)
  if (o.help || !o.before || !o.after) { console.log(USAGE); process.exit(o.help ? 0 : 2) }
  if (!process.env.OPENROUTER_API_KEY) { console.error('缺少环境变量 OPENROUTER_API_KEY'); process.exit(2) }
  const sentences = loadSentences(path.resolve(o.sentences), o.only)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = path.join(o.out, timestamp)
  fs.mkdirSync(outDir, { recursive: true })
  const tmp = o.workdir ? (fs.mkdirSync(o.workdir, { recursive: true }), o.workdir) : fs.mkdtempSync(path.join(os.tmpdir(), 'awd-matrix-'))
  for (const d of ['pgdata']) fs.rmSync(path.join(tmp, d), { recursive: true, force: true })
  const java = findJava21()
  const T0 = Date.now()
  let pg = null
  const instances = []
  let builds = []
  let browser = null
  const servers = []
  const cleanup = async () => {
    await browser?.close().catch(() => {})
    for (const sv of servers) sv.close()
    await Promise.all(instances.map(i => i.stop()))
    if (pg) await pg.stop()
    if (!o.keep) for (const b of builds) await run('git', ['worktree', 'remove', '--force', b.wt], { cwd: REPO }).catch(() => {})
    await run('git', ['worktree', 'prune'], { cwd: REPO }).catch(() => {})
    if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true })
  }
  let cleaning = false
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { if (cleaning) return; cleaning = true; await cleanup(); process.exit(130) })

  try {
    log(`输出目录 ${outDir}`)
    const refs = [...new Set([o.before, o.after])]
    const runsEditor = s => needsEditor(s) && !o.apiOnly && editorSupported(s)
    const needFrontend = sentences.some(runsEditor)
    const [pgRes, ...built] = await Promise.all([startPg(tmp), ...refs.map(r => buildRef(r, tmp, java, o, needFrontend))])
    pg = pgRes; builds = built
    const byRef = Object.fromEntries(built.map(b => [b.ref, b]))
    const sides = []
    for (const side of ['before', 'after']) for (const model of o.models) sides.push({ side, model, build: byRef[o[side]] })
    for (const s of sides) instances.push(Object.assign(new Instance({ label: `${s.side}-${s.model}`, build: s.build, model: s.model, pg, tmp, java, outDir, profile: PROFILES[o.profile] }), { side: s.side }))

    // 以并发 K 启动实例
    const queue = (items, k, fn) => { let i = 0; return Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => { while (i < items.length) await fn(items[i++]) })) }
    log(`启动 ${instances.length} 个后端实例（并发 ${o.concurrency}）...`)
    await queue(instances, o.concurrency, async inst => { await inst.start(); log(`实例就绪 ${inst.label} :${inst.port}`) })
    if (needFrontend) {
      browser = await loadPlaywright()
      o.browser = browser
      for (const inst of instances) { inst.h5 = await serveH5(inst.build, inst.base); servers.push(inst.h5.server) }
    }
    const setupMs = Date.now() - T0
    if (process.env.AWD_MATRIX_HOLD) { log('HOLD ' + JSON.stringify(instances.map(i => ({ l: i.label, api: i.port, h5: i.h5?.port, sid: i.sid, uid: i.userId, user: i.username })))); await new Promise(() => {}) }

    // 每实例串行跑题，实例之间并行（所有实例已起，并行度 = 实例数；K 限制的是同时启动数）
    const results = []
    const tRun = Date.now()
    await Promise.all(instances.map(async inst => {
      let unreachable = 0
      for (const s of sentences) for (let r = 1; r <= o.runs; r++) {
        let rec
        if (needsEditor(s) && !runsEditor(s)) rec = { instance: inst.label, ref: inst.build.ref, model: inst.model, sentence: s.id, run: r, status: 'SKIPPED', reason: `hostState=${s.hostState} 需要编辑器（--api-only 或该宿主类型暂不支持）`, pass: null }
        else if (unreachable >= MAX_UNREACHABLE) rec = { instance: inst.label, ref: inst.build.ref, model: inst.model, sentence: s.id, run: r, status: 'SKIPPED', reason: `SKIPPED：模型 ${inst.model} 在本机/本出口不可达（OpenRouter 连续 ${MAX_UNREACHABLE} 次 403）`, pass: null }
        else if (s.requiresPlugin && !fs.existsSync(path.join(inst.dir, 'plugins', s.requiresPlugin, 'manifest.json'))) rec = { instance: inst.label, ref: inst.build.ref, model: inst.model, sentence: s.id, run: r, status: 'SKIPPED', reason: `SKIPPED：实例未安装插件 ${s.requiresPlugin}`, pass: null }
        else {
          // 供应商侧的瞬时故障（空响应流、第 1 轮就卡死）不是模型行为：自动重跑，最多 INFRA_RETRIES 次，次数记入 rec.infraRetries
          for (let a = 0; ; a++) {
            rec = await runOne(inst, s, r, o)
            rec.infraRetries = a
            if (a >= INFRA_RETRIES || !isInfraFailure(rec)) break
            log(`${inst.label} ${s.id} #${r}: 供应商瞬时故障（${rec.status}），重跑 ${a + 1}/${INFRA_RETRIES}`)
          }
        }
        rec.side = inst.side
        if (rec.status !== 'SKIPPED') unreachable = UNREACHABLE_RE.test(rec.error || '') && !rec.tools?.length ? unreachable + 1 : 0
        results.push(rec)
        log(`${inst.label} ${s.id} #${r}: ${rec.status === 'SKIPPED' ? 'SKIPPED ' + (rec.reason || '') : (rec.pass ? 'PASS' : 'FAIL')} ${rec.status !== 'SKIPPED' ? `first=${rec.firstTool} rounds=${rec.rounds} ${((rec.durationMs || 0) / 1000).toFixed(0)}s` : ''}`)
      }
    }))
    const runMs = Date.now() - tRun
    const meta = { timestamp, before: { ref: o.before, sha: byRef[o.before].sha }, after: { ref: o.after, sha: byRef[o.after].sha }, models: o.models, profile: o.profile, tier: o.tier, sentenceCount: sentences.length, runs: o.runs, concurrency: o.concurrency, wallMs: Date.now() - T0, setupMs, runMs, apiOnly: o.apiOnly }
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ meta, results }, null, 2))
    fs.writeFileSync(path.join(outDir, 'report.md'), buildReport(meta, results, sentences))
    log(`完成：总 ${(meta.wallMs / 1000).toFixed(0)}s（准备 ${(setupMs / 1000).toFixed(0)}s，跑题 ${(runMs / 1000).toFixed(0)}s）。报告 ${path.join(outDir, 'report.md')}`)
  } finally {
    scrubSecret(outDir)
    if (!cleaning) { cleaning = true; await cleanup() }
  }
}
main().catch(e => { console.error('失败：' + (e.message || e)); process.exit(1) })
