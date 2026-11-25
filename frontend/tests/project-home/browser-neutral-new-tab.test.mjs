// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D25: "+" (and any default browser tab) opened https://www.baidu.com — in every locale, a third
// party chosen for the user. A new tab is now the app's own neutral start page.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const pane = fs.readFileSync(new URL('../../src/components/BrowserPane.vue', import.meta.url), 'utf8')

test('no third-party site is opened by default', () => {
  assert.doesNotMatch(page, /openBrowserTab\('https?:\/\//, 'no hard-coded site in openBrowserTab calls')
  assert.match(page, /openBrowserTab\(url = '', pane = null\)/)
  assert.doesNotMatch(page + pane, /baidu\.com/)
})

test('a blank tab shows the start page, and the native view stays out of the way until navigation', () => {
  assert.match(pane, /showStartPage\(\) \{\s*return this\.currentUrl === 'about:blank' && !this\.loadError && !this\.desktopCreateError/)
  assert.match(pane, /<view v-if="showStartPage" class="browser-start-page">/)
  assert.match(pane, /const bounds = this\.loadError \|\| this\.showStartPage\s*\n\s*\? \{ x: rect\.left, y: rect\.top, width: 0, height: 0 \}/)
  assert.match(pane, /if \(next !== 'about:blank'\) this\.\$nextTick\(\(\) => this\.syncDesktopBounds\(\)\)/)
  assert.match(pane, /:focus="showStartPage"/, 'the address bar is ready for typing')
  assert.match(page, /if \(!url \|\| String\(url\)\.startsWith\('about:'\)\) \{\s*tab\.name = this\.\$t\('panels\.bpNewTabTitle'\)/, 'the tab is named "New tab", not about:blank')
  assert.match(page, /if \(t\.startsWith\('about:'\) \|\| !active\.url \|\| String\(active\.url\)\.startsWith\('about:'\)\) return/, 'the blank page title does not rename it')
})
