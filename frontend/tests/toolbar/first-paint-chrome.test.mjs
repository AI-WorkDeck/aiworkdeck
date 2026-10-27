// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(process.env.CHROME_EDITOR_SOURCE || new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const names = [...script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)].flatMap(([, clause]) => {
  const named = clause.match(/\{([\s\S]*?)\}/)?.[1].split(',').map(s => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean) || []
  const name = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim()
  return name ? [...named, name] : named
})
const options = new Function(...names, script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'return'))(...names.map(() => () => {}))
const hidden = { success: true, applied: { menubar: false, statusbar: false, toolbars: { standardbar: false }, sheetTabs: false } }
const tick = () => new Promise(resolve => setImmediate(resolve))
function host(kind = 'writer', file = { id: 1 }) {
  const events = [], commands = []
  let answer = async () => hidden
  const vm = { ...options.methods, ready: false, chromeInitialized: false, chromeInitFailed: false,
    file, docKind: kind, docLoadFailed: false, statusKey: 'loadingDoc', $refs: {},
    executor: { executeCommand(action, params) { commands.push({ action, params }); return answer() } },
    async loadDocument() { events.push('loaded') }, $emit(event) { events.push(event) },
    initEvidence() {}, initWritingAssistance() {}, appendLog() {},
  }
  Object.defineProperty(vm, 'loadingOverlayVisible', { get: () => options.computed.loadingOverlayVisible.call(vm) })
  return { vm, commands, events, respond(fn) { answer = fn } }
}
for (const kind of ['writer', 'calc', 'impress']) {
  test(`${kind}: first loaded model stays covered until native hiding is confirmed`, async () => {
    const h = host(kind)
    let release
    h.respond(() => new Promise(resolve => { release = resolve }))
    const opening = h.vm.finishDocLoad()
    await tick()
    assert.equal(h.vm.ready, false)
    assert.equal(h.vm.loadingOverlayVisible, true)
    assert.deepEqual(h.events, ['loaded'])
    assert.equal(h.commands[0]?.action, 'set_chrome')
    assert.equal(h.commands[0].params.toolbars, false)
    assert.equal(h.commands[0].params.sheetTabs, kind === 'calc' ? false : undefined)
    release(hidden)
    await opening
    assert.equal(h.vm.ready, true)
    assert.equal(h.vm.loadingOverlayVisible, false)
    assert.deepEqual(h.events, ['loaded', 'ready'])
  })
}
test('blank spare hides native chrome before readiness; adoption prepares the new layout again', async () => {
  const h = host('writer', null)
  await h.vm.finishDocLoad()
  assert.equal(h.commands.length, 1)
  assert.equal(h.vm.chromeInitialized, true)
  h.vm.file = { id: 2 }
  await h.vm.finishDocLoad()
  assert.equal(h.commands.length, 2)
})
for (const response of [null, { success: false }, { ...hidden, applied: { ...hidden.applied, menubar: true } }]) {
  test(`failed/visible native layout stays covered and retries without reloading: ${JSON.stringify(response)}`, async () => {
    const h = host()
    h.respond(async () => response)
    await h.vm.finishDocLoad()
    assert.equal(h.vm.docLoadFailed, false, 'display failure must not turn a successfully loaded document into a failed load')
    assert.equal(h.vm.loadingOverlayVisible, true)
    assert.equal(h.vm.chromeInitFailed, true)
    h.respond(async () => hidden)
    h.vm.retryLoad()
    await tick()
    assert.equal(h.vm.loadingOverlayVisible, false)
    assert.equal(h.vm.chromeInitFailed, false)
    assert.equal(h.events.filter(e => e === 'loaded').length, 1)
  })
}
test('late hiding receipt from an old document cannot reveal a new guest', async () => {
  const h = host()
  let release
  h.respond(() => new Promise(resolve => { release = resolve }))
  const opening = h.vm.finishDocLoad()
  await tick()
  h.vm._docLoadSeq++
  release(hidden)
  await opening
  assert.equal(h.vm.chromeInitialized, false)
  assert.equal(h.vm.ready, false)
})
test('an existing toolbar retains the user native-menu escape state on reload', async () => {
  const h = host()
  h.vm.chromeInitialized = true
  h.vm.$refs.toolbar = { async reapplyChrome() { h.events.push('user-chrome') } }
  h.vm.loadDocument = async () => { await h.vm.rehideChromeAfterRetarget(); h.events.push('loaded') }
  await h.vm.finishDocLoad()
  assert.equal(h.commands.length, 0)
  assert.deepEqual(h.events, ['user-chrome', 'loaded', 'ready'])
})
test('loading hides the guest compositing layer without removing its layout', () => {
  assert.match(source, /class="libre-host" :class="\{ 'libre-host-loading': loadingOverlayVisible \}"/)
  assert.match(source, /\.libre-host-loading\s*\{\s*opacity:\s*0;\s*pointer-events:\s*none;/)
})
