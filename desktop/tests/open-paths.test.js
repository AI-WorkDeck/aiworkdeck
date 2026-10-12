// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { pathsFromArgv, installOpenPaths } = require('../main/open-paths')

function harness(options = {}) {
  const app = new EventEmitter()
  const ipcMain = new EventEmitter()
  const delivered = []
  let focusCount = 0
  let window = null
  const makeWindow = () => {
    const webContents = new EventEmitter()
    webContents.mainFrame = {}
    webContents.send = (channel, request) => delivered.push({ channel, ...request })
    window = { webContents, isDestroyed: () => false }
    return webContents
  }
  installOpenPaths({
    app, ipcMain, getWindow: () => window, focusWindow: () => { focusCount++ },
    platform: 'darwin', argv: [],
    stat: filePath => {
      if (filePath.includes('missing')) throw new Error('ENOENT')
      return { isFile: () => !filePath.endsWith('folder'), isDirectory: () => filePath.endsWith('folder') }
    },
    ...options,
  })
  const ready = (sender = window.webContents) => ipcMain.emit('checkba:open-paths-ready', { sender, senderFrame: sender.mainFrame })
  const ack = (requestId, sender = window.webContents) => ipcMain.emit('checkba:open-path-ack', { sender, senderFrame: sender.mainFrame }, requestId)
  const open = filePath => {
    let prevented = false
    app.emit('open-file', { preventDefault() { prevented = true } }, filePath)
    assert.equal(prevented, true)
  }
  return { app, ipcMain, delivered, makeWindow, ready, ack, open, focused: () => focusCount }
}

test('mac cold launch preserves every file and waits for explicit ready plus per-file completion', () => {
  const h = harness()
  h.open('/Users/test/合同 一.docx')
  h.open('/Users/test/证据.pdf')
  h.open('/Users/test/project-folder')
  assert.equal(h.delivered.length, 0)
  const wc = h.makeWindow()
  wc.emit('did-finish-load')
  assert.equal(h.delivered.length, 0, 'DOM load does not imply workbench readiness')
  h.ready()
  assert.deepEqual(h.delivered.map(x => x.path), ['/Users/test/合同 一.docx'])
  h.ready()
  h.ack(999)
  assert.equal(h.delivered.length, 1)
  h.ack(h.delivered[0].requestId)
  assert.equal(h.delivered[1].path, '/Users/test/证据.pdf')
  h.ack(h.delivered[1].requestId)
  assert.equal(h.delivered[2].isDirectory, true)
  h.ack(h.delivered[2].requestId)
  h.open('/Users/test/另一个.docx')
  assert.equal(h.delivered[3].path, '/Users/test/另一个.docx')
  assert.equal(h.focused(), 4)
})

test('Windows argv parsing preserves spaces, Chinese and UNC paths, skips runtime and installer options', () => {
  const args = ['C:\\Apps\\AI WorkDeck.exe', '--updated', '/S', '--remote-debugging-port=9222', '合同 一.DOCX', '\\\\server\\share\\证据.pdf', 'https://example.com/file.pdf']
  assert.deepEqual(pathsFromArgv(args, { platform: 'win32', cwd: 'C:\\工作' }), [
    'C:\\工作\\合同 一.DOCX', '\\\\server\\share\\证据.pdf',
  ])
  assert.deepEqual(pathsFromArgv(['electron.exe', 'C:\\repo\\desktop', 'one.pdf'], { platform: 'win32', cwd: 'C:\\docs', defaultApp: true }), ['C:\\docs\\one.pdf'])
})

test('Windows cold argv and second-instance requests share a sequential queue', () => {
  const h = harness({ platform: 'win32', argv: ['app.exe', 'C:\\first.docx', 'C:\\second.pdf'] })
  h.app.emit('second-instance', {}, ['app.exe', 'third.xlsx'], 'C:\\Other Folder')
  h.makeWindow()
  h.ready()
  h.ack(h.delivered[0].requestId)
  h.ack(h.delivered[1].requestId)
  assert.deepEqual(h.delivered.map(x => x.path), ['C:\\first.docx', 'C:\\second.pdf', 'C:\\Other Folder\\third.xlsx'])
})

for (const interruption of ['navigation', 'crash', 'destroyed']) {
  test(`unacknowledged file is redelivered after ${interruption}; remaining files keep order`, () => {
    const h = harness()
    let wc = h.makeWindow()
    h.ready()
    h.open('/one.docx')
    h.open('/two.pdf')
    const firstId = h.delivered[0].requestId
    if (interruption === 'navigation') wc.emit('did-start-navigation', {}, 'file:///index.html', false, true)
    if (interruption === 'crash') wc.emit('render-process-gone')
    if (interruption === 'destroyed') { wc.emit('destroyed'); wc = h.makeWindow() }
    h.ack(firstId)
    assert.equal(h.delivered.length, 1)
    h.ready()
    assert.equal(h.delivered[1].requestId, firstId)
    h.ack(firstId)
    assert.equal(h.delivered[2].path, '/two.pdf')
  })
}

test('a guest renderer or iframe cannot release paths or consume acknowledgements', () => {
  const h = harness()
  const wc = h.makeWindow()
  h.open('/one.docx')
  const guest = new EventEmitter()
  h.ready(guest)
  h.ipcMain.emit('checkba:open-paths-ready', { sender: wc, senderFrame: {} })
  assert.equal(h.delivered.length, 0)
  h.ready()
  h.open('/two.pdf')
  h.ack(h.delivered[0].requestId, guest)
  h.ipcMain.emit('checkba:open-path-ack', { sender: wc, senderFrame: {} }, h.delivered[0].requestId)
  assert.equal(h.delivered.length, 1)
  h.ack(h.delivered[0].requestId)
  assert.equal(h.delivered.length, 2)
})

test('hash navigation and repeat ready do not redeliver the active request', () => {
  const h = harness()
  const wc = h.makeWindow()
  h.ready()
  h.open('/one.docx')
  h.open('/two.pdf')
  wc.emit('did-start-navigation', {}, 'file:///index.html#/workbench', true, true)
  h.ready()
  assert.equal(h.delivered.length, 1)
  h.ack(h.delivered[0].requestId)
  assert.equal(h.delivered[1].path, '/two.pdf')
})

test('a send failure retains the request until a new renderer is ready', () => {
  const h = harness()
  const wc = h.makeWindow()
  wc.send = () => { throw new Error('renderer destroyed during send') }
  h.ready()
  h.open('/one.docx')
  assert.equal(h.delivered.length, 0)
  wc.emit('destroyed')
  h.makeWindow()
  h.ready()
  assert.equal(h.delivered[0].path, '/one.docx')
})

test('replacement window does not depend on the old renderer destroyed event arriving first', () => {
  const h = harness()
  const previous = h.makeWindow()
  h.ready()
  h.open('/one.docx')
  h.open('/two.pdf')
  h.makeWindow()
  h.ready()
  assert.equal(h.delivered[1].path, '/one.docx')
  previous.emit('destroyed')
  h.ack(h.delivered[1].requestId)
  assert.equal(h.delivered[2].path, '/two.pdf')
})

test('real filesystem rejects missing files but accepts files and directories', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-open-path-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, '合同.docx')
  fs.writeFileSync(file, 'fixture')
  const h = harness({ stat: fs.statSync })
  h.makeWindow(); h.ready()
  h.open(path.join(dir, 'missing.docx'))
  h.open(file)
  h.open(dir)
  h.ack(h.delivered[0].requestId)
  assert.deepEqual(h.delivered.map(x => [x.path, x.isDirectory]), [[file, false], [dir, true]])
})

test('shipping main wiring recreates a closed window and brings open requests to the foreground', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
  const start = source.indexOf("require('./open-paths').installOpenPaths({")
  const end = source.indexOf('\napp.whenReady()', start)
  const app = new EventEmitter()
  const ipcMain = new EventEmitter()
  const actions = []
  const context = vm.createContext({ app, ipcMain,
    mainWindow: null, mainWindowStartupReady: true,
    createMainWindow() { context.mainWindow = { isDestroyed: () => false, isMinimized: () => true,
      restore: () => actions.push('restore'), show: () => actions.push('show'), focus: () => actions.push('focus') }; actions.push('create') },
    require(name) { assert.equal(name, './open-paths'); return { installOpenPaths(options) {
      installOpenPaths({ ...options, platform: 'win32', argv: [], stat: () => ({ isFile: () => true, isDirectory: () => false }) })
    } } },
  })
  vm.runInContext(source.slice(start, end), context)
  app.emit('second-instance', {}, ['app.exe', 'C:\\contract.docx'], 'C:\\')
  assert.deepEqual(actions.slice(0, 4), ['create', 'restore', 'show', 'focus'])
})
