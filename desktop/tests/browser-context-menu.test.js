// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 问题 68：网页右键菜单只有「加入网核收藏」一项，把复制 / 粘贴 / 全选等基础项全替换掉了，
// 没选中文字时右键干脆没反应。问题 67：截图框选提示钉在左上角压住红绿灯，window 模式文案写成「网页区域」。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { browserContextMenuTemplate } = require('../main/browser-context-menu')

const t = (pair) => pair.zh
function fakeWc() {
  const calls = []
  return { calls, wc: { cut: () => calls.push('cut'), copy: () => calls.push('copy'), paste: () => calls.push('paste'), selectAll: () => calls.push('selectAll') } }
}
const labels = (tpl) => tpl.filter((i) => i.type !== 'separator').map((i) => i.label)

test('未选中文字的普通网页：仍给复制 / 全选基础菜单', () => {
  const { wc } = fakeWc()
  const tpl = browserContextMenuTemplate({ selectionText: '', isEditable: false, editFlags: {} }, { t, wc, onWebmark() {} })
  assert.deepEqual(labels(tpl), ['复制', '全选'])
  assert.equal(tpl[0].enabled, false, '没选中时复制置灰')
})

test('选中文字：复制 / 全选 + 加入网核收藏', () => {
  const { wc, calls } = fakeWc()
  let marked = 0
  const tpl = browserContextMenuTemplate({ selectionText: ' 合同 ', isEditable: false, editFlags: { canCopy: true } }, { t, wc, onWebmark: () => marked++ })
  assert.deepEqual(labels(tpl), ['复制', '全选', '加入网核收藏'])
  tpl[0].click(); tpl.at(-1).click()
  assert.deepEqual(calls, ['copy'])
  assert.equal(marked, 1)
})

test('可编辑区：剪切 / 复制 / 粘贴 / 全选，按 editFlags 置灰', () => {
  const { wc, calls } = fakeWc()
  const tpl = browserContextMenuTemplate({ selectionText: '', isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: true } }, { t, wc, onWebmark() {} })
  assert.deepEqual(labels(tpl), ['剪切', '复制', '粘贴', '全选'])
  assert.equal(tpl[0].enabled, false)
  assert.equal(tpl[2].enabled, true)
  tpl[2].click(); tpl[3].click()
  assert.deepEqual(calls, ['paste', 'selectAll'])
})

test('main.js 网页右键菜单走 browserContextMenuTemplate，不再无选中就 return', () => {
  const src = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
  const handler = src.slice(src.indexOf("view.webContents.on('context-menu'"), src.indexOf("view.webContents.on('context-menu'") + 1500)
  assert.match(handler, /browserContextMenuTemplate\(/)
  assert.doesNotMatch(handler, /if \(!selectionText\) return/)
})

test('截图框选提示贴底居中，window 模式文案不说「网页区域」', () => {
  const src = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
  const block = src.slice(src.indexOf("ipcMain.handle('checkba:ocr-start-selection'"), src.indexOf("ipcMain.handle('checkba:ocr-start-selection'") + 4000)
  const hintCss = block.match(/\.hint \{[^}]*\}/)[0]
  assert.match(hintCss, /bottom:/)
  assert.match(hintCss, /left: 50%/)
  assert.match(hintCss, /translateX\(-50%\)/)
  assert.doesNotMatch(hintCss, /top: 14px/)
  assert.match(block, /useWindow\s*\?[\s\S]{0,200}拖动框选区域/)
})
