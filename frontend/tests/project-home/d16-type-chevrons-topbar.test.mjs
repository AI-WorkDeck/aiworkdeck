// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D16 (lane X spec): serif only for the brand wordmark / welcome hero; one chevron for every
// dropdown trigger; top-bar icon buttons have a localized tooltip + aria-label with the shortcut,
// a divider between layout toggles and tools, and a browser icon that isn't a second globe.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { accelHint } from '../../src/config/commands/index.js'

const read = (p) => fs.readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')
const PO = read('pages/project-overview/project-overview.vue')
const SCSS = read('pages/project-overview/project-overview.scss')

test('UI text is sans: project name / All Projects, chat greeting, dialog titles', () => {
  const rule = (src, sel) => src.slice(src.indexOf(sel + ' {'), src.indexOf('}', src.indexOf(sel + ' {')))
  assert.match(rule(SCSS, '.project-name'), /font-family: var\(--awd-font-sans\)/)
  assert.match(rule(read('components/ChatInterface.vue'), '.welcome-text'), /font-family: var\(--awd-font-sans\)/)
  assert.doesNotMatch(read('components/AwdDialog.vue'), /awd-dlg__title \{[^}]*--awd-font-serif/)
})

test('dropdown triggers use the chevron, not ▼ / ▾ glyphs', () => {
  for (const p of ['components/ChatInterface.vue', 'components/AwdSelect.vue', 'components/welcome/WelcomePane.vue',
    'pages/project-overview/project-overview.vue', 'components/dd/DdClientWorkspace.vue', 'components/dd/DdClientChecklist.vue']) {
    const tpl = read(p).split('<script')[0]
    assert.doesNotMatch(tpl, /class="(dropdown-arrow|awd-select-caret|switcher-arrow|select-chevron)"[^>]*>[▼▾]/, p)
    assert.doesNotMatch(tpl, /<text aria-hidden="true">▾<\/text>/, p)
  }
})

test('every top-bar icon button has a tooltip and aria-label with its shortcut', () => {
  const bar = PO.slice(PO.indexOf('<view class="header-tools" v-if="!isClientView">'), PO.indexOf('<view v-else>', PO.indexOf('<view class="header-tools" v-if="!isClientView">')))
  const tips = [...bar.matchAll(/:title="topBarTip\((.+?), '([\w.]+)'\)" :aria-label="topBarTip\((.+?), '([\w.]+)'\)" role="button"/g)]
  assert.equal(tips.length, 7)
  for (const m of tips) { assert.equal(m[1], m[3]); assert.equal(m[2], m[4]) }
  assert.match(bar, /<view class="top-bar-divider" aria-hidden="true"><\/view>/)
  assert.match(bar, /GLYPHS\.browserWindow/)
  assert.doesNotMatch(bar, /GLYPHS\.web"/)
})

test('accelHint: Mac symbols on macOS, Ctrl+Alt+… elsewhere, empty without a shortcut', () => {
  assert.equal(accelHint('view.sidebar', true), '⌥⌘B')
  assert.equal(accelHint('view.sidebar', false), 'Ctrl+Alt+B')
  assert.equal(accelHint('tools.newBrowserTab', true), '')
  assert.equal(accelHint('no.such.command', false), '')
})
