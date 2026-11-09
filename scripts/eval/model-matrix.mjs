#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 真实模型 A/B 矩阵：before/after 两个 git ref × N 个模型 × 句子集，并行跑 Agent，直接走后端 HTTP/SSE。
// 用法与设计见 scripts/eval/README.md。密钥只从环境变量 OPENROUTER_API_KEY 读取，只传给子进程环境，从不打印、落盘。

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
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
  const o = { runs: 1, concurrency: 4, apiOnly: false, keep: false, runTimeout: 300, out: path.join(HERE, 'out') }
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
    else if (a === '--keep') o.keep = true
    else if (a === '--help' || a === '-h') o.help = true
    else throw new Error('未知参数：' + a)
  }
  return o
}
const USAGE = `用法：node scripts/eval/model-matrix.mjs --before <ref> --after <ref> --models a,b --sentences <file.json>
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
  try { return path.dirname(execFileSync('which', ['initdb'], { encoding: 'utf8' }).trim()) } catch { /* ignore */ }
  throw new Error('找不到 PostgreSQL（initdb），请设置 PG_BIN')
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
  if (e.finalTextIncludes?.length) r.finalText = e.finalTextIncludes.every(t => (rec.finalText || '').includes(t))
  if (e.outcomeCheck) {
    try {
      const fn = new (Object.getPrototypeOf(async function () {}).constructor)('ctx', e.outcomeCheck)
      r.outcome = !!(await fn(ctx))
    } catch (err) { r.outcome = false; r.outcomeError = String(err.message || err).slice(0, 200) }
  }
  const checks = Object.entries(r).filter(([k]) => ['firstTool', 'mustUse', 'mustNotUse', 'finalText', 'outcome'].includes(k))
  r.pass = rec.status === 'finished' && checks.every(([, v]) => v === true)
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
async function buildRef(ref, tmp, java) {
  const sha = execFileSync('git', ['rev-parse', '--verify', ref + '^{commit}'], { cwd: REPO, encoding: 'utf8' }).trim()
  const wt = path.join(tmp, 'wt-' + sha.slice(0, 10))
  if (!fs.existsSync(wt)) await run('git', ['worktree', 'add', '--detach', wt, sha], { cwd: REPO })
  log(`构建 ${ref} (${sha.slice(0, 10)}) ...`)
  const t0 = Date.now()
  await run('mvn', ['-q', '-B', '-DskipTests', 'package'], { cwd: path.join(wt, 'backend'), env: { ...process.env, JAVA_HOME: java, PATH: path.join(java, 'bin') + ':' + process.env.PATH } })
  const jars = fs.readdirSync(path.join(wt, 'backend/target')).filter(f => /^backend-.*\.jar$/.test(f) && !f.includes('original'))
  if (!jars.length) throw new Error('未找到后端 jar：' + ref)
  log(`构建 ${ref} 完成 ${Math.round((Date.now() - t0) / 1000)}s`)
  return { ref, sha, wt, jar: path.join(wt, 'backend/target', jars[0]) }
}

// ---------- 后端实例 ----------
class Instance {
  constructor({ label, build, model, pg, tmp, java, outDir }) {
    Object.assign(this, { label, build, model, pg, tmp, java, outDir })
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
    this.cursor = 0
  }
  async http(method, url, body) {
    const isForm = body instanceof FormData
    const res = await fetch(this.base + url, {
      method,
      headers: { ...(this.sid ? { 'X-Session-Id': this.sid } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
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
  }
  async seed(sentence) {
    const seed = sentence.seed || {}
    const proj = await this.http('POST', '/api/projects', { projectType: 'BLANK', name: 'matrix-' + sentence.id + '-' + Date.now() })
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
    return pid
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
    const r = await this.http('POST', '/api/agent/chat', { projectId: pid, conversationId, message: text, mode: 'AGENT', model: this.model, clientCapability: 'none' })
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
  const re = /\[Round\] conv=(\S+) depth=(\d+) round=(\d+) tools=(\d+)|name = "([a-zA-Z_0-9]+)", arguments|Parsed XML tool: ([a-zA-Z_0-9]+)/g
  while ((m = re.exec(slice))) {
    if (m[1]) { if (m[1] === conversationId) rounds.push({ depth: +m[2], round: +m[3], toolsOffered: +m[4] }) }
    else tools.push(m[5] || m[6])
  }
  return { tools, rounds }
}

async function runOne(inst, sentence, runIdx, opts) {
  const rec = { instance: inst.label, ref: inst.build.ref, model: inst.model, sentence: sentence.id, run: runIdx }
  const t0 = Date.now()
  try {
    await inst.reset()
    const pid = await inst.seed(sentence)
    const c = await inst.chat(pid, sentence.text, opts.runTimeout)
    await sleep(300) // 让日志/用量落盘（落盘延迟，不是等模型）
    const fd = fs.openSync(inst.logFile, 'r'); const size = fs.fstatSync(fd).size
    const buf = Buffer.alloc(size - c.logOffset); fs.readSync(fd, buf, 0, buf.length, c.logOffset); fs.closeSync(fd)
    const { tools, rounds } = parseLogSlice(buf.toString('utf8'), c.conversationId)
    const usage = (await inst.rows(`select coalesce(sum(prompt_tokens),0)::int as p, coalesce(sum(completion_tokens),0)::int as c, count(*)::int as calls from token_usage where conversation_id='${c.conversationId}'`).catch(() => []))[0] || {}
    Object.assign(rec, {
      status: c.status, error: c.error, tools, firstTool: tools[0] || null,
      rounds: rounds.length, toolsOffered: rounds.map(r => r.toolsOffered),
      promptTokens: usage.p ?? 0, completionTokens: usage.c ?? 0, llmCalls: usage.calls ?? 0,
      durationMs: c.durationMs, finalText: (c.text || '').slice(0, 1500), events: summarizeEvents(c.events), conversationId: c.conversationId,
    })
    const ctx = {
      projectId: pid, tools, finalText: c.text || '', api: (m, u, b) => inst.http(m, u, b), sql: q => inst.sql(q), rows: q => inst.rows(q),
      files: () => inst.rows(`select id, name, parent_id, is_folder, is_deleted from project_file where project_id=${pid} order by id`),
      tasks: () => inst.rows(`select id, title, due_date, source from project_task where project_id=${pid} order by id`),
      memory: () => inst.rows('select memory_type, memory_key, memory_value, scope from memory_entry'),
    }
    rec.checks = await judge(sentence, rec, ctx)
    rec.pass = rec.checks.pass
  } catch (e) {
    Object.assign(rec, { status: 'harness_error', error: String(e.message).slice(0, 400), tools: rec.tools || [], pass: false, checks: { pass: false } })
  }
  rec.wallMs = Date.now() - t0
  return rec
}
function summarizeEvents(evs) { const c = {}; for (const e of evs) c[e] = (c[e] || 0) + 1; return c }

// ---------- 报告 ----------
function buildReport(meta, results, sentences) {
  const L = []
  const models = meta.models
  const total = results.filter(r => r.status !== 'SKIPPED')
  L.push(`# 模型矩阵报告 ${meta.timestamp}`, '',
    `- before: \`${meta.before.ref}\` (${meta.before.sha.slice(0, 10)})`, `- after: \`${meta.after.ref}\` (${meta.after.sha.slice(0, 10)})`,
    `- 模型: ${models.join(', ')}；每句 ${meta.runs} 次；并发实例 ${meta.concurrency}`,
    `- 总墙钟: ${(meta.wallMs / 1000).toFixed(0)}s（其中构建+启动 ${(meta.setupMs / 1000).toFixed(0)}s，跑题 ${(meta.runMs / 1000).toFixed(0)}s）`, '')
  const skipped = sentences.filter(s => results.some(r => r.sentence === s.id && r.status === 'SKIPPED'))
  if (skipped.length) L.push(`SKIPPED（需要编辑器，当前仅 API 模式）：${skipped.map(s => s.id).join(', ')}`, '')
  L.push('## 汇总', '', '| 模型 | 版本 | 通过 | 首工具正确 | mustUse 满足 | 结果校验 | 提示词 tokens | 补全 tokens | 轮数 | 耗时(s) |', '|---|---|---|---|---|---|---|---|---|---|')
  for (const m of models) for (const side of ['before', 'after']) {
    // before=after 同 ref 时 results 里靠 side 区分
    const rs = results.filter(r => r.side === side && r.model === m && r.status !== 'SKIPPED')
    const f = k => rs.filter(r => r.checks?.[k] === true).length, g = k => rs.filter(r => r.checks && k in r.checks).length
    const sum = k => rs.reduce((a, r) => a + (r[k] || 0), 0)
    L.push(`| ${m} | ${side} | ${rs.filter(r => r.pass).length}/${rs.length} | ${f('firstTool')}/${g('firstTool')} | ${f('mustUse')}/${g('mustUse')} | ${f('outcome')}/${g('outcome')} | ${sum('promptTokens')} | ${sum('completionTokens')} | ${sum('rounds')} | ${(sum('durationMs') / 1000).toFixed(0)} |`)
  }
  L.push('', '## 逐句对比', '')
  for (const m of models) {
    L.push(`### ${m}`, '', '| 句子 | before 通过 | after 通过 | before 首工具 | after 首工具 | before 轮/tokens | after 轮/tokens | 差异 |', '|---|---|---|---|---|---|---|---|')
    for (const s of sentences) {
      const pick = side => results.filter(r => r.side === side && r.model === m && r.sentence === s.id)
      const b = pick('before'), a = pick('after')
      if (b[0]?.status === 'SKIPPED') { L.push(`| ${s.id} | SKIPPED | SKIPPED | | | | | 需要编辑器 |`); continue }
      const pr = rs => `${rs.filter(r => r.pass).length}/${rs.length}`
      const ft = rs => rs.map(r => r.firstTool || '-').join(' / ')
      const rt = rs => rs.map(r => `${r.rounds}r/${(r.promptTokens || 0) + (r.completionTokens || 0)}t`).join(' / ')
      const bp = b.filter(r => r.pass).length / (b.length || 1), ap = a.filter(r => r.pass).length / (a.length || 1)
      L.push(`| ${s.id} | ${pr(b)} | ${pr(a)} | ${ft(b)} | ${ft(a)} | ${rt(b)} | ${rt(a)} | ${ap < bp ? '**退步**' : ap > bp ? '进步' : ''} |`)
    }
    L.push('')
  }
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
  return L.join('\n')
}

// ---------- 主流程 ----------
async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help || !o.before || !o.after || !o.models?.length || !o.sentences) { console.log(USAGE); process.exit(o.help ? 0 : 2) }
  if (!process.env.OPENROUTER_API_KEY) { console.error('缺少环境变量 OPENROUTER_API_KEY'); process.exit(2) }
  const sentences = loadSentences(path.resolve(o.sentences), o.only)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = path.join(o.out, timestamp)
  fs.mkdirSync(outDir, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-matrix-'))
  const java = findJava21()
  const T0 = Date.now()
  let pg = null
  const instances = []
  let builds = []
  const cleanup = async () => {
    await Promise.all(instances.map(i => i.stop()))
    if (pg) await pg.stop()
    for (const b of builds) await run('git', ['worktree', 'remove', '--force', b.wt], { cwd: REPO }).catch(() => {})
    await run('git', ['worktree', 'prune'], { cwd: REPO }).catch(() => {})
    if (!o.keep) fs.rmSync(tmp, { recursive: true, force: true })
  }
  let cleaning = false
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { if (cleaning) return; cleaning = true; await cleanup(); process.exit(130) })

  try {
    log(`输出目录 ${outDir}`)
    const refs = [...new Set([o.before, o.after])]
    const [pgRes, ...built] = await Promise.all([startPg(tmp), ...refs.map(r => buildRef(r, tmp, java))])
    pg = pgRes; builds = built
    const byRef = Object.fromEntries(built.map(b => [b.ref, b]))
    const sides = []
    for (const side of ['before', 'after']) for (const model of o.models) sides.push({ side, model, build: byRef[o[side]] })
    for (const s of sides) instances.push(Object.assign(new Instance({ label: `${s.side}-${s.model}`, build: s.build, model: s.model, pg, tmp, java, outDir }), { side: s.side }))

    // 以并发 K 启动实例
    const queue = (items, k, fn) => { let i = 0; return Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => { while (i < items.length) await fn(items[i++]) })) }
    log(`启动 ${instances.length} 个后端实例（并发 ${o.concurrency}）...`)
    await queue(instances, o.concurrency, async inst => { await inst.start(); log(`实例就绪 ${inst.label} :${inst.port}`) })
    const setupMs = Date.now() - T0

    // 每实例串行跑题，实例之间并行（所有实例已起，并行度 = 实例数；K 限制的是同时启动数）
    const results = []
    const tRun = Date.now()
    await Promise.all(instances.map(async inst => {
      for (const s of sentences) for (let r = 1; r <= o.runs; r++) {
        let rec
        if (needsEditor(s)) rec = { instance: inst.label, ref: inst.build.ref, model: inst.model, sentence: s.id, run: r, status: 'SKIPPED', reason: `hostState=${s.hostState} 需要编辑器，--api-only/当前版本不支持`, pass: null }
        else rec = await runOne(inst, s, r, o)
        rec.side = inst.side
        results.push(rec)
        log(`${inst.label} ${s.id} #${r}: ${rec.status === 'SKIPPED' ? 'SKIPPED' : (rec.pass ? 'PASS' : 'FAIL')} ${rec.status !== 'SKIPPED' ? `first=${rec.firstTool} rounds=${rec.rounds} ${((rec.durationMs || 0) / 1000).toFixed(0)}s` : ''}`)
      }
    }))
    const runMs = Date.now() - tRun
    const meta = { timestamp, before: { ref: o.before, sha: byRef[o.before].sha }, after: { ref: o.after, sha: byRef[o.after].sha }, models: o.models, runs: o.runs, concurrency: o.concurrency, wallMs: Date.now() - T0, setupMs, runMs, apiOnly: true }
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ meta, results }, null, 2))
    fs.writeFileSync(path.join(outDir, 'report.md'), buildReport(meta, results, sentences))
    log(`完成：总 ${(meta.wallMs / 1000).toFixed(0)}s（准备 ${(setupMs / 1000).toFixed(0)}s，跑题 ${(runMs / 1000).toFixed(0)}s）。报告 ${path.join(outDir, 'report.md')}`)
  } finally {
    if (!cleaning) { cleaning = true; await cleanup() }
  }
}
main().catch(e => { console.error('失败：' + (e.message || e)); process.exit(1) })
