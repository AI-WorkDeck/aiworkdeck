// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D28: zh-TW users saw Simplified labels in the Command Palette and in-app menus, because the
// command table only had {zh, en} and labelOf() returned zh for any zh* language.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { labelOf } from '../../src/config/commands/index.js'

const dir = new URL('../../src/config/commands/', import.meta.url)
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))

test('every label that has a zh text also has a zh-TW text', () => {
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8')
    for (const m of src.matchAll(/\bzh: ([`'])([^`']*)\1(, 'zh-TW')?/g)) {
      assert.ok(m[3], `${f}: "${m[2]}" has no 'zh-TW' label`)
    }
  }
})

test('labelOf: zh-TW / zh-HK get Traditional, zh-CN gets Simplified, others English', () => {
  const item = { label: { zh: '全部项目', 'zh-TW': '全部專案', en: 'All Projects' } }
  assert.equal(labelOf(item, 'zh-TW'), '全部專案')
  assert.equal(labelOf(item, 'zh-HK'), '全部專案')
  assert.equal(labelOf(item, 'zh-CN'), '全部项目')
  assert.equal(labelOf(item, 'ja-JP'), 'All Projects')
  assert.equal(labelOf({ label: { zh: '文件', en: 'File' } }, 'zh-TW'), '文件', 'falls back to zh when a zh-TW text is missing')
})

test('the zh-TW texts contain no common Simplified-only characters', () => {
  const simplifiedOnly = /[这项开关设语务导贴览档话编辑视图帮发简体数据网络录栏线账额签]/
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8')
    for (const m of src.matchAll(/'zh-TW': ([`'])([^`']*)\1/g)) assert.doesNotMatch(m[2], simplifiedOnly, `${f}: ${m[2]}`)
  }
})
