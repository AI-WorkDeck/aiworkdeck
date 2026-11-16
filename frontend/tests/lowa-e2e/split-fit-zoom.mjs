// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 分屏开合后按窗格宽度适配缩放（真引擎）：把视口宽度减半模拟开分屏、恢复模拟关分屏，
// 断言 set_zoom{fit:'width'} 让整页宽度落进画布、关分屏回到原缩放、手动缩放被尊重。
// 纯逻辑见 tests/lowa-unit/split-fit-zoom.test.mjs；这里验的是 LOWA 真的按新画布
// 宽度算出了页宽缩放（Qt 画布跟上 webview 尺寸、PAGE_WIDTH 当场生效）。
// Run: npm run test:lowa-split-fit-zoom
import assert from 'node:assert/strict'
import { preflight, startServer, launchBrowser, loadPuppeteer, openEditor } from './_boot.mjs'

const WIDE = 1400, NARROW = 700, HEIGHT = 900
const PAGE_PX_AT_100 = 794 // A4 21cm @96dpi
preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await openEditor(browser, { clipboard: false, viewport: { width: WIDE, height: HEIGHT } })
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const canvasWidth = () => page.evaluate(() => document.getElementById('qtcanvas').clientWidth)
  const resize = async (width) => { await page.setViewport({ width, height: HEIGHT }); await sleep(1000) }
  await exec('set_chrome', { menubar: false, statusbar: false, toolbars: false })
  assert.equal((await exec('set_zoom', { value: 100 })).zoom, 100)

  await resize(NARROW)
  const narrow = await canvasWidth()
  const split = await exec('set_zoom', { fit: 'width' })
  console.log('split', JSON.stringify(split), 'canvas', narrow)
  assert.equal(split.success, true)
  assert.equal(split.fitted, true)
  assert.ok(split.zoom < 100, '窄窗格里 100% 放不下整页，应当缩小')
  assert.ok(split.zoom * PAGE_PX_AT_100 / 100 <= narrow, `页宽 ${split.zoom}% 仍超出画布 ${narrow}px`)
  assert.ok(split.zoom * PAGE_PX_AT_100 / 100 >= narrow * 0.6, `缩得过头：${split.zoom}% 在 ${narrow}px 画布里只占一小块`)
  assert.equal((await exec('set_zoom', {})).zoom, split.zoom, '适配后停在 BY_VALUE')
  await page.screenshot({ path: '/tmp/awd-split-fit-narrow.png' })

  await resize(WIDE)
  const unsplit = await exec('set_zoom', { fit: 'width' })
  console.log('unsplit', JSON.stringify(unsplit))
  assert.equal(unsplit.zoom, 100, '关分屏回到分屏前的 100%，不放大到页宽')
  await page.screenshot({ path: '/tmp/awd-split-fit-wide.png' })

  await resize(NARROW)
  assert.equal((await exec('set_zoom', { fit: 'width' })).zoom, split.zoom)
  assert.equal((await exec('set_zoom', { value: split.zoom - 10 })).zoom, split.zoom - 10)
  await resize(WIDE)
  assert.equal((await exec('set_zoom', { fit: 'width' })).zoom, split.zoom - 10, '分屏期间手动定的缩放被尊重')
  console.log('PASS split → fit pane width, unsplit → restore, manual zoom respected')
} finally { await browser.close(); await new Promise(r => server.close(r)) }
