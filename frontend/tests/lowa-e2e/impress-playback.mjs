// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real native playback: no replacement worker, simulated input or PDF snapshots.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor, here } from './_boot.mjs'

preflight()
const out = process.env.LOWA_PLAYBACK_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'awd-impress-playback-'))
fs.mkdirSync(out, { recursive: true })
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))
const evidence = { frames: {} }
try {
  const page = await openEditor(browser, { clipboard: false, viewport: { width: 1280, height: 900 } })
  const exec = async (action, params = {}) => {
    const result = await page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), action, params)
    assert.equal(result?.success, true, `${action}: ${JSON.stringify(result)}`)
    return result
  }
  await exec('load_document', { bytes: Array.from(fs.readFileSync(path.join(here, 'fixtures/impress-smoke.pptx'))), name: 'playback.pptx' })
  const slides = []
  for (const [color, text] of [['#0C2850', 'FIRST'], ['#E69B37', 'SECOND']]) {
    const { slideNumber } = await exec('slide_add_page')
    await exec('slide_set_layout', { slideNumber, layout: 20, backgroundColor: color })
    const shape = await exec('slide_add_shape', { slideNumber, shapeType: 'rectangle', left: 40, top: 25, width: 250, height: 60, fillColor: color, text })
    await exec('slide_set_transition', { slideNumber, effect: 'fade', durationSeconds: 1 })
    slides.push({ slideNumber, shapeName: shape.shapeName })
  }
  await exec('set_chrome', { all: false })
  const before = []
  for (const slide of slides) before.push(await exec('slide_get_page', { slideNumber: slide.slideNumber }))
  const sample = async name => {
    const bytes = await page.screenshot({ path: path.join(out, `${name}.png`) })
    const png = PNG.sync.read(Buffer.from(bytes))
    // Central slide pixels, excluding toolbar, sidebar, slide text and cursor.
    const sum = [0, 0, 0]
    let count = 0
    for (let y = 400; y < 460; y += 5) for (let x = 300; x < 500; x += 5) {
      const offset = (y * png.width + x) * 4
      sum.forEach((_, c) => { sum[c] += png.data[offset + c] })
      count++
    }
    const rgb = sum.map(v => v / count)
    evidence.frames[name] = rgb
    return rgb
  }
  const startedAt = Date.now()
  const started = await exec('slide_show_control', { operation: 'start', slideNumber: slides[0].slideNumber })
  evidence.startMs = Date.now() - startedAt
  assert.equal(started.running, true)
  assert.equal(started.slideNumber, slides[0].slideNumber)
  await pause(1200)
  const first = await sample('start')
  assert.ok(distance(first, [12, 40, 80]) < 20, 'start must render the requested blue slide')
  const next = await exec('slide_show_control', { operation: 'next' })
  assert.equal(next.slideNumber, slides[1].slideNumber)
  const nextFrames = []
  for (let i = 0; i < 12; i++) { nextFrames.push(await sample(`next-${i}`)); await pause(90) }
  const second = nextFrames.at(-1)
  assert.ok(distance(second, [230, 155, 55]) < 20, 'next must finish on the orange slide')
  assert.ok(distance(first, second) > 100, 'next must visibly reach a different slide')
  assert.ok(nextFrames.some(rgb => distance(rgb, first) > 30 && distance(rgb, second) > 30), 'capture a genuine intermediate fade frame')
  const previous = await exec('slide_show_control', { operation: 'previous' })
  assert.equal(previous.slideNumber, slides[0].slideNumber)
  const previousFrames = []
  for (let i = 0; i < 12; i++) { previousFrames.push(await sample(`previous-${i}`)); await pause(90) }
  assert.ok(distance(first, previousFrames.at(-1)) < 15, 'previous must visibly return to the first slide')
  evidence.previousHasIntermediateFrame = previousFrames.some(rgb => distance(rgb, first) > 30 && distance(rgb, second) > 30)
  const ended = await exec('slide_show_control', { operation: 'end' })
  assert.equal(ended.running, false)
  assert.equal((await exec('slide_show_control', { operation: 'state' })).running, false)
  await sample('ended')
  const after = []
  for (const slide of slides) after.push(await exec('slide_get_page', { slideNumber: slide.slideNumber }))
  assert.deepEqual(after, before, 'viewing must not modify content, geometry, background or transition settings')
  await exec('slide_set_shape_text', { ...slides[0], text: 'EDITABLE AFTER SHOW' })
  const edited = await exec('slide_get_page', { slideNumber: slides[0].slideNumber })
  assert.equal(edited.shapes.find(shape => shape.name === slides[0].shapeName)?.text, 'EDITABLE AFTER SHOW')
  evidence.contentUnchanged = true
  evidence.editableAfterEnd = true
  console.log(JSON.stringify({ ...evidence, output: out }, null, 2))
  // Keep slow-start failures visible while preserving all visual evidence above.
  assert.ok(evidence.startMs < Number(process.env.LOWA_PLAYBACK_MAX_START_MS || 10000), `native show startup took ${evidence.startMs} ms`)
  console.log('PASS native playback, visible fade, previous, end, content preservation and editing')
} finally {
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(evidence, null, 2))
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  console.log(`Evidence: ${out}`)
}
