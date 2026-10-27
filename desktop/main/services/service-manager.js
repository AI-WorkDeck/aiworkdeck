// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require('path')
const net = require('net')
const fs = require('fs')
const { spawn } = require('child_process')

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try { socket.destroy() } catch (e) { /* ignore */ }
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

// 向内核要一个空闲端口（listen 0 再立即释放）。存在"释放后被抢"的窗口，
// 概率极低且仅影响单机自用端口，可接受（见设计文档 §2.1 端口策略）
function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
    s.once('error', reject)
  })
}

/**
 * 服务描述符（descriptor）契约：
 * {
 *   name: string                       // 唯一名，也是 ports 表的 key
 *   eager: boolean                     // startEager() 是否拉起
 *   logName: string                    // 打包态日志文件名（<dataDir>/logs/<logName>.log）
 *   enabled?: (ctx) => boolean         // 缺省 true；false 则 start() 返回 {ok:false, disabled:true}
 *   port: (ctx) => number|Promise<number>   // 分配端口（可读 env、可 findFreePort）
 *   verifyReuse?: (ctx, port) => Promise<boolean>  // 端口已被监听时验明是否自家服务；缺省视为是（旧语义）
 *   reallocatePort?: (ctx) => Promise<number>      // verifyReuse 失败（端口被陌生进程占）时重新分配
 *   fixedPort?: boolean               // 分配后不得漂移（后端地址已注入渲染层）
 *   health?: (ctx, port, build) => Promise<boolean> // 完整后端健康，供持续监督
 *   startupHealth?: (ctx, port, build, launch) => Promise<boolean> // 可选的首屏就绪；不代替完整健康
 *   requestStop?: (ctx, port, controlToken) => Promise<boolean> // 本次 child 的优雅退出
 *   stopTimeoutMs?: number            // SIGKILL 前宽限；后端需要覆盖 Spring graceful 时间
 *   startTimeoutMs: (ctx) => number
 *   prepare?: (ctx) => Promise<void>   // spawn 前置（dev 构建 jar / 打包态跑 DB 迁移）
 *   commands: (ctx) => [{cmd, args, env, cwd}]           // 候选命令，按序轮试
 *   moreCommandsAfterFailure?: (ctx) => [{...}]          // 首个候选失败后追加（系统 JDK 回退）
 * }
 * ctx = { packaged, appVersion, resourcesPath, dataDir, projectRoot, ports }
 */
class ServiceManager {
  constructor(ctx) {
    this.ctx = { ...ctx, ports: {} }
    this.ports = this.ctx.ports
    this.descriptors = new Map()
    this.procs = new Map()
    this.operations = new Map()
    this.healthChecks = new Map()
    this.launches = new Map()
    this.stopRequests = new Map()
    this.managed = new Set() // 曾由本管理器启动；退出后仍可恢复
    this.closing = false
    this.logStreams = new Map() // name -> 日志写入流（跟踪以便关闭，防 fd 泄漏）
  }

  register(descriptor) {
    this.descriptors.set(descriptor.name, descriptor)
  }

  async allocatePorts() {
    for (const d of this.descriptors.values()) {
      // eslint-disable-next-line no-await-in-loop
      this.ports[d.name] = await d.port(this.ctx)
    }
  }

  logStreamFor(d) {
    if (!this.ctx.packaged) return null
    const dir = path.join(this.ctx.dataDir, 'logs')
    fs.mkdirSync(dir, { recursive: true })
    return fs.createWriteStream(path.join(dir, d.logName + '.log'), { flags: 'a' })
  }

  runExclusive(name, operation, action) {
    const active = this.operations.get(name)
    if (active && active.operation === operation) return active.promise
    const promise = (active ? active.promise.catch(() => {}) : Promise.resolve()).then(action)
    const entry = { operation, promise }
    this.operations.set(name, entry)
    promise.finally(() => {
      if (this.operations.get(name) === entry) this.operations.delete(name)
    }).catch(() => {})
    return promise
  }

  start(name) {
    return this.runExclusive(name, 'start', () => this._start(name))
  }

  isOwned(name) { return this.managed.has(name) }
  isBusy(name) { return this.operations.has(name) }
  getLaunch(name) { return this.launches.get(name) }
  async checkHealth(name, launch = this.launches.get(name)) {
    const current = () => launch && this.launches.get(name) === launch &&
      this.procs.get(name) === launch.process && launch.process.exitCode == null && launch.process.signalCode == null
    if (!current()) return false
    const healthy = await (this.healthChecks.get(name)?.() || Promise.resolve(false))
    if (!current()) return false
    if (healthy) launch.fullReady = true
    return healthy
  }

  async _start(name) {
    if (this.closing) throw new Error('services are stopping')
    const d = this.descriptors.get(name)
    if (!d) throw new Error(`unknown service: ${name}`)
    if (d.enabled && !d.enabled(this.ctx)) return { ok: false, disabled: true }
    let port = this.ports[name]

    // 已有实例在跑：验明正身后复用（无 verifyReuse 的服务保持旧语义直接复用）
    // 'reuse' = 自家服务在听 | 'foreign' = 陌生进程占用 | 'free' = 无人监听
    const probe = async () => {
      if (!(await isPortOpen(port))) return 'free'
      if (!d.verifyReuse || (await d.verifyReuse(this.ctx, port))) return 'reuse'
      return 'foreign'
    }
    let state = await probe()
    if (state === 'foreign' && d.reallocatePort && !d.fixedPort) {
      port = await d.reallocatePort(this.ctx)
      this.ports[name] = port
      state = await probe()
    }
    if (state === 'reuse') {
      if (!this.procs.has(name)) { this.managed.delete(name); this.launches.delete(name) }
      const launch = this.launches.get(name)
      return { ok: true, reused: true, launch,
        fullReady: launch ? await this.checkHealth(name, launch) : d.health ? await d.health(this.ctx, port) : true }
    }
    if (state === 'foreign') throw new Error(`${name} port ${port} 被未知进程占用`)

    if (d.prepare) await d.prepare(this.ctx)
    const postPrepare = await probe()
    if (postPrepare === 'reuse') {
      if (!this.procs.has(name)) { this.managed.delete(name); this.launches.delete(name) }
      const launch = this.launches.get(name)
      return { ok: true, reused: true, launch,
        fullReady: launch ? await this.checkHealth(name, launch) : d.health ? await d.health(this.ctx, port) : true }
    }
    if (postPrepare === 'foreign') throw new Error(`${name} port ${port} 被未知进程占用`)
    if (this.procs.get(name)) await this._stop(name)

    let timeoutMs = d.startTimeoutMs(this.ctx)
    // Windows-on-ARM 转译环境（Mac 虚拟机等）：x64 JVM/Python 首启慢一个数量级，
    // 60 秒级看门狗会把还在预热的进程杀在半路进入杀-重试死循环（dev-board#340）。
    // 统一放大等待窗口，而不是各服务自己猜。
    if (this.ctx.winEmulated) timeoutMs *= 8
    // 关闭上一次 start 遗留的日志流，避免每次重启/崩溃-重启累积文件描述符泄漏
    const prevStream = this.logStreams.get(name)
    if (prevStream) { try { prevStream.end() } catch (e) { /* ignore */ } this.logStreams.delete(name) }
    const logStream = this.logStreamFor(d)
    if (logStream) this.logStreams.set(name, logStream)
    const candidates = [...d.commands(this.ctx)]
    let triedFallback = false

    for (let i = 0; i < candidates.length; i++) {
      if (this.closing) throw new Error('services are stopping')
      const spec = candidates[i]
      const stdio = logStream ? ['ignore', 'pipe', 'pipe'] : 'inherit'
      const proc = spawn(spec.cmd, spec.args, { cwd: spec.cwd, env: spec.env, stdio })
      const launch = { process: proc, deadline: Date.now() + timeoutMs,
        fullReady: false, splitReadiness: !!d.startupHealth, bootOverlay: spec.bootOverlay }
      this.launches.set(name, launch)
      this.procs.set(name, proc)
      this.managed.add(name)
      if (d.requestStop) this.stopRequests.set(name, () => d.requestStop(this.ctx, port, spec.env?.AWD_BACKEND_CONTROL_TOKEN))
      proc.once('exit', () => { if (this.procs.get(name) === proc) this.procs.delete(name) })
      if (logStream) {
        proc.stdout.pipe(logStream, { end: false })
        proc.stderr.pipe(logStream, { end: false })
      }

      // 捕获本次启动的指纹，后台下载激活 overlay 不应把仍运行的旧版本判死。
      const health = d.health ? () => d.health(this.ctx, port, spec.env?.AWD_BACKEND_BUILD) : null
      if (health) this.healthChecks.set(name, health)
      const startupHealth = d.startupHealth ? () => d.startupHealth(this.ctx, port, spec.env?.AWD_BACKEND_BUILD, launch) : health
      // 等 HTTP 就绪或进程退出；其它服务保留 TCP readiness。
      // eslint-disable-next-line no-await-in-loop
      const result = await this.waitStartOrExit(proc, port, timeoutMs, startupHealth)
      if (result === 'started') {
        // A split startup probe only opens the window gate. Full readiness is confirmed
        // asynchronously by the supervisor, never awaited again on the startup path.
        const fullReady = !d.startupHealth
        launch.fullReady = fullReady
        return { ok: true, reused: false, cmd: spec.cmd, fullReady, launch }
      }
      if (result === 'timeout' || this.closing) {
        // 进程还活着但端口没起：杀掉再试下一个候选
        // eslint-disable-next-line no-await-in-loop
        await this._stop(name)
      } else {
        // 'exited'：进程已崩溃退出，丢引用即可，继续尝试下一个候选
        this.procs.delete(name)
      }

      if (!triedFallback && d.moreCommandsAfterFailure) {
        triedFallback = true
        for (const c of d.moreCommandsAfterFailure(this.ctx)) {
          if (!candidates.some((x) => x.cmd === c.cmd)) candidates.push(c)
        }
      }
    }
    throw new Error(`${name} failed to start on port ${port}`)
  }

  // 等服务端口就绪或进程退出，返回 'started' | 'exited' | 'timeout'
  waitStartOrExit(proc, port, timeoutMs, health = null) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (v) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      proc.once('exit', () => finish('exited'))
      proc.once('error', () => finish('exited'))
      const start = Date.now()
      const poll = async () => {
        while (!settled && Date.now() - start < timeoutMs) {
          // eslint-disable-next-line no-await-in-loop
          if (this.closing || proc.exitCode != null || proc.signalCode != null) return finish('exited')
          const ready = await (health ? health() : isPortOpen(port))
          if (!settled && ready) return finish('started')
          // eslint-disable-next-line no-await-in-loop
          await sleep(200)
        }
        finish('timeout')
      }
      poll().catch(() => finish('timeout'))
    })
  }

  // 并行拉起所有 eager 服务。端口已在 allocatePorts 统一分配好，服务之间没有
  // "谁先监听"的启动时序依赖（pptx 只是把 mineru 端口写进环境变量，不要求 mineru
  // 已经监听），逐个 await 纯粹是白白把首启时间叠加起来。单个服务失败互不影响，
  // 语义与原来串行版本一致：results 里每个 name 各自 {ok, error}。
  // 首屏已单独启动后端时排除它，避免后台组件启动再次探测/重启后端。
  async startEager(excludedNames = []) {
    const results = {}
    const eagerNames = [...this.descriptors.values()].filter((d) => d.eager && !excludedNames.includes(d.name)).map((d) => d.name)
    await Promise.all(eagerNames.map(async (name) => {
      try {
        results[name] = await this.start(name)
      } catch (e) {
        results[name] = { ok: false, error: String(e && e.message ? e.message : e) }
      }
    }))
    return results
  }

  stop(name) {
    return this.runExclusive(name, 'stop', () => this._stop(name))
  }

  async _stop(name) {
    const p = this.procs.get(name)
    if (!p) return { ok: true }
    if (p.exitCode != null || p.signalCode != null) { this.procs.delete(name); return { ok: true } }
    return new Promise((resolve, reject) => {
      let finished = false
      let killTimer = null
      let exitTimer = null
      const done = () => {
        if (finished) return
        finished = true
        // 进程已经退了就把强杀定时器撤掉：原来这个 setTimeout 从不取消，每停一次服务
        // 就留一个 3 秒的悬挂句柄（退出路径上还会把事件循环多吊住 3 秒）
        if (killTimer) { clearTimeout(killTimer); killTimer = null }
        if (exitTimer) clearTimeout(exitTimer)
        if (this.procs.get(name) === p) this.procs.delete(name)
        resolve({ ok: true })
      }
      p.once('exit', done)
      const terminate = () => {
        if (finished) return
        try { p.kill('SIGTERM') } catch (e) { p.removeListener('exit', done); reject(e) }
      }
      const requestStop = this.stopRequests.get(name)
      if (requestStop) {
        // Windows SIGTERM 等价于强杀；先通过拥有者令牌请 Spring 优雅关闭。
        Promise.resolve().then(requestStop).catch(() => false).then((accepted) => {
          if (!accepted && process.platform !== 'win32') terminate()
        })
      } else terminate()
      // 后端必须给事务和文件写入留下退出宽限；强杀后仍等 exit，不能与新 JVM 重叠。
      const graceMs = this.descriptors.get(name)?.stopTimeoutMs || 3000
      killTimer = setTimeout(() => {
        try { p.kill('SIGKILL') } catch (e) { /* ignore */ }
        if (!finished) exitTimer = setTimeout(() => {
          p.removeListener('exit', done)
          reject(new Error(`${name} did not exit after SIGKILL`))
        }, 3000)
      }, graceMs)
    })
  }

  // 并行停所有服务。各服务之间没有停止顺序依赖（端口、数据目录都各管各的），
  // 逐个 await 只是把每个服务最坏 3 秒的强杀兜底线性叠加起来：退出时后端一个人
  // 装死就够让「⌘Q 到应用消失」拖成 6 秒，用户看着一个还能点的窗口，最后整个应用
  // 在同一瞬间消失——观感与闪退不可区分（dev-board#602）。
  async stopAll() {
    this.closing = true
    await Promise.all([...new Set([...this.procs.keys(), ...this.operations.keys()])].map((name) => this.stop(name)))
    // 退出/全停时关闭所有日志流，释放 fd
    for (const [, s] of this.logStreams) { try { s.end() } catch (e) { /* ignore */ } }
    this.logStreams.clear()
    return { ok: true }
  }

  restart(name) {
    return this.runExclusive(name, 'restart', async () => {
      if (this.closing) throw new Error('services are stopping')
      await this._stop(name)
      return this._start(name)
    })
  }
}

function createServiceManager(ctx) {
  return new ServiceManager(ctx)
}

module.exports = { createServiceManager, ServiceManager, isPortOpen, findFreePort }
