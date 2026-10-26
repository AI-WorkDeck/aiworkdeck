// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run with Electron, not node. An abandoned Chromium callback crashes the process before JS can catch it.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { installBackendRequestGate } = require('../main/services/backend-request-gate')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-gate-abort-'))
for (const key of ['home', 'appData', 'userData', 'sessionData', 'logs', 'crashDumps', 'temp']) {
  const folder = path.join(root, key)
  fs.mkdirSync(folder); app.setPath(key, folder)
}
const timer = setTimeout(() => app.exit(2), 20000)
app.whenReady().then(async () => {
  const requested = []
  const server = http.createServer((req, res) => {
    requested.push(req.url); res.setHeader('Content-Type', 'text/html'); res.end('<html>Isolated request gate test</html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const launch = { process: { exitCode: null, signalCode: null }, deadline: Date.now() + 10000,
    fullReady: false, coreReadPaths: ['/api/core'] }
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  const dispose = installBackendRequestGate(window.webContents.session, { getState: () => ({ port, launch, closing: false }) })
  try {
    await window.loadURL(`http://127.0.0.1:${port}/`)
    const outcome = await window.webContents.executeJavaScript(`new Promise(resolve => {
      const request = new XMLHttpRequest(); request.open('GET', '/api/optional'); request.timeout = 50;
      request.ontimeout = () => resolve('timeout'); request.onload = () => resolve('sent'); request.send();
    })`)
    assert.equal(outcome, 'timeout')
    launch.fullReady = true
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(await window.webContents.executeJavaScript("fetch('/api/live').then(r => r.status)"), 200)
    assert.ok(!requested.includes('/api/optional'), 'Cancelled work must not be sent when the backend becomes ready')
    console.log(JSON.stringify({ passed: true, root, cancelledRequestNotReplayed: true, nextRequestSucceeded: true }))
  } finally {
    dispose(); window.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
  clearTimeout(timer); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
