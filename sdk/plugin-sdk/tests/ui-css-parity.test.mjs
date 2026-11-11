// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// awd-plugin-ui.css（给插件作者看/单独引用）与 awd-plugin-sdk.js 里自动注入的那份
// 必须是同一套类名：两份手工同步过，加了组件只改一边，插件里就会出现「有类名没样式」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const css = (await readFile(new URL('../awd-plugin-ui.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
const sdk = await readFile(new URL('../awd-plugin-sdk.js', import.meta.url), 'utf8')
const injected = sdk.match(/var PLUGIN_UI_V3_CSS = \[([\s\S]*?)\]\.join/)[1]
const classes = text => new Set([...text.matchAll(/\.(awd-[\w-]+)/g)].map(m => m[1]))

test('awd-plugin-ui.css 与 SDK 自动注入的样式定义同一组 .awd-* 类', () => {
  const fromCss = classes(css), fromSdk = classes(injected)
  assert.deepEqual([...fromCss].filter(c => !fromSdk.has(c)), [], 'CSS 文件有、SDK 注入里缺')
  assert.deepEqual([...fromSdk].filter(c => !fromCss.has(c)), [], 'SDK 注入有、CSS 文件里缺')
})

test('标签、表格单元格默认不折行（中文会逐字断行）', () => {
  for (const text of [css, injected]) {
    assert.match(text, /\.awd-subnav-item\s*\{[^}]*white-space:\s*nowrap/)
    assert.match(text, /\.awd-table th,\s*\.awd-table td\s*\{[^}]*white-space:\s*nowrap/)
  }
})
