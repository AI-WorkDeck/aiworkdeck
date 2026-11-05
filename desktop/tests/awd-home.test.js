// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 问题 20（dev-board#1713）：AWD_HOME 隔离实例。设了它，数据目录、userData、后端 user.home、
// 子进程 HOME 全部落到这个目录下；不设时行为不变。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const awd = require('../main/awd-home')

const MAIN = path.join(__dirname, '../main')

test('awdHome / dataDir：不设或空白时回落真实 home，设了就落在 AWD_HOME 下', () => {
  assert.equal(awd.awdHome({}), null)
  assert.equal(awd.awdHome({ AWD_HOME: '   ' }), null)
  assert.equal(awd.dataDir({}), path.join(os.homedir(), '.aiworkdeck'))
  const home = path.join(os.tmpdir(), 'awd-demo')
  assert.equal(awd.awdHome({ AWD_HOME: home }), home)
  assert.equal(awd.dataDir({ AWD_HOME: home }), path.join(home, '.aiworkdeck'))
  // 相对路径按当前目录解析成绝对路径，免得后端 cwd 一换就指到别处
  assert.equal(awd.awdHome({ AWD_HOME: 'rel-home' }), path.resolve('rel-home'))
})

test('applyUserData：只有 AWD_HOME 且没显式 --user-data-dir 时才改 userData', () => {
  const calls = []
  const app = { setPath: (k, v) => calls.push([k, v]) }
  assert.equal(awd.applyUserData(app, {}, ['electron', '.']), null)
  assert.equal(awd.applyUserData(app, { AWD_HOME: '/tmp/h' }, ['x', '--user-data-dir=/tmp/u']), null)
  assert.equal(awd.applyUserData(app, { AWD_HOME: '/tmp/h' }, ['x', '--user-data-dir', '/tmp/u']), null)
  assert.deepEqual(calls, [])
  assert.equal(awd.applyUserData(app, { AWD_HOME: '/tmp/h' }, ['x']), path.resolve('/tmp/h/userdata'))
  assert.deepEqual(calls, [['userData', path.resolve('/tmp/h/userdata')]])
})

test('childEnv：设了 AWD_HOME 时子进程 HOME/USERPROFILE 指过去，否则原样', () => {
  const env = { HOME: '/Users/real', PATH: '/bin' }
  assert.equal(awd.childEnv(env, null), env)
  assert.deepEqual(awd.childEnv(env, '/tmp/h'), { HOME: '/tmp/h', USERPROFILE: '/tmp/h', PATH: '/bin' })
})

// 统一取数契约：主进程里任何派生 ~/.aiworkdeck 的地方都必须走 awd-home.js，
// 否则设了 AWD_HOME 还会有日志/偏好/overlay 偷偷写进真实目录。
test('main/ 下不再自己拼 home + .aiworkdeck，也不再直接读 app.getPath(\'home\')', () => {
  const offenders = []
  const walk = (dir) => {
    for (const en of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, en.name)
      if (en.isDirectory()) { walk(p); continue }
      if (!en.name.endsWith('.js') || p === path.join(MAIN, 'awd-home.js')) continue
      fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return
        if (/getPath\(\s*['"]home['"]\s*\)/.test(line) || /['"]\.aiworkdeck['"]/.test(line)) {
          offenders.push(`${path.relative(MAIN, p)}:${i + 1}: ${line.trim()}`)
        }
      })
    }
  }
  walk(MAIN)
  assert.deepEqual(offenders, [])
})

test('main.js 在单实例锁之前按 AWD_HOME 定好 userData', () => {
  const src = fs.readFileSync(path.join(MAIN, 'main.js'), 'utf8')
  const apply = src.indexOf("require('./awd-home').applyUserData(app)")
  const lock = src.indexOf('app.requestSingleInstanceLock()')
  assert.ok(apply > 0, 'main.js 没调用 applyUserData')
  assert.ok(apply < lock, 'applyUserData 必须早于 requestSingleInstanceLock（锁按 userData 判重）')
})

test('后端：设了 AWD_HOME 时 JVM 带 -Duser.home，不设时参数不变', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-home-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { javaLaunchArgs } = require('../main/services/backend-service')
  const resources = path.join(root, 'resources')
  fs.mkdirSync(path.join(resources, 'backend', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'backend', 'app.jar'), 'jar')
  const ctx = { packaged: true, resourcesPath: resources, dataDir: path.join(root, '.aiworkdeck'), appVersion: '0.77.0' }
  const plain = javaLaunchArgs(ctx)
  assert.equal(plain[0], '-cp')
  assert.deepEqual(javaLaunchArgs({ ...ctx, awdHome: root }), ['-Duser.home=' + root, ...plain])
})

test('后端复用：不同 home 的实例互不复用对方的后端（两个方向都不行）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-home-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { backendBuildId, decideReuse } = require('../main/services/backend-service')
  const resources = path.join(root, 'resources')
  fs.mkdirSync(path.join(resources, 'backend', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'backend', 'app.jar'), 'jar')
  const real = { packaged: true, resourcesPath: resources, dataDir: path.join(root, 'real'), appVersion: '0.77.0' }
  const demo = { ...real, awdHome: path.join(root, 'demo') }
  const demo2 = { ...real, awdHome: path.join(root, 'demo2') }
  const realBuild = backendBuildId(real)
  const demoBuild = backendBuildId(demo)
  assert.ok(realBuild && !realBuild.includes('@'), '默认实例的指纹格式不变')
  assert.notEqual(demoBuild, realBuild)
  assert.equal(backendBuildId({ ...demo }), demoBuild, '同一 AWD_HOME 指纹稳定')
  // 隔离实例看到真实实例的后端：跳过，不许连过去读真实数据
  assert.equal(decideReuse({ ours: true, build: realBuild }, { packaged: true, expectedBuild: demoBuild }), 'skip')
  // 真实实例看到隔离实例的后端：同样跳过
  assert.equal(decideReuse({ ours: true, build: demoBuild }, { packaged: true, expectedBuild: realBuild }), 'skip')
  assert.equal(decideReuse({ ours: true, build: backendBuildId(demo2) }, { packaged: true, expectedBuild: demoBuild }), 'skip')
  // 同一个隔离实例自己的残留后端照常复用
  assert.equal(decideReuse({ ours: true, build: demoBuild }, { packaged: true, expectedBuild: demoBuild }), 'reuse')
})

test('service-manager：设了 AWD_HOME 时子进程拿到的 HOME 是 AWD_HOME', async (t) => {
  const { createServiceManager, findFreePort } = require('../main/services/service-manager')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-home-'))
  const out = path.join(home, 'seen-home')
  const mgr = createServiceManager({ packaged: false, resourcesPath: null, dataDir: home,
    projectRoot: path.join(__dirname, '..'), awdHome: home })
  // 先停子进程再删目录：Windows 上子进程占着 cwd 时删除会 EPERM，未停的子进程还会让测试挂死
  t.after(async () => {
    await mgr.stopAll()
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })
  const script = `require('fs').writeFileSync(${JSON.stringify(out)}, process.env.HOME || '');
    require('http').createServer((q, r) => r.end('ok')).listen(Number(process.env.PORT), '127.0.0.1')`
  mgr.register({ name: 'probe', logName: 'probe', port: async () => findFreePort(), startTimeoutMs: () => 10000,
    commands: (ctx) => [{ cmd: process.execPath, args: ['-e', script],
      env: { ...process.env, HOME: '/should/not/leak', PORT: String(ctx.ports.probe) }, cwd: home }] })
  await mgr.allocatePorts()
  const r = await mgr.start('probe')
  assert.equal(r.ok, true)
  assert.equal(fs.readFileSync(out, 'utf8'), home)
})

test('更新：设了 AWD_HOME 的隔离实例不做应用内更新', () => {
  const { updatesDisabledReason } = require('../main/services/update-service')
  assert.equal(updatesDisabledReason({ AWD_HOME: '/tmp/demo' }, ['electron', '.']), 'AWD_HOME')
  assert.equal(updatesDisabledReason({ AWD_HOME: '' }, ['electron', '.']), null)
})
