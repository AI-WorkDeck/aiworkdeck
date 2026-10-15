// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Regression for dev-board#1286: selecting text in Writer and dragging it with
// the mouse must move the selected text to the drop position (both with
// RecordChanges OFF and ON) in a single Undo step, while a plain click inside
// the selection without dragging collapses the selection as normal.
import assert from 'node:assert/strict'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser, { viewport: { width: 1200, height: 800 } })
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const ok = async (a, p = {}) => {
    const r = await exec(a, p)
    assert.equal(r.success, true, a + ': ' + JSON.stringify(r))
    return r
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))

  // Helper: map a native caret rect to canvas client coordinates (center of caret)
  const caretClientPoint = async (caret) => page.evaluate((c) => {
    const surface = document.getElementById('qtcanvas').getBoundingClientRect()
    const scale = surface.width / c.frameWidth
    const menuH = Math.max(0, surface.height - c.frameHeight * scale)
    return {
      x: surface.left + c.x * scale,
      y: surface.top + menuH + (c.y + c.height / 2) * scale,
    }
  }, caret)

  const resetSentence = async (trackChanges) => {
    await ok('set_track_changes', { on: false })
    await ok('ui_command', { name: 'select_all' })
    await ok('replace_selection', { text: '甲方应当向乙方支付货款。' })
    await ok('resolve_all_revisions', { action: 'accept' })
    await ok('set_track_changes', { on: trackChanges })
  }

  // Locate client coordinates of after-"支付" and select "应当"
  const selectSourceAndMeasureDrop = async () => {
    const locDrop = await ok('find_text_locations', { keyword: '支付' })
    await ok('set_selection', { anchor: locDrop.matches[0].anchorId })
    await ok('collapse_selection', { to: 'end' })
    await ok('clear_anchors', {})
    const dropRaw = await ok('get_cursor_rect', {})
    const dropPt = await caretClientPoint(dropRaw.nativeCaret)

    const locSrc = await ok('find_text_locations', { keyword: '应当' })
    await ok('set_selection', { anchor: locSrc.matches[0].anchorId })
    await ok('clear_anchors', {})
    await pause(120)
    const srcRaw = await ok('get_cursor_rect', {})
    assert.equal(srcRaw.collapsed, false)
    assert.ok(srcRaw.selectionRects?.start && srcRaw.selectionRects?.end, 'get_cursor_rect must return selectionRects for active selection')
    const startPt = await caretClientPoint(srcRaw.selectionRects.start)
    const endPt = await caretClientPoint(srcRaw.selectionRects.end)
    const srcCenter = { x: (startPt.x + endPt.x) / 2, y: startPt.y }
    return { srcCenter, dropPt }
  }

  // 1. RecordChanges = false: drag "应当" to after "支付"
  await resetSentence(false)
  {
    const { srcCenter, dropPt } = await selectSourceAndMeasureDrop()
    await page.mouse.move(srcCenter.x, srcCenter.y)
    await page.mouse.down()
    await page.mouse.move((srcCenter.x + dropPt.x) / 2, dropPt.y, { steps: 5 })
    await page.mouse.move(dropPt.x, dropPt.y, { steps: 5 })
    await page.mouse.up()
    await pause(300)

    const p0 = (await ok('get_paragraph', { index: 0 })).text
    assert.equal(p0, '甲方向乙方支付应当货款。', 'RecordChanges=false: dragged text moved to drop point')
    const selAfter = (await ok('get_selection', {})).text
    assert.equal(selAfter, '应当', 'moved text remains selected at destination (Word parity)')

    await ok('undo', {})
    const pUndo = (await ok('get_paragraph', { index: 0 })).text
    assert.equal(pUndo, '甲方应当向乙方支付货款。', 'single undo restores both source deletion and destination insertion')
  }

  // 2. RecordChanges = true: drag "应当" to after "支付" records Delete + Insert redlines
  //    (Wait >1s after selection to cross LOWA's 1Hz synthetic resize heartbeat)
  await resetSentence(true)
  {
    const { srcCenter, dropPt } = await selectSourceAndMeasureDrop()
    await pause(1100)
    await page.mouse.move(srcCenter.x, srcCenter.y)
    await page.mouse.down()
    await page.mouse.move((srcCenter.x + dropPt.x) / 2, dropPt.y, { steps: 5 })
    await page.mouse.move(dropPt.x, dropPt.y, { steps: 5 })
    await page.mouse.up()
    await pause(350)

    const p0 = (await ok('get_paragraph', { index: 0, __agent: true })).text
    const revs = (await ok('list_revisions', {})).revisions
    assert.equal(p0, '甲方向乙方支付应当货款。', 'RecordChanges=true: final text reflects moved text')
    assert.equal(revs.length, 2, 'RecordChanges=true: move produces 1 Delete + 1 Insert revision')
    assert.deepEqual(revs.map((r) => r.type).sort(), ['Delete', 'Insert'])
    assert.ok(revs.every((r) => r.text === '应当'))

    await ok('undo', {})
    const pUndo = (await ok('get_paragraph', { index: 0, __agent: true })).text
    assert.equal(pUndo, '甲方应当向乙方支付货款。', 'RecordChanges=true: single undo restores original text')
  }

  // 3. Plain click inside selection without dragging collapses selection without moving text
  await resetSentence(false)
  {
    const { srcCenter } = await selectSourceAndMeasureDrop()
    await page.mouse.click(srcCenter.x, srcCenter.y)
    await pause(200)
    const p0 = (await ok('get_paragraph', { index: 0 })).text
    assert.equal(p0, '甲方应当向乙方支付货款。', 'plain click inside selection must not alter text')
    const selAfter = (await ok('get_selection', {})).text
    assert.equal(selAfter, '', 'plain click inside selection collapses selection')
  }

  console.log('PASS selected-text-drag-move: RecordChanges=false/true move + single-step undo + plain click collapse')
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}
