// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D9 / D10: an open chat dropdown (model / mode / skill) used a full-screen transparent mask to
// close itself. The mask swallowed the click that closed it — clicking "Account & balance" in
// Settings "did nothing" — and Esc did not close it. Now a capture-phase listener closes the
// dropdown and lets the click through; Esc and window blur close it too.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')

test('no click-swallowing mask is rendered for the chat dropdowns', () => {
  assert.doesNotMatch(src, /class="dropdown-mask/)
})

test('outside pointerdown, Esc and blur close the dropdowns; clicks inside the dropdown zone do not', () => {
  const start = src.indexOf("    const DROPDOWN_ZONE =")
  const end = src.indexOf('    onBeforeUnmount(detachDropdownListeners)')
  assert.ok(start > 0 && end > start)
  const listeners = { doc: new Map(), win: new Map() }
  const ref = (v) => ({ value: v })
  const state = { showModelDropdown: ref(false), showModeDropdown: ref(false), showSkillDropdown: ref(false) }
  let watcher = null
  const document = {
    addEventListener: (t, fn, cap) => { assert.equal(cap, true, 'capture phase, before any target handler'); listeners.doc.set(t, fn) },
    removeEventListener: (t) => listeners.doc.delete(t),
  }
  const window = { addEventListener: (t, fn) => listeners.win.set(t, fn), removeEventListener: (t) => listeners.win.delete(t) }
  new Function('showModelDropdown', 'showModeDropdown', 'showSkillDropdown', 'watch', 'document', 'window',
    src.slice(start, end))(state.showModelDropdown, state.showModeDropdown, state.showSkillDropdown,
    (getter, cb) => { watcher = { getter, cb } }, document, window)
  const open = () => { state.showModelDropdown.value = true; watcher.cb(watcher.getter()) }
  const el = (inside) => ({ closest: (sel) => (inside && sel.includes('.model-dropdown') ? {} : null) })

  open()
  listeners.doc.get('pointerdown')({ target: el(true) })
  assert.equal(state.showModelDropdown.value, true, 'picking inside the dropdown keeps it open')
  listeners.doc.get('pointerdown')({ target: el(false) })
  assert.equal(state.showModelDropdown.value, false, 'an outside click closes it (and is not cancelled)')

  open()
  listeners.doc.get('keydown')({ key: 'Escape' })
  assert.equal(state.showModelDropdown.value, false, 'Esc closes it')

  open()
  listeners.win.get('blur')()
  assert.equal(state.showModelDropdown.value, false, 'clicking into the editor webview (window blur) closes it')

  watcher.cb(false)
  assert.equal(listeners.doc.size, 0, 'listeners are removed when nothing is open')
})
