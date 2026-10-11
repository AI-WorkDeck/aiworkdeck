// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs')
const path = require('node:path')

// Electron dev argv includes the app entry after the executable; installed builds do not.
function pathsFromArgv(argv, { defaultApp = false, cwd = process.cwd(), platform = process.platform } = {}) {
  const paths = platform === 'win32' ? path.win32 : path
  return argv.slice(defaultApp ? 2 : 1)
    .filter(value => typeof value === 'string' && value && !value.startsWith('-') &&
      !value.startsWith('/') && !/^[a-z][a-z\d+.-]*:\/\//i.test(value))
    .map(value => paths.resolve(cwd, value))
}

function installOpenPaths({ app, ipcMain, getWindow, focusWindow,
  platform = process.platform, argv = process.argv, defaultApp = process.defaultApp,
  stat = fs.statSync, cwd = process.cwd() }) {
  const pending = []
  let nextId = 0
  let readySender = null
  let inFlight = null
  const observed = new WeakSet()

  function flush() {
    const win = getWindow()
    if (!readySender || inFlight || !pending.length || !win || win.isDestroyed() || win.webContents !== readySender) return
    inFlight = pending[0]
    try {
      readySender.send('checkba:menu-action', inFlight)
    } catch (_) {
      // The renderer can disappear between readiness and send. Keep the head for its successor.
      readySender = null
      inFlight = null
    }
  }

  function enqueue(filePath) {
    if (typeof filePath !== 'string' || !filePath) return
    let info
    try { info = stat(filePath) } catch (_) { return }
    if (!info.isFile() && !info.isDirectory()) return
    pending.push({ action: 'open-path', path: filePath, isDirectory: info.isDirectory(), requestId: ++nextId })
    focusWindow()
    flush()
  }

  function enqueueArgv(args, workingDirectory) {
    for (const filePath of pathsFromArgv(args, { defaultApp, cwd: workingDirectory, platform })) enqueue(filePath)
  }

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    enqueue(filePath)
  })
  app.on('second-instance', (_event, args, workingDirectory) => {
    if (platform === 'win32') enqueueArgv(args, workingDirectory || cwd)
    focusWindow()
  })
  if (platform === 'win32') enqueueArgv(argv, cwd)

  ipcMain.on('checkba:open-paths-ready', (event) => {
    const win = getWindow()
    if (!win || win.isDestroyed() || event.sender !== win.webContents ||
      (event.senderFrame && event.senderFrame !== event.sender.mainFrame)) return
    if (readySender !== event.sender) inFlight = null
    readySender = event.sender
    if (!observed.has(readySender)) {
      const sender = readySender
      const reset = () => {
        if (readySender !== sender) return
        readySender = null
        inFlight = null
      }
      // Navigation/reload and renderer crashes invalidate readiness, but never consume the head.
      sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) reset()
      })
      sender.on('render-process-gone', reset)
      sender.once('destroyed', reset)
      observed.add(sender)
    }
    flush()
  })
  ipcMain.on('checkba:open-path-ack', (event, requestId) => {
    if (event.sender !== readySender || !inFlight || inFlight.requestId !== requestId ||
      (event.senderFrame && event.senderFrame !== event.sender.mainFrame)) return
    pending.shift()
    inFlight = null
    flush()
  })
}

module.exports = { pathsFromArgv, installOpenPaths }
