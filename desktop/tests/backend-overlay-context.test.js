// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createServiceManager } = require('../main/services/service-manager')
const { createBackendDescriptor, backendLayout } = require('../main/services/backend-service')
const overlay = require('../main/services/overlay')

function harness(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-backend-overlay-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const resourcesPath = path.join(home, 'resources')
  const builtin = path.join(resourcesPath, 'backend', 'app.jar')
  fs.mkdirSync(path.dirname(builtin), { recursive: true })
  fs.writeFileSync(builtin, 'bundled backend')
  const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
  const start = source.indexOf('function createServices()')
  const end = source.indexOf('// 组件管理（模型下载/状态）', start)
  assert.ok(start >= 0 && end > start)
  const context = vm.createContext({
    path, process: { resourcesPath }, __dirname: path.join(__dirname, '../main'),
    app: { isPackaged: true, getVersion: () => '0.38.4', getPath: () => home },
    createServiceManager, createBackendDescriptor, createModelManager: () => ({}),
    createPptxDescriptor: () => ({ name: 'pptx-service' }),
    createMineruDescriptor: () => ({ name: 'mineru-service' }),
    createKokoroDescriptor: () => ({ name: 'kokoro-service' }),
    createAsrDescriptor: () => ({ name: 'asr-service' }),
    require: name => { assert.equal(name, './services/win-arch'); return { isWinArmEmulated: () => false } },
  })
  vm.runInContext(`let modelManager = null; ${source.slice(start, end)}; globalThis.manager = createServices()`, context)
  const correctCtx = { packaged: true, appVersion: '0.38.4', dataDir: path.join(home, '.aiworkdeck') }
  return { home, builtin, manager: context.manager, correctCtx }
}

function bootRecorder(manager) {
  const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('function recordBackendBoot(')
  const end = source.indexOf('// 增量更新（docs/INCREMENTAL_UPDATE_DESIGN.md）', start)
  assert.ok(start >= 0 && end > start)
  const context = vm.createContext({ services: manager, updateService: null, console,
    require: name => { assert.equal(name, './services/overlay'); return overlay } })
  vm.runInContext(source.slice(start, end), context)
  return context.recordBackendBoot
}

function activateFixture(h, version) {
  const staged = path.join(h.home, 'staged-' + version)
  fs.mkdirSync(staged); fs.writeFileSync(path.join(staged, 'app.jar'), 'patched ' + version)
  overlay.activate(h.correctCtx, version, { 'backend-app': staged })
}

function captureLaunch(h) {
  const spec = h.manager.descriptors.get('backend').commands(h.manager.ctx)[0]
  const launch = { bootOverlay: spec.bootOverlay }
  h.manager.launches.set('backend', launch)
  return launch
}

test('shipping service creation loads the activated backend patch and honors rollback', t => {
  const h = harness(t)
  assert.equal(backendLayout(h.manager.ctx).appJar, h.builtin)
  const staged = path.join(h.home, 'staged')
  fs.mkdirSync(staged); fs.writeFileSync(path.join(staged, 'app.jar'), 'patched backend')
  overlay.activate(h.correctCtx, '0.38.5', { 'backend-app': staged })
  const expected = path.join(overlay.componentDir(h.correctCtx, 'backend-app'), 'app.jar')
  assert.equal(backendLayout(h.manager.ctx).appJar, expected)
  assert.equal(backendLayout(h.manager.ctx).libDir, path.join(path.dirname(h.builtin), 'lib'))
  overlay.revert(h.correctCtx)
  assert.equal(backendLayout(h.manager.ctx).appJar, h.builtin)
})

test('shipping service creation ignores patches from another major version', t => {
  const h = harness(t)
  const staged = path.join(h.home, 'staged')
  fs.mkdirSync(staged); fs.writeFileSync(path.join(staged, 'app.jar'), 'other-major backend')
  overlay.activate({ ...h.correctCtx, appVersion: '0.37.0' }, '0.37.1', { 'backend-app': staged })
  assert.equal(backendLayout(h.manager.ctx).appJar, h.builtin)
  assert.equal(h.manager.ctx.appVersion, '0.38.4')
})

test('late full health cannot mark a newer activated overlay successful or count its failure', t => {
  const h = harness(t), record = bootRecorder(h.manager)
  activateFixture(h, '0.38.5')
  const olderSuccess = captureLaunch(h), olderFailure = captureLaunch(h)
  activateFixture(h, '0.38.6')
  overlay.noteBackendBootFailure(h.correctCtx)
  record(true, olderSuccess)
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 1)
  record(false, olderFailure, 'old process timed out')
  assert.equal(overlay.readCurrent(h.correctCtx).version, '0.38.6')
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 1)
})

test('full startup failures keep the two-launch rollback rule and one verdict per launch', t => {
  const h = harness(t), record = bootRecorder(h.manager)
  activateFixture(h, '0.38.5')
  const first = captureLaunch(h)
  assert.equal(record(false, first, 'full startup timeout').reverted, false)
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 1)
  record(false, first, 'duplicate failure')
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 1)
  const second = captureLaunch(h)
  assert.equal(record(false, second, 'full startup timeout').reverted, true)
  assert.equal(overlay.readCurrent(h.correctCtx), null)
})

test('full health clears failures for the exact overlay used by this launch', t => {
  const h = harness(t), record = bootRecorder(h.manager)
  activateFixture(h, '0.38.5')
  overlay.noteBackendBootFailure(h.correctCtx)
  const launch = captureLaunch(h)
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 1)
  record(true, launch)
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 0)
})

test('shipping supervisor callback records the verified launch rather than the current launch', t => {
  const h = harness(t)
  activateFixture(h, '0.38.5'); const oldLaunch = captureLaunch(h)
  activateFixture(h, '0.38.6'); const currentLaunch = captureLaunch(h)
  overlay.noteBackendBootFailure(h.correctCtx)
  const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8').replace(/\r\n/g, '\n')
  const start = source.indexOf('function configureBackendSupervision(')
  const end = source.indexOf('// 增量更新（docs/INCREMENTAL_UPDATE_DESIGN.md）', start)
  let supervisor
  class FakeSupervisor {
    constructor(_services, onChange) { this.onChange = onChange; supervisor = this }
    bindPowerMonitor() {} start() {}
  }
  const context = vm.createContext({ services: h.manager, updateService: null, console, BackendSupervisor: FakeSupervisor,
    powerMonitor: {}, BrowserWindow: { getAllWindows: () => [] }, logDesktopEvent() {},
    require: name => { assert.equal(name, './services/overlay'); return overlay } })
  vm.runInContext(`let backendSupervisor = null; let backendStartupFailed = false; ${source.slice(start, end)}
    configureBackendSupervision()`, context)
  supervisor.onChange({ ok: true }, oldLaunch)
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 1)
  assert.equal(currentLaunch.bootRecorded, undefined)
  supervisor.onChange({ ok: true }, currentLaunch)
  assert.equal(overlay.readCurrent(h.correctCtx).bootFailures, 0)
})

test('shipping service IPC does not expose the internal child process or overlay launch', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8').replace(/\r\n/g, '\n')
  const ensureStart = source.indexOf("ipcMain.handle('checkba:service-ensure'")
  const ensureEnd = source.indexOf('\n// 本机偏好', ensureStart)
  const restartStart = source.indexOf("ipcMain.handle('checkba:backend-restart'")
  const handlers = new Map()
  const launch = { process: { kill() {} }, bootOverlay: { private: true } }
  const result = { ok: true, fullReady: false, launch }
  const context = vm.createContext({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    services: { start: async () => result, ports: {} },
    backendSupervisor: { recover: async () => result }, getBackendHealth() {},
    require: name => { assert.equal(name, './services/pysvc-runtime'); return { PACK_ID_BY_SERVICE: {} } },
  })
  vm.runInContext(source.slice(ensureStart, ensureEnd) + '\n' + source.slice(restartStart), context)
  for (const [name, args] of [['checkba:service-ensure', [null, { name: 'backend' }]], ['checkba:backend-restart', []]]) {
    const response = await handlers.get(name)(...args)
    assert.equal(response.ok, true)
    assert.equal(response.fullReady, false)
    assert.equal(response.launch, undefined)
    assert.doesNotThrow(() => structuredClone(response), name)
  }
})
