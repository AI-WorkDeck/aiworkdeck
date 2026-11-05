// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎：修订开着时给选区建证据链接/书签不产生修订（教程反馈 75），
// 链接后接着输入不沿用链接（教程反馈 82）。
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

async function blankDocx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>')
  return Array.from(await zip.generateAsync({ type: 'uint8array' }))
}
// 逐字读 HyperLinkURL：第一段每个字符一项。
const DEBUG_ACTION = `debug_link_chars() {
  const para = xModel.getText().createEnumeration().nextElement();
  const cur = para.getText().createTextCursorByRange(para.getStart());
  const out = [];
  while (true) {
    if (!cur.goRight(1, true)) break;
    let url = '', style = '', underline = 0, color = 0;
    try { url = String(cur.getPropertyValue('HyperLinkURL') || ''); } catch (e) {}
    try { style = String(cur.getPropertyValue('CharStyleName') || ''); } catch (e) {}
    try { underline = Number(cur.getPropertyValue('CharUnderline')) || 0; } catch (e) {}
    try { color = Number(cur.getPropertyValue('CharColor')); } catch (e) {}
    out.push({ ch: cur.getString(), url: url, style: style, underline: underline, color: color });
    cur.collapseToEnd();
    if (out.length > 200) break;
  }
  return { success: true, chars: out };
},`
preflight()
const server = await startServer({ patchServed(url, bytes) {
  if (url === '/office_thread.js') return Buffer.from(bytes.toString().replace('const EXEC = {', 'const EXEC = {\n' + DEBUG_ACTION))
  if (/^\/assets\/editor-.*\.js$/.test(url)) {
    return Buffer.from(bytes.toString().replace(/(['"])get_hyperlink_at_cursor\1/, match => match + ',"debug_link_chars"'))
  }
  return bytes
} })
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const ok = async (a, p) => { const r = await exec(a, p); assert.equal(r.success, true, a + ': ' + JSON.stringify(r)); return r }
  const revisions = async () => (await ok('list_revisions', { limit: 50, locate: false })).count
  const url = 'https://checkba-internal.local/open?u=' + encodeURIComponent('checkba://filelink?k=EVID_TEST1&projectId=1')
  const blank = await blankDocx()

  await ok('load_document', { name: 'link.docx', bytes: blank })
  // 正文先在修订关闭时写好：落在插入修订里的属性变化会被并进那条插入，测不出来。
  await ok('set_track_changes', { on: false })
  await ok('insert_at_cursor', { text: '甲方证据乙方' })
  await ok('set_track_changes', { on: true })
  const base = await revisions()
  assert.equal(base, 0)
  await ok('find_navigate', { keyword: '证据', direction: 'next' })
  await ok('set_selection_hyperlink', { url })
  assert.equal(await revisions(), base, '建链不产生属性修订')
  assert.equal((await ok('set_track_changes')).recordChanges, true, '修订开关恢复为开')
  await ok('find_navigate', { keyword: '乙方', direction: 'next' })
  await ok('bookmark_selection', { name: 'EVID_TEST2' })
  assert.equal(await revisions(), base, '套书签不产生修订')
  assert.equal((await ok('set_track_changes')).recordChanges, true)
  const linked = (await ok('debug_link_chars')).chars
  assert.deepEqual(linked.filter(c => c.url).map(c => c.ch).join(''), '证据', '链接只落在选区上')
  const exported = await page.evaluate(async () => {
    const r = await window.__loExecutor.executeCommand('export_document', {})
    return r && r.bytes ? Array.from(r.bytes) : null
  })
  await ok('load_document', { name: 'link-reopen.docx', bytes: exported, authorName: '测试用户' })
  assert.equal(await revisions(), 0, '保存重开后也没有格式修订')
  assert.equal((await ok('debug_link_chars')).chars.filter(c => c.url).map(c => c.ch).join(''), '证据', '链接经 docx 往返仍在')
  console.log('PASS hyperlink/bookmark under record changes add no revision')

  await ok('load_document', { name: 'link-typing.docx', bytes: blank })
  await ok('insert_at_cursor', { text: '甲方证据' })
  await ok('find_navigate', { keyword: '证据', direction: 'next' })
  await ok('set_selection_hyperlink', { url })
  // 用户手打的路径：IME 覆盖层提交 = insert_at_cursor + replaceSelection。
  await ok('insert_at_cursor', { text: '之后', replaceSelection: true })
  let chars = (await ok('debug_link_chars')).chars
  assert.equal(chars.map(c => c.ch).join(''), '甲方证据之后', '建链后选区收拢，接着输入不覆盖链接文字')
  assert.deepEqual(chars.filter(c => c.url).map(c => c.ch).join(''), '证据', '接着输入的字不沿用链接')
  await ok('goto', { type: 'end' })
  await ok('insert_at_cursor', { text: '再输入', replaceSelection: true })
  chars = (await ok('debug_link_chars')).chars
  assert.deepEqual(chars.filter(c => c.url).map(c => c.ch).join(''), '证据')
  console.log('PASS typing after a new link does not extend it')

  // 保存重开后（自动保存 + 重载是常态）链接文字带着 docx 的「超链接」字符样式，
  // 在它末尾接着输入同样不能沿用。
  const bytes = await page.evaluate(async () => {
    const r = await window.__loExecutor.executeCommand('export_document', {})
    return r && r.bytes ? Array.from(r.bytes) : null
  })
  await ok('load_document', { name: 'link-typing-reopen.docx', bytes })
  await ok('find_navigate', { keyword: '证据', direction: 'next' })
  await ok('collapse_selection', { to: 'end' })
  await ok('insert_at_cursor', { text: '续写', replaceSelection: true })
  chars = (await ok('debug_link_chars')).chars
  assert.equal(chars.map(c => c.ch).join(''), '甲方证据续写之后再输入')
  assert.deepEqual(chars.filter(c => c.style).map(c => c.ch).join(''), '证据', '只有链接文字带链接样式: ' + JSON.stringify(chars))
  const linkStyle = chars[2], typed = chars.slice(4, 6), plain = chars[0]
  for (const c of typed) {
    assert.equal(c.url, '', '重开后接着输入不带链接')
    assert.equal(c.style, plain.style, '重开后接着输入不沿用链接字符样式: ' + JSON.stringify({ linkStyle, c }))
    assert.equal(c.underline, plain.underline, '不沿用下划线')
  }
  await ok('undo')
  chars = (await ok('debug_link_chars')).chars
  assert.equal(chars.map(c => c.ch).join(''), '甲方证据之后再输入', '一次撤销撤掉整次输入（含样式复位）')
  console.log('PASS typing after a reopened link does not inherit its style')
} finally {
  await browser.close()
  server.close()
}
