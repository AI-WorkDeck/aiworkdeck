// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// office-tier1 O8：自动保存空闲门随上次导出耗时伸缩（2 倍，夹在 1.5–8 秒），小文件不变。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
const start = src.indexOf('function autoSaveIdleMs(')
const fn = new Function(src.slice(start, src.indexOf('\n}\n', start) + 2) + '\nreturn autoSaveIdleMs')()

test('small documents keep the 1.5 s idle window; slow exports widen it, capped at 8 s', () => {
  assert.equal(fn(undefined), 1500)
  assert.equal(fn(20), 1500)
  assert.equal(fn(700), 1500)
  assert.equal(fn(1000), 2000)
  assert.equal(fn(2700), 5400)
  assert.equal(fn(30000), 8000)
})

test('the autosave gate uses the adaptive window, not a fixed 1.5 s', () => {
  assert.match(src, /sinceCmd < idleNeeded/)
  assert.doesNotMatch(src, /sinceCmd < 1500/)
})
