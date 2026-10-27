// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1393: hold left mouse button while wheeling through multiple pages.
// Uses native browser input and a real LOWA engine with inline review enabled.
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser, { viewport: { width: 1200, height: 800 } })
  page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message))
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const ok = async (a, p) => { const r = await exec(a, p); assert.equal(r?.success, true, a + ': ' + JSON.stringify(r)); return r }

  // ---------- 多页 + 带修订的夹具 ----------
  const run = (t) => `<w:r><w:t>${t}</w:t></w:r>`
  const paras = []
  for (let i = 0; i < 140; i++) {
    paras.push(i % 25 === 7
      ? `<w:p>${run('第' + i + '段前置，')}<w:del w:id="${900 + i}" w:author="甲审阅人" w:date="2026-09-10T08:00:00Z"><w:r><w:delText>旧表述</w:delText></w:r></w:del><w:ins w:id="${800 + i}" w:author="甲审阅人" w:date="2026-09-10T08:00:00Z">${run('新表述')}</w:ins>${run('，后续。')}</w:p>`
      : `<w:p>${run('第' + i + '段：本段为多页文档的填充正文，用于把视口推离文首位置。')}</w:p>`)
  }
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`)
  await ok('load_document', { name: 'drag-wheel-1393.docx', bytes: Array.from(await zip.generateAsync({ type: 'uint8array' })) })


  await page.evaluate(() => window.postMessage({ __lo: 'lo-relay', type: 'inline-review-state', session: 'drag-wheel-1393', enabled: true, writable: true, revision: 0, status: 'ready', deepStatus: 'idle', findings: [] }, location.origin))
  const pause = ms => new Promise(r => setTimeout(r, ms))
  await ok('select_paragraph', { index: 0 })
  await ok('collapse_selection', { to: 'start' })
  const raw = await ok('get_cursor_rect')
  const pt = await page.evaluate(c => {
    const r = document.querySelector('#qtcanvas').getBoundingClientRect()
    const s = r.width/c.frameWidth
    return {x:r.left+c.x*s, y:r.top+Math.max(0,r.height-c.frameHeight*s)+(c.y+c.height/2)*s}
  }, raw.nativeCaret)

  const top = async () => {
    const r = await ok('get_review_layout', { fresh: false })
    assert.equal(r.available, true, 'requires r5 review geometry')
    return r.view.top
  }
  const selection = async () => (await ok('get_selection')).text
  const original = (await ok('get_document_text')).paragraphs.map(p => p.text)
  assert.equal(original.length, 140)
  const revisions = (await ok('list_revisions', { locate: false })).count
  assert.equal(revisions, 12, 'fixture includes revisions for background review')
  await page.mouse.move(pt.x + 5, pt.y)
  await page.mouse.down()
  await page.mouse.move(pt.x + 180, pt.y + 85, { steps: 10 })
  await pause(250)
  const initial = await selection()
  assert.ok(initial.length > 40, 'real mouse drag creates a nonempty selection')
  const initialTop = await top()
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel({ deltaY: 400 })
    await pause(300) // Includes the real 180ms inline-review callback.
  }
  const downTop = await top(), downText = await selection()
  assert.ok(downTop > initialTop + 16000, 'wheel crosses a page while left button stays held')
  assert.ok(downText.length > initial.length + 400, 'stationary pointer extends selection across pages')
  assert.ok(downText.startsWith(initial), 'selection keeps its original anchor')
  // The same default caret API is used by IME and by background review. Neither
  // may move the live view cursor or terminate the ongoing native mouse gesture.
  const caret = await ok('get_cursor_rect')
  assert.ok(caret.nativeCaret)
  await ok('get_review_context')
  assert.equal(await top(), downTop, 'background reads do not pull the viewport back')
  assert.equal(await selection(), downText, 'background reads preserve the selection')
  assert.equal(caret.selectionRects, undefined, 'endpoint traversal is opt-in')
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel({ deltaY: -400 })
    await pause(300)
  }
  const upTop = await top(), upText = await selection()
  assert.ok(upTop < downTop - 4000, 'wheel also scrolls upward while dragging')
  assert.ok(upText.length > initial.length && upText.length < downText.length, 'upward wheel contracts selection toward anchor')
  assert.ok(downText.startsWith(upText), 'reverse wheel retains the same original anchor')
  await page.mouse.up()
  await pause(650)
  assert.equal(await selection(), upText, 'release preserves the cross-page selection')
  const releasedTop = await top()
  assert.ok(releasedTop > initialTop + 4000, 'release stays away from selection origin')
  await page.mouse.wheel({ deltaY: 400 })
  await pause(350)
  assert.ok(await top() > releasedTop, 'ordinary wheel still scrolls after release')
  assert.equal(await selection(), upText, 'ordinary wheel does not extend a finished selection')
  assert.deepEqual((await ok('get_document_text')).paragraphs.map(p => p.text), original, 'selection never edits the document')
  assert.equal((await ok('list_revisions', { locate: false })).count, revisions, 'selection preserves revisions')
  // Start lower in the document and select backwards through earlier pages.
  await ok('select_paragraph', { index: 100 })
  await ok('collapse_selection', { to: 'end' })
  const backwardRaw = await ok('get_cursor_rect')
  const backwardPoint = await page.evaluate(c => {
    const r = document.querySelector('#qtcanvas').getBoundingClientRect(), scale = r.width / c.frameWidth
    return { x: r.left + c.x * scale, y: r.top + Math.max(0, r.height - c.frameHeight * scale) + (c.y + c.height / 2) * scale }
  }, backwardRaw.nativeCaret)
  await page.mouse.move(backwardPoint.x - 5, backwardPoint.y)
  await page.mouse.down()
  await page.mouse.move(backwardPoint.x - 80, backwardPoint.y - 70, { steps: 10 })
  await pause(250)
  const backwardInitial = await selection(), backwardTop = await top()
  assert.ok(backwardInitial.length > 20, 'backward mouse gesture creates a selection')
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel({ deltaY: -400 })
    await pause(300)
  }
  const backwardText = await selection()
  assert.ok(await top() < backwardTop - 16000, 'backward gesture crosses pages upward')
  assert.ok(backwardText.length > backwardInitial.length + 400)
  assert.ok(backwardText.endsWith(backwardInitial), 'backward selection keeps its end anchor')
  // Release immediately after another wheel, without allowing a timer to run.
  await page.mouse.wheel({ deltaY: -400 })
  await page.mouse.up()
  await pause(650)
  const quickRelease = await selection()
  assert.ok(quickRelease.length >= backwardText.length, 'immediate release keeps the extended selection')
  assert.ok(quickRelease.endsWith(backwardInitial))
  assert.deepEqual((await ok('get_document_text')).paragraphs.map(p => p.text), original)
  console.log('PASS drag-wheel: stationary left drag across pages, up/down, background review, release and ordinary wheel')
} finally {
  await browser.close()
  await new Promise(r => server.close(r))
}
