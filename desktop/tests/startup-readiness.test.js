// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { createServiceManager } = require('../main/services/service-manager')

const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('app.whenReady().then(() => {')
const end = source.indexOf('// Acknowledgement comes only', start)
assert.ok(start >= 0 && end > start)
const startup = source.slice(start, end)
const settle = () => new Promise(resolve => setImmediate(resolve))

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Execute the shipping startup chain and ServiceManager scheduling. Electron and
// service processes are replaced; unresolved service gates model slow readiness.
function harness({ rollback = false, allocationFails = false } = {}) {
  const calls = [], windows = [], failures = [], health = []
  const backend = deferred(), retry = deferred(), optional = deferred()
  const manager = createServiceManager({ packaged: false })
  for (const name of ['backend', 'pptx-service', 'mineru-service']) {
    manager.register({ name, eager: true, port: () => {
      if (allocationFails) throw new Error('port allocation failed')
      return 12345
    } })
  }
  let backendCalls = 0, version = 'candidate'
  manager._start = (name) => {
    calls.push(name)
    if (name === 'backend') {
      const launch = { bootOverlay: { context: {}, current: overlay.readCurrent() } }
      manager.launches.set('backend', launch)
      return (++backendCalls === 1 ? backend : retry).promise.then(result => ({ ...result, launch }))
    }
    return optional.promise
  }
  const overlay = {
    cleanupStaleMajors() {},
    markBootOk: () => calls.push('boot-ok'),
    readCurrent: () => rollback && version === 'candidate' ? { version: 'candidate', components: {} } : null,
    noteBackendBootFailure: () => { version = 'previous'; return { reverted: rollback } },
  }
  const stubs = {
    './services/overlay': overlay,
    './permissions-service': { initPermissionsService() {} },
    './app-menu': { initAppMenu() {} },
    './services/update-service': { createUpdateService: () => ({ start() {} }) },
    './services/pysvc-runtime': { extractTar() {} },
    './services/full-update': { createFullUpdate: () => ({ lastError: () => null }) },
    electron: {},
  }
  const context = vm.createContext({
    app: { whenReady: () => ({ then: callback => callback() }) },
    nativeTheme: { on() {} },
    applyNativeTheme() {}, syncTitleBarOverlay() {}, initLocalFileService() {},
    ipcMain: {}, globalShortcut: { register() {} },
    console: { error: (...args) => failures.push(args.map(String).join(' ')) },
    require: name => { assert.ok(name in stubs, `unstubbed startup require: ${name}`); return stubs[name] },
    overlayCtx: () => ({}), createServices: () => manager,
    configureBackendSupervision: failed => health.push(failed),
    createMainWindow: () => {
      const window = { version, destroyed: false, webContents: new EventEmitter() }
      window.isDestroyed = () => window.destroyed
      window.destroy = () => { window.destroyed = true }
      window.webContents.send = () => {}
      window.webContents.loading = true
      window.webContents.isLoading = () => window.webContents.loading
      window.webContents.on('did-finish-load', () => { window.webContents.loading = false })
      context.mainWindow = window
      windows.push(window)
    },
    retireFirstLaunchSplash() {},
    views: {}, quitInProgress: false, services: null, mainWindow: null,
    mainWindowStartupReady: false, backendBooting: false, fullUpdate: null, updateService: null,
  })
  const recordStart = source.indexOf('function recordBackendBoot(')
  const recordEnd = source.indexOf('// 增量更新（docs/INCREMENTAL_UPDATE_DESIGN.md）', recordStart)
  vm.runInContext(source.slice(recordStart, recordEnd), context)
  vm.runInContext(startup, context)
  return { context, manager, backend, retry, optional, calls, windows, failures, health }
}

test('window opens while the backend starts; optional services wait for backend and page', async () => {
  const h = harness()
  await settle()
  assert.ok(h.calls.includes('backend'))
  assert.equal(h.windows.length, 1, 'the launch page loads in parallel with the backend')
  assert.equal(h.context.backendBooting, true, 'backend requests are held while it starts')
  assert.equal(h.context.mainWindowStartupReady, true)

  h.backend.resolve({ ok: true })
  await settle()
  assert.equal(h.windows.length, 1, 'backend readiness must not open a second window')
  assert.equal(h.context.backendBooting, false)
  assert.deepEqual(h.health, [false])
  assert.deepEqual(h.calls, ['backend', 'boot-ok'], 'model loading must not compete with initial page loading')

  h.windows[0].webContents.emit('did-finish-load')
  await settle()
  assert.deepEqual(h.calls, ['backend', 'boot-ok', 'pptx-service', 'mineru-service'])
  assert.equal(h.windows.length, 1, 'optional services are deliberately still unready here')
  h.optional.reject(new Error('optional component unavailable'))
  await settle()
  assert.equal(h.windows.length, 1, 'an optional failure must not rebuild or reload the workbench')
  assert.ok(h.failures.some(line => line.includes('optional component unavailable')))
  assert.equal(h.calls.filter(name => name === 'backend').length, 1, 'background startup must not restart the backend')
})

test('core readiness opens the workbench without clearing overlay failures; only full health records success', async () => {
  const h = harness()
  await settle()
  h.backend.resolve({ ok: true, fullReady: false })
  await settle()
  assert.equal(h.windows.length, 1)
  assert.deepEqual(h.calls, ['backend'])
  h.context.recordBackendBoot(true, h.manager.getLaunch('backend'))
  assert.deepEqual(h.calls, ['backend', 'boot-ok'])
  h.context.recordBackendBoot(true, h.manager.getLaunch('backend'))
  assert.deepEqual(h.calls, ['backend', 'boot-ok'], 'one launch only records one verdict')
})

test('overlay rollback replaces the early window with one on the rolled-back frontend', async () => {
  const h = harness({ rollback: true })
  await settle()
  assert.equal(h.windows.length, 1)
  assert.equal(h.windows[0].version, 'candidate')
  h.backend.reject(new Error('candidate backend failed'))
  await settle()
  assert.equal(h.calls.filter(name => name === 'backend').length, 2)
  assert.equal(h.context.backendBooting, true, 'requests stay held through the rollback retry')
  h.retry.resolve({ ok: true })
  await settle()
  assert.equal(h.windows.length, 2)
  assert.equal(h.windows[1].version, 'previous', 'frontend version matches the rolled-back backend')
  assert.equal(h.windows[0].destroyed, true)
  assert.equal(h.context.mainWindow, h.windows[1])
  assert.equal(h.context.backendBooting, false)
  assert.deepEqual(h.health, [false])
})

test('a page that finished loading before the backend starts optional services right after it', async () => {
  const h = harness()
  await settle()
  h.windows[0].webContents.emit('did-finish-load')
  await settle()
  assert.deepEqual(h.calls, ['backend'])
  h.backend.resolve({ ok: true })
  await settle()
  assert.deepEqual(h.calls, ['backend', 'boot-ok', 'pptx-service', 'mineru-service'])
})

test('backend failure still opens the recoverable error UI', async () => {
  const h = harness()
  await settle()
  h.backend.reject(new Error('backend unavailable'))
  await settle()
  assert.equal(h.windows.length, 1)
  assert.equal(h.context.backendBooting, false, 'held requests are released to fail visibly')
  assert.deepEqual(h.health, [true])
})

test('allocation failure keeps the existing failed-startup window path', async () => {
  const h = harness({ allocationFails: true })
  await settle()
  assert.equal(h.windows.length, 1)
  assert.deepEqual(h.health, [true])
  assert.deepEqual(h.calls, [])
})

test('late page load cannot start optional services after quitting or stopping', async () => {
  for (const state of ['quitInProgress', 'closing']) {
    const h = harness()
    await settle()
    h.backend.resolve({ ok: true })
    await settle()
    if (state === 'closing') h.manager.closing = true
    else h.context.quitInProgress = true
    h.windows[0].webContents.emit('did-finish-load')
    await settle()
    assert.deepEqual(h.calls, ['backend', 'boot-ok'])
  }
})
