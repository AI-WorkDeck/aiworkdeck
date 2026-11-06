#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 深色纸面（教程第 18 集：深色模式下 Word 纸面仍是白的）。真实引擎，无后端、无账户。
// set_app_theme dark 之后逐类断言屏幕像素：
//   Word：纸面变暗；「自动」颜色字变亮；显式黑字（w:color 000000，Word 文件里很常见）
//         也要变亮——这一项靠引擎补丁 patch_dark_page_text，旧引擎（r7 及以前）必红；
//         红字仍是红色；白色底纹单元格里的字仍是深色（不能白底白字）；PDF 导出仍是白纸黑字。
//   Excel：无底色单元格变暗，显式黑字变亮（同样依赖引擎补丁），黄色底纹单元格的字仍是深色。
//   PPT：幻灯片保留自己的白底。
// 构建 wrapper 后运行；LOWA_ENGINE_DIR 选引擎；DARK_PAGE_OUT 存截图（默认临时目录）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { PNG } from 'pngjs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const out = process.env.DARK_PAGE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'awd-dark-page-'))
fs.mkdirSync(out, { recursive: true })
const results = []
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`) }

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const run = (t, rpr = '') => `<w:r><w:rPr>${rpr}<w:sz w:val="40"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`
const para = (t, rpr = '') => `<w:p>${run(t, rpr)}</w:p>`
const LINE = 'MMMMMMMMMMMMMMMMMMMMMMMMMM'

async function docx(body) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  zip.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`)
  return Array.from(await zip.generateAsync({ type: 'uint8array' }))
}
function shade(fill) {
  const cell = `<w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>${para(LINE)}${para(LINE)}</w:tc>`
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tr>${cell}</w:tr></w:tbl>`
}
async function xlsx(fontRgb, fillRgb, text = 'MMMMMMMM') {
  const zip = new JSZip(), ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', rels = 'http://schemas.openxmlformats.org/package/2006/relationships'
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)
  zip.file('_rels/.rels', `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`)
  const fill = fillRgb ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${fillRgb}"/></patternFill></fill>` : '<fill><patternFill patternType="none"/></fill>'
  zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/></font><font><sz val="20"/><color rgb="FF${fontRgb}"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill}</fills><borders count="1"><border/></borders><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`)
  const rows = Array.from({ length: 12 }, (_, r) => `<row r="${r + 1}" ht="30" customHeight="1">` + 'ABCDEF'.split('').map((c) => `<c r="${c}${r + 1}" s="1" t="inlineStr"><is><t>${text}</t></is></c>`).join('') + '</row>').join('')
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><sheetFormatPr defaultRowHeight="30"/><cols><col min="1" max="6" width="20" customWidth="1"/></cols><sheetData>${rows}</sheetData></worksheet>`)
  return Array.from(await zip.generateAsync({ type: 'uint8array' }))
}

// 只统计画布左中部（纸面 / 单元格区域），避开工具栏、标尺、侧栏与验证页的日志框。
function stats(png) {
  const x0 = Math.floor(png.width * 0.12), x1 = Math.floor(png.width * 0.45)
  const y0 = Math.floor(png.height * 0.25), y1 = Math.floor(png.height * 0.6)
  let n = 0, dark = 0, bright = 0, red = 0, lum = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * png.width + x) * 4, r = png.data[o], g = png.data[o + 1], b = png.data[o + 2]
    const l = (r + g + b) / 3
    n++; lum += l
    if (l < 60) dark++
    if (l > 190) bright++
    if (r > 170 && g < 90 && b < 90) red++
  }
  return { mean: Math.round(lum / n), dark: +(dark / n).toFixed(4), bright: +(bright / n).toFixed(4), red: +(red / n).toFixed(4) }
}

// 竖排标尺：画布最左那一条（藏掉原生工具栏后产品里同样露出来），取一段纵向带的平均亮度。
function rulerMean(png) {
  let sum = 0, n = 0
  for (let y = Math.floor(png.height * 0.1); y < Math.floor(png.height * 0.6); y++) for (let x = 3; x < 17; x++) {
    const o = (y * png.width + x) * 4; sum += (png.data[o] + png.data[o + 1] + png.data[o + 2]) / 3; n++
  }
  return n ? Math.round(sum / n) : null
}

preflight()
const puppeteer = await loadPuppeteer()
const server = await startServer()
const browser = await launchBrowser(puppeteer)
let page
try {
  page = await openEditor(browser, { viewport: { width: 1100, height: 900 } })
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const load = (bytes, name) => page.evaluate((b, n) => window.__loExecutor.executeCommand('load_document', { bytes: new Uint8Array(b), name: n }), bytes, name)
  const shot = async (name) => {
    await page.evaluate(() => { const v = document.getElementById('vlog'); if (v) v.style.display = 'none' })
    await new Promise((r) => setTimeout(r, 1500))
    const buf = await page.screenshot({ path: path.join(out, name + '.png') })
    return stats(PNG.sync.read(Buffer.from(buf)))
  }
  const cases = [
    ['word-auto', await docx(Array(14).fill(para(LINE)).join(''))],
    ['word-black', await docx(Array(14).fill(para(LINE, '<w:color w:val="000000"/>')).join(''))],
    ['word-red', await docx(Array(14).fill(para(LINE, '<w:color w:val="FF0000"/>')).join(''))],
    ['word-white-shading', await docx(Array(5).fill(shade('FFFFFF')).join(''))],
  ]
  const res = {}
  for (const [name, bytes] of cases) {
    const loaded = await load(bytes, name + '.docx')
    if (!loaded.success) throw new Error(name + ': ' + JSON.stringify(loaded))
    // 同产品：原生菜单/工具栏/状态栏都藏起来，露出来的只剩画布与标尺
    await exec('set_chrome', { menubar: false, statusbar: false, toolbars: false, rulers: true })
    await exec('set_app_theme', { mode: 'dark' })
    res[name] = await shot(name + '-dark')
    console.log(name, JSON.stringify(res[name]))
    if (name === 'word-auto') res.rulerMean = rulerMean(PNG.sync.read(fs.readFileSync(path.join(out, name + '-dark.png'))))
    if (name === 'word-black') {
      const pdf = await exec('export_pdf', {})
      const bytes = pdf && (pdf.bytes || pdf.data)
      if (bytes) fs.writeFileSync(path.join(out, 'word-black-dark.pdf'), Buffer.from(Object.values(bytes)))
      // PDF 页面内容流里不应出现深色纸面的填充色（0x221F1A → 0.133 0.122 0.102）
      const text = bytes ? Buffer.from(Object.values(bytes)).toString('latin1') : ''
      check('深色模式下导出 PDF 仍是白纸（没有深色纸面填充）', !!bytes && !/0\.13\d? 0\.12\d? 0\.10\d? rg/.test(text), { bytes: bytes ? Object.values(bytes).length : 0 })
    }
    await exec('set_app_theme', { mode: 'light' })
  }
  check('Word 纸面变暗', res['word-auto'].mean < 90, res['word-auto'])
  // 标尺（产品里唯一露出来的原生 chrome 之一）跟着暗：引擎补丁 patch_dark_ruler，r7 及以前必红
  check('标尺跟着变暗（引擎补丁）', res.rulerMean != null && res.rulerMean < 110, { rulerMean: res.rulerMean })
  check('Word 自动颜色字在深色纸面上变亮', res['word-auto'].bright > 0.01 && res['word-auto'].dark > 0.5, res['word-auto'])
  // 显式黑字改画白色后，亮像素应与「自动」颜色那份同一量级；旧引擎下几乎为零。
  check('Word 显式黑字在深色纸面上变亮（引擎补丁）', res['word-black'].bright > res['word-auto'].bright * 0.5, { black: res['word-black'], auto: res['word-auto'] })
  check('Word 红字仍是红色', res['word-red'].red > 0.005 && res['word-red'].bright < 0.01, res['word-red'])
  check('Word 白色底纹里的字仍是深色（不白底白字）', res['word-white-shading'].bright > 0.3 && res['word-white-shading'].dark > 0.005, res['word-white-shading'])

  for (const [name, font, fill, text] of [['excel-empty', '000000', null, ' '], ['excel-black', '000000', null], ['excel-yellow-fill', '000000', 'FFFF00']]) {
    const loaded = await load(await xlsx(font, fill, text), name + '.xlsx')
    if (!loaded.success) throw new Error(name + ': ' + JSON.stringify(loaded))
    // 同产品：原生菜单/工具栏/状态栏都藏起来，露出来的只剩画布与标尺
    await exec('set_chrome', { menubar: false, statusbar: false, toolbars: false, rulers: true })
    await exec('set_app_theme', { mode: 'dark' })
    res[name] = await shot(name + '-dark')
    console.log(name, JSON.stringify(res[name]))
    await exec('set_app_theme', { mode: 'light' })
  }
  check('Excel 无底色单元格变暗，显式黑字变亮（引擎补丁）', res['excel-black'].mean < 110 && res['excel-black'].bright - res['excel-empty'].bright > 0.02, { black: res['excel-black'], empty: res['excel-empty'] })
  check('Excel 黄色底纹单元格的字仍是深色', res['excel-yellow-fill'].dark > 0.005, res['excel-yellow-fill'])

  const pptx = fs.readFileSync(new URL('./fixtures/impress-smoke.pptx', import.meta.url))
  const loaded = await load(Array.from(pptx), 'smoke.pptx')
  if (!loaded.success) throw new Error('pptx: ' + JSON.stringify(loaded))
  await exec('set_app_theme', { mode: 'dark' })
  res.ppt = await shot('ppt-dark')
  console.log('ppt', JSON.stringify(res.ppt))
  check('PPT 幻灯片保留自己的白底', res.ppt.bright > 0.3, res.ppt)
} finally {
  await browser.close(); server.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${out}`)
process.exit(failed.length ? 1 : 0)
