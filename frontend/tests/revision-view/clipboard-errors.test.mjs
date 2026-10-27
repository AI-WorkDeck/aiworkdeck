// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { attachImeOverlay } from '../../src/composables/zetaOfficeImeOverlay.js'

function setup(t, response) {
  const dom = new JSDOM('<div><canvas></canvas></div>', { pretendToBeVisual: true })
  const globals = ['document', 'navigator', 'getComputedStyle']
  const saved = globals.map(k => Object.getOwnPropertyDescriptor(globalThis, k))
  const calls = [], errors = [], copied = []
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { readText: async () => 'paste', writeText: async text => copied.push(text) } })
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, value: dom.window[k] })
  const overlay = attachImeOverlay({ canvas: document.querySelector('canvas'), commit: () => response,
    sendCommand: async action => { calls.push(action); return response }, onError: message => errors.push(message) })
  t.after(() => { overlay.destroy(); dom.window.close(); globals.forEach((k, i) => saved[i] ? Object.defineProperty(globalThis, k, saved[i]) : delete globalThis[k]) })
  return { calls, errors, copied, async key(key) {
    overlay.element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
    await new Promise(resolve => setImmediate(resolve))
  } }
}
for (const response of [{ success: false, message: 'range too large' }, { success: true, text: 'partial', truncated: true }]) {
  test('failed or partial copy must not write clipboard or delete source: ' + JSON.stringify(response), async t => {
    const f = setup(t, response); await f.key('x')
    assert.deepEqual(f.calls, ['get_selection']); assert.deepEqual(f.copied, [])
    assert.equal(f.errors.length, 1)
  })
}
test('paste rejection is visible to the host', async t => {
  const f = setup(t, { success: false, message: '500 rows maximum' }); await f.key('v')
  assert.deepEqual(f.calls, ['replace_selection']); assert.deepEqual(f.errors, ['500 rows maximum'])
})
test('successful copy retains all returned text', async t => {
  const text = Array.from({ length: 101 }, (_, i) => i).join('\n')
  const f = setup(t, { success: true, text }); await f.key('c')
  assert.deepEqual(f.copied, [text]); assert.deepEqual(f.errors, [])
})
