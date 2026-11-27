// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X-S2 / X5: zh-TW users get Traditional native menus, About window and shell dialogs.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildTable, render, JAVA, OUT } = require('../scripts/gen-zh-hant')
const { toTraditional } = require('../main/zh-hant')
const TABLE = require('../main/zh-hant-table.json')

test('the shell table is generated from the backend ZhHantConverter and is up to date', () => {
  // Windows checkouts may turn LF into CRLF; compare content, not line endings.
  const lf = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  assert.strictEqual(lf(OUT), render(buildTable(lf(JAVA))),
    'run: node desktop/scripts/gen-zh-hant.js')
})

// Every Simplified string the main process can show (t({ zh / 'zh-CN': ... }) literals).
function shellStrings() {
  const dirs = [path.join(__dirname, '../main'), path.join(__dirname, '../main/services')]
  const out = new Set()
  for (const dir of dirs) for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/(?:\bzh|'zh-CN'):\s*(['"])((?:(?!\1).)+)\1/g)) out.add(m[2])
  }
  return [...out]
}

test('no Simplified-only character survives in any zh-TW shell string', () => {
  const strings = shellStrings()
  assert.ok(strings.length > 25, 'found the shell strings')
  const simplified = new Set(Object.keys(TABLE.chars))
  for (const s of strings) {
    const t = toTraditional(s)
    const left = [...t].filter((c) => simplified.has(c))
    assert.deepStrictEqual(left, [], `${s} → ${t}`)
    assert.ok(!t.includes('后'), `后 in ${t}`) // check-terminology.mjs zh-TW rule
    assert.notStrictEqual(t.trim(), '回傳', `${s} must not become 回傳`)
  }
})

test('shell vocabulary follows the Traditional-Chinese macOS menus, not a character map', () => {
  const cases = {
    '关于 AI WorkDeck': '關於 AI WorkDeck', '前置全部窗口': '全部移到最前', '最小化': '縮到最小',
    '重新加载': '重新載入', '要重新加载界面吗？': '要重新載入介面嗎？', '粘贴并匹配样式': '貼上並符合樣式',
    '开发者工具': '開發者工具', '源代码与法律声明': '原始碼與法律聲明',
    '打开文件夹…': '開啟資料夾…', '新建项目…': '新增專案…', '文档': '文件', '打开文件…': '開啟檔案…',
    '退出登录…': '登出…', '查看日志': '查看日誌', '反馈…': '意見回饋…', '停止当前任务': '停止目前任務', '新建浏览器标签': '新增瀏覽器分頁',
  }
  for (const [zh, tw] of Object.entries(cases)) assert.strictEqual(toTraditional(zh), tw)
})

test('t() converts for zh-TW, keeps explicit zh-TW text, and leaves zh-CN untouched', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-zh-hant-'))
  const electronId = require.resolve('electron')
  const prev = require.cache[electronId]
  require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: { app: { getPath: () => userData, getLocale: () => 'zh-TW' } } }
  const langPath = require.resolve('../main/app-language')
  delete require.cache[langPath]
  try {
    const lang = require('../main/app-language')
    lang.setAppLanguage('zh-TW')
    assert.strictEqual(lang.t({ zh: '关于 AI WorkDeck', en: 'About AI WorkDeck' }), '關於 AI WorkDeck')
    assert.strictEqual(lang.t({ zh: '退出', 'zh-TW': '離開', en: 'Quit' }), '離開')
    lang.setAppLanguage('zh-CN')
    assert.strictEqual(lang.t({ zh: '关于 AI WorkDeck', en: 'About AI WorkDeck' }), '关于 AI WorkDeck')
  } finally {
    delete require.cache[langPath]
    if (prev) require.cache[electronId] = prev; else delete require.cache[electronId]
  }
})
