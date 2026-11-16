// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict'

// 主窗口的导航与 <webview> 白名单（S26 阶段 1）。
//
// 主窗口带完整 preload 桥（window.checkbaDesktop）。顶层导航到别的页面时 preload 会在新页面
// 上再注入一次，所以主窗口只能停在应用自己的页面上：
//   - 应用页（打包态 file:// 的前端目录内、开发态 dev server 同源）→ 放行；
//   - checkba: → 交给渲染层的内部打开；
//   - http(s) / mailto → 拦下，交给系统浏览器（shell.openExternal），绝不在主窗口里打开；
//   - 其余一律拦下。
// window.open 维持原行为：http(s) 交给工作区浏览器标签（独立 BrowserView，无 preload、沙箱），
// 但不再「其余 scheme 一律放行」——放行会新建一个继承主窗口 preload 的子窗口。
//
// <webview> 只允许两种已知形态：LOWA 编辑器（zetaoffice preload + persist:zetaoffice 分区 +
// 本机编辑器服务）与人机验证（captcha preload + https 托管页，本机联调允许 loopback http）。其余（任意 preload / 分区）拒绝挂载，
// 并强制 nodeIntegration 关、contextIsolation 开、sandbox 开、去掉 allowpopups。
//
// 纯判定函数与 Electron 解耦，desktop/tests/navigation-guard.test.js 直接调用。

const path = require('path')
const { fileURLToPath } = require('url')

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function parseUrl(value) {
  try { return new URL(String(value || '')) } catch (e) { return null }
}

function isInside(root, target) {
  const rel = path.relative(root, target)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** 应用自己的页面：打包态前端目录内的 file://，或开发态 dev server 同源。 */
function isAppUrl(url, { appRoot, devOrigin } = {}) {
  const u = parseUrl(url)
  if (!u) return false
  const dev = devOrigin && parseUrl(devOrigin)
  if (dev && u.origin === dev.origin) return true
  if (u.protocol !== 'file:' || !appRoot || u.host) return false
  try { return isInside(path.resolve(appRoot), fileURLToPath(u)) } catch (e) { return false }
}

/** 可交给系统浏览器的地址：只认 http(s)/mailto，返回规范化后的 href；否则 null。 */
function externalUrl(url) {
  const u = parseUrl(url)
  return u && EXTERNAL_PROTOCOLS.has(u.protocol) ? u.href : null
}

/** 主窗口顶层导航：'allow' | 'internal' | 'external' | 'deny'。 */
function decideMainNavigation(url, ctx) {
  if (String(url || '').startsWith('checkba:')) return 'internal'
  if (isAppUrl(url, ctx)) return 'allow'
  if (externalUrl(url)) return 'external'
  return 'deny'
}

/** 主窗口 window.open：'internal' | 'browser-tab' | 'deny'。 */
function decideWindowOpen(url) {
  const u = String(url || '')
  if (u.startsWith('checkba:')) return 'internal'
  if (/^https?:\/\//i.test(u)) return 'browser-tab'
  return 'deny'
}

function toPath(preload) {
  const p = String(preload || '')
  if (!p) return ''
  try { return path.resolve(p.startsWith('file:') ? fileURLToPath(p) : p) } catch (e) { return '' }
}

function isLoopbackHttp(src) {
  const u = parseUrl(src)
  return !!u && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
}

/**
 * <webview> 挂载判定。kinds：[{ preload, partition, src(src) => boolean }]，
 * preload 与 partition 必须同时逐字匹配，src 还要过各自的校验。
 */
function decideWebviewAttach(webPreferences, params, kinds) {
  const preload = toPath((webPreferences && webPreferences.preload) || (params && params.preload))
  const partition = String((params && params.partition) || '')
  const src = String((params && params.src) || '')
  return kinds.some(k => preload && preload === toPath(k.preload) && partition === k.partition && k.src(src))
}

function webviewKinds(preloadDir) {
  return [
    { preload: path.join(preloadDir, 'zetaoffice-webview-preload.js'), partition: 'persist:zetaoffice', src: isLoopbackHttp },
    // 人机验证托管页在官网（https）；本机联调官网时是 loopback http。
    { preload: path.join(preloadDir, 'captcha-webview-preload.js'), partition: '', src: s => (parseUrl(s) || {}).protocol === 'https:' || isLoopbackHttp(s) },
  ]
}

/**
 * 给主窗口挂导航、window.open 与 <webview> 白名单。
 * deps: { appRoot, devOrigin（dev server 地址或 origin）, preloadDir, openExternal(url), sendInternal(url), sendOpenTab(url), log? }
 */
function installMainWindowGuards(webContents, deps) {
  const log = deps.log || (() => {})
  const ctx = { appRoot: deps.appRoot, devOrigin: deps.devOrigin }
  const kinds = webviewKinds(deps.preloadDir)
  const openExternal = (url) => {
    const href = externalUrl(url)
    if (!href) return
    Promise.resolve().then(() => deps.openExternal(href)).catch(e => log('open-external-failed', { message: String(e && e.message || e) }))
  }

  webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url)
    try {
      if (decision === 'internal') deps.sendInternal(String(url))
      else if (decision === 'browser-tab') deps.sendOpenTab(String(url))
      else log('window-open-denied', { scheme: (parseUrl(url) || {}).protocol || '' })
    } catch (e) { /* ignore */ }
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, legacyUrl) => {
    const url = (event && event.url) || legacyUrl
    const decision = decideMainNavigation(url, ctx)
    if (decision === 'allow') return
    event.preventDefault()
    try {
      if (decision === 'internal') deps.sendInternal(String(url))
      else if (decision === 'external') openExternal(url)
      else log('navigation-denied', { scheme: (parseUrl(url) || {}).protocol || '' })
    } catch (e) { /* ignore */ }
  })

  // 服务端重定向：主框架只许落在应用页上；不自动打开外部浏览器（没有用户手势）。
  webContents.on('will-redirect', (event, legacyUrl, _inPlace, legacyMainFrame) => {
    const isMainFrame = event && typeof event.isMainFrame === 'boolean' ? event.isMainFrame : legacyMainFrame
    if (isMainFrame === false) return
    const url = (event && event.url) || legacyUrl
    if (decideMainNavigation(url, ctx) === 'allow') return
    event.preventDefault()
    log('redirect-denied', { scheme: (parseUrl(url) || {}).protocol || '' })
  })

  webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!decideWebviewAttach(webPreferences, params, kinds)) {
      event.preventDefault()
      log('webview-denied', { partition: String((params && params.partition) || '') })
      return
    }
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    // Electron 45 的 guest 默认就是沙箱（实测 getLastWebPreferences），这里写死防回退。
    webPreferences.sandbox = true
    delete params.allowpopups
  })
}

module.exports = {
  isAppUrl,
  externalUrl,
  decideMainNavigation,
  decideWindowOpen,
  decideWebviewAttach,
  webviewKinds,
  installMainWindowGuards,
}
