#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Qt/WASM mouse-clock regression (#1511). Stock r6 must fail the slow
// same-point click assertion; a rebuilt engine must retain real double clicks.
// No synthetic event timestamps or product debug interfaces are used.
// LOWA_MOUSE_CLOCK_OUT: screenshots/results directory (default: temporary).
// LOWA_MOUSE_CLOCK_DRAG=1: additionally reuse selected-text-drag-move.mjs with
// the production wrapper and a test-only build without its distant reset click.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor, engineDir, distDir } from './_boot.mjs'

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.env.LOWA_MOUSE_CLOCK_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'awd-mouse-clock-'))
fs.mkdirSync(out, { recursive: true })
const results = []
function check(name, condition, detail) {
  results.push({ name, passed: !!condition, detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`)
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
preflight()
const server = await startServer()
let browser
try {
  browser = await launchBrowser(await loadPuppeteer(), { headed: true })
  const page = await openEditor(browser, { clipboard: false, viewport: { width: 1100, height: 780, deviceScaleFactor: 1 } })
  const exec = async (action, params = {}) => {
    const result = await page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), action, params)
    assert.equal(result.success, true, `${action}: ${JSON.stringify(result)}`)
    return result
  }
  await exec('set_track_changes', { on: false })
  await exec('ui_command', { name: 'select_all' })
  await exec('replace_selection', { text: 'alpha bravo charlie delta echo' })
  await exec('set_zoom', { value: 150 })
  // Measure a word midpoint through the real view cursor, then remove the
  // selection. Measurement never manufactures a mouse event or its timestamp.
  const found = await exec('find_text_locations', { keyword: 'bravo' })
  await exec('set_selection', { anchor: found.matches[0].anchorId })
  const raw = await exec('get_cursor_rect', { selectionRects: true })
  assert.ok(raw.selectionRects?.start && raw.selectionRects?.end)
  const point = await page.evaluate(r => {
    const canvas = document.getElementById('qtcanvas').getBoundingClientRect()
    const a = r.selectionRects.start, b = r.selectionRects.end
    const scale = canvas.width / a.frameWidth
    const menu = Math.max(0, canvas.height - a.frameHeight * scale)
    return { x: canvas.left + (a.x + b.x) * scale / 2, y: canvas.top + menu + (a.y + a.height / 2) * scale }
  }, raw)
  await exec('collapse_selection', { to: 'end' })
  await exec('clear_anchors')
  await pause(200)
  // Moving far away clears Qt's distance latch before the first click. The
  // second click remains at precisely the same point and uses genuine CDP input.
  await page.mouse.move(point.x + 100, point.y)
  await page.mouse.click(point.x, point.y)
  await pause(100)
  const first = (await exec('get_selection')).text
  check('first click places caret', first === '', { first, point })
  await pause(1300)
  await page.mouse.click(point.x, point.y)
  await pause(150)
  const slow = (await exec('get_selection')).text
  await page.screenshot({ path: path.join(out, 'slow-second-click.png') })
  check('same-point clicks over one second apart do not select a word', slow === '', { slow })

  // Clear the native selection and move >double-click distance. Two actual
  // down/up sequences now exercise Qt's positive double-click behavior.
  await exec('collapse_selection', { to: 'end' })
  // Separate this pair from the slow-click case. Moving alone does not reset
  // the last press timestamp; without this pause the pair can become a triple.
  await page.mouse.click(point.x + 100, point.y)
  await pause(1300)
  await page.mouse.click(point.x, point.y)
  await pause(60)
  await page.mouse.click(point.x, point.y)
  await pause(150)
  const rapid = (await exec('get_selection')).text
  await page.screenshot({ path: path.join(out, 'rapid-double-click.png') })
  check('rapid real double-click still selects the word', rapid === 'bravo', { rapid })
  const text = (await exec('get_paragraph', { index: 0 })).text
  check('mouse gestures preserve document text', text === 'alpha bravo charlie delta echo', { text })
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}

async function runDrag(label, dist) {
  const log = fs.createWriteStream(path.join(out, `drag-${label}.log`))
  const child = spawn(process.execPath, [path.join(frontend, 'tests/lowa-e2e/selected-text-drag-move.mjs')], {
    cwd: frontend,
    env: { ...process.env, LOWA_ENGINE_DIR: engineDir, ...(dist ? { LOWA_DIST_DIR: dist } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  await new Promise(resolve => log.end(resolve))
  check(`selected-text drag and undo (${label})`, code === 0, { exitCode: code })
}

if (process.env.LOWA_MOUSE_CLOCK_DRAG === '1') {
  await runDrag('production')
  // Reuse the existing drag suite without copying its document/Undo assertions.
  // This build-only transform removes the compensation; production sources stay
  // untouched. Fail if the exact inspected branch is absent or duplicated.
  const { build } = await import('vite')
  const noResetDist = path.join(out, 'no-reset-editor')
  let transformed = 0
  await build({
    configFile: path.join(frontend, 'vite.zetaoffice.config.js'),
    logLevel: 'warn',
    build: { outDir: noResetDist },
    plugins: [{
      name: 'mouse-clock-test-disable-distant-reset',
      enforce: 'pre',
      transform(source, id) {
        if (!id.endsWith('/zetaOfficeSelectionDrag.js')) return null
        const anchor = 'if (lastCanvasClick && Math.hypot(clientX - lastCanvasClick.x, clientY - lastCanvasClick.y) < 16) {'
        assert.equal(source.split(anchor).length, 2, 'distant reset branch must be unique')
        transformed++
        return source.replace(anchor, 'if (false) {')
      },
    }],
  })
  assert.equal(transformed, 1, 'test must transform the actual selection drag module')
  for (const name of fs.readdirSync(distDir).filter(name => /^cjk.*\.(ttf|ttc|otf)$/.test(name))) {
    fs.copyFileSync(path.join(distDir, name), path.join(noResetDist, name))
  }
  await runDrag('no-reset', noResetDist)
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ engineDir, results }, null, 2))
console.log(`Evidence: ${out}`)
if (results.some(result => !result.passed)) process.exitCode = 1
