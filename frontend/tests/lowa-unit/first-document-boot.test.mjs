// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const worker = fs.readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const boot = worker.slice(worker.indexOf('function bootDoc('), worker.indexOf('// ---- probe 1:'))
const load = worker.slice(worker.indexOf('  load_document(p) {'), worker.indexOf('  // [Track E] export the current document'))
const exec = worker.slice(worker.indexOf('function execCommand('), worker.indexOf('// ---- message loop'))

function harness(kind = 'writer') {
  const calls = [], messages = []
  let failLoad = false
  const model = { getCurrentController: () => ({}), setPropertyValue() {}, setModified() {}, close() { calls.push('close') } }
  const desktop = { loadComponentFromURL(url) { calls.push(url); return failLoad ? null : model } }
  const state = {
    xModel: null, ctrl: null, context: null, desktop: null, docSeq: 0, humanAuthor: '',
    zetajs: { getUnoComponentContext: () => ({}) },
    css: { frame: { Desktop: { create: () => desktop } },
      ucb: { SimpleFileAccess: { create: () => ({ exists: () => false, writeFile() {} }) } },
      io: { SequenceInputStream: { createStreamFromSequence: () => ({ closeInput() {} }) } } },
    post: (cmd, data) => messages.push({ cmd, ...data }), log() {}, errStr: String,
    HOUSE_DEFAULT_PROFILE: {}, readConfigLocale: () => ({}), IMPORT_FILTERS: {},
    docKindOf: () => state.xModel ? kind : 'unknown', isWriterDoc: () => kind === 'writer',
    installReviewCommentInterceptor() {}, installContextMenuInterceptor() {}, ensureFullScreen() {},
    installKeyHandler() {}, installModifyListener() {}, installSelectionListener() {}, dropAiAnchors() {}, resetRevisionView() {},
    mkProp: (Name, Value) => ({ Name, Value }), CANCELLED: {}, INFLIGHT: {},
    RESOLVE_REVISION_ACTIONS: new Set(), FINAL_TEXT_ACTIONS: new Set(), setRedlineAuthor() {}, AI_AUTHOR: 'QA',
  }
  vm.createContext(state)
  vm.runInContext(boot + '\nconst EXEC = {' + load + ' get_ui_state(){return {success:true}}, set_app_theme(){return {success:true}}, set_host_context_menu(){return {success:true}}, set_style_profile(){return {success:true}}};\n' + exec, state)
  return { state, calls, messages, fail(value) { failLoad = value }, command(action, params) {
    state.execCommand('test', action, params); return messages.at(-1)?.result
  } }
}

test('a cold file starts its desktop without constructing a disposable blank model', () => {
  const h = harness(); h.state.bootDoc(true)
  assert.ok(h.state.desktop)
  assert.equal(h.state.xModel, null)
  assert.deepEqual(h.calls, [])
  assert.equal(h.messages.some(m => m.cmd === 'ui_ready'), false)
  assert.equal(h.command('get_ui_state').code, 'DOCUMENT_NOT_READY')
})

for (const kind of ['writer', 'calc', 'impress']) {
  test(`${kind}: first real model reveals UI, later loads do not repeat boot readiness`, () => {
    const h = harness(kind); h.state.bootDoc(true)
    assert.equal(h.command('load_document', { bytes: [1], name: 'real.docx' }).kind, kind)
    assert.equal(h.calls.some(url => url === 'private:factory/swriter'), false)
    assert.equal(h.messages.filter(m => m.cmd === 'ui_ready').length, 1)
    assert.equal(h.command('get_ui_state').success, true)
    assert.equal(h.command('load_document', { bytes: [1] }).success, true)
    assert.equal(h.messages.filter(m => m.cmd === 'ui_ready').length, 1)
  })
}

test('first-load rejection leaves UI unready and a retry can load the real file', () => {
  const h = harness(); h.state.bootDoc(true); h.fail(true)
  assert.equal(h.command('load_document', { bytes: [1] }).code, 'DOC_REJECTED')
  assert.equal(h.state.xModel, null)
  assert.equal(h.messages.some(m => m.cmd === 'ui_ready'), false)
  assert.equal(h.command('get_ui_state').code, 'DOCUMENT_NOT_READY')
  h.fail(false)
  assert.equal(h.command('load_document', { bytes: [1] }).success, true)
  assert.equal(h.messages.filter(m => m.cmd === 'ui_ready').length, 1)
})

test('a deliberate empty document and a spare retain blank Writer initialization', () => {
  const spare = harness(); spare.state.bootDoc()
  assert.deepEqual(spare.calls, ['private:factory/swriter'])
  assert.equal(spare.messages.filter(m => m.cmd === 'ui_ready').length, 1)
  const h = harness(); h.state.bootDoc(true)
  assert.equal(h.command('load_document', { bytes: [], authorName: '作者' }).empty, true)
  assert.deepEqual(h.calls, ['private:factory/swriter'])
  assert.equal(h.state.humanAuthor, '作者')
  assert.equal(h.command('load_document', { authorName: '新作者' }).success, true)
  assert.equal(h.calls.length, 1, 'author-only update must never replace an existing model')
})

test('author-only updates before first import and after rejection never construct a blank model', () => {
  const h = harness(); h.state.bootDoc(true)
  assert.equal(h.command('load_document', { authorName: 'First author' }).success, true)
  assert.equal(h.state.xModel, null)
  assert.deepEqual(h.calls, [])
  h.fail(true)
  assert.equal(h.command('load_document', { bytes: [1] }).code, 'DOC_REJECTED')
  const attempts = h.calls.length
  assert.equal(h.command('load_document', { authorName: 'Resolved author' }).success, true)
  assert.equal(h.state.xModel, null)
  assert.equal(h.calls.length, attempts)
  assert.equal(h.messages.some(m => m.cmd === 'ui_ready'), false)
})

test('engine-wide configuration is accepted before the first document', () => {
  const h = harness(); h.state.bootDoc(true)
  for (const action of ['set_app_theme', 'set_host_context_menu', 'set_style_profile'])
    assert.equal(h.command(action, {}).success, true, action)
  assert.equal(h.state.xModel, null)
  assert.deepEqual(h.calls, [])
})
