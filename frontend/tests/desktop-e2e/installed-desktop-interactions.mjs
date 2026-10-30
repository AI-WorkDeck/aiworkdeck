// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Disposable signed-install runner only. Never run this against a user's clipboard.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, label, timeout = 30000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await read(); if (value) return value; await sleep(200) }
  throw new Error(`Timed out: ${label}`)
}
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

// mainRpc evaluates an expression in the installed app's Node inspector, awaits promises,
// and returns its JSON value. The launcher verifies the installer and installed signature.
export async function checkDesktopInteractions({ page, browser, mainRpc, run }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Disposable GitHub Actions runner required')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'User desktops are forbidden')
  assert.equal(process.env.AWD_TEST_INSTALLED, '1', 'Signed installed-app harness required')
  assert.ok(process.env.RUNNER_TEMP && fs.statSync(process.env.RUNNER_TEMP).isDirectory())
  const runtime = await mainRpc(`(()=>{const {app}=process.mainModule.require('electron');return {packaged:app.isPackaged,execPath:process.execPath,version:process.versions.electron}})()`)
  assert.equal(runtime.packaged, true)
  assert.ok(!runtime.execPath.includes('node_modules'))
  const evidence = { runtime, checks: [], downloadDialog: 'Destination chosen by test through DownloadItem.setSavePath; native chooser UI not covered' }
  const token = crypto.randomBytes(6).toString('hex')
  const bytes = Buffer.from(`Synthetic installed Electron download ${token}\n中文字节验证\n`)
  const downloadPath = path.join(run, `browser-download-${token}.txt`)
  const loads = { '/one': 0, '/two': 0, '/popup': 0 }
  const server = http.createServer((req, res) => {
    if (req.url === '/download') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="browser-download-${token}.txt"`, 'Content-Length': bytes.length })
      res.end(bytes); return
    }
    if (!(req.url in loads)) { res.writeHead(404); res.end(); return }
    const count = ++loads[req.url]
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><meta charset="utf-8"><title>AWD ${req.url} ${token}</title><h1 id="body">Synthetic browser ${req.url}</h1><p id="load">${count}</p><a id="next" href="/two">Next page</a><button id="popup" onclick="window.open('/popup','_blank')">New tab</button><a id="download" href="/download">Download fixture</a>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const ids = []
  let clipboardTouched = false
  const capture = async name => {
    const encoded = await mainRpc(`(async()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/h5/index.html'));return (await w.capturePage()).toPNG().toString('base64')})()`)
    fs.writeFileSync(path.join(run, name + '.png'), Buffer.from(encoded, 'base64'))
  }
  const browserPage = async url => until(async () => {
    const target = browser.targets().find(t => t.url() === url)
    return target ? await target.page() : null
  }, `BrowserView at ${url}`)
  const snapshot = id => page.evaluate(id => window.checkbaDesktop.browser.getSnapshot({ id }), id)
  const state = async (id, url) => until(async () => {
    const s = await snapshot(id)
    return s.ok && s.url === url && s.html.includes('Synthetic browser') ? s : false
  }, `BrowserView body at ${url}`)
  const nav = async index => {
    const selector = `.browser-pane .browser-nav [role="button"]:nth-child(${index})`
    await page.waitForSelector(selector)
    assert.equal(await page.$eval(selector, el => el.getAttribute('aria-disabled')), index === 3 ? null : 'false')
    await page.focus(selector)
    await page.keyboard.press('Enter')
  }
  try {
    const dismiss = await page.$('.ocd-mask .ocd-actions .ocd-btn:not(.primary)')
    if (dismiss) await dismiss.click()
    await page.evaluate(() => {
      window.__installedInteractionEvents = { clipboard: [], urls: [], newTabs: [] }
      const api = window.checkbaDesktop
      window.__installedInteractionUnsubs = [
        api.clipboard.onCopied(data => window.__installedInteractionEvents.clipboard.push(data)),
        api.browser.onUrlUpdated(data => window.__installedInteractionEvents.urls.push(data)),
        api.browser.onOpenNewTab(data => window.__installedInteractionEvents.newTabs.push(data)),
      ]
    })
    const id = await page.evaluate(url => {
      const vm = window.__checkbaActiveOverviewVm
      vm.openBrowserTab(url, 'left')
      return vm.activeFileIdLeft
    }, base + '/one')
    ids.push(id)
    await state(id, base + '/one')
    const web = await browserPage(base + '/one')
    await web.click('#next')
    await state(id, base + '/two')
    await page.waitForFunction(id => window.__installedInteractionEvents.urls.some(e => e.id === id && e.canGoBack), {}, id)
    await nav(1); await state(id, base + '/one')
    await page.waitForFunction(() => document.querySelector('.browser-nav [role="button"]:nth-child(2)')?.getAttribute('aria-disabled') === 'false')
    await nav(2); await state(id, base + '/two')
    const beforeReload = loads['/two']
    await nav(3)
    await until(() => loads['/two'] > beforeReload, 'real network reload')
    await state(id, base + '/two')
    await capture('installed-browser-navigation')
    evidence.checks.push('Production BrowserView link navigation, DOM toolbar back/forward/reload and preload URL events')

    await (await browserPage(base + '/two')).click('#popup')
    const popupId = await until(() => page.evaluate(url => {
      const vm = window.__checkbaActiveOverviewVm
      const tab = vm.leftFiles.find(t => t.tabType === 'web' && t.url === url)
      return tab && vm.activeFileIdLeft === tab.id ? tab.id : null
    }, base + '/popup'), 'window.open becomes active workbench tab')
    ids.push(popupId)
    await state(popupId, base + '/popup')
    await capture('installed-browser-popup')
    assert.equal(await page.evaluate(url => window.__installedInteractionEvents.newTabs.some(e => e.url === url), base + '/popup'), true)
    evidence.browserEvents = await page.evaluate(() => ({ urls: window.__installedInteractionEvents.urls, newTabs: window.__installedInteractionEvents.newTabs }))
    evidence.checks.push('Real window.open handled by production handler and rendered in a new workbench tab')

    // Only select a destination; the production listener, HTTP transfer and file writes stay real.
    await mainRpc(`(()=>{const {session}=process.mainModule.require('electron');globalThis.__installedDownload={};globalThis.__installedDownloadListener=(_event,item)=>{if(item.getURL()!==${JSON.stringify(base + '/download')})return;item.setSavePath(${JSON.stringify(downloadPath)});item.once('done',(_e,state)=>{globalThis.__installedDownload={state,path:item.getSavePath(),filename:item.getFilename(),received:item.getReceivedBytes(),total:item.getTotalBytes()}})};session.defaultSession.on('will-download',globalThis.__installedDownloadListener);return true})()`)
    await (await browserPage(base + '/popup')).click('#download')
    evidence.download = await until(async () => {
      const d = await mainRpc('globalThis.__installedDownload')
      return d?.state ? d : null
    }, 'BrowserView download completion')
    assert.equal(evidence.download.state, 'completed')
    assert.deepEqual(fs.readFileSync(downloadPath), bytes)
    evidence.download.sha256 = sha256(bytes)
    evidence.checks.push('Real fixture HTTP download completed and exact UTF-8 bytes matched')
    for (const tabId of ids) await page.evaluate(id => window.__checkbaActiveOverviewVm.closeFile(id, 'left'), tabId)

    const oldImageIds = await page.evaluate(async () => {
      const response = await fetch(window.checkbaDesktop.apiBaseUrl + '/api/clipboard?limit=50')
      const result = await response.json()
      return (result.data?.items || result.items || []).filter(i => i.type === 'IMAGE').map(i => i.id)
    })
    await sleep(1500) // Production clipboard watcher primes without replaying initial OS contents.
    const text = `Installed clipboard ${token} 中文`
    clipboardTouched = true
    await mainRpc(`(async()=>{const {clipboard,ClipboardItem}=process.mainModule.require('electron');await clipboard.write([new ClipboardItem({'text/plain':new Blob([${JSON.stringify(text)}],{type:'text/plain'})})]);return true})()`)
    await page.waitForFunction(text => window.__installedInteractionEvents.clipboard.some(e => e.text === text && e.source === 'system'), { timeout: 20000 }, text)
    evidence.clipboardText = await page.evaluate(text => window.__installedInteractionEvents.clipboard.find(e => e.text === text && e.source === 'system'), text)
    // Real native bitmap -> OS PNG -> production watcher/nativeImage -> production preload.
    evidence.clipboardImage = await mainRpc(`(async()=>{const {clipboard,ClipboardItem,nativeImage}=process.mainModule.require('electron');const image=nativeImage.createFromBitmap(Buffer.from([0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255]),{width:2,height:2});await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(image.toPNG())],{type:'image/png'})})]);return {bitmap:image.toBitmap().toString('base64'),width:2,height:2}})()`)
    await page.waitForFunction(() => window.__installedInteractionEvents.clipboard.some(e => e.type === 'IMAGE' && e.source === 'system'), { timeout: 20000 })
    const imageEvent = await page.evaluate(() => window.__installedInteractionEvents.clipboard.find(e => e.type === 'IMAGE' && e.source === 'system'))
    const decoded = await mainRpc(`(()=>{const image=process.mainModule.require('electron').nativeImage.createFromDataURL(${JSON.stringify(imageEvent.data)});return {bitmap:image.toBitmap().toString('base64'),...image.getSize()}})()`)
    assert.deepEqual(decoded, evidence.clipboardImage)
    evidence.checks.push('Actual OS text and PNG passed production polling and production preload; PNG pixels match')

    // Read-only backend verification: only the normal clipboard bridge may create these records.
    const records = await until(() => page.evaluate(async ({ text, oldImageIds }) => {
      const response = await fetch(window.checkbaDesktop.apiBaseUrl + '/api/clipboard?limit=50')
      if (!response.ok) return null
      const result = await response.json()
      const items = result.data?.items || result.items || []
      return items.some(i => i.type === 'TEXT' && i.text === text) && items.some(i => i.type === 'IMAGE' && !oldImageIds.includes(i.id)) ? items : null
    }, { text, oldImageIds }), 'production clipboard bridge persists text and image')
    evidence.clipboardRecords = records.map(i => ({ id: i.id, type: i.type, text: i.type === 'TEXT' ? i.text : undefined }))
    await page.evaluate(() => window.__checkbaActiveOverviewVm.openPanelInItsDock('clipboard'))
    // Read the mounted plugin frame directly. innerText can include layout line breaks;
    // the text node plus visible card bounds establish content and actual UI rendering.
    const clipFrame = await until(async () => {
      for (const element of await page.$$('.plugin-iframe')) {
        if (!await element.isVisible()) continue
        const frame = await element.contentFrame()
        if (!frame) continue
        const shown = await frame.evaluate(text => Array.from(document.querySelectorAll('.clip-card .content-text')).some(el => {
          const rect = el.getBoundingClientRect(), style = getComputedStyle(el)
          return el.textContent === text && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        }), text)
        if (shown) return frame
      }
    }, 'clipboard text visible in product panel', 45000)
    await clipFrame.waitForFunction(() => Array.from(document.querySelectorAll('.clip-card img')).some(img => {
      const rect = img.getBoundingClientRect(), style = getComputedStyle(img)
      return img.complete && img.naturalWidth === 2 && img.naturalHeight === 2 && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }))
    await capture('installed-clipboard-cards')
    evidence.checks.push('Production clipboard bridge persisted records and displayed text/image cards')
    await mainRpc(`(()=>{const {Menu}=process.mainModule.require('electron');const item=Menu.getApplicationMenu().items[0].submenu.items[0];if(!item.label.includes('AI WorkDeck'))throw Error('About menu missing');item.click();return true})()`)
    const about = await until(async () => (await browser.pages()).find(p => p.url().startsWith('data:text/html') && p !== page), 'About window')
    await about.waitForFunction(() => document.body.innerText.includes('GNU AGPL v3.0'))
    evidence.about = await about.evaluate(() => ({ text: document.body.innerText, links: Array.from(document.querySelectorAll('a')).map(a => a.href) }))
    assert.ok(evidence.about.text.includes('AI WorkDeck'))
    assert.equal(evidence.about.links.length, 3)
    await about.screenshot({ path: path.join(run, 'installed-about.png') })
    // Electron before-input-event runs through native webContents input; CDP
    // dispatch alone is not evidence that this native accelerator path ran.
    await mainRpc(`(()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('data:text/html'));w.focus();w.webContents.focus();w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});return true})()`)
    await until(() => about.isClosed(), 'About window closes with Escape')
    evidence.checks.push('Production About menu opens licensed/versioned window and Escape closes it')
    evidence.passed = true
    return evidence
  } catch (error) {
    evidence.passed = false
    evidence.error = error.stack || String(error)
    const frameDiagnostics = []
    for (const frame of page.frames()) {
      if (frame.url() === 'about:blank') { frameDiagnostics.push({ url: frame.url(), inactiveBlankFrame: true }); continue }
      try {
        frameDiagnostics.push({ url: frame.url(), ...await frame.evaluate(() => ({
          bodyText: document.body?.innerText?.slice(0, 5000),
          cards: Array.from(document.querySelectorAll('.clip-card .content-text')).map(el => ({ text: el.textContent, bounds: el.getBoundingClientRect().toJSON() })),
        })) })
      } catch (readError) { frameDiagnostics.push({ url: frame.url(), error: String(readError) }) }
    }
    fs.writeFileSync(path.join(run, 'installed-interaction-frames.json'), JSON.stringify(frameDiagnostics, null, 2))
    await capture('installed-interactions-failure').catch(() => {})
    throw error
  } finally {
    await page.evaluate(() => { window.__installedInteractionUnsubs?.forEach(fn => fn()); delete window.__installedInteractionUnsubs }).catch(() => {})
    await mainRpc(`(()=>{const {session,clipboard}=process.mainModule.require('electron');if(globalThis.__installedDownloadListener)session.defaultSession.removeListener('will-download',globalThis.__installedDownloadListener);delete globalThis.__installedDownloadListener;${clipboardTouched ? 'clipboard.clear();' : ''}return true})()`).catch(() => {})
    for (const id of ids) await page.evaluate(id => { const vm=window.__checkbaActiveOverviewVm; if(vm.leftFiles.some(t=>t.id===id))return vm.closeFile(id,'left') }, id).catch(() => {})
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    fs.writeFileSync(path.join(run, 'installed-desktop-interactions.json'), JSON.stringify(evidence, null, 2))
  }
}
