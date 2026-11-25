// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH X10：工作台底部状态栏曾整条用等宽字体（看起来像终端）。状态栏用界面无衬线体。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const scss = readFileSync(fileURLToPath(new URL('../../src/pages/project-overview/project-overview.scss', import.meta.url)), 'utf8')

test('workbench status bar uses the UI sans font, not monospace', () => {
  const block = scss.match(/\n\.status-bar\s*\{([^}]*)\}/)
  assert.ok(block, '.status-bar rule not found')
  const family = block[1].match(/font-family:\s*([^;]+);/)
  assert.ok(family, '.status-bar must set font-family')
  assert.match(family[1], /var\(--awd-font-sans\)/)
  assert.doesNotMatch(family[1], /mono/i)
})
