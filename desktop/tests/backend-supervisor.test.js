// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { BackendSupervisor } = require('../main/services/backend-supervisor')
const { probeBackendHealth, probeBackendStartupHealth } = require('../main/services/backend-service')
const { ServiceManager, findFreePort } = require('../main/services/service-manager')

function harness(overrides = {}, options = {}) {
  let now = 0, healthy = true, restarts = 0
  const events = []
  const services = { ctx: {}, ports: { backend: 1 }, procs: new Map([['backend', {}]]),
    descriptors: new Map([['backend', { health: async () => healthy }]]),
    isOwned: () => true, isBusy: () => false,
    checkHealth: async () => {
      const result = await services.descriptors.get('backend').health()
      if (result && services.getLaunch?.('backend')) services.getLaunch('backend').fullReady = true
      return result
    },
    restart: async () => { restarts++; healthy = true; services.procs.set('backend', {}); return { ok: true } }, ...overrides }
  const supervisor = new BackendSupervisor(services, (s) => events.push(s),
    { now: () => now, retryDelays: [5, 15, 45], stableMs: 300, resumeGraceMs: 30, ...options })
  return { services, supervisor, events, setHealthy: (v) => { healthy = v },
    advance: (v) => { now += v }, restarts: () => restarts }
}

function pollingHarness(t, deadline = 21000) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1000 })
  const manager = new ServiceManager({ packaged: false })
  manager.ports.backend = 1; manager.managed.add('backend')
  let healthy = false, failures = 0
  const calls = []
  const replace = () => {
    const launch = { process: {}, deadline, splitReadiness: true, fullReady: false }
    manager.procs.set('backend', launch.process); manager.launches.set('backend', launch)
    return launch
  }
  const launch = replace()
  manager.healthChecks.set('backend', async () => { calls.push(Date.now()); return healthy })
  const supervisor = new BackendSupervisor(manager, () => {}, {
    retryDelays: [50000], onStartupFailure: () => { failures++ }
  })
  t.after(() => supervisor.stop())
  const settle = () => new Promise(setImmediate)
  const advance = async ms => { t.mock.timers.tick(ms); await settle() }
  return { manager, supervisor, launch, calls, replace, settle, advance,
    setHealthy: value => { healthy = value }, failures: () => failures }
}

test('core startup polls full health promptly, then returns to the normal ten-second interval', async t => {
  const h = pollingHarness(t)
  h.supervisor.start(); await h.settle()
  assert.deepEqual(h.calls, [1000])
  await h.advance(500)
  assert.deepEqual(h.calls, [1000, 1500])
  h.setHealthy(true)
  await h.advance(500)
  assert.equal(h.launch.fullReady, true)
  assert.deepEqual(h.calls, [1000, 1500, 2000])
  await h.advance(9999)
  assert.equal(h.calls.length, 3, 'steady state must not keep the fast health probe')
  await h.advance(1)
  assert.equal(h.calls.at(-1), 12000)
})

test('fast polling honors the original deadline and reports an expired core launch only once', async t => {
  const h = pollingHarness(t, 1200)
  h.supervisor.start(); await h.settle()
  await h.advance(199)
  assert.equal(h.calls.length, 1)
  await h.advance(1)
  assert.equal(h.failures(), 1)
  assert.equal(h.launch.deadline, 1200)
  assert.equal(h.supervisor.getHealth().reason, 'full-startup-failed')
  await h.advance(9999)
  assert.equal(h.calls.length, 2, 'an expired startup must stop fast polling')
  await h.advance(1)
  assert.equal(h.failures(), 1)
})

test('a recovered core launch resumes fast polling even while the old steady timer was pending', async t => {
  const h = pollingHarness(t)
  h.setHealthy(true)
  h.supervisor.start(); await h.settle()
  assert.equal(h.launch.fullReady, true)
  h.manager.restart = async () => ({ ok: true, fullReady: false, launch: h.replace() })
  h.setHealthy(false)
  await h.supervisor.recover()
  await h.advance(500)
  assert.equal(h.calls.at(-1), 1500)
  h.setHealthy(true)
  await h.advance(500)
  assert.equal(h.manager.getLaunch('backend').fullReady, true)
  assert.equal(h.supervisor.getHealth().ok, true)
})

test('an in-flight startup probe does not overlap or rearm monitoring after stop', async t => {
  const h = pollingHarness(t)
  let resolveProbe
  h.manager.healthChecks.set('backend', () => {
    h.calls.push(Date.now())
    return new Promise(resolve => { resolveProbe = resolve })
  })
  h.supervisor.start(); await h.settle()
  await h.advance(1500)
  assert.equal(h.calls.length, 1)
  h.supervisor.stop()
  resolveProbe(false); await h.settle()
  await h.advance(20000)
  assert.equal(h.calls.length, 1)
  assert.equal(h.supervisor.timer, null)
  assert.equal(h.supervisor.getHealth().state, 'stopped')
})

test('suspension pauses startup probes and resume restores the short startup interval', async t => {
  const h = pollingHarness(t)
  h.supervisor.start(); await h.settle()
  h.supervisor.suspend()
  await h.advance(500)
  assert.equal(h.calls.length, 1)
  h.supervisor.resume(); await h.settle()
  assert.equal(h.calls.length, 2)
  await h.advance(500)
  assert.equal(h.calls.at(-1), 2000)
  assert.equal(h.calls.length, 3)
})

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

test('core readiness has one bounded full-startup deadline and is never published as healthy', async () => {
  let failures = 0
  const h = harness({}, { onStartupFailure: async () => { failures++ } })
  const launch = { process: h.services.procs.get('backend'), deadline: 120, splitReadiness: true, fullReady: false }
  h.services.getLaunch = () => launch
  h.setHealthy(false)
  await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'starting')
  assert.equal(h.supervisor.getHealth().ok, false)
  h.advance(119); await h.supervisor.check()
  assert.equal(h.restarts(), 0); assert.equal(failures, 0)
  h.advance(1); await h.supervisor.check()
  assert.equal(failures, 1)
  assert.equal(h.supervisor.getHealth().state, 'degraded')
  await h.supervisor.check(); assert.equal(failures, 1)
  h.advance(5); await h.supervisor.check()
  assert.equal(h.restarts(), 1)
})

test('full health ends startup grace; subsequent runtime failures do not count as boot failures', async () => {
  let failures = 0
  const h = harness({}, { onStartupFailure: async () => { failures++ } })
  const launch = { process: h.services.procs.get('backend'), deadline: 120, splitReadiness: true, fullReady: false }
  h.services.getLaunch = () => launch
  h.setHealthy(false); await h.supervisor.check()
  h.setHealthy(true); await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'healthy'); assert.equal(launch.fullReady, true)
  h.advance(130); h.setHealthy(false); await h.supervisor.check()
  assert.equal(h.supervisor.getHealth().state, 'degraded'); assert.equal(failures, 0)
})

test('a recovery that only reaches core readiness stays starting and does not claim a healthy restart', async () => {
  const h = harness({ restart: async () => ({ ok: true, fullReady: false }) })
  assert.equal((await h.supervisor.recover()).ok, true)
  assert.equal(h.supervisor.getHealth().state, 'starting')
  assert.equal(h.supervisor.getHealth().ok, false)
  assert.equal(h.supervisor.healthySince, null)
})

test('repeated core-only restarts exhaust the recovery budget instead of renewing health forever', async () => {
  let now = 0, restarts = 0, failures = 0, launch
  const h = harness({ restart: async () => {
    restarts++
    const process = {}
    h.services.procs.set('backend', process)
    launch = { process, deadline: now + 120, splitReadiness: true, fullReady: false }
    return { ok: true, fullReady: false }
  } }, { now: () => now, onStartupFailure: () => { failures++ } })
  launch = { process: h.services.procs.get('backend'), deadline: 120, splitReadiness: true, fullReady: false }
  h.services.getLaunch = () => launch
  h.setHealthy(false)
  for (let i = 0; i < 20; i++) { now += 125; await h.supervisor.check() }
  assert.equal(restarts, 3)
  assert.equal(failures, 4)
  assert.equal(h.supervisor.getHealth().state, 'failed')
  assert.equal(h.supervisor.getHealth().reason, 'retry-limit')
  assert.equal(h.events.some(event => event.ok), false)
})

test('startup probe accepts known core/full phases and only falls back for a missing legacy route', async (t) => {
  let phase = 'core', startupStatus = 200, fullStatus = 503, fullCalls = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/api/desktop/startup-health') {
      res.statusCode = startupStatus
      res.end(JSON.stringify({ status: 'UP', build: 'candidate', phase }))
    } else {
      assert.equal(req.url, '/api/desktop/health'); fullCalls++
      res.statusCode = fullStatus
      res.end(JSON.stringify({ status: fullStatus === 200 ? 'UP' : 'DOWN', build: 'candidate' }))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port
  assert.equal(await probeBackendStartupHealth(port, 100, 'candidate'), true)
  assert.equal(await probeBackendHealth(port, 100, 'candidate'), false)
  assert.equal(await probeBackendStartupHealth(port, 100, 'different'), false)
  phase = 'invented'; assert.equal(await probeBackendStartupHealth(port, 100, 'candidate'), false)
  phase = 'full'; fullStatus = 200
  assert.equal(await probeBackendStartupHealth(port, 100, 'candidate'), true)
  startupStatus = 503; const before = fullCalls
  assert.equal(await probeBackendStartupHealth(port, 100, 'candidate'), false)
  assert.equal(fullCalls, before)
  startupStatus = 404
  assert.equal(await probeBackendStartupHealth(port, 100, 'candidate'), true)
  assert.equal(fullCalls, before + 1)
})

test('core read advertisement belongs only to a build-verified core launch', async (t) => {
  const { createBackendDescriptor } = require('../main/services/backend-service')
  const descriptor = createBackendDescriptor()
  let status = 200, build = 'candidate', phase = 'core', paths = ['/api/projects/:id/files']
  const server = http.createServer((_req, res) => {
    res.statusCode = status
    res.end(JSON.stringify({ status: 'UP', build, phase, coreReadPaths: paths }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port, launch = {}, nextLaunch = {}
  assert.equal(await descriptor.startupHealth({ packaged: true }, port, 'candidate', launch), true)
  assert.deepEqual(launch.coreReadPaths, paths)
  assert.equal(nextLaunch.coreReadPaths, undefined)
  for (const change of [() => { build = 'wrong' }, () => { build = 'candidate'; phase = 'full' },
    () => { phase = 'core'; status = 503 }, () => { status = 200; paths = ['/api/*'] }]) {
    change()
    const rejected = {}
    await descriptor.startupHealth({ packaged: true }, port, 'candidate', rejected)
    assert.equal(rejected.coreReadPaths, undefined)
  }
  paths = ['/api/projects/:id/files']
  await descriptor.startupHealth({ packaged: true }, port, '', nextLaunch)
  assert.equal(nextLaunch.coreReadPaths, undefined, 'an absent expected fingerprint cannot enable gating')
})

test('development full health does not wait on wizard while a lightweight core is serving', async (t) => {
  const { createBackendDescriptor } = require('../main/services/backend-service')
  let healthStatus = 503, wizardCalls = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/api/admin/wizard') {
      wizardCalls++; res.end(JSON.stringify({ initialized: true })); return
    }
    assert.equal(req.url, '/api/desktop/health')
    res.statusCode = healthStatus; res.end(JSON.stringify({ status: 'DOWN' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const descriptor = createBackendDescriptor(), port = server.address().port
  assert.equal(await descriptor.health({ packaged: false }, port), false)
  assert.equal(wizardCalls, 0)
  healthStatus = 404
  assert.equal(await descriptor.health({ packaged: false }, port), true)
  assert.equal(wizardCalls, 1)
})

test('development startup fallback checks full health before considering a legacy wizard', async (t) => {
  const { createBackendDescriptor } = require('../main/services/backend-service')
  let fullStatus = 503, fullBuild = 'candidate', wizardCalls = 0, fullCalls = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/api/desktop/startup-health') { res.statusCode = 404; res.end(); return }
    if (req.url === '/api/admin/wizard') { wizardCalls++; res.end(JSON.stringify({ initialized: true })); return }
    assert.equal(req.url, '/api/desktop/health'); fullCalls++
    res.statusCode = fullStatus
    res.end(JSON.stringify({ status: 'UP', build: fullBuild }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const descriptor = createBackendDescriptor(), port = server.address().port
  assert.equal(await descriptor.startupHealth({ packaged: false }, port, 'candidate'), false)
  assert.equal(fullCalls, 1); assert.equal(wizardCalls, 0)
  fullStatus = 200; fullBuild = 'different'
  assert.equal(await descriptor.startupHealth({ packaged: false }, port, 'candidate'), false)
  assert.equal(wizardCalls, 0, 'a mismatched full-health build must not downgrade')
  fullStatus = 404
  assert.equal(await descriptor.startupHealth({ packaged: false }, port, 'candidate'), true)
  assert.equal(wizardCalls, 1)
})

test('service lifecycle replacement outside supervisor recovery invalidates an in-flight health result', async () => {
  const manager = new ServiceManager({ packaged: false })
  manager.ports.backend = 1; manager.managed.add('backend')
  let resolveOld
  const oldLaunch = { process: {}, fullReady: false, splitReadiness: true, deadline: 120 }
  const newLaunch = { process: {}, fullReady: false, splitReadiness: true, deadline: 120 }
  manager.procs.set('backend', oldLaunch.process); manager.launches.set('backend', oldLaunch)
  manager.healthChecks.set('backend', () => new Promise(resolve => { resolveOld = resolve }))
  const events = []
  const supervisor = new BackendSupervisor(manager, (health, verifiedLaunch) => events.push({ health, verifiedLaunch }), { now: () => 0 })
  const checking = supervisor.check()
  manager.procs.set('backend', newLaunch.process); manager.launches.set('backend', newLaunch)
  manager.healthChecks.set('backend', async () => false)
  resolveOld(true)
  await checking
  assert.equal(events.some(event => event.health.ok), false)
  assert.equal(newLaunch.fullReady, false)
  assert.equal(supervisor.healthySince, null)
  await supervisor.check()
  assert.equal(supervisor.getHealth().state, 'starting')
  manager.healthChecks.set('backend', async () => true)
  await supervisor.check()
  assert.equal(events.at(-1).health.ok, true)
  assert.equal(events.at(-1).verifiedLaunch, newLaunch)
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
function startupHarness(services, sourceOverride) {
  const fs = require('node:fs')
  const path = require('node:path')
  const vm = require('node:vm')
  const source = (sourceOverride ?? fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')).replace(/\r\n/g, '\n')
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


test('startup harness executes the same failure and recovery behavior from CRLF source', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const crlf = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8').replace(/\r?\n/g, '\r\n')
  assert.ok(crlf.includes('.catch((err) => {\r\n'), 'fixture must contain Windows line endings')
  for (const owned of [false, true]) {
    const h = startupHarness({ isOwned: () => owned, ports: owned ? { backend: 12345 } : {} }, crlf)
    h.fail()
    const health = h.handlers.get('checkba:backend-health')()
    assert.equal(health.state, 'failed')
    assert.equal(health.reason, 'startup-failed')
    assert.equal(health.owned, owned)
    assert.equal(h.windowCount(), 1)
    const restart = await h.handlers.get('checkba:backend-restart')()
    assert.equal(restart.ok, owned)
    assert.equal(h.handlers.get('checkba:backend-health')().state, owned ? 'healthy' : 'failed')
  }
})
