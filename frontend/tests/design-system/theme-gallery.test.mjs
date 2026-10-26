// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
const root = new URL('../../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const ids = ['theme-inkwash-zen', 'theme-anime-twilight', 'theme-aurora-glass']
for (const id of ids) test(`${id}: actual distributed scripts render all 20 locales and reject foreign messages`, () => {
  const base = `official-plugins/${id}/`
  const html = read(base + 'web/index.html')
  const nodes = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => ({ dataset: { i18n: m[1] }, textContent: '' }))
  assert.equal(nodes.length, 9)
  assert.doesNotMatch(html, /<[^>]*>[^<]*[\u4e00-\u9fff]/)
  assert.equal(read(base + 'web/awd-plugin-sdk.js'), read('sdk/plugin-sdk/awd-plugin-sdk.js'))
  assert.equal(read(base + 'web/gallery.js'), read('scripts/theme-gallery-runtime.js'))
  const listeners = [], parent = { postMessage() {} }, attributes = {}, styles = {}
  const document = { documentElement: { setAttribute: (key, value) => { attributes[key] = value }, style: { setProperty: (key, value) => { styles[key] = value } } }, body: { classList: { toggle() {} } }, querySelectorAll: () => nodes }
  const window = { parent, addEventListener: (_, listener) => listeners.push(listener) }
  const context = vm.createContext({ window, document, setTimeout, clearTimeout })
  for (const [, file] of html.matchAll(/<script src="([^"]+)"/g)) vm.runInContext(read(base + 'web/' + file), context)
  const send = (data, source = parent) => listeners.forEach(listener => listener({ source, data }))
  assert.equal(document.documentElement.lang, 'en-US', '0.72 preview explicitly falls back to package default')
  send({ awd: 1, type: 'theme', theme: 'dark' })
  assert.equal(attributes['data-theme'], 'dark')
  assert.equal(document.documentElement.lang, 'en-US')
  const locales = readdirSync(new URL(base + 'l10n/', root)).filter(f => f.endsWith('.json'))
  assert.equal(locales.length, 20)
  for (const file of locales) {
    const language = file.slice(0, -5), words = JSON.parse(read(base + 'l10n/' + file))
    assert.deepEqual(JSON.parse(JSON.stringify(window.AWD_THEME_L10N[language])), words)
    for (const type of ['init', 'theme']) {
      const data = type === 'init' ? { context: { language, theme: 'dark' } } : { language, theme: 'light', tokens: { '--awd-font-sans': 'monospace' } }
      send({ awd: 1, type, ...data })
      assert.equal(document.documentElement.lang, language)
      assert.equal(document.documentElement.dir, language === 'ar-SA' ? 'rtl' : 'ltr')
      for (const node of nodes) assert.equal(node.textContent, words[node.dataset.i18n])
      assert.equal(attributes['data-theme'], type === 'init' ? 'dark' : 'light')
    }
  }
  const previous = nodes.map(n => n.textContent)
  send({ awd: 1, type: 'theme', theme: 'dark', language: 'ar-SA' }, {})
  assert.deepEqual(nodes.map(n => n.textContent), previous)
  assert.equal(attributes['data-theme'], 'light')
  send({ awd: 1, type: 'theme', language: 'unknown' })
  assert.equal(document.documentElement.lang, 'en-US')
})

test('both preview and open plugin panes push current application language through the existing channel', () => {
  for (const [file, method, ref] of [['MarketDetailPane', 'pushThemePreview', 'themePreview'], ['PluginPane', 'pushTheme', 'pluginFrame']]) {
    const source = read(`frontend/src/components/${file}.vue`)
    assert.match(source, /uni\.\$on\(APP_LANGUAGE_EVENT,/)
    assert.match(source, /uni\.\$off\(APP_LANGUAGE_EVENT,/)
    const body = source.match(new RegExp(`${method}\\(\\) \\{([\\s\\S]*?)\\n    \\},`))[1]
    const sent = [], host = { isWebPlugin: true, $refs: { [ref]: { contentWindow: { postMessage: (...args) => sent.push(args) } } } }
    let language = 'zh-CN'
    const push = new Function('getResolvedTheme', 'collectThemeTokens', 'getAppLanguage', 'PROTOCOL', body).bind(host, () => 'dark', () => ({}), () => language, 1)
    push(); language = 'ar-SA'; push()
    assert.deepEqual(sent.map(([message]) => message.language), ['zh-CN', 'ar-SA'])
    assert.ok(sent.every(([message, origin]) => message.type === 'theme' && origin === '*'))
  }
})
