// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { buildHarness } from './build.mjs'

const output = resolve(process.argv[2] || '/tmp/tts-1339-ui')
const smoke = process.argv.includes('--smoke')
const visualsOnly = process.argv.includes('--visuals-only')
await mkdir(output, { recursive: true })
const built = await buildHarness(output)
const profile = await mkdtemp(join(tmpdir(), 'tts-1339-chrome-'))
const result = { scope: 'Production components compiled by real Uni H5 compiler; real Uni controls/events. Isolated single-page harness, synthetic API/host, not installed Electron or full workbench.',
  startedAt: new Date().toISOString(), build: built, variants: [], interactions: {}, localUiAssets: [], errors: [], passed: false }

function wav(duration) {
  const rate = 24000, frames = Math.round(duration * rate)
  const out = Buffer.alloc(44 + frames * 2)
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28)
  out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++) out.writeInt16LE(Math.round(400 * Math.sin(2 * Math.PI * i * 220 / rate)), 44 + 2 * i)
  return out
}
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/__qa/audio' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const config = JSON.parse(raw)
      await new Promise(resolve => setTimeout(resolve, config.delay))
      if (res.destroyed) return
      res.writeHead(config.fail ? 503 : 200, { 'Content-Type': config.fail ? 'text/plain' : 'audio/wav' })
      res.end(config.fail ? 'Controlled synthetic failure' : wav(config.duration))
      return
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const target = resolve(built.dist, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!target.startsWith(built.dist + '/')) { res.writeHead(403).end(); return }
    const contents = await readFile(target)
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(target)] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime }); res.end(contents)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
let page
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir: profile, headless: true, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'] })
  page = await browser.newPage()
  page.on('pageerror', error => result.errors.push(String(error)))
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().startsWith(origin + '/') || /^(blob:|data:)/.test(request.url())) request.continue()
    else if (request.url() === 'https://cdn.dcloud.net.cn/img/shadow-grey.png') {
      result.localUiAssets.push(request.url())
      request.respond({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFAAAAAASUVORK5CYII=', 'base64') })
    }
    else { result.errors.push(`Unexpected outbound request blocked: ${request.url()}`); request.abort() }
  })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async fn => { const handle = await page.waitForFunction(fn, { timeout: 15000 }); await handle.dispose() }
  const snapshot = () => page.evaluate(() => window.__panelQA.snapshot())
  async function accessibleName(selector) {
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    assert(nodeId, `AX target missing: ${selector}`)
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
    return { role: nodes[0]?.role?.value, name: nodes[0]?.name?.value, ignored: nodes[0]?.ignored }
  }
  let navigation = 0
  async function load(width = 260, theme = 'light', lang = 'zh-CN', touch = false) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1, hasTouch: touch })
    await page.goto(`${origin}/?theme=${theme}&lang=${lang}&run=${++navigation}#/pages/tts/index`, { waitUntil: 'networkidle0' })
    await wait(() => window.__panelQA?.pane()?.voicesLoaded)
    assert(await page.$('uni-scroll-view.easy-voice-pane'), 'Expected real compiled Uni scroll-view')
    assert(await page.$('uni-textarea textarea'), 'Expected real compiled Uni textarea')
  }
  async function fill(text) {
    await page.click('uni-textarea textarea')
    // Select the fixture range; input itself is a trusted CDP native insertion, not dispatchEvent.
    await page.$eval('uni-textarea textarea', element => element.select())
    await cdp.send('Input.insertText', { text })
    await sleep(150) // Let any Uni delayed event settle in ordinary (non-race) cases.
  }
  async function tabTo(selector) {
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab')
      if (await page.evaluate(selector => document.activeElement?.matches(selector), selector)) return
    }
    throw new Error(`Control is not reachable using Tab: ${selector}`)
  }
  async function key(selector, value) { await tabTo(selector); await page.keyboard.press(value) }
  const text = '第一条，合作内容。双方按照约定提交资料。第二条，费用结算。核对无误后办理结算。'
  await load()
  if (smoke) {
    await writeFile(join(output, 'smoke-dom.html'), await page.content())
    await page.screenshot({ path: join(output, 'smoke.png') })
    result.interactions.smoke = { tags: await page.evaluate(() => [...new Set([...document.querySelectorAll('*')].map(el => el.tagName).filter(name => name.startsWith('UNI-')))]), snapshot: await snapshot() }
  } else {
    if (!visualsOnly) {
    // Native input and programmatic import must survive Uni's 100ms update window.
    await page.click('uni-textarea textarea')
    await cdp.send('Input.insertText', { text: '快速输入第一部分' })
    await cdp.send('Input.insertText', { text: '第二部分。' })
    await page.click('.action-area .workdeck-btn')
    await wait(() => window.__qaAudit.requests.length > 0)
    const fast = await page.evaluate(() => ({ inputs: window.__qaAudit.inputs, requests: window.__qaAudit.requests, text: window.__panelQA.snapshot().text }))
    assert(fast.inputs[1].time - fast.inputs[0].time < 100)
    assert.equal(fast.requests[0].text, '快速输入第一部分第二部分。')
    result.interactions.fastTextInput = fast
    for (const delay of [0, 50]) {
      await load()
      await fill('旧文本。')
      await key('.mini-btn:not(.icon)', 'Enter')
      if (delay) await sleep(delay)
      await page.click('.action-area .workdeck-btn')
      await wait(() => window.__qaAudit.requests.length > 0)
      const imported = await page.evaluate(() => ({ at: window.__qaAudit.imports[0], request: window.__qaAudit.requests[0], text: window.__panelQA.snapshot().text }))
      assert(imported.request.text.includes('验收材料'))
      result.interactions[`immediateImport${delay}`] = imported
    }
    await load()
    // Selectors below follow semantic roles and production CSS; no synthetic DOM events.
    result.interactions.textareaAX = await accessibleName('uni-textarea textarea')
    assert.equal(result.interactions.textareaAX.name, '文本内容')
    await key('.mini-btn:not(.icon)', 'Enter')
    await wait(() => document.querySelector('uni-textarea textarea').value.includes('验收材料'))
    assert((await page.$eval('uni-textarea textarea', el => el.value)).includes('验收材料'))
    await key('.mini-btn.icon', ' ')
    await wait(() => window.__panelQA.pane().text === '')
    await fill('English input contains spaces and must not trigger playback.')
    assert.equal(await page.evaluate(() => window.__qaAudit.requests.length), 0)
    result.interactions.importClearInput = true
    await key('.awd-select-trigger', ' ')
    await wait(() => !!document.querySelector('.awd-select-search-input input'))
    result.interactions.searchAX = await accessibleName('.awd-select-search-input input')
    assert(result.interactions.searchAX.name, 'Actual search input has no accessible name')
    await page.keyboard.type('Synthetic voice 40')
    await sleep(150)
    assert.equal(await page.$eval('.awd-select-search-input input', el => el.value), 'Synthetic voice 40')
    assert.equal(await page.$$eval('.awd-select-item', items => items.length), 1)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await wait(() => window.__panelQA.snapshot().voice === 'qa-extra-39')
    await key('.awd-select-trigger', 'Enter')
    await wait(() => document.activeElement?.matches('.awd-select-search-input input'))
    await page.keyboard.type('not-a-real-voice')
    await wait(() => !!document.querySelector('.awd-select-empty'))
    await page.keyboard.press('Escape')
    assert.equal(await page.$('.awd-select-menu'), null)
    await key('.awd-select-trigger', 'Enter')
    await wait(() => document.activeElement?.matches('.awd-select-search-input input'))
    // Two trusted native input events within Uni's 100ms throttle, immediately followed by Enter.
    await cdp.send('Input.insertText', { text: 'M' })
    await cdp.send('Input.insertText', { text: 'aple' })
    await page.keyboard.press('Enter')
    await wait(() => window.__panelQA.snapshot().voice === 'qa-en-1')
    result.interactions.voiceSearch = { voice: (await snapshot()).voice, spacePreserved: true, emptyAndEscape: true }
    await key('.rate-slider', 'ArrowRight')
    assert.equal((await snapshot()).rate, 105)
    await page.keyboard.press('Home')
    assert.equal((await snapshot()).rate, 50)
    await page.keyboard.press('End')
    assert.equal((await snapshot()).rate, 200)
    await page.keyboard.press('PageDown')
    assert.equal((await snapshot()).rate, 175)
    await key('.rate-reset', ' ')
    assert.equal((await snapshot()).rate, 100)
    result.interactions.rateKeyboard = true
    await page.evaluate(() => { window.__qaConfig.duration = 2 })
    await fill(text)
    await key('.action-area .workdeck-btn', 'Enter')
    await wait(() => window.__panelQA.snapshot().status === 'playing')
    assert(await page.$('.reading-segment.active'))
    await key('.play-btn', ' ')
    await wait(() => window.__panelQA.snapshot().status === 'paused')
    const pausedTime = await page.evaluate(() => window.__qaAudit.audios.at(-1).currentTime)
    await sleep(200)
    assert(Math.abs(await page.evaluate(() => window.__qaAudit.audios.at(-1).currentTime) - pausedTime) < .05)
    await key('.play-btn', 'Enter')
    await wait(() => window.__panelQA.snapshot().status === 'playing')
    await wait(() => !window.__panelQA.snapshot().generating)
    const requestsBeforeRate = await page.evaluate(() => window.__qaAudit.requests.length)
    await key('.rate-slider', 'PageUp')
    assert.equal((await snapshot()).rate, 125)
    assert.equal(await page.evaluate(() => window.__qaAudit.audios.find(a => !a.paused).playbackRate), 1.25)
    assert.equal(await page.evaluate(() => window.__qaAudit.requests.length), requestsBeforeRate)
    result.interactions.playback = { snapshot: await snapshot(), decoded: await page.evaluate(() => window.__panelQA.decodeExport()) }
    const beforeFiles = await readdir(output)
    await key('.download-link', 'Enter')
    let downloaded
    for (let i = 0; i < 40; i++) {
      downloaded = (await readdir(output)).find(name => name.endsWith('.wav') && !beforeFiles.includes(name))
      if (downloaded) break
      await sleep(50)
    }
    assert(downloaded, 'Keyboard download did not produce WAV')
    result.interactions.download = downloaded
    await key('.stop-btn', ' ')
    await wait(() => window.__panelQA.snapshot().status === 'idle')
    result.interactions.stop = true
    await load()
    await page.evaluate(() => { window.__qaConfig.failAt = 1; window.__qaConfig.duration = 2 })
    await fill(text)
    await key('.action-area .workdeck-btn', ' ')
    await wait(() => window.__panelQA.snapshot().status === 'error')
    assert(await page.$('.reading-error[role=alert]'))
    await page.screenshot({ path: join(output, 'failure-retry.png') })
    await page.evaluate(() => { window.__qaConfig.failAt = -1 })
    await key('.action-area .workdeck-btn', 'Enter')
    await wait(() => window.__panelQA.snapshot().status === 'playing')
    result.interactions.failureRetry = true
    await load()
    await page.evaluate(() => { window.__qaConfig = { delay: 1, delays: [], duration: .25, failAt: -1 } })
    const long = Array.from({ length: 18 }, (_, i) => `第${i + 1}段，字幕自动滚动验收材料。`).join('\n')
    await fill(long)
    await key('.action-area .workdeck-btn', 'Enter')
    await wait(() => window.__panelQA.snapshot().currentIndex >= 14)
    const scroll = await page.evaluate(() => {
      const inner = [...document.querySelectorAll('.reading-transcript .uni-scroll-view')].find(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible')
      const active = document.querySelector('.reading-segment.active')
      const viewport = inner.getBoundingClientRect(), row = active.getBoundingClientRect()
      return { scrollTop: inner.scrollTop, current: window.__panelQA.snapshot().currentIndex, visible: row.bottom > viewport.top && row.top < viewport.bottom }
    })
    assert(scroll.scrollTop > 0 && scroll.visible, 'Actual Uni scroll-view must follow current subtitle')
    result.interactions.subtitleScroll = scroll
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await load()
    assert(await page.evaluate(() => window.__panelQA.pane().reduceMotion))
    result.interactions.reducedMotion = true
    await cdp.send('Emulation.setEmulatedMedia', { features: [] })
    }
    for (const lang of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) for (const width of [160, 220, 260, 420]) {
      await load(width, theme, lang)
      await fill(text)
      await key('.action-area .workdeck-btn', 'Enter')
      await wait(() => window.__panelQA.snapshot().status === 'playing')
      await key('.play-btn', ' ')
      await wait(() => window.__panelQA.snapshot().status === 'paused')
      const geometry = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
        controls: [...document.querySelectorAll('.ev-btn,.awd-select-trigger,.rate-slider,uni-textarea')].filter(el => el.getBoundingClientRect().width > 0).map(el => {
          const r = el.getBoundingClientRect(); return { tag: el.tagName, className: el.className, left: r.left, right: r.right, width: r.width, height: r.height }
        }) }))
      assert(geometry.documentWidth <= width + 1, `Horizontal page overflow at ${width}/${theme}/${lang}`)
      assert(geometry.controls.every(control => control.left >= -1 && control.right <= width + 1), `Clipped controls at ${width}/${theme}/${lang}`)
      const file = `${width}-${theme}-${lang}.png`
      await page.screenshot({ path: join(output, file) })
      result.variants.push({ width, theme, lang, geometry, screenshot: file })
    }
    await load(420, 'light', 'zh-CN', true)
    const touch = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches,
      heights: [...document.querySelectorAll('.ev-btn,.awd-select-trigger,.rate-slider')].map(el => ({ className: el.className, height: el.getBoundingClientRect().height })) }))
    assert(touch.coarse && touch.heights.every(item => item.height >= 48), 'Touch controls must be at least 48px')
    result.interactions.touch = touch
    await page.screenshot({ path: join(output, '420-touch.png') })
    result.interactions.cssZoom = []
    for (const zoom of [1.5, 2]) {
      await load(420, 'dark', 'en-US')
      await page.evaluate(zoom => { document.documentElement.style.zoom = zoom }, zoom)
      await fill(text)
      await key('.action-area .workdeck-btn', 'Enter')
      await wait(() => window.__panelQA.snapshot().status === 'playing')
      await key('.play-btn', ' ')
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        controls: [...document.querySelectorAll('.ev-btn,.awd-select-trigger,.rate-slider')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height } }) }))
      assert(layout.controls.every(c => c.left >= -1 && c.right <= 421), `Zoom ${zoom} clips controls`)
      await page.screenshot({ path: join(output, `420-css-zoom-${zoom}.png`) })
      result.interactions.cssZoom.push({ zoom, kind: 'CSS zoom, not OS display scaling or browser zoom', layout })
    }
  }
  assert.equal(result.errors.length, 0, 'Browser errors or external traffic')
  result.passed = true
} catch (error) {
  result.failure = { message: error.message, stack: error.stack }
  if (page) {
    result.failureState = await page.evaluate(() => ({ active: document.activeElement?.outerHTML, snapshot: window.__panelQA?.snapshot(), keys: window.__qaAudit?.keys, focuses: window.__qaAudit?.focuses, inputs: window.__qaAudit?.inputs, requests: window.__qaAudit?.requests }))
    await writeFile(join(output, 'failure-dom.html'), await page.content())
    await page.screenshot({ path: join(output, 'failure.png') })
  }
  process.exitCode = 1
} finally {
  result.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2))
  await browser?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
  await rm(built.workspace, { recursive: true, force: true })
  console.log(JSON.stringify({ passed: result.passed, output, failure: result.failure }, null, 2))
}
