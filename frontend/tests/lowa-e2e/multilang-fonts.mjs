// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// LOWA 编辑器多语种与跨字体回退端到端测试（dev-board#1478）：
// 验证英语、西语、德语、法语、俄语、希腊语、越南语、印尼/马来语、简中、繁中、日语、韩语、
// 泰语、高棉语、老挝语、缅甸语、阿拉伯语、印地语在默认样式及显式切换中文四类字体
// （黑体/宋体/楷体/仿宋）和日韩泰西常用字体时，均能正确注册并嵌入对应字体子集，
// 不出现因字体缺字或 assign 覆盖回退链导致的方框（□/☒）。

import assert from 'node:assert/strict'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

preflight()
const puppeteer = await loadPuppeteer()
const server = await startServer()
const browser = await launchBrowser(puppeteer)

try {
  const page = await openEditor(browser, { viewport: { width: 1280, height: 900 } })
  const res = await page.evaluate(async () => {
    const ex = window.__loExecutor
    const fontsRes = await ex.executeCommand('list_fonts', {})
    const cases = [
      { font: null, text: 'EN: Contract Law | ES: ¡Español pingüino! | DE: Größe ÄÖÜß | FR: Français cœur | RU: Договор купли-продажи | EL: Σύμβαση | VI: Hợp đồng dịch vụ pháp lý tiếng Việt | ID: Perjanjian Hukum' },
      { font: null, text: '简中: 法律服务合同 | 繁中: 法律服務協議書 | 日本語: 業務委託契約書（ひらがな・カタカナ・辻・榊） | 한국어: 법률 서비스 계약서 안녕하세요' },
      { font: null, text: 'ไทย: สัญญาจ้างงาน สวัสดีชาวโลก | ខ្មែរ: កិច្ចសន្យាផ្លូវច្បាប់ | ລາວ: ສັນຍາທາງກົດໝາຍ | မြန်မာ: ဥပဒေရေးရာစာချုပ် | العربية: عقد الخدمات القانونية | हिन्दी: कानूनी सेवा अनुबंध' },
      { font: '黑体', text: '[黑体] 中文黑体 | 日本語ゴシック | 한국어 맑은 고딕 안녕하세요 | ไทย สวัสดีชาวโลก | Español | Русский | Tiếng Việt' },
      { font: '宋体', text: '[宋体] 中文宋体 | 日本語明朝 | 한국어 바탕 안녕하세요 | ไทย สัญญาจ้างงาน | Deutsch | Русский | Tiếng Việt' },
      { font: '楷体', text: '[楷体] 中文楷体 | 日本語 | 한국어 안녕하세요 | ไทย สวัสดีชาวโลก | Français | Русский' },
      { font: '仿宋', text: '[仿宋] 中文仿宋 | 日本語（辻・榊） | 한국어 안녕하세요 세계 법률 | ไทย สวัสดีชาวโลก | Русский | Tiếng Việt' },
      { font: 'Malgun Gothic', text: '[Malgun Gothic] 한국어: 법률 서비스 계약서 | 中文 | 日本語 | ไทย สวัสดี' },
      { font: 'Batang', text: '[Batang] 한국어 바탕체: 본 계약은 당사자 간의 합의에 의하여 체결한다. | 中文 | 日本語 | ไทย' },
      { font: 'MS Mincho', text: '[MS Mincho] 日本語明朝: 業務委託契約書（辻・榊・鷗） | 한국어 | 中文 | ไทย' },
      { font: 'TH Sarabun New', text: '[TH Sarabun New] ภาษาไทย: บันทึกข้อตกลงความร่วมมือทางกฎหมาย | 中文 | English | 한국어' },
      { font: 'Liberation Sans', text: '[Liberation Sans] EN/ES/DE/RU/VI + 中文 + 日本語 + 한국어 + ภาษาไทย + ខ្មែរ + ລາວ + မြန်မာ' },
    ]
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      await ex.executeCommand('insert_at_cursor', { text: c.text })
      const fmt = { paragraphIndex: i, fontSize: 10.5 }
      if (c.font) fmt.fontName = c.font
      const r = await ex.executeCommand('format_selection', fmt)
      if (!r || !r.success) throw new Error('format_selection failed at paragraph ' + i + ': ' + JSON.stringify(r))
      if (i < cases.length - 1) await ex.executeCommand('insert_paragraph', {})
    }
    const pdf = await ex.executeCommand('export_pdf', {})
    if (!pdf || !pdf.success || !pdf.bytes) throw new Error('export_pdf failed')
    return {
      families: fontsRes.families || [],
      pdfBytes: Array.from(pdf.bytes),
    }
  })

  // 1. 验证全部随包多语种字体已注册到 LibreOffice
  const expectedRegistered = [
    'Noto Sans SC',
    'Noto Serif SC',
    '霞鹜文楷',
    '朱雀仿宋（预览测试版）',
    'Noto Sans KR',
    'Noto Serif KR',
    'Noto Sans Thai',
    'Noto Serif Thai',
    'Noto Sans Khmer',
    'Noto Sans Lao',
    'Noto Sans Myanmar',
    'Noto Sans Arabic',
    'Noto Sans Devanagari',
    'Liberation Sans',
    'Liberation Serif',
  ]
  for (const fam of expectedRegistered) {
    assert.ok(res.families.includes(fam), `expected font registered in LOWA: ${fam}`)
  }

  // 2. 验证导出的 PDF 中真实嵌入了全部语种与字形类别对应的字体子集（证明无豆腐块，字形由目标字体渲染）
  const pdfLatin1 = Buffer.from(res.pdfBytes).toString('latin1')
  const baseFonts = [...pdfLatin1.matchAll(/\/BaseFont\s*\/([^\s/>]+)/g)].map((m) => m[1])
  const expectedEmbedded = [
    'LiberationSans',
    'LiberationSerif',
    'NotoSansSC-Regular',
    'NotoSerifSC-Regular',
    'LXGWWenKai-Regular',
    'ZhuqueFangsong-Regular',
    'NotoSansKR-Regular',
    'NotoSerifKR-Regular',
    'NotoSansThai-Regular',
    'NotoSerifThai-Regular',
    'NotoSansKhmer-Regular',
    'NotoSansLao-Regular',
    'NotoSansMyanmar-Regular',
    'NotoSansArabic-Regular',
    'NotoSansDevanagari-Regular',
  ]
  for (const sub of expectedEmbedded) {
    assert.ok(
      baseFonts.some((bf) => bf.includes(sub)),
      `expected PDF to embed font subset ${sub}, got: ${baseFonts.join(', ')}`
    )
  }

  console.log('multilang-fonts e2e passed: all', expectedEmbedded.length, 'font subsets embedded cleanly')
} finally {
  await browser.close()
  server.close()
}
