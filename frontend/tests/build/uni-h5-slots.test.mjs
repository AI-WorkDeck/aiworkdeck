// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { patchUniH5Slots } from '../../scripts/patch-uni-h5-slots.mjs'

const require = createRequire(import.meta.url)
const runtimeFile = require.resolve('@dcloudio/uni-h5-vue/dist/vue.runtime.cjs.js')
const runtimeRequire = createRequire(runtimeFile)
const names = ['vue.runtime.esm.js', 'vue.runtime.cjs.js']
const originals = Object.fromEntries(names.map(name => [name,
  fs.readFileSync(path.join(path.dirname(runtimeFile), name), 'utf8')
    .replace('def(children, "_", type, true);', 'def(children, "_", type);')]))

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-slots-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const name of names) fs.writeFileSync(path.join(dir, name), originals[name])
  return dir
}

async function exercise(source) {
  const dom = new JSDOM('<div id="app"></div>')
  const errors = []
  const context = vm.createContext({
    window: dom.window, document: dom.window.document,
    Element: dom.window.Element, SVGElement: dom.window.SVGElement,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    navigator: dom.window.navigator,
    console: { ...console, error: (...messages) => errors.push(messages.map(String).join(' ')) },
    setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'production' } },
  })
  const module = { exports: {} }
  vm.runInContext(`(function(require,module,exports){${source}\n})`, context,
    { filename: runtimeFile })(runtimeRequire, module, module.exports)
  const { createApp, h, ref, nextTick } = module.exports
  const value = ref('first')
  const Child = { setup: (_, { slots }) => () => h('section', slots.default()) }
  const app = createApp({ setup: () => () => {
    const text = value.value
    return h(Child, null, { default: () => h('span', text), _: 2 })
  } })
  app.config.errorHandler = error => errors.push(error.message)
  const text = []
  try {
    app.mount(dom.window.document.getElementById('app'))
    text.push(dom.window.document.querySelector('section')?.textContent)
    for (const next of ['second', 'third']) {
      value.value = next
      await nextTick()
      text.push(dom.window.document.querySelector('section')?.textContent)
    }
    try { app.unmount() } catch (error) { errors.push(error.message) }
    return { errors, text, remaining: dom.window.document.getElementById('app').innerHTML }
  } finally { dom.window.close() }
}

test('real uni runtime reproduces the shared 3.5 slot failure before patching', async t => {
  const shared = runtimeRequire('@vue/shared')
  const probe = { _: 2 }
  shared.def(probe, '_', 2)
  if (Object.getOwnPropertyDescriptor(probe, '_').writable) {
    t.skip('Installed shared uses the old def contract; clean lockfile install is required for the failure baseline')
    return
  }
  const result = await exercise(originals['vue.runtime.cjs.js'])
  assert.ok(result.errors.some(message => /read only property '_'/.test(message)), JSON.stringify(result))
})

test('patched real uni runtime updates dynamic slots repeatedly and unmounts', async t => {
  const dir = fixture(t)
  patchUniH5Slots(dir)
  const result = await exercise(fs.readFileSync(path.join(dir, names[1]), 'utf8'))
  assert.deepEqual(result, { errors: [], text: ['first', 'second', 'third'], remaining: '' })
  const once = names.map(name => fs.readFileSync(path.join(dir, name), 'utf8'))
  patchUniH5Slots(dir)
  assert.deepEqual(names.map(name => fs.readFileSync(path.join(dir, name), 'utf8')), once)
})

for (const invalid of ['missing file', 'missing anchor', 'duplicate anchor']) {
  test(`rejects ${invalid} before modifying either runtime`, t => {
    const dir = fixture(t)
    const cjs = path.join(dir, names[1])
    if (invalid === 'missing file') fs.unlinkSync(cjs)
    else fs.writeFileSync(cjs, invalid === 'missing anchor'
      ? originals[names[1]].replace('shared.def(children, "_", type);', '')
      : originals[names[1]] + '\nshared.def(children, "_", type);')
    const esmBefore = fs.readFileSync(path.join(dir, names[0]), 'utf8')
    assert.throws(() => patchUniH5Slots(dir))
    assert.equal(fs.readFileSync(path.join(dir, names[0]), 'utf8'), esmBefore)
  })
}
