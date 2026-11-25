// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH X45/X46：设置左侧导航英文统一 Title Case（docs/i18n/STYLE_GUIDE.md：导航、菜单、对话框标题用 Title Case）；
// zh-TW 左栏插件名与插件自己的名字一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import admin from '../../src/locales/en-US/admin.js'
import chat from '../../src/locales/en-US/chat.js'
import mcp from '../../src/locales/en-US/mcp.js'
import twWorkbench from '../../src/locales/zh-TW/workbench.js'

const SMALL = new Set(['&', 'and', 'of', 'to', 'in', 'for', 'on', 'or', 'a', 'an', 'the'])
const isTitleCase = (s) => s.split(/\s+/).every((w, i) => {
  if (i > 0 && SMALL.has(w)) return true
  const first = w.replace(/^[^A-Za-z]+/, '')[0]
  return !first || first === first.toUpperCase()
})

test('settings navigation labels are Title Case in English', () => {
  const labels = Object.entries(admin).filter(([k, v]) => /^nav[A-Z]/.test(k) && typeof v === 'string')
  labels.push(['mcp.title', mcp.title], ['chat.builtinWorkflowsFoldEntry', chat.builtinWorkflowsFoldEntry])
  assert.deepEqual(labels.filter(([, v]) => !isTitleCase(v)), [])
})

test('zh-TW rail label for the redaction plugin matches the plugin name', () => {
  const plugin = JSON.parse(readFileSync(new URL('../../../official-plugins/desensitize/l10n/zh-TW.json', import.meta.url), 'utf8'))
  assert.equal(twWorkbench.railLabelDesensitize, plugin['plugin.name'])
})
