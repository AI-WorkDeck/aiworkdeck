// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Q28 part 2 / X-S10 §4: in narrow windows the top bar never overlaps (three-part flex row,
// compact steps at 1000 and 880 px) and the rail never shows a half-cut icon (plugins that
// don't fit go into 「更多」). The headless run in the PR measured the real layout; these pin the wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const scss = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.scss', import.meta.url), 'utf8')

function computed(name) {
  const start = page.indexOf('    ' + name + '() {')
  assert.ok(start > 0, name)
  let i = page.indexOf('{', start), depth = 0
  for (; i < page.length; i++) { if (page[i] === '{') depth++; else if (page[i] === '}' && --depth === 0) break }
  return new Function('return {' + page.slice(start, i + 1) + '}')()[name]
}
const shown = computed('railShownPlugins')
const overflow = computed('railOverflowPlugins')
const vm = (fit, editMode = false) => {
  const v = { LEFT_SIDEBAR_PLUGINS: ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => ({ key })), railFitCount: fit, railEditMode: editMode }
  Object.defineProperty(v, 'railShownPlugins', { get: () => shown.call(v) })
  return v
}

test('rail: everything fits → no 更多; too short → last slot becomes 更多 with the rest', () => {
  assert.equal(shown.call(vm(Infinity)).length, 6)
  assert.equal(overflow.call(vm(Infinity)).length, 0)
  const v = vm(4)
  assert.deepEqual(shown.call(v).map((p) => p.key), ['a', 'b', 'c'])
  assert.deepEqual(overflow.call(v).map((p) => p.key), ['d', 'e', 'f'])
  assert.equal(shown.call(vm(6)).length, 6, 'exactly fits: no 更多')
})

test('rail: arranging icons (edit mode) still lists every icon', () => {
  assert.equal(shown.call(vm(3, true)).length, 6)
})

test('top bar: switch is laid out in the row, not positioned over it; compact steps exist', () => {
  assert.match(scss, /\.project-header \.header-center \{\s*position: static;\s*transform: none;\s*flex: 0 0 auto;/)
  assert.match(scss, /\.project-header \.header-left \{\s*flex: 1 1 0;\s*min-width: 120px;/)
  assert.match(scss, /@media \(max-width: 999px\) \{[^}]*awd-lang-current/)
  assert.match(scss, /@media \(max-width: 879px\) \{\s*\.header-tools-optional \{ display: none; \}\s*\.header-more-btn \{ display: flex; \}/)
  assert.match(page, /class="header-tools-optional"/)
  assert.match(page, /class="top-bar-btn header-more-btn"/)
})
