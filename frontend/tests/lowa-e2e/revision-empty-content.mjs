// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1309: paragraph-only and empty-cell deletions must remain actionable.
// LOWA_DIST_DIR may point at an isolated build; LOWA_ENGINE_DIR is read-only.
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

async function fixture(kind) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const deletion = '<w:del w:id="1" w:author="段落审阅人" w:date="2026-10-16T08:00:00Z"/>'
  const mark = '<w:pPr><w:rPr>' + deletion + '</w:rPr></w:pPr>'
  const run = text => '<w:r><w:t>' + text + '</w:t></w:r>'
  let body = kind === 'paragraph'
    ? '<w:p>' + mark + run('甲段') + '</w:p><w:p>' + run('乙段') + '</w:p>'
    : kind === 'empty-paragraph'
      ? '<w:p>' + run('甲段') + '</w:p><w:p>' + mark + '</w:p><w:p>' + run('乙段') + '</w:p>'
      : '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:p><w:del w:id="1" w:author="段落审阅人" w:date="2026-10-16T08:00:00Z"><w:r><w:delText>\u200d</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl><w:p>' + run('后文') + '</w:p>'
  body += '<w:p><w:ins w:id="2" w:author="独立审阅人" w:date="2026-10-16T09:00:00Z">' + run('独立插入') + '</w:ins></w:p>'
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr/></w:body></w:document>')
  return Array.from(await zip.generateAsync({ type: 'uint8array' }))
}

preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser, { clipboard: false, viewport: { width: 1600, height: 1000 } })
  const exec = (action, params = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), action, params)
  const ok = async (action, params) => {
    const result = await exec(action, params)
    assert.equal(result?.success, true, action + ': ' + JSON.stringify(result))
    return result
  }
  await page.evaluate(() => {
    const execute = window.__loExecutor.executeCommand.bind(window.__loExecutor)
    window.__revisionResult = null
    window.__loExecutor.executeCommand = async (action, ...args) => {
      const result = await execute(action, ...args)
      if (action === 'resolve_revisions') window.__revisionResult = result
      return result
    }
  })
  const finalText = async () => (await ok('get_document_text', { __agent: true })).paragraphs.map(p => p.text)
  for (const kind of ['paragraph', 'empty-paragraph', 'empty-cell']) {
    for (const mode of ['all', 'balloons']) for (const action of ['accept', 'reject']) {
      const label = kind + '/' + mode + '/' + action
      await ok('load_document', { name: 'synthetic-empty-revision.docx', bytes: await fixture(kind) })
      await ok('set_revision_view', { mode })
      const snapshot = await ok('list_revisions', { locate: false })
      const target = snapshot.revisions.find(r => r.type === 'Delete')
      const other = snapshot.revisions.find(r => r.type === 'Insert')
      assert.ok(target && other, label + ': both target and unrelated revision exist')
      const located = (await ok('list_revisions', { locate: true })).revisions.find(r => r.identifier === target.identifier)
      for (const field of ['identifier', 'type', 'text', 'author', 'timestamp']) {
        assert.equal(located[field], target[field], label + ': location cannot change snapshot ' + field)
      }
      let result
      if (mode === 'balloons') {
        await page.waitForFunction(() => [...document.querySelectorAll('.awd-rb-card button')].some(b => {
          const r = b.getBoundingClientRect()
          return b.textContent === '接受' && r.width > 0 && r.x >= 0 && r.right < innerWidth && r.y > 0 && r.bottom < innerHeight && getComputedStyle(b.closest('article')).visibility === 'visible'
        }), { timeout: 20000 })
        await page.evaluate(() => { window.__revisionResult = null })
        const button = await page.evaluate(label => {
          const b = [...document.querySelectorAll('.awd-rb-card button')].find(b => b.textContent === label)
          const r = b.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }, action === 'accept' ? '接受' : '拒绝')
        await page.mouse.click(button.x, button.y)
        await page.waitForFunction(() => window.__revisionResult !== null, { timeout: 15000 })
        result = await page.evaluate(() => window.__revisionResult)
      } else {
        result = await ok('resolve_revisions', { indices: [target.index], action, expectedRevisions: [target],
          revision: snapshot.revision, documentSeq: snapshot.documentSeq })
      }
      assert.equal(result.success, true, label + ': ' + JSON.stringify(result))
      assert.equal(result.resolved, 1, label)
      assert.deepEqual(result.results.map(r => r.success), [true], label)
      assert.equal((await ok('set_revision_view')).mode, mode, label + ': preserve display preference')
      const after = await ok('list_revisions')
      assert.deepEqual(after.revisions.map(r => r.identifier), [other.identifier], label + ': preserve unrelated revision')
      const expected = kind === 'paragraph'
        ? (action === 'accept' ? ['甲段乙段', '独立插入'] : ['甲段', '乙段', '独立插入'])
        : kind === 'empty-paragraph'
          ? (action === 'accept' ? ['甲段', '乙段', '独立插入'] : ['甲段', '', '乙段', '独立插入'])
          : ['后文', '独立插入']
      assert.deepEqual(await finalText(), expected, label)
      const bytes = await page.evaluate(async () => Array.from((await window.__loExecutor.executeCommand('export_document', { name: 'resolved.docx' })).bytes))
      const xml = await (await JSZip.loadAsync(Uint8Array.from(bytes))).file('word/document.xml').async('string')
      assert.equal((xml.match(/<w:del[\s>]/g) || []).length, 0, label + ': no pending deletion')
      assert.equal((xml.match(/<w:ins[\s>]/g) || []).length, 1, label + ': unrelated insertion persists')
      if (kind === 'empty-cell') {
        assert.equal((xml.match(/<w:tbl>/g) || []).length, 1, label + ': preserve table structure')
        assert.equal(xml.includes('\u200d'), action === 'reject', label + ': accept removes marker; reject restores it')
      }
      await ok('load_document', { name: 'resolved.docx', bytes })
      assert.deepEqual(await finalText(), expected, label + ': DOCX reload')
      const reopened = await ok('list_revisions')
      assert.equal(reopened.count, 1, label)
      assert.equal(reopened.revisions[0].text, other.text, label)
      assert.equal(reopened.revisions[0].type, 'Insert', label)
      console.log('PASS ' + label + ': exact target, visible balloon control where applicable, preserved neighbour, DOCX roundtrip')
    }
  }
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
