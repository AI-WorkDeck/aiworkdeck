// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
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
    if (name === 'backend') return (++backendCalls === 1 ? backend : retry).promise
    return optional.promise
  }
  const overlay = {
    cleanupStaleMajors() {},
    markBootOk: () => calls.push('boot-ok'),
    readCurrent: () => rollback ? { version: 'candidate' } : null,
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
      const window = { version, webContents: new EventEmitter() }
      window.webContents.send = () => {}
      context.mainWindow = window
      windows.push(window)
    },
    retireFirstLaunchSplash() {},
    views: {}, quitInProgress: false, services: null, mainWindow: null,
    mainWindowStartupReady: false, fullUpdate: null, updateService: null,
  })
  vm.runInContext(startup, context)
  return { context, manager, backend, retry, optional, calls, windows, failures, health }
}

test('window waits for backend readiness but not optional model services', async () => {
  const h = harness()
  await settle()
  assert.ok(h.calls.includes('backend'))
  assert.equal(h.windows.length, 0, 'an unready backend must not produce a fake ready window')

  h.backend.resolve({ ok: true })
  await settle()
  assert.equal(h.windows.length, 1, 'a healthy backend must open the workbench without waiting for Python')
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

test('overlay rollback and healthy retry finish before loading the window', async () => {
  const h = harness({ rollback: true })
  await settle()
  h.backend.reject(new Error('candidate backend failed'))
  await settle()
  assert.equal(h.calls.filter(name => name === 'backend').length, 2)
  assert.equal(h.windows.length, 0, 'rollback retry still determines the window frontend version')
  h.retry.resolve({ ok: true })
  await settle()
  assert.equal(h.windows.length, 1)
  assert.equal(h.windows[0].version, 'previous')
  assert.deepEqual(h.health, [false])
})

test('backend failure still opens the recoverable error UI', async () => {
  const h = harness()
  await settle()
  h.backend.reject(new Error('backend unavailable'))
  await settle()
  assert.equal(h.windows.length, 1)
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
