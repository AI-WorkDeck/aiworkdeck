// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

/**
 * ModelManager：本地大模型组件的状态机（absent | downloading | installed | error）。
 * 不自研下载器——spawn MinerU 官方 CLI（ModelScope/HF SDK 原生断点续传与校验），
 * 只负责：进程管理、stdout 进度解析（节流）、完成标记、删除与查询。
 *
 * createModelManager({ dataDir, resourcesPath, packaged, onProgress, spawnSpecOverride? })
 *   - onProgress({ id, phase: 'progress'|'done'|'error', percent?, message? })
 *   - spawnSpecOverride(component, ctx) → {cmd,args,env,cwd}：测试注入用
 */

const { MARKER, checkInventory, saveInventory } = require('./model-inventory')
const DOWNLOAD_STALL_MS = 3 * 60 * 1000
const DOWNLOAD_TOTAL_MS = 2 * 60 * 60 * 1000
const PROGRESS_POLL_MS = 1000

// 目标目录累计字节数（含子目录）：整体进度 = 已落盘字节 / estBytes。
// 下载器的 stdout 百分比是"当前单个文件"的 tqdm（MinerU 十几个模型文件会
// 反复 0→100%，真机反馈以为下载重跑了），不能当整体进度用。
function dirSize(root) {
  let total = 0
  const stack = [root]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch (e) { continue }
    for (const en of entries) {
      const fp = path.join(cur, en.name)
      if (en.isDirectory()) stack.push(fp)
      else if (en.isFile()) { try { total += fs.statSync(fp).size } catch (e) { /* 下载器可能正在改名/删除 */ } }
    }
  }
  return total
}

const { libDirFor, PACK_ID_BY_SERVICE } = require('./pysvc-runtime')
const { t } = require('../app-language')

function pyBin(resourcesPath) {
  return process.platform === 'win32'
    ? path.join(resourcesPath || '', 'python', 'python.exe')
    : path.join(resourcesPath || '', 'python', 'bin', 'python3.11')
}

// ModelScope 下载脚本随 main/** 打进 app.asar（package.json build.files），Python 读不了 asar；
// Electron 的 fs 能读，所以每次下载前把它拷到数据目录再交给打包 Python。
const FETCH_SCRIPT = path.join(__dirname, 'model-fetch.py')

function stagedFetchScript(ctx) {
  const dst = path.join(ctx.dataDir, 'models', '.model-fetch.py')
  const src = fs.readFileSync(FETCH_SCRIPT, 'utf8')
  let cur = null
  try { cur = fs.readFileSync(dst, 'utf8') } catch (e) { /* 首次 */ }
  if (cur !== src) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, src)
  }
  return dst
}

// kokoro / asr 的模型下载源（dev-board#583），按顺序尝试：
//   modelscope —— model-fetch.py 从 ModelScope 同名仓直下，落成标准 HF 缓存布局；
//   hf         —— model-fetch.py 校验 HF 元数据，huggingface_hub 逐文件下载走 hf-mirror.com。
// 为什么 ModelScope 在前：hf-mirror 只代理元数据，大文件 302 到 HF 官方 CDN
// （cas-bridge.xethub.hf.co），国内无代理网络连不上，报 LocalEntryNotFoundError。
// hf 留作回落给海外用户（ModelScope 在海外可能慢或不通）。
// CHECKBA_MODEL_SOURCE=modelscope|hf 强制单一来源（测试/排障用）。
const HF_SOURCES = ['modelscope', 'hf']
const SOURCE_LABELS = {
  modelscope: { zh: 'ModelScope', en: 'ModelScope' },
  hf: { zh: 'HuggingFace 镜像', en: 'HuggingFace mirror' }
}

function hfRepoSpec(ctx, service, repo, source) {
  const dir = path.join(ctx.dataDir, 'models', service.replace(/-service$/, ''))
  const base = { ...process.env, PYTHONPATH: libDirFor(ctx, service), HF_HOME: dir }
  if (source === 'modelscope') {
    return {
      cmd: pyBin(ctx.resourcesPath),
      args: [stagedFetchScript(ctx), '--repo', repo, '--hf-home', dir],
      env: base,
      cwd: dir
    }
  }
  return {
    cmd: pyBin(ctx.resourcesPath),
    args: [stagedFetchScript(ctx), '--source', 'hf', '--repo', repo, '--hf-home', dir],
    env: {
      ...base,
      HF_ENDPOINT: process.env.CHECKBA_HF_ENDPOINT || 'https://hf-mirror.com',
      // 打包内带 hf_xet：Xet 路径绕过 HF_ENDPOINT 直连 HF 官方 CAS
      // (cas-server.xethub.hf.co)，镜像签发的凭证在那边必 401——大陆用户
      // 无梯子即挂。禁用 xet 走镜像的普通 HTTP 下载（真机 401 实证）。
      HF_HUB_DISABLE_XET: '1'
    },
    cwd: dir
  }
}

// 所有源都失败后给用户看的话：先说原因和该怎么办，再附各源的原始异常便于排障。
// 前端会再套一层「下载失败：{msg}」（components.stateFailed），所以这里不重复「下载失败」。
function humanDownloadError(attempts) {
  const disk = attempts.some((a) => /error\[disk\]|No space left|Errno 28|ENOSPC/i.test(a.detail))
  const labels = attempts.map((a) => t(SOURCE_LABELS[a.source])).join(' / ')
  const runtime = attempts.some((a) => /ModuleNotFoundError|ImportError|DLL load failed|WinError 193/i.test(a.detail))
  const checksum = attempts.some((a) => /error\[checksum\]|ChecksumError/i.test(a.detail))
  const permission = attempts.some((a) => /PermissionError|EACCES|Errno 13/i.test(a.detail))
  const head = runtime
    ? t({ zh: '模型下载组件无法加载，请修复对应的运行时组件后重试。', en: 'The model downloader could not load. Repair its runtime component and retry.' })
    : checksum
      ? t({ zh: '模型下载内容校验失败，请重新下载。', en: 'Model download integrity verification failed. Please retry.' })
      : permission
        ? t({ zh: '无法写入模型目录，请检查文件访问权限后重试。', en: 'Cannot write to the model directory. Check file permissions and retry.' })
        : disk
    ? t({ zh: '磁盘空间不足，请清理出空间后重试。', en: 'Not enough disk space. Free up some space and try again.' })
    : t({
      zh: `无法连接模型下载源（${labels}），请检查网络后重试。`,
      en: `Could not reach the model download sources (${labels}). Check your network and try again.`
    })
  const details = attempts.map((a) => `${a.source}: ${a.detail.slice(0, 220)}`).join('; ')
  return `${head}${t({ zh: '原始错误：', en: ' Details: ' })}${details}`
}

// 组件注册表：MinerU pipeline 模型 + Kokoro 语音模型 + 本地转写模型
//
// name 写成 { zh, en } 对，由 status() 用 app-language 的 t() 取值——**必须在 status() 里取，
// 不能在这张表上取**：模块加载发生在渲染层把语言同步过来之前，那样会把语言冻死在首启猜测上。
// 这个 name 一路出现在 admin「组件管理」列表、下载/删除确认文案里，英文界面下不能是中文。
//
// sizeHint 只写数值与单位、**不带任何语言**（不要写「约」）：它会被塞进
// admin 的下载/删除确认文案与语音面板的按钮里，那些串是双语的，
// 「约」写在这里就会原样出现在英文界面上。修饰词归各处的 i18n 串。
const COMPONENTS = [
  {
    id: 'mineru-models',
    // 下载器本身跑在该服务的 venv 里（modelscope / huggingface_hub 都在 lib/ 下），
    // 所以下模型之前必须先装它的 runtime pack（download() 的守卫查这一项）
    runtimeService: 'mineru-service',
    name: { zh: '扫描件 OCR 模型（MinerU）', en: 'Scanned-document OCR Model (MinerU)' },
    sizeHint: '3 GB',
    estBytes: 3.0 * 1024 * 1024 * 1024, // 整体进度分母（估计值，进度封顶 99% 直到进程成功退出）
    // 模型根目录（相对 dataDir）
    dir: (ctx) => path.join(ctx.dataDir, 'models', 'mineru'),
    // 官方下载 CLI（前置校证 P1/P2，见 phase2 计划）
    spawnSpec: (ctx) => {
      const dir = path.join(ctx.dataDir, 'models', 'mineru')
      return {
        cmd: pyBin(ctx.resourcesPath),
        args: [
          '-c', 'from mineru.cli.models_download import download_models; download_models()',
          '-s', 'modelscope', '-m', 'pipeline'
        ],
        env: {
          ...process.env,
          PYTHONPATH: libDirFor(ctx, 'mineru-service'),
          MINERU_MODEL_SOURCE: 'modelscope',
          MODELSCOPE_CACHE: dir,
          HF_HOME: path.join(dir, 'hf'),
          MINERU_TOOLS_CONFIG_JSON: path.join(dir, 'mineru.json')
        },
        cwd: dir
      }
    }
  },
  {
    id: 'kokoro-models',
    runtimeService: 'kokoro-service',
    name: { zh: '语音合成模型（Kokoro）', en: 'Speech Synthesis Model (Kokoro)' },
    // 全仓实测约 376MB（含 100 个音色文件与 samples）；写小了进度会在 80% 处提前封顶 99%
    sizeHint: '380 MB',
    estBytes: 380 * 1024 * 1024,
    dir: (ctx) => path.join(ctx.dataDir, 'models', 'kokoro'),
    // 先 ModelScope 再 hf-mirror（见 HF_SOURCES）；两条路都落标准 HF 缓存，运行侧 HF_HOME 与此一致
    sources: HF_SOURCES,
    spawnSpec: (ctx, source) => hfRepoSpec(ctx, 'kokoro-service', 'hexgrad/Kokoro-82M-v1.1-zh', source)
  },
  {
    id: 'asr-models',
    runtimeService: 'asr-service',
    name: { zh: '本地转写模型（Whisper medium）', en: 'On-device Transcription Model (Whisper medium)' },
    sizeHint: '1.5 GB',
    estBytes: 1.5 * 1024 * 1024 * 1024,
    dir: (ctx) => path.join(ctx.dataDir, 'models', 'asr'),
    // 与 kokoro 同样先 ModelScope 再 hf-mirror；运行侧 HF_HOME 与此一致。
    // 模型不进安装包：1.5GB 会让安装包体积翻几倍，而只有开了「录音不出本机」的用户才需要它。
    sources: HF_SOURCES,
    spawnSpec: (ctx, source) => hfRepoSpec(ctx, 'asr-service', 'Systran/faster-whisper-medium', source)
  }
]

// 本次下载要依次尝试的来源；没有 sources 的组件（mineru）只有一次、source 为 null
function sourcesFor(c) {
  if (!c.sources) return [null]
  const forced = process.env.CHECKBA_MODEL_SOURCE
  return forced && c.sources.includes(forced) ? [forced] : c.sources
}

class ModelManager {
  constructor(opts) {
    this.ctx = {
      dataDir: opts.dataDir,
      resourcesPath: opts.resourcesPath,
      projectRoot: opts.projectRoot || null,
      packaged: !!opts.packaged
    }
    this.onProgress = opts.onProgress || (() => {})
    this.spawnSpecOverride = opts.spawnSpecOverride || null
    this.progressPollMs = opts.progressPollMs || PROGRESS_POLL_MS
    this.stallMs = opts.stallMs ?? DOWNLOAD_STALL_MS
    this.totalMs = opts.totalMs ?? DOWNLOAD_TOTAL_MS
    this.active = new Map() // id -> download job (including cancellation/termination)
    this.errors = new Map() // id -> last error message
  }

  component(id) {
    const c = COMPONENTS.find((x) => x.id === id)
    if (!c) throw new Error(`unknown component: ${id}`)
    return c
  }

  dirOf(id) {
    return this.component(id).dir(this.ctx)
  }

  isInstalled(id) {
    return checkInventory(id, this.dirOf(id)).installed
  }

  stateOf(id) {
    if (this.active.has(id)) return 'downloading'
    if (this.isInstalled(id)) return 'installed'
    if (this.errors.has(id) || checkInventory(id, this.dirOf(id)).invalid) return 'error'
    return 'absent'
  }

  status() {
    return COMPONENTS.map((c) => ({
      id: c.id,
      // 每次调用都重新取语言：切语言不重启主进程，缓存下来会一直报旧语言的名字
      name: t(c.name),
      sizeHint: c.sizeHint,
      state: this.stateOf(c.id),
      repairRequired: checkInventory(c.id, this.dirOf(c.id)).invalid,
      validation: 'structure-and-size',
      message: this.errors.get(c.id) || (checkInventory(c.id, this.dirOf(c.id)).invalid
        ? t({ zh: '模型需要校验，请选择校验并修复；可复用的下载文件会保留。', en: 'Model verification is needed. Verify and repair to reuse valid cached downloads.' }) : null)
    }))
  }

  async download(id, { repair = false, beforeStart } = {}) {
    const c = this.component(id)
    // 模型下载器本身就跑在这个服务的 venv 里（modelscope / huggingface_hub 都在 lib/ 下）：
    // 运行时 pack 没装的话，spawn 出去只会 ModuleNotFoundError，用户看到的是一句看不懂的
    // 报错而不是「先装组件」。这里当场说清楚（面板据此先装 pack 再下模型）。
    if (this.ctx.packaged && c.runtimeService && !libDirFor(this.ctx, c.runtimeService)) {
      throw new Error(`${PACK_ID_BY_SERVICE[c.runtimeService]} 未安装：模型下载要用该组件的 Python 运行时`)
    }
    if (this.active.has(id)) throw new Error(`${id} already downloading`)
    if (!repair && this.isInstalled(id)) throw new Error(`${id} already installed`)
    this.errors.delete(id)

    const dir = this.dirOf(id)
    const sources = sourcesFor(c)
    const attempts = [] // 失败过的来源：{ source, detail, raw }

    // A job owns all attempts and timers. Old child events cannot finish a newer retry.
    const job = { child: null, stopped: false, finish: null, stop: null }
    this.active.set(id, job)
    let lastLine = ''
    let lastSize = dirSize(dir)
    let lastChange = Date.now()
    const started = Date.now()
    const finish = (phase, message) => {
      if (job.stopped) return
      job.stopped = true
      clearInterval(poller)
      if (this.active.get(id) === job) this.active.delete(id)
      if (phase === 'error') this.errors.set(id, message)
      this.onProgress({ id, phase, message })
    }
    job.finish = finish
    // Wait for close before releasing the job: no new writer may race the old downloader.
    job.stop = (phase, message) => {
      if (job.stopPromise) return job.stopPromise
      job.stopPromise = new Promise((resolve) => {
        const child = job.child
        let killTimer
        const closed = () => {
          clearTimeout(killTimer)
          finish(phase, message)
          resolve({ ok: true })
        }
        if (!child || child.exitCode !== null || child.signalCode !== null) return closed()
        child.once('close', closed)
        child.kill('SIGTERM')
        killTimer = setTimeout(() => { if (!job.stopped) child.kill('SIGKILL') }, 3000)
      })
      return job.stopPromise
    }
    const poller = setInterval(() => {
      if (job.stopped || job.stopPromise) return
      const size = dirSize(dir)
      if (size !== lastSize) { lastSize = size; lastChange = Date.now() }
      if (Date.now() - started >= this.totalMs || Date.now() - lastChange >= this.stallMs) {
        job.stop('error', t({ zh: '模型下载超时或长时间没有新数据，已停止下载。请检查网络后重试。',
          en: 'Model download timed out or stopped receiving data. Download stopped; check your network and retry.' }))
        return
      }
      const percent = c.estBytes > 0 ? Math.min(99, Math.round(size / c.estBytes * 100)) : undefined
      this.onProgress({ id, phase: 'progress', percent, bytesDownloaded: size, message: lastLine.slice(0, 200) })
    }, this.progressPollMs)

    const settleFailure = (idx, raw, line) => {
      if (job.stopped || job.stopPromise) return
      const source = sources[idx]
      attempts.push({ source, raw, detail: line || raw })
      if (idx + 1 < sources.length) {
        lastChange = Date.now()
        return runAttempt(idx + 1)
      }
      finish('error', source === null ? raw.slice(0, 500) : humanDownloadError(attempts))
    }
    const runAttempt = (idx) => {
      let child
      try {
        const spec = this.spawnSpecOverride ? this.spawnSpecOverride(c, this.ctx, sources[idx]) : c.spawnSpec(this.ctx, sources[idx])
        child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e) { settleFailure(idx, String(e.message || e)); return }
      job.child = child
      let error = ''
      let errLine = ''
      lastLine = ''
      const hook = (stream) => {
        let buf = ''
        const line = (value) => {
          if (!value.trim() || job.child !== child || job.stopped) return
          lastLine = value.trim()
          if (/^(error\[\w+\]:|[\w.]+(Error|Exception)\b)/.test(lastLine)) errLine = lastLine
        }
        stream.on('data', (d) => {
          const parts = (buf + d.toString()).split(/[\r\n]+/)
          buf = parts.pop().slice(-2000)
          parts.forEach(line)
        })
        stream.on('end', () => line(buf))
      }
      hook(child.stdout)
      hook(child.stderr)
      child.once('error', (e) => { error = String(e.message || e) })
      child.once('close', (code, signal) => {
        if (job.stopped || job.stopPromise || job.child !== child) return
        if (code === 0 && !error) {
          try { saveInventory(id, dir) } catch (e) {
            finish('error', t({ zh: '下载进程已结束，但模型文件不完整。请重新下载以修复。',
              en: 'Download finished but model files are incomplete. Download again to repair.' }))
            return
          }
          finish('done')
        } else settleFailure(idx, error || `download exited ${code ?? signal}: ${lastLine}`, errLine || lastLine)
      })
    }
    try {
      if (beforeStart) await beforeStart()
      if (job.stopped) return { ok: false, cancelled: true, message: t({ zh: '已取消下载', en: 'Download cancelled' }) }
      fs.mkdirSync(dir, { recursive: true })
      fs.rmSync(path.join(dir, MARKER), { force: true })
      if (id === 'mineru-models') {
        // MinerU skips whole configured directories even when a child weight was removed.
        // Explicit repair must let its downloader inspect the cache again, retaining other settings.
        const configPath = path.join(dir, 'mineru.json')
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
          if (config['models-dir']) delete config['models-dir'].pipeline
          fs.writeFileSync(configPath, JSON.stringify(config))
        } catch (e) {
          if (e.code !== 'ENOENT') {
            // Keep an unreadable/invalid configuration for diagnosis; the downloader creates a fresh one.
            fs.renameSync(configPath, configPath + '.repair-backup')
          }
        }
      }
      runAttempt(0)
      return { ok: true }
    } catch (e) {
      const message = String(e.message || e)
      finish('error', message)
      return { ok: false, message }
    }
  }

  async cancel(id) {
    const job = this.active.get(id)
    if (!job) return { ok: true }
    this.errors.delete(id)
    return job.stop('cancelled', t({ zh: '已取消下载', en: 'Download cancelled' }))
  }

  /** Stop all writers on exit; keep ownership until their streams close. */
  killAllActive() {
    for (const [id] of this.active) this.cancel(id).catch(() => {})
  }

  async remove(id) {
    if (this.active.has(id)) await this.cancel(id)
    fs.rmSync(this.dirOf(id), { recursive: true, force: true })
    this.errors.delete(id)
    return { ok: true }
  }
}

function createModelManager(opts) {
  return new ModelManager(opts)
}

module.exports = { createModelManager, ModelManager }
