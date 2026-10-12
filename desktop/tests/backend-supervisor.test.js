// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { BackendSupervisor } = require('../main/services/backend-supervisor')
const { probeBackendHealth } = require('../main/services/backend-service')
const { ServiceManager, findFreePort } = require('../main/services/service-manager')

function harness(overrides = {}) {
  let now = 0, healthy = true, restarts = 0
  const events = []
  const services = { ctx: {}, ports: { backend: 1 }, procs: new Map([['backend', {}]]),
    descriptors: new Map([['backend', { health: async () => healthy }]]),
    isOwned: () => true, isBusy: () => false,
    checkHealth: () => services.descriptors.get('backend').health(),
    restart: async () => { restarts++; healthy = true; services.procs.set('backend', {}); return { ok: true } }, ...overrides }
  const supervisor = new BackendSupervisor(services, (s) => events.push(s),
    { now: () => now, retryDelays: [5, 15, 45], stableMs: 300, resumeGraceMs: 30 })
  return { services, supervisor, events, setHealthy: (v) => { healthy = v },
    advance: (v) => { now += v }, restarts: () => restarts }
}

test('HTTP hang requires consecutive failures; restart has delay, preserves port and needs sustained health to reset budget', async () => {
  const h = harness()
  await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'healthy')
  h.setHealthy(false)
  await h.supervisor.check(); await h.supervisor.check()
  assert.equal(h.restarts(), 0)
  await h.supervisor.check()
  assert.equal(h.restarts(), 0)
  h.advance(5); await h.supervisor.check()
  assert.equal(h.restarts(), 1)
  assert.equal(h.services.ports.backend, 1)
  assert.equal(h.supervisor.getHealth().attempts, 1)
  h.advance(300); await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().attempts, 0)
})

test('child exit is unhealthy even if the endpoint would respond; recovery budget is bounded', async () => {
  const h = harness({ restart: async () => { throw new Error('cannot start') } })
  h.services.procs.delete('backend')
  for (let i = 0; i < 15; i++) { h.advance(100); await h.supervisor.check() }
  assert.equal(h.supervisor.getHealth().attempts, 3)
  assert.equal(h.supervisor.getHealth().state, 'failed')
  assert.equal(h.supervisor.getHealth().reason, 'retry-limit')
})

test('sleep cancels an in-flight failed probe; wake receives grace and quit cancels recovery', async () => {
  let resolve
  const h = harness()
  h.services.descriptors.get('backend').health = () => new Promise((r) => { resolve = r })
  const checking = h.supervisor.check()
  h.supervisor.suspend(); resolve(false); await checking
  assert.equal(h.supervisor.getHealth().state, 'suspended')
  h.services.descriptors.get('backend').health = async () => false
  h.supervisor.resume(); await new Promise(setImmediate)
  await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'starting')
  h.supervisor.stop(); h.advance(100); await h.supervisor.check()
  assert.equal(h.restarts(), 0)
  assert.equal(h.supervisor.getHealth().state, 'stopped')
})

test('manual and automatic recovery share one operation; foreign backend can never be restarted', async () => {
  let resolve
  const h = harness({ restart: () => new Promise((r) => { resolve = r }) })
  const automatic = h.supervisor.recover(false)
  assert.equal(h.supervisor.recover(), automatic)
  resolve({ ok: true }); await automatic
  h.services.isOwned = () => false
  assert.equal((await h.supervisor.recover()).ok, false)
})

test('health is real bounded HTTP, requiring status and build; TCP accept alone cannot pass', async (t) => {
  let mode = 'up'
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/api/desktop/health')
    if (mode === 'hang') return
    res.statusCode = mode === 'down' ? 503 : 200
    res.end(JSON.stringify({ status: 'UP', build: 'current' }))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port
  assert.equal(await probeBackendHealth(port, 200, 'current'), true)
  assert.equal(await probeBackendHealth(port, 200, 'old'), false)
  mode = 'down'; assert.equal(await probeBackendHealth(port, 200), false)
  mode = 'hang'; assert.equal(await probeBackendHealth(port, 50), false)
})

test('manager serializes start/restart, confirms graceful child exit and never moves fixed port', async (t) => {
  const manager = new ServiceManager({ packaged: false })
  t.after(() => manager.stopAll())
  let spawns = 0
  const port = await findFreePort()
  manager.register({ name: 'backend', fixedPort: true, port: () => port, startTimeoutMs: () => 5000,
    stopTimeoutMs: 2000, health: () => probeBackendHealth(port, 100), verifyReuse: async () => false,
    reallocatePort: () => { throw new Error('must not move') }, commands: () => {
      spawns++
      return [{ cmd: process.execPath, args: ['-e', `
        const http = require('http');
        let hung = false;
        const s = http.createServer((q,r)=>{
          if(q.url === '/hang') { hung = true; r.end('hung'); return; }
          if(!hung) r.end(JSON.stringify({status:'UP'}));
        }).listen(${port}, '127.0.0.1');
        process.on('SIGTERM',()=>setTimeout(()=>s.close(()=>process.exit(0)), 100));
      `], env: process.env }]
    } })
  await manager.allocatePorts()
  const start = manager.start('backend')
  const restart = manager.restart('backend')
  assert.equal((await start).ok, true)
  const old = manager.procs.get('backend')
  assert.equal((await restart).ok, true)
  assert.ok(old.exitCode != null || old.signalCode != null)
  assert.equal(spawns, 2)
  assert.equal(manager.ports.backend, port)
  const supervisor = new BackendSupervisor(manager, () => {}, { failureThreshold: 1, retryDelays: [0] })
  t.after(() => supervisor.stop())
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/hang`)).text(), 'hung')
  assert.equal(await manager.checkHealth('backend'), false)
  await supervisor.check()
  assert.equal(spawns, 3)
  assert.equal(supervisor.getHealth().state, 'healthy')
  assert.equal(await manager.checkHealth('backend'), true)
  await manager.stop('backend')
  const foreign = http.createServer((q, r) => r.end('foreign'))
  await new Promise((r) => foreign.listen(port, '127.0.0.1', r))
  t.after(() => foreign.close())
  await assert.rejects(manager.restart('backend'), /未知进程/)
  assert.equal(spawns, 3)
  assert.equal(manager.ports.backend, port)
})

test('shipping backend shutdown uses a per-launch control token and keeps a 45s write grace', async (t) => {
  const { createBackendDescriptor } = require('../main/services/backend-service')
  const d = createBackendDescriptor()
  const ctx = { packaged: false, projectRoot: '/isolated', ports: { backend: 1 } }
  const first = d.commands(ctx)[0].env.AWD_BACKEND_CONTROL_TOKEN
  const second = d.commands(ctx)[0].env.AWD_BACKEND_CONTROL_TOKEN
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.notEqual(first, second)
  assert.equal(d.stopTimeoutMs, 45000)
  let calls = 0
  const server = http.createServer((req, res) => {
    calls++
    assert.equal(req.method, 'POST')
    assert.equal(req.url, '/api/desktop/shutdown')
    assert.equal(req.headers['x-awd-backend-control-token'], first)
    res.writeHead(202); res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => server.close())
  const port = server.address().port
  assert.equal(await d.requestStop(ctx, port, ''), false)
  assert.equal(calls, 0)
  assert.equal(await d.requestStop(ctx, port, first), true)
})

test('graceful HTTP shutdown never sends SIGTERM before the child exits', async () => {
  const { EventEmitter } = require('node:events')
  const m = new ServiceManager({ packaged: false })
  const p = new EventEmitter()
  const signals = []
  p.kill = (signal) => { signals.push(signal) }
  m.procs.set('backend', p)
  m.descriptors.set('backend', { stopTimeoutMs: 1000 })
  m.stopRequests.set('backend', async () => {
    setTimeout(() => { p.exitCode = 0; p.emit('exit', 0) }, 20)
    return true
  })
  await m.stop('backend')
  assert.deepEqual(signals, [])
  assert.equal(m.procs.has('backend'), false)
})

test('quit during startup prevents a deferred prepare from spawning a new child', async () => {
  const m = new ServiceManager({ packaged: false })
  let finishPrepare, prepared
  const gate = new Promise((r) => { prepared = r })
  m.register({ name: 'backend', port: findFreePort, startTimeoutMs: () => 100,
    prepare: () => { prepared(); return new Promise((r) => { finishPrepare = r }) },
    commands: () => [{ cmd: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }] })
  await m.allocatePorts()
  const starting = m.start('backend')
  await gate
  const stopping = m.stopAll()
  finishPrepare()
  await assert.rejects(starting, /stopping/)
  await stopping
  assert.equal(m.procs.size, 0)
})

test('late probe cannot overwrite recovery or stop, and power listeners are removed on quit', async () => {
  const { EventEmitter } = require('node:events')
  let finishProbe, finishRestart
  const h = harness({ restart: () => new Promise((r) => { finishRestart = r }) })
  h.services.checkHealth = () => new Promise((r) => { finishProbe = r })
  const power = new EventEmitter()
  h.supervisor.bindPowerMonitor(power)
  const probe = h.supervisor.check()
  const restart = h.supervisor.recover()
  finishProbe(false); await probe
  assert.equal(h.supervisor.getHealth().state, 'restarting')
  h.supervisor.stop()
  finishRestart({ ok: true }); await restart
  assert.equal(h.supervisor.getHealth().state, 'stopped')
  assert.equal(power.listenerCount('resume'), 0)
  assert.equal(power.listenerCount('suspend'), 0)
})

test('external wizard 200 cannot hide health 503; only explicit 404 is legacy and never taken over', async (t) => {
  let status = 503, wizardRequests = 0, restartCalls = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/api/admin/wizard') {
      wizardRequests++
      res.end(JSON.stringify({ initialized: true }))
      return
    }
    assert.equal(req.url, '/api/desktop/health')
    res.statusCode = status
    res.end(status === 404 ? 'old backend route not found' : JSON.stringify({ status: status === 200 ? 'UP' : 'DOWN' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const h = harness({ ports: { backend: server.address().port }, isOwned: () => false,
    restart: async () => { restartCalls++; return { ok: true } } })
  await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'failed')
  assert.equal(h.supervisor.getHealth().reason, 'external-backend')
  assert.equal(wizardRequests, 0, 'a failing health probe must not fall back to identity')
  status = 404
  await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'degraded')
  assert.equal(h.supervisor.getHealth().ok, false)
  assert.equal(h.supervisor.getHealth().reason, 'external-health-unverified')
  assert.equal(wizardRequests, 1)
  status = 200
  await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'healthy')
  assert.equal(h.supervisor.getHealth().owned, false)
  assert.equal((await h.supervisor.recover()).ok, false)
  assert.equal(restartCalls, 0)
})

// 执行 main.js 出货的失败回调、配置函数和 IPC handler；只替换 Electron 副作用。
function startupHarness(services) {
  const fs = require('node:fs')
  const path = require('node:path')
  const vm = require('node:vm')
  const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
  const helpers = source.slice(source.indexOf('function configureBackendSupervision('), source.indexOf('// 增量更新（docs/INCREMENTAL_UPDATE_DESIGN.md）'))
  const catchStart = source.indexOf(".catch((err) => {\n      // 端口分配/启动链失败")
  assert.ok(catchStart >= 0)
  const catchBody = source.slice(catchStart + '.catch((err) => {'.length, source.indexOf('\n    })', catchStart))
  const ipc = source.slice(source.indexOf("ipcMain.handle('checkba:backend-restart'"))
  const handlers = new Map()
  const supervisors = []
  let windows = 0
  class FakeSupervisor {
    constructor(manager) { this.manager = manager; this.health = {}; supervisors.push(this) }
    bindPowerMonitor() {}
    publish(state, reason) { this.health = { state, reason, ok: state === 'healthy', owned: this.manager.isOwned('backend') } }
    getHealth() { return this.health }
    start() { this.started = true }
    recover() { this.publish('healthy', ''); return Promise.resolve({ ok: true }) }
  }
  const context = vm.createContext({ services, BackendSupervisor: FakeSupervisor, powerMonitor: {},
    BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    logDesktopEvent() {}, console: { error() {} }, Date,
    createMainWindow: () => { windows++ }, retireFirstLaunchSplash() {} })
  vm.runInContext(`let backendSupervisor = null; let backendStartupFailed = false; let mainWindowStartupReady = false; let mainWindow = null;
    ${helpers}
    function failStartup(err) { ${catchBody} }
    ${ipc}`, context)
  return { fail: () => context.failStartup(new Error('startup failed')), handlers, supervisors, windowCount: () => windows }
}

test('startup failure before ownership opens UI with failed snapshot, never permanent starting', async () => {
  for (const services of [null, { isOwned: () => false, ports: {} }]) {
    const h = startupHarness(services)
    h.fail()
    const health = h.handlers.get('checkba:backend-health')()
    assert.equal(health.state, 'failed')
    assert.equal(health.reason, 'startup-failed')
    assert.equal(health.owned, false)
    assert.equal(h.windowCount(), 1)
    assert.equal(h.supervisors.length, 0)
    const result = await h.handlers.get('checkba:backend-restart')()
    assert.equal(result.ok, false)
    assert.match(result.error, /startup failed/)
  }
})

test('startup catch keeps an owned failed child recoverable through the shipping IPC handler', async () => {
  const h = startupHarness({ isOwned: () => true, ports: { backend: 12345 } })
  h.fail()
  assert.equal(h.supervisors.length, 1)
  assert.equal(h.supervisors[0].started, true)
  assert.equal(h.handlers.get('checkba:backend-health')().state, 'failed')
  assert.equal((await h.handlers.get('checkba:backend-restart')()).ok, true)
  assert.equal(h.handlers.get('checkba:backend-health')().state, 'healthy')
  assert.equal(h.windowCount(), 1, 'backend recovery must not recreate or reload the editor window')
})
