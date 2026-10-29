// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run with Electron. Uses only synthetic content and a fresh profile; no backend, account or clipboard.
const { app, BrowserWindow, BrowserView, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { once } = require('node:events')
const { createBrowserViewRegistry } = require('../main/browser-views')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-runtime-compat-'))
const paths = {}
for (const key of ['home', 'appData', 'userData', 'sessionData', 'documents', 'downloads', 'desktop', 'music', 'pictures', 'videos', 'logs', 'crashDumps', 'temp']) {
  const folder = path.join(root, key)
  fs.mkdirSync(folder)
  app.setPath(key, folder)
  paths[key] = app.getPath(key)
  assert.equal(paths[key], folder)
}
const failures = []
const versions = { ...process.versions }
const evidence = { root, versions, paths, checks: [] }
const fail = error => {
  evidence.passed = false
  evidence.error = error.stack || String(error)
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2))
  console.error(evidence.error)
  console.error('Artifacts:', root)
  app.exit(1)
}
process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)
app.on('render-process-gone', (_event, contents, details) => failures.push({ url: contents.getURL(), ...details }))
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, preloadPath, error) => failures.push({ preloadPath, error: error.message }))
})
const deadline = setTimeout(() => fail(new Error('Runtime compatibility smoke timed out')), 60000)
const mark = name => evidence.checks.push(name)
const page = label => `<!doctype html><html><head><meta charset="utf-8"><title>${label}</title></head>
<body style="background:#137a43;color:white"><h1>${label}</h1><input type="file" id="file">
<script>window.smokeErrors=[];addEventListener('error',e=>smokeErrors.push(e.message));addEventListener('unhandledrejection',e=>smokeErrors.push(String(e.reason)))</script></body></html>`

app.whenReady().then(async () => {
  assert.equal(versions.electron, require('../package.json').devDependencies.electron)
  assert.equal(app.commandLine.hasSwitch('no-sandbox'), false)
  mark('pinned runtime and Chromium sandbox enabled')
  const downloadBytes = Buffer.from('Synthetic Electron download\n')
  const server = http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src blob:; style-src 'unsafe-inline'")
    if (req.url === '/download') {
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Disposition', 'attachment; filename="compat.txt"')
      res.end(downloadBytes)
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(page(req.url === '/second' ? 'Second page' : 'Runtime compatibility'))
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const win = new BrowserWindow({ show: true, width: 700, height: 500,
    webPreferences: { preload: path.resolve(__dirname, '../preload/preload.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, additionalArguments: [`--checkba-api-base=${base}`, '--checkba-system-memory=8589934592'] } })
  const views = createBrowserViewRegistry({ getWindow: () => win,
    createView: () => new BrowserView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }) })
  ipcMain.handle('checkba:ui-confirm', (event, payload) => {
    assert.equal(event.sender, win.webContents)
    assert.deepEqual(payload, { marker: 'synthetic-confirm' })
    return { ok: true, marker: payload.marker }
  })
  try {
    await win.loadURL(base)
    const bridge = await win.webContents.executeJavaScript(`(async () => ({
      api: checkbaDesktop.apiBaseUrl, memory: checkbaDesktop.systemMemory.totalBytes,
      node: typeof require, process: typeof process,
      reply: await checkbaDesktop.app.confirm({marker:'synthetic-confirm'})
    }))()`)
    assert.deepEqual(bridge, { api: base, memory: 8589934592, node: 'undefined', process: 'undefined', reply: { ok: true, marker: 'synthetic-confirm' } })
    assert.equal(win.webContents.getLastWebPreferences().sandbox, true)
    mark('production sandboxed preload, context bridge and invoke/reply')
    await win.webContents.executeJavaScript('window.events=[];window.unsubscribe=checkbaDesktop.chrome.onState(value=>events.push(value));void 0')
    win.webContents.send('checkba:chrome-state', { fullscreen: true })
    assert.deepEqual(await win.webContents.executeJavaScript('events'), [{ fullscreen: true }])
    await win.webContents.executeJavaScript('unsubscribe()')
    win.webContents.send('checkba:chrome-state', { fullscreen: false })
    assert.equal(await win.webContents.executeJavaScript('events.length'), 1)
    mark('production IPC subscription and unsubscribe')

    const filePath = path.join(paths.documents, '合成 file.txt')
    fs.writeFileSync(filePath, 'Synthetic file input')
    win.webContents.debugger.attach('1.3')
    const doc = await win.webContents.debugger.sendCommand('DOM.getDocument')
    const input = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#file' })
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [filePath] })
    const resolved = await win.webContents.executeJavaScript(`({physical:checkbaDesktop.fs.getPathForFile(document.querySelector('#file').files[0]),synthetic:checkbaDesktop.fs.getPathForFile(new File(['x'],'virtual.txt'))})`)
    assert.equal(resolved.physical, filePath)
    assert.equal(resolved.synthetic, '')
    win.webContents.debugger.detach()
    mark('webUtils file path through actual DOM File and production bridge')

    const wasm = await win.webContents.executeJavaScript(`(async()=>{
      const {instance}=await WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]));
      const memory=new WebAssembly.Memory({initial:1,maximum:1,shared:true});
      const url=URL.createObjectURL(new Blob(['onmessage=e=>{Atomics.store(new Int32Array(e.data),0,42);postMessage("done")}'],{type:'text/javascript'}));
      const worker=new Worker(url);
      await new Promise((resolve,reject)=>{worker.onmessage=resolve;worker.onerror=reject;worker.postMessage(memory.buffer)});
      worker.terminate();URL.revokeObjectURL(url);
      return {isolated:crossOriginIsolated,module:instance instanceof WebAssembly.Instance,shared:memory.buffer instanceof SharedArrayBuffer,value:Atomics.load(new Int32Array(memory.buffer),0)}
    })()`)
    assert.deepEqual(wasm, { isolated: true, module: true, shared: true, value: 42 })
    mark('cross-origin isolation, WebAssembly and shared-memory worker')

    const { view } = views.ensure('smoke')
    views.setBounds('smoke', { x: 20, y: 20, width: 620, height: 380 })
    assert.equal(views.attach('smoke'), true)
    assert.ok(win.getBrowserViews().includes(view))
    await view.webContents.loadURL(base)
    await view.webContents.executeJavaScript('window.retainedValue="keep-me"')
    views.detach('smoke')
    assert.equal(win.getBrowserViews().length, 0)
    views.attach('smoke')
    assert.equal(await view.webContents.executeJavaScript('retainedValue'), 'keep-me')
    views.setAllVisible(false)
    assert.equal(win.getBrowserViews().length, 0)
    views.setAllVisible(true)
    assert.ok(win.getBrowserViews().includes(view))
    await view.webContents.loadURL(base + '/second')
    assert.equal(view.webContents.canGoBack(), true)
    let loaded = once(view.webContents, 'did-finish-load')
    view.webContents.goBack()
    await loaded
    assert.equal(view.webContents.getURL(), base + '/')
    assert.equal(view.webContents.canGoForward(), true)
    loaded = once(view.webContents, 'did-finish-load')
    view.webContents.goForward()
    await loaded
    assert.equal(await view.webContents.executeJavaScript('document.querySelector("h1").textContent'), 'Second page')
    const screenshot = await view.webContents.capturePage()
    assert.equal(screenshot.isEmpty(), false)
    fs.writeFileSync(path.join(root, 'browser-view.png'), screenshot.toPNG())
    mark('production BrowserView registry attach, hide, restore, retained state and history')

    const target = path.join(paths.downloads, 'compat.txt')
    const downloaded = new Promise((resolve, reject) => {
      win.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(target)
        item.once('done', (_event, state) => state === 'completed' ? resolve() : reject(new Error(`Download ${state}`)))
      })
    })
    win.webContents.downloadURL(base + '/download')
    await downloaded
    assert.deepEqual(fs.readFileSync(target), downloadBytes)
    mark('real Chromium download to isolated destination')
    assert.deepEqual(await win.webContents.executeJavaScript('smokeErrors'), [])
    assert.deepEqual(await view.webContents.executeJavaScript('smokeErrors'), [])
    assert.deepEqual(failures, [])
  } finally {
    views.destroyAll()
    ipcMain.removeHandler('checkba:ui-confirm')
    win.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  clearTimeout(deadline)
  evidence.passed = true
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
  app.quit()
}).catch(fail)
