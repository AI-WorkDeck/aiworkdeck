// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test'), assert = require('node:assert/strict')
const { JSDOM } = require('../../frontend/node_modules/jsdom')
const tick = () => new Promise(resolve => setTimeout(resolve, 0)), refresh = () => new Promise(resolve => setTimeout(resolve, 100))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function fixture(t) {
  const { attachNativeDocumentRulers } = await import('../../frontend/src/composables/nativeDocumentRulers.js')
  const dom = new JSDOM('<main><div id="x"></div><div id="y"></div><input></main>', { pretendToBeVisual: true })
  const doc = dom.window.document, element = doc.querySelector('main'), horizontal = doc.querySelector('#x'), vertical = doc.querySelector('#y'), calls = []
  let state = { success: true, available: true, pageIndex: 0, pageWidth: 10000, pageHeight: 14000, leftMargin: 1000, rightMargin: 1000, topMargin: 1000, bottomMargin: 1000, leftIndent: 100, rightIndent: 100, firstLineIndent: 200 }
  let writable = true, token = 0, gate, fail = false, composing = false
  const model = { view: { ruler: true, verticalRuler: true }, layout: { pages: [{ x: 200, y: 200 }] } }
  const ruler = attachNativeDocumentRulers({ element, horizontal, vertical, input: { element: doc.querySelector('input'), flush: async () => {}, getState: () => ({ composing }) },
    model: () => model, viewport: () => ({ xTwips: 0, yTwips: 0, scale: 0.1, width: 1100, height: 1500 }), canWrite: () => writable,
    execute: async (action, params) => { calls.push({ action, params }); if (action === 'get_ruler_state') { if (gate) await gate.promise; return { ...state, contextToken: 'fresh-' + ++token } }; if (fail) throw Error('STALE_RULER_CONTEXT'); Object.assign(state, params.patch); return { ...state, contextToken: 'do-not-reuse-this-result' } } })
  t.after(() => { ruler.destroy(); dom.window.close() })
  const pointer = (type, node = dom.window, values = {}) => node.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 120, clientY: 120, ...values }))
  return { ruler, dom, element, calls, model, pointer, handle: key => element.querySelector(`[data-ruler-handle="${key}"]`),
    hold: () => (gate = deferred()), unavailable: () => { state.available = false }, reject: () => { fail = true },
    readonly: () => { writable = false; ruler.invalidate() }, composing: () => { composing = true },
    async load() { ruler.refresh(); await refresh() } }
}
test('rulers display seven real handles; dragging writes only at release with a fresh one-use context', async t => {
  const f = await fixture(t); await f.load()
  assert.equal(f.element.querySelectorAll('[data-ruler-handle]').length, 7)
  assert.equal(f.handle('leftMargin').style.left, '116px')
  f.pointer('pointerdown', f.handle('leftMargin')); await tick()
  f.pointer('pointermove', f.dom.window, { clientX: 140 }); f.pointer('pointermove', f.dom.window, { clientX: 150 })
  assert.equal(f.calls.filter(call => call.action === 'set_ruler_state').length, 0)
  f.pointer('pointerup', f.dom.window, { clientX: 150 }); await tick()
  assert.deepEqual(f.calls.find(call => call.action === 'set_ruler_state').params, { contextToken: 'fresh-2', patch: { leftMargin: 1300 } })
  await refresh(); f.pointer('pointerdown', f.handle('rightIndent')); await tick(); f.pointer('pointerup', f.dom.window, { clientX: 110 }); await tick()
  const writes = f.calls.filter(call => call.action === 'set_ruler_state')
  assert.deepEqual(writes[1].params.patch, { rightIndent: 200 })
  assert.equal(writes[1].params.contextToken, 'fresh-4', 'never reuse the token returned by a mutation')
})
test('Escape, focus loss, permission revocation, and release before read completion never write', async t => {
  const f = await fixture(t); await f.load()
  f.pointer('pointerdown', f.handle('leftIndent')); await tick(); f.pointer('pointermove', f.dom.window, { clientX: 200 })
  f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); f.pointer('pointerup', f.dom.window, { clientX: 200 }); await refresh()
  f.pointer('pointerdown', f.handle('firstLineIndent')); await tick(); f.dom.window.dispatchEvent(new f.dom.window.Event('blur')); f.pointer('pointerup', f.dom.window, { clientX: 200 }); await refresh()
  const held = f.hold(); f.pointer('pointerdown', f.handle('leftMargin')); f.pointer('pointerup', f.dom.window, { clientX: 200 }); held.resolve(); await refresh()
  f.pointer('pointerdown', f.handle('leftMargin')); await tick(); f.readonly(); f.pointer('pointerup', f.dom.window, { clientX: 200 }); await tick()
  assert.equal(f.calls.filter(call => call.action === 'set_ruler_state').length, 0)
  assert.equal(f.element.querySelectorAll('[data-ruler-handle]').length, 0)
})
test('mixed or hidden rulers have no editable handles; an engine refusal is visible and recoverable', async t => {
  const f = await fixture(t); f.model.view = { ruler: false, verticalRuler: false }; await f.load(); assert.equal(f.calls.length, 0)
  f.model.view = { ruler: true, verticalRuler: true }; await f.load()
  f.reject(); f.pointer('pointerdown', f.handle('bottomMargin')); await tick(); f.pointer('pointerup', f.dom.window, { clientY: 100 }); await tick()
  assert.equal(f.element.querySelector('[data-native-ruler-notice]').hidden, false)
  f.unavailable(); await f.load(); assert.equal(f.element.querySelectorAll('[data-ruler-handle]').length, 0)
})
test('keyboard adjustments use the real field and IME ownership blocks ruler mutations', async t => {
  const f = await fixture(t); await f.load()
  f.handle('topMargin').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await tick()
  assert.deepEqual(f.calls.find(call => call.action === 'set_ruler_state').params.patch, { topMargin: 1057 })
  await refresh(); f.composing(); f.pointer('pointerdown', f.handle('leftMargin')); f.pointer('pointerup', f.dom.window, { clientX: 200 }); await tick()
  assert.equal(f.calls.filter(call => call.action === 'set_ruler_state').length, 1)
  f.ruler.destroy(); assert.equal(f.element.querySelectorAll('[data-ruler-handle]').length, 0)
})
