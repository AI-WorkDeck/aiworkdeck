// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function component() {
  const source = process.env.TOOLBAR_SOURCE
    ? readFileSync(process.env.TOOLBAR_SOURCE, 'utf8')
    : readFileSync(new URL('../../src/components/EditorToolbar.vue', import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  const names = [...script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)].flatMap(([, clause]) => {
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1].split(',').map(s => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean) || []
    const main = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim()
    return main ? [...named, main] : named
  })
  const body = script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'return')
  return new Function(...names, body)(...names.map(name => name === 'readViewPrefs' ? () => ({}) : () => {}))
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const state = (address, docKind = 'calc') => ({ success: true, docKind, marker: address, character: {}, paragraph: {}, view: {},
  ...(docKind === 'calc' ? { calc: { address, formula: '=' + address } } : {}) })
function harness(docKind = 'calc') {
  const options = component(), reads = [], events = []
  const executor = { executeCommand(action) {
    if (action !== 'get_ui_state') return Promise.resolve({ success: true })
    const d = deferred(); reads.push(d); return d.promise
  } }
  const vm = { ...options.data(), ...options.methods, docKind, executor, $emit: name => events.push(name) }
  Object.defineProperty(vm, 'isWriter', { get: () => vm.docKind === 'writer' })
  return { options, vm, reads, events }
}

for (const kind of ['writer', 'calc', 'impress']) {
  test(`${kind}: selection bursts share one trailing read and publish the last state`, async () => {
    const { vm, reads } = harness(kind)
    const first = vm.refresh()
    const burst = Array.from({ length: 20 }, () => vm.refresh())
    assert.equal(reads.length, 1, 'selection bursts must not queue twenty worker calls')
    reads[0].resolve(state('A1', kind)); await first; await tick()
    assert.equal(reads.length, 2)
    reads[1].resolve(state('Z9', kind)); await Promise.all(burst)
    assert.equal(vm.state.marker, 'Z9')
    await tick(); assert.equal(reads.length, 2, 'a quiet editor must not keep polling')
  })
}

test('post-mutation callers await a newer read, without waiting for future selection traffic', async () => {
  const { vm, reads } = harness()
  const initial = vm.refresh()
  const mutationReceipt = { success: true, written: 'B2' }
  let mutationDone = false
  const after = vm.after(mutationReceipt).then(result => { mutationDone = true; return result })
  assert.equal(reads.length, 1)
  reads[0].resolve(state('A1')); await initial; await tick()
  assert.equal(mutationDone, false, 'the pre-mutation result is insufficient')
  assert.equal(reads.length, 2)
  const laterSelection = vm.refresh()
  reads[1].resolve(state('B2')); assert.equal(await after, mutationReceipt)
  assert.equal(vm.state.marker, 'B2')
  await tick(); assert.equal(reads.length, 3)
  reads[2].resolve(state('C3')); await laterSelection
  assert.equal(vm.state.marker, 'C3')
})

test('a failed read preserves state and releases the trailing request and later retries', async () => {
  const { vm, reads, events } = harness()
  vm.state = state('kept')
  const first = vm.refresh(), trailing = vm.refresh()
  assert.equal(reads.length, 1)
  reads[0].reject(new Error('worker busy')); await first; await tick()
  assert.equal(vm.state.marker, 'kept')
  assert.equal(reads.length, 2)
  reads[1].resolve({ success: false }); await trailing
  assert.equal(vm.state.marker, 'kept')
  assert.equal(events.filter(e => e === 'ui-state').length, 2)
  const retry = vm.refresh(); reads[2].resolve(state('recovered')); await retry
  assert.equal(vm.state.marker, 'recovered')
})

for (const change of ['executor', 'docKind']) {
  test(`${change} replacement discards the old result and queued requests`, async () => {
    const { vm, reads, events } = harness()
    const old = vm.refresh(), queued = vm.refresh()
    if (change === 'executor') vm.executor = { executeCommand: async () => state('new') }
    else vm.docKind = 'impress'
    const fresh = vm.refresh()
    if (change === 'docKind') reads.at(-1).resolve(state('new', 'impress'))
    await fresh
    reads[0].resolve(state('old'))
    // Old code starts the queued request immediately; settle it so failure is an assertion.
    if (reads.length > (change === 'executor' ? 1 : 2)) reads[1].resolve(state('old-queued'))
    await Promise.all([old, queued]); await tick()
    assert.equal(vm.state.marker, 'new')
    assert.equal(events.filter(e => e === 'ui-state').length, 1)
  })
}

test('bootstrap invalidates reads from the previous document even with the same executor and kind', async () => {
  const { vm, reads } = harness()
  const old = vm.refresh()
  const boot = vm.bootstrap(); await tick()
  const freshRead = reads.at(-1)
  assert.notEqual(freshRead, reads[0])
  freshRead.resolve(state('new-document')); await boot
  reads[0].resolve(state('old-document')); await old
  assert.equal(vm.state.marker, 'new-document')
})

test('bootstrap discards old catalogs and does not continue against a replacement executor', async () => {
  const { vm } = harness('writer')
  const catalogs = deferred(), firstCalls = [], secondCalls = []
  vm.executor = { async executeCommand(action) {
    firstCalls.push(action)
    if (action === 'list_fonts' || action === 'list_styles') return catalogs.promise
    return state('old', 'writer')
  } }
  const first = vm.bootstrap(); await tick()
  vm.executor = { async executeCommand(action) {
    secondCalls.push(action)
    if (action === 'list_fonts') return { families: ['New font'] }
    if (action === 'list_styles') return { styles: [{ name: 'New style' }] }
    return state('new', 'writer')
  } }
  await vm.bootstrap()
  catalogs.resolve({ families: ['Old font'], styles: [{ name: 'Old style' }] }); await first
  assert.deepEqual(vm.fontList, ['New font'])
  assert.deepEqual(vm.styleList, [{ name: 'New style' }])
  assert.equal(vm.state.marker, 'new')
  assert.equal(secondCalls.filter(a => a === 'get_ui_state').length, 1)
})

test('a superseded bootstrap stops after chrome instead of applying preferences to the new document', async () => {
  const { vm } = harness('writer'), chrome = deferred(), calls = []
  vm.executor = { executeCommand: () => chrome.promise }
  const old = vm.bootstrap()
  vm.executor = { async executeCommand(action) { calls.push(action); return state('new', 'writer') } }
  await vm.bootstrap()
  chrome.resolve({ success: true }); await old
  assert.equal(calls.filter(a => a === 'set_view_options').length, 1)
  assert.equal(calls.filter(a => a === 'get_ui_state').length, 1)
})

test('unmount discards in-flight and queued reads without scheduling further work', async () => {
  const { options, vm, reads, events } = harness()
  const originalDocument = globalThis.document, originalWindow = globalThis.window
  globalThis.document = globalThis.window = { removeEventListener() {} }
  try {
    const old = vm.refresh(), queued = vm.refresh()
    options.beforeUnmount.call(vm)
    reads[0].resolve(state('late'))
    if (reads.length > 1) reads[1].resolve(state('late-queued'))
    await Promise.all([old, queued]); await tick()
    assert.equal(vm.state.marker, undefined)
    assert.equal(events.length, 0)
    await vm.refresh()
    assert.equal(reads.length, 1)
  } finally { globalThis.document = originalDocument; globalThis.window = originalWindow }
})

test('focused Calc input is preserved while unfocused state tracks the newest selection', async () => {
  const { vm, reads } = harness()
  vm.calcFormulaFocused = true; vm.calcFormulaInput = '=SUM(A1:A4)'
  const first = vm.refresh(); reads[0].resolve(state('B2')); await first
  assert.equal(vm.calcAddressInput, 'B2')
  assert.equal(vm.calcFormulaInput, '=SUM(A1:A4)')
  vm.calcFormulaFocused = false
  const next = vm.refresh(); reads[1].resolve(state('C3')); await next
  assert.equal(vm.calcFormulaInput, '=C3')
})
