// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

const source = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
function section(from, to) {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}

// Execute the shipping functions, with only Electron/OS effects replaced. No source-pattern
// assertion can catch a stale closed callback nulling the replacement window.
function harness(platform = 'darwin', engine = '', prepare = async () => {}) {
  const windows = []
  const intervals = []
  class Window extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.destroyed = false
      this.sent = []
      this.menuBarCalls = []
      this.webContents = new EventEmitter()
      this.webContents.send = (...args) => this.sent.push(args)
      this.webContents.setWindowOpenHandler = () => {}
      this.webContents.session = new EventEmitter()
      this.webContents.session.webRequest = {
        onBeforeRequest(listener) { this.listener = listener },
        onErrorOccurred(listener) { this.errorListener = listener },
        onCompleted(listener) { this.completedListener = listener },
      }
      windows.push(this)
    }
    isDestroyed() { return this.destroyed }
    show() { this.hidden = false }
    hide() { this.hidden = true }
    focus() {}
    loadFile() {}
    isFullScreen() { return false }
    // dev-board#726：win32 建窗后应显式收起原生菜单条，见 createMainWindow。
    setMenuBarVisibility(visible) { this.menuBarCalls.push(['setMenuBarVisibility', visible]) }
    setAutoHideMenuBar(hide) { this.menuBarCalls.push(['setAutoHideMenuBar', hide]) }
    static getAllWindows() { return windows.filter(w => !w.destroyed) }
  }
  const app = new EventEmitter()
  app.isPackaged = false
  const clipboard = { text: 'already copied before launch', availableFormats: () => ['text/plain'], readText() { return this.text } }
  const context = vm.createContext({
    app, BrowserWindow: Window, clipboard, path, console, prepareRendererForQuit: prepare,
    // createMainWindow 用 nativeTheme 决定窗口的 backgroundColor（首屏白闪兜底，dev-board#731）。
    // 默认给浅色：桌面壳启动时 applyNativeTheme('light') 就是出厂值，与真实运行一致。
    nativeTheme: { shouldUseDarkColors: false },
    process: { platform, env: { AWD_EDITOR_ENGINE: engine } }, __dirname: path.join(__dirname, '../main'),
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1400, height: 900 } }) },
    require: name => {
      // 建窗那段里现场 require 的模块在这里明确列出；来了别的就当场报死，
      // 免得新依赖悄悄混进建窗路径还没人知道。
      const stubs = {
        'node:os': { totalmem: () => 8 * 1024 ** 3 },
        './services/win-arch': { isWinArmEmulated: () => false },
        './reload-guard': { attachReloadGuard: () => true },
        './services/backend-request-gate': require('../main/services/backend-request-gate'),
      }
      assert.ok(name in stubs, 'createMainWindow 里多了一个没桩的 require: ' + name)
      return stubs[name]
    },
    setInterval: fn => { intervals.push(fn); return intervals.length }, clearInterval: () => {},
    views: { layoutAll() {} }, restoreViewsVisibility() {}, syncOcrSelectWinBounds() {},
    attachCopyListener() {}, attachDownloadListener() {}, attachAvatarCorpRelaxation() {},
    // 轮询逻辑用真模块；变更序号 helper（osascript）不起，走无序号的逐 tick 读取（dev-board#869）
    createClipboardPoller: require('../main/clipboard-watch').createClipboardPoller,
    startChangeCounter: () => null,
  })
  vm.runInContext(`let mainWindow = null; let mainWindowStartupReady = false;
    let quitInProgress = false; let updateRestartRequested = false;
    let services = { ports: { backend: 9799 } }; const IS_DEV = false;
    let clipboardWatchTimer = null; let clipboardPrimed = false; let lastClipboardFingerprint = '';
    let clipboardChangeCounter = null;
    ${section('function emitClipboard(', 'function closeOcrSelectWin(')}
    ${section('function sendClipboardCopied(', 'function startClipboardWatcher()')}
    ${section('function startClipboardWatcher()', 'function stopClipboardWatcher()')}
    ${section('function createMainWindow()', 'function syncOcrSelectWinBounds()')}
    ${section("app.on('activate'", "app.on('before-quit'")}
    globalThis.create = createMainWindow;
    globalThis.current = () => mainWindow;
    globalThis.finishStartup = () => { ${section('      mainWindowStartupReady = true', '      retireFirstLaunchSplash()')} };
  `, context)
  return { context, windows, intervals, app, clipboard }
}

test('mac activation during service startup waits for the allocated backend port', () => {
  const h = harness()
  h.app.emit('activate')
  assert.equal(h.windows.length, 0)
  h.context.finishStartup()
  assert.equal(h.windows.length, 1)
  assert.equal(typeof h.windows[0].webContents.session.webRequest.listener, 'function')
  assert.ok(h.windows[0].options.webPreferences.additionalArguments.includes('--checkba-api-base=http://127.0.0.1:9799'))
})

test('dev-board#726: win32 window hides the native menu bar and turns off its Alt auto-hide toggle', () => {
  const h = harness('win32')
  h.context.finishStartup()
  assert.deepEqual(h.windows[0].menuBarCalls, [
    ['setMenuBarVisibility', false],
    ['setAutoHideMenuBar', false],
  ])
})

test('dev-board#726: mac window never touches menu bar visibility (real system menu bar)', () => {
  const h = harness('darwin')
  h.context.finishStartup()
  assert.deepEqual(h.windows[0].menuBarCalls, [])
})

test('repeated creation keeps the current window and its clipboard destination', () => {
  const h = harness()
  h.context.finishStartup()
  const active = h.context.current()
  h.context.create()
  assert.equal(h.windows.length, 1)
  assert.equal(h.context.current(), active)
  h.intervals[0]() // prime, without replaying the pre-launch clipboard
  assert.equal(active.sent.length, 0)
  h.clipboard.text = 'new copy after restart'
  h.intervals[0]()
  assert.equal(active.sent[0][0], 'checkba:clipboard-copied')
  assert.equal(active.sent[0][1].text, 'new copy after restart')
})

test('late closed event from an old window cannot disconnect the replacement', () => {
  const h = harness()
  h.context.finishStartup()
  const old = h.context.current()
  old.destroyed = true
  h.context.create()
  const active = h.context.current()
  old.emit('closed')
  assert.equal(h.context.current(), active)
  h.intervals[0]()
  h.clipboard.text = 'copy after old window closed'
  h.intervals[0]()
  assert.equal(active.sent[0][1].text, 'copy after old window closed')
  assert.equal(old.sent.length, 0)
})

test('closing the current window still permits Dock activation to reopen it', () => {
  const h = harness()
  h.context.finishStartup()
  const old = h.context.current()
  old.destroyed = true
  old.emit('closed')
  assert.equal(h.context.current(), null)
  h.app.emit('activate')
  assert.equal(h.windows.length, 2)
  assert.equal(h.context.current(), h.windows[1])
  assert.equal(h.intervals.length, 1)
})

function preloadBridge(argv, ipcRenderer = {}) {
  let bridge
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload/preload.js'), 'utf8'), {
    process: { argv, platform: 'win32' },
    require: name => {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value } },
        ipcRenderer,
      }
    },
  })
  return bridge
}

test('physical memory reaches the sandboxed preload through the real window arguments', () => {
  const h = harness()
  h.context.finishStartup()
  const bridge = preloadBridge(h.windows[0].options.webPreferences.additionalArguments)
  assert.equal(bridge.systemMemory.totalBytes, 8 * 1024 ** 3)
})

test('native DOCX policy reaches the pool only for opted-in Mac windows', () => {
  for (const [platform, engine, expected] of [['darwin', 'lok', 64 * 1024 * 1024], ['darwin', '', null], ['win32', 'lok', null]]) {
    const h = harness(platform, engine)
    h.context.finishStartup()
    const bridge = preloadBridge(h.windows[0].options.webPreferences.additionalArguments)
    assert.equal(bridge.zetaoffice.nativeDocxMaxBytes, expected)
  }
  for (const value of ['', '0', '-1', 'NaN', '1.5', '9007199254740992']) {
    assert.equal(preloadBridge(['--checkba-native-docx-max-bytes=' + value]).zetaoffice.nativeDocxMaxBytes, null)
  }
})

test('missing or malformed physical memory remains unknown, never zero', () => {
  for (const value of [null, '', '0', '-1', 'NaN', 'Infinity', '1.5', '9007199254740992', '8192oops']) {
    const bridge = preloadBridge(value === null ? [] : ['--checkba-system-memory=' + value])
    assert.equal(bridge.systemMemory.totalBytes, null, String(value))
  }
})

test('Mac 红叉确认后隐藏并保留编辑器，Dock 激活恢复同一窗口供退出时保存', async () => {
  const h = harness()
  h.context.finishStartup()
  const current = h.current ? h.current() : h.context.current()
  let prevented = false
  current.emit('close', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.hidden, true)
  assert.equal(current.destroyed, false)
  h.app.emit('activate')
  assert.equal(current.hidden, false)
  assert.equal(h.windows.length, 1)
})

test('Mac close waits for confirmation, coalesces repeat closes, and cancellation keeps the window visible', async () => {
  let reject, calls = 0
  const h = harness('darwin', '', () => { calls++; return new Promise((_, no) => { reject = no }) })
  h.context.finishStartup()
  const current = h.context.current()
  current.emit('close', { preventDefault() {} })
  current.emit('close', { preventDefault() {} })
  assert.equal(calls, 1)
  assert.notEqual(current.hidden, true)
  reject(new Error('cancelled'))
  await new Promise(resolve => setImmediate(resolve))
  assert.notEqual(current.hidden, true)
  assert.equal(current.sent.at(-1)[0], 'checkba:quit-cancelled')
})

test('Cmd+Q takes over an in-flight Mac close without resuming AI before the real exit', async () => {
  let accept
  const h = harness('darwin', '', () => new Promise(resolve => { accept = resolve }))
  h.context.finishStartup()
  const current = h.context.current()
  current.emit('close', { preventDefault() {} })
  vm.runInContext('quitInProgress = true', h.context)
  accept()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(!current.sent.some(([name]) => name === 'checkba:quit-cancelled'))
  assert.notEqual(current.hidden, true, 'real exit owns the window hide')
})

test('shipping preload forwards the native request identity through confirmation stage and final ACK', async () => {
  const listeners = {}, sent = [], invoked = []
  const bridge = preloadBridge([], {
    on: (name, fn) => { listeners[name] = fn },
    send: (...args) => sent.push(args),
    invoke: async (name, data) => { invoked.push([name, data]); return true },
  })
  bridge.lifecycle.onPrepareQuit(async ({ reportStage }) => {
    await reportStage('confirming')
    await reportStage('saving')
    return { ok: true }
  })
  assert.equal(sent[0][0], 'checkba:quit-handler-ready')
  await listeners['checkba:prepare-quit']({}, { requestId: 'quit-test-1489' })
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)), [
    ['checkba:quit-stage', { requestId: 'quit-test-1489', stage: 'confirming' }],
    ['checkba:quit-stage', { requestId: 'quit-test-1489', stage: 'saving' }],
    ['checkba:quit-prepared', { requestId: 'quit-test-1489', ok: true }],
  ])
})
