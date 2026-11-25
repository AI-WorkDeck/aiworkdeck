// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { noFrameworkEgress, stripFrameworkEgress } from '../../scripts/no-framework-egress.mjs'

// The exact rule uni-h5-vite appends to framework/shadow.css (see its plugins/css.js).
const uniShadow = `body::after{position:fixed;content:'';left:-1000px;top:-1000px;animation:shadow-preload .1s;animation-delay:3s}
@keyframes shadow-preload { 0% { background-image: url(https://cdn.dcloud.net.cn/img/shadow-grey.png); } 100% { background-image: url("https://cdn.dcloud.net.cn/img/shadow-grey.png"); } }`

test('the DCloud shadow-preload image is never requested', () => {
  const out = stripFrameworkEgress(uniShadow)
  assert.doesNotMatch(out, /dcloud\.net\.cn/)
  assert.match(out, /background-image: none;/)
})

test('the plugin rewrites emitted CSS assets only', () => {
  const plugin = noFrameworkEgress()
  const bundle = {
    'assets/index.css': { type: 'asset', fileName: 'assets/index.css', source: uniShadow },
    'assets/other.css': { type: 'asset', fileName: 'assets/other.css', source: Buffer.from('a{background:url(/static/a.png)}') },
    'assets/index.js': { type: 'chunk', fileName: 'assets/index.js', code: 'const u = "https://cdn.dcloud.net.cn/x.png"' },
  }
  plugin.generateBundle({}, bundle)
  assert.doesNotMatch(bundle['assets/index.css'].source, /dcloud/)
  assert.equal(Buffer.from(bundle['assets/other.css'].source).toString(), 'a{background:url(/static/a.png)}')
  assert.match(bundle['assets/index.js'].code, /dcloud/, 'JS is not touched')
})

test('uni-h5-vite still injects the rule we strip (fails if the upstream hook moves)', () => {
  const src = fs.readFileSync(new URL('../../node_modules/@dcloudio/uni-h5-vite/dist/plugins/css.js', import.meta.url), 'utf8')
  assert.match(src, /shadow-preload/)
  assert.match(src, /createShadowImageUrl/)
})
