// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { pathToFileURL } = require('node:url')
const guard = require('../main/navigation-guard')

const appRoot = path.resolve('/Applications/AI WorkDeck.app/Contents/Resources/frontend/dist/build/h5')
const appIndex = pathToFileURL(path.join(appRoot, 'index.html')).href
const prod = { appRoot, devOrigin: null }
const dev = { appRoot: null, devOrigin: 'http://localhost:5173' }
const preloadDir = path.resolve('/Applications/AI WorkDeck.app/Contents/Resources/app.asar/preload')
const lowaPreload = path.join(preloadDir, 'zetaoffice-webview-preload.js')
const captchaPreload = path.join(preloadDir, 'captcha-webview-preload.js')

test('main window stays on the app page; everything else is external, internal or denied', () => {
  assert.equal(guard.decideMainNavigation(appIndex, prod), 'allow')
  assert.equal(guard.decideMainNavigation(appIndex + '#/pages/project-overview/project-overview?x=1', prod), 'allow')
  assert.equal(guard.decideMainNavigation(pathToFileURL(path.join(appRoot, 'static/a.html')).href, prod), 'allow')
  assert.equal(guard.decideMainNavigation('http://localhost:5173/#/pages/unlock/unlock', dev), 'allow')

  for (const url of ['https://example.com/', 'http://example.com/x?y=1', 'mailto:someone@example.com', 'http://127.0.0.1:9696/api/x']) {
    assert.equal(guard.decideMainNavigation(url, prod), 'external', url)
  }
  // dev server origin is only the app in dev mode
  assert.equal(guard.decideMainNavigation('http://localhost:5173/', prod), 'external')
  assert.equal(guard.decideMainNavigation('http://localhost:5174/', dev), 'external')
  assert.equal(guard.decideMainNavigation('checkba://open?x=1', prod), 'internal')

  for (const url of [
    'file:///etc/hosts',
    pathToFileURL(path.join(appRoot, '..', 'other.html')).href,
    pathToFileURL(appRoot).href, // the directory itself is not a page inside it
    'file://remote-host/share/index.html',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'about:blank',
    'blob:file:///abc',
    'ftp://example.com/',
    'smb://host/share',
    'not a url',
    '',
  ]) {
    assert.equal(guard.decideMainNavigation(url, prod), 'deny', url)
  }
  assert.equal(guard.decideMainNavigation(appIndex, { appRoot: null, devOrigin: null }), 'deny')
})

test('only http(s)/mailto reach the system browser, normalized', () => {
  assert.equal(guard.externalUrl('https://EXAMPLE.com/a b'), 'https://example.com/a%20b')
  assert.equal(guard.externalUrl('mailto:a@b.c'), 'mailto:a@b.c')
  for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'checkba://x', 'smb://h/s', 'vscode://x', '']) {
    assert.equal(guard.externalUrl(url), null, url)
  }
})

test('window.open keeps the workspace browser tab for http(s) and denies child windows otherwise', () => {
  assert.equal(guard.decideWindowOpen('https://example.com'), 'browser-tab')
  assert.equal(guard.decideWindowOpen('http://127.0.0.1:9696/api/files/1/bytes?token=t'), 'browser-tab')
  assert.equal(guard.decideWindowOpen('checkba://x'), 'internal')
  for (const url of ['', 'about:blank', 'file:///etc/hosts', appIndex, 'data:text/html,x', 'blob:file:///x', 'javascript:1']) {
    assert.equal(guard.decideWindowOpen(url), 'deny', url)
  }
})

test('webview allowlist: only the LOWA editor and captcha shapes attach', () => {
  const kinds = guard.webviewKinds(preloadDir)
  const ok = (preload, partition, src) => guard.decideWebviewAttach({ preload }, { partition, src }, kinds)
  assert.equal(ok(lowaPreload, 'persist:zetaoffice', 'http://127.0.0.1:47613/editor.html?uilang=zh'), true)
  assert.equal(ok(pathToFileURL(lowaPreload).href, 'persist:zetaoffice', 'http://localhost:51234/editor.html'), true)
  assert.equal(ok(captchaPreload, '', 'https://www.aiworkdeck.com/captcha-embed?x=1'), true)
  assert.equal(guard.decideWebviewAttach({}, { preload: pathToFileURL(captchaPreload).href, src: 'https://www.aiworkdeck.com/captcha-embed' }, kinds), true)

  // wrong pairing, wrong partition, wrong src, foreign preload, no preload
  assert.equal(ok(lowaPreload, '', 'http://127.0.0.1:47613/editor.html'), false)
  assert.equal(ok(lowaPreload, 'persist:other', 'http://127.0.0.1:47613/editor.html'), false)
  assert.equal(ok(lowaPreload, 'persist:zetaoffice', 'https://example.com/editor.html'), false)
  assert.equal(ok(captchaPreload, 'persist:zetaoffice', 'https://www.aiworkdeck.com/captcha-embed'), false)
  assert.equal(ok(captchaPreload, '', 'http://www.aiworkdeck.com/captcha-embed'), false)
  assert.equal(ok(captchaPreload, '', 'http://localhost:3000/captcha-embed'), true) // local website dev
  assert.equal(ok(captchaPreload, '', 'file:///tmp/captcha.html'), false)
  assert.equal(ok(path.join(preloadDir, 'preload.js'), '', 'https://example.com'), false)
  assert.equal(ok(path.join(preloadDir, '..', 'preload', '..', 'x', 'captcha-webview-preload.js'), '', 'https://example.com'), false)
  assert.equal(ok('', 'persist:zetaoffice', 'http://127.0.0.1:47613/editor.html'), false)
  assert.equal(ok('', '', 'https://example.com'), false)
})

function fakeContents() {
  const wc = new EventEmitter()
  wc.setWindowOpenHandler = (h) => { wc.openHandler = h }
  return wc
}
function install(wc) {
  const calls = { external: [], internal: [], tabs: [], log: [] }
  guard.installMainWindowGuards(wc, {
    appRoot, devOrigin: null, preloadDir,
    openExternal: (u) => { calls.external.push(u) },
    sendInternal: (u) => calls.internal.push(u),
    sendOpenTab: (u) => calls.tabs.push(u),
    log: (k) => calls.log.push(k),
  })
  return calls
}
const navEvent = (url, extra = {}) => ({ url, prevented: false, preventDefault() { this.prevented = true }, ...extra })

test('installed handlers: link click opens the system browser and leaves the main window', async () => {
  const wc = fakeContents()
  const calls = install(wc)
  const ext = navEvent('https://example.com/report')
  wc.emit('will-navigate', ext, ext.url)
  assert.equal(ext.prevented, true)
  await new Promise(r => setImmediate(r))
  assert.deepEqual(calls.external, ['https://example.com/report'])

  const inApp = navEvent(appIndex + '#/pages/unlock/unlock')
  wc.emit('will-navigate', inApp, inApp.url)
  assert.equal(inApp.prevented, false)

  const file = navEvent('file:///etc/hosts')
  wc.emit('will-navigate', file, file.url)
  assert.equal(file.prevented, true)
  assert.equal(calls.external.length, 1)

  const internal = navEvent('checkba://open?id=1')
  wc.emit('will-navigate', internal, internal.url)
  assert.equal(internal.prevented, true)
  assert.deepEqual(calls.internal, ['checkba://open?id=1'])
})

test('installed handlers: redirects of the main frame never leave the app and never auto-open', () => {
  const wc = fakeContents()
  const calls = install(wc)
  const away = navEvent('https://example.com/', { isMainFrame: true })
  wc.emit('will-redirect', away, away.url)
  assert.equal(away.prevented, true)
  const sub = navEvent('https://example.com/', { isMainFrame: false })
  wc.emit('will-redirect', sub, sub.url)
  assert.equal(sub.prevented, false)
  assert.deepEqual(calls.external, [])
})

test('installed handlers: window.open never creates a child window', () => {
  const wc = fakeContents()
  const calls = install(wc)
  assert.equal(wc.openHandler({ url: 'https://example.com/x' }).action, 'deny')
  assert.equal(wc.openHandler({ url: 'about:blank' }).action, 'deny')
  assert.equal(wc.openHandler({ url: 'checkba://y' }).action, 'deny')
  assert.deepEqual(calls.tabs, ['https://example.com/x'])
  assert.deepEqual(calls.internal, ['checkba://y'])
})

test('installed handlers: will-attach-webview rejects unknown shapes and hardens known ones', () => {
  const wc = fakeContents()
  install(wc)
  const ev = () => ({ prevented: false, preventDefault() { this.prevented = true } })
  const bad = ev()
  wc.emit('will-attach-webview', bad, { preload: path.join(preloadDir, 'preload.js') }, { partition: 'persist:any', src: 'https://example.com' })
  assert.equal(bad.prevented, true)

  const good = ev()
  const prefs = { preload: lowaPreload, nodeIntegration: true, nodeIntegrationInSubFrames: true, contextIsolation: false }
  const params = { partition: 'persist:zetaoffice', src: 'http://127.0.0.1:47613/editor.html', allowpopups: 'true' }
  wc.emit('will-attach-webview', good, prefs, params)
  assert.equal(good.prevented, false)
  assert.equal(prefs.nodeIntegration, false)
  assert.equal(prefs.nodeIntegrationInSubFrames, false)
  assert.equal(prefs.contextIsolation, true)
  assert.equal(prefs.sandbox, true)
  assert.equal('allowpopups' in params, false)
})
