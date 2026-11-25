// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH X19：这些界面在深色模式下曾出现浅底条、深字压深底等问题。规则：整个文件（模板内联 style、
// JS 拼的样式串、<style> 块）不许出现裸颜色；只允许作为 var(--awd-*, 兜底) 的兜底值。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILES = [
  'components/AwdDatePicker.vue',
  'components/PermissionOnboardingModal.vue',
]
const read = (f) => readFileSync(fileURLToPath(new URL('../../src/' + f, import.meta.url)), 'utf8')
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g

function rawColors(src) {
  const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const noFallbacks = code.replace(/var\(--awd-[\w-]+,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*\)/g, '')
  return noFallbacks.match(COLOR) || []
}

for (const f of FILES) {
  test(`${f} uses tokens only (dark-mode safe)`, () => assert.deepEqual(rawColors(read(f)), []))
}

test('file tree recycle-bin bar uses a token background', () => {
  const tree = read('components/FileTree.vue')
  const bar = tree.match(/v-if="viewMode === 'recycle'" class="tree-toolbar" style="([^"]*)"/)
  assert.ok(bar, 'recycle bar not found')
  assert.deepEqual(rawColors(bar[1]), [])
})
