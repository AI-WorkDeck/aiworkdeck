// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { createServiceManager, findFreePort, isPortOpen } = require('../main/services/service-manager')

// 用 node 自身起一个最小 HTTP 服务当"假服务"，验证 spawn/端口等待/停止全链路
const FAKE_SERVICE = `
  const http = require('http');
  const port = Number(process.env.PORT);
  http.createServer((req, res) => res.end('ok')).listen(port, '127.0.0.1');
`

function fakeDescriptor(overrides) {
  return Object.assign({
    name: 'fake',
    eager: true,
    logName: 'fake',
    port: async () => findFreePort(),
    startTimeoutMs: () => 10000,
    commands: (ctx) => [{
      cmd: process.execPath,
      args: ['-e', FAKE_SERVICE],
      env: { ...process.env, PORT: String(ctx.ports.fake) },
      cwd: ctx.dataDir
    }]
  }, overrides)
}

function makeManager(t) {
  const mgr = createServiceManager({
    packaged: false,
    resourcesPath: null,
    dataDir: require('os').tmpdir(),
    projectRoot: path.join(__dirname, '..')
  })
  // 断言失败时也要关闭子服务，否则测试报告失败后仍会挂到 CI 超时。
  t.after(() => mgr.stopAll())
  return mgr
}

test('findFreePort returns a usable port', async () => {
  const port = await findFreePort()
  assert.ok(port > 0)
  assert.strictEqual(await isPortOpen(port), false)
})

test('start/stop lifecycle: spawns, waits for port, stops', async (t) => {
  const mgr = makeManager(t)
  mgr.register(fakeDescriptor())
  await mgr.allocatePorts()
  const res = await mgr.start('fake')
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.reused, false)
  const response = await fetch(`http://127.0.0.1:${mgr.ports.fake}`, {
    signal: AbortSignal.timeout(3000)
  })
  assert.strictEqual(response.status, 200)
  assert.strictEqual(await response.text(), 'ok')
  await mgr.stop('fake')
  assert.strictEqual(await isPortOpen(mgr.ports.fake), false)
})

test('reuses already-open port without spawning', async (t) => {
  const http = require('http')
  const server = http.createServer((req, res) => res.end('ok'))
  const port = await findFreePort()
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  try {
    const mgr = makeManager(t)
    mgr.register(fakeDescriptor({ port: async () => port }))
    await mgr.allocatePorts()
    const res = await mgr.start('fake')
    assert.strictEqual(res.reused, true)
  } finally {
    server.close()
  }
})

test('verifyReuse=false triggers reallocatePort instead of reusing foreign process', async (t) => {
  const http = require('http')
  // 陌生进程占着首选端口
  const foreign = http.createServer((req, res) => res.end('not ours'))
  const occupied = await findFreePort()
  await new Promise((r) => foreign.listen(occupied, '127.0.0.1', r))
  try {
    const mgr = makeManager(t)
    mgr.register(fakeDescriptor({
      port: async () => occupied,
      verifyReuse: async () => false,
      reallocatePort: async () => findFreePort()
    }))
    await mgr.allocatePorts()
    const res = await mgr.start('fake')
    assert.strictEqual(res.ok, true)
    assert.strictEqual(res.reused, false)
    assert.notStrictEqual(mgr.ports.fake, occupied)
    await mgr.stopAll()
  } finally {
    foreign.close()
  }
})

test('verifyReuse=true keeps old reuse semantics', async (t) => {
  const http = require('http')
  const server = http.createServer((req, res) => res.end('ok'))
  const port = await findFreePort()
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  try {
    const mgr = makeManager(t)
    mgr.register(fakeDescriptor({ port: async () => port, verifyReuse: async () => true }))
    await mgr.allocatePorts()
    const res = await mgr.start('fake')
    assert.strictEqual(res.reused, true)
  } finally {
    server.close()
  }
})

test('backend allocator skips foreign listener using isolated ports', async (t) => {
  const http = require('http')
  const { allocateBackendPort } = require('../main/services/backend-service')
  const holder = http.createServer((req, res) => res.end('foreign'))
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve))
  t.after(() => holder.close())
  const occupied = holder.address().port
  const free = await findFreePort()
  const port = await allocateBackendPort({ packaged: true }, [occupied, free])
  assert.strictEqual(port, free)
})

test('spawned backend env.SERVER_PORT always follows ctx.ports.backend, not an inherited SERVER_PORT', () => {
  // 原实现是 `if (!env.SERVER_PORT) env.SERVER_PORT = String(ctx.ports.backend)`——
  // 宿主 shell/环境如果恰好已经设过 SERVER_PORT（不少框架的常见变量名），这个判断
  // 会让继承值赢，JVM 绑到一个 ServiceManager 根本不知道的端口上；waitStartOrExit
  // 还在死等 ctx.ports.backend 那个端口开放，永远等不到，把明明健康的 JVM 当启动
  // 失败杀掉重试。ctx.ports.backend 是 allocateBackendPort() 已经选定、渲染层也据此
  // 注入 apiBaseUrl 的唯一真源，必须无条件赢过任何继承值。
  const { createBackendDescriptor } = require('../main/services/backend-service')
  const d = createBackendDescriptor()
  const prevServerPort = process.env.SERVER_PORT
  process.env.SERVER_PORT = '6001' // 模拟宿主环境已经设过这个变量，且与分配到的端口不同
  try {
    const ctx = {
      packaged: false,
      resourcesPath: null,
      dataDir: require('os').tmpdir(),
      projectRoot: path.join(__dirname, '..'),
      ports: { backend: 5269 }
    }
    const cmds = d.commands(ctx)
    assert.strictEqual(cmds[0].env.SERVER_PORT, '5269')
  } finally {
    if (prevServerPort === undefined) delete process.env.SERVER_PORT
    else process.env.SERVER_PORT = prevServerPort
  }
})

test('falls through failed candidate to next command', async (t) => {
  const mgr = makeManager(t)
  mgr.register(fakeDescriptor({
    commands: (ctx) => [
      // 第一个候选立刻退出（崩溃路径）
      { cmd: process.execPath, args: ['-e', 'process.exit(1)'], env: process.env, cwd: ctx.dataDir },
      { cmd: process.execPath, args: ['-e', FAKE_SERVICE], env: { ...process.env, PORT: String(ctx.ports.fake) }, cwd: ctx.dataDir }
    ]
  }))
  await mgr.allocatePorts()
  const res = await mgr.start('fake')
  assert.strictEqual(res.ok, true)
  await mgr.stopAll()
})
