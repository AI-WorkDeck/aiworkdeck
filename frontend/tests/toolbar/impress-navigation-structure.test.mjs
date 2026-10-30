// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const worker = read('../../src/zetaoffice/public/office_thread.js')
const exec = worker.slice(worker.indexOf('function execCommand('), worker.indexOf('// ---- message loop'))
const guest = read('../../src/zetaoffice/editor-main.js')
const relay = guest.slice(guest.indexOf('function relayModified(d) {'), guest.indexOf('// Only real input resets the save idle window'))
const host = read('../../src/components/LibreOfficeEditor.vue')
const subscribe = host.match(/\n    subscribeHostEvents\(transport\) \{\n([\s\S]*?)\n    \},/)[1]
const actions = ['slide_add_page', 'slide_delete_page', 'slide_move_page', 'undo', 'redo']
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness(kind = 'impress', operation = () => ({ success: true })) {
  const messages = [], relayed = []
  let receive
  const editor = { ready: true, docKind: kind, navigationStructureKey: 0,
    $refs: { toolbar: { state: { documentSeq: 7 } } } }
  new Function('transport', subscribe).call(editor, { subscribe(fn) { receive = fn }, send() {} })
  const relayEvent = new Function('hostTransport', `let lastModifiedRelay = 0; ${relay}; return relayModified`)( {
    send(message) { relayed.push(message); receive(message) },
  })
  const state = {
    xModel: {}, docSeq: 7, CANCELLED: {}, INFLIGHT: {},
    EXEC: Object.fromEntries([...actions, 'insert_at_cursor', 'ui_command', 'get_ui_state'].map(action => [action, operation])),
    RESOLVE_REVISION_ACTIONS: new Set(), FINAL_TEXT_ACTIONS: new Set(),
    humanAuthor: 'Test', AI_AUTHOR: 'Test AI', setRedlineAuthor() {}, errStr: String, log() {},
    runAgentCommandInMarginView: (_action, run) => run(),
    isImpressDoc: () => editor.docKind === 'impress',
    post(cmd, payload) { const event = { cmd, ...payload }; messages.push(event); relayEvent(event) },
  }
  vm.createContext(state); vm.runInContext(exec, state)
  return { state, editor, messages, relayed, receive, relayEvent }
}

for (const action of actions) {
  test(`${action} completion reaches navigation through worker, guest relay and host`, () => {
    const h = harness()
    h.state.execCommand('host-command', action, {})
    assert.equal(h.editor.navigationStructureKey, 1)
    assert.deepEqual(h.relayed, [{ __lo: 'lo-relay', type: 'structure-changed', documentSeq: 7 }])
    assert.equal(h.messages.at(-1).result.success, true)
  })
}

test('guest undo/redo completion does not require a host executor wrapper and is not throttled', async () => {
  const flight = deferred(), h = harness('impress', () => flight.promise)
  h.state.execCommand('guest-ime-z', 'undo', {})
  assert.equal(h.editor.navigationStructureKey, 0)
  flight.resolve({ success: true }); await tick()
  assert.equal(h.editor.navigationStructureKey, 1)
  h.state.EXEC.redo = () => ({ success: true })
  h.state.execCommand('guest-ime-y', 'redo', {})
  assert.equal(h.editor.navigationStructureKey, 2)
})

test('text, selection and reads never emit structure events', () => {
  const h = harness()
  for (const action of ['insert_at_cursor', 'ui_command', 'get_ui_state']) h.state.execCommand(action, action, {})
  assert.equal(h.editor.navigationStructureKey, 0)
  assert.equal(h.relayed.length, 0)
})

test('failed, partial and thrown operations do not announce successful structure changes', async () => {
  for (const operation of [() => ({ success: false }), () => ({ success: false, created: true }),
    () => { throw Error('failed') }, () => Promise.reject(Error('async failed'))]) {
    const h = harness('impress', operation)
    h.state.execCommand('failed', 'slide_add_page', {}); await tick()
    assert.equal(h.editor.navigationStructureKey, 0)
    assert.equal(h.relayed.length, 0)
    assert.equal(h.messages.at(-1).result.success, false)
  }
})

test('late completion after worker retarget cannot emit a structure event for the new document', async () => {
  const flight = deferred(), h = harness('impress', () => flight.promise)
  h.state.execCommand('old', 'slide_move_page', {})
  h.state.docSeq = 8; h.editor.$refs.toolbar.state.documentSeq = 8
  flight.resolve({ success: true }); await tick()
  assert.equal(h.messages.some(event => event.cmd === 'structure_changed'), false)
  assert.equal(h.editor.navigationStructureKey, 0)
})

test('Writer and Calc undo keep their existing notification path', () => {
  for (const kind of ['writer', 'calc']) {
    const h = harness(kind)
    h.state.execCommand('undo', 'undo', {})
    assert.equal(h.relayed.length, 0)
    assert.equal(h.editor.navigationStructureKey, 0)
  }
})

test('host rejects stale, missing, unready and non-Impress structure notifications', () => {
  for (const prepare of [h => { h.editor.ready = false }, h => { h.editor.docKind = 'calc' },
    h => { h.editor.$refs.toolbar.state.documentSeq = 8 }, h => { h.editor.$refs.toolbar = null }]) {
    const h = harness(); prepare(h)
    h.relayEvent({ cmd: 'structure_changed', documentSeq: 7 })
    assert.equal(h.editor.navigationStructureKey, 0)
  }
  const h = harness()
  h.relayEvent({ cmd: 'structure_changed' })
  assert.equal(h.editor.navigationStructureKey, 0)
})
