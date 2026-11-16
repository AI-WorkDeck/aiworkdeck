// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
const dom = new JSDOM('<body></body>')
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key]
const Vue = await import('vue')
const source = readFileSync(new URL('../../src/components/project-home/ScratchTransferDialog.vue', import.meta.url), 'utf8')
function component(source, bindings) {
  const { descriptor } = parse(source)
  const script = descriptor.script.content.replace(/import[^\n]+\n/g, '').replace('export default', 'return')
  const result = new Function(...Object.keys(bindings), script)(...Object.values(bindings))
  result.render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)(Vue)
  return result
}
const AwdSelect = component(readFileSync(new URL('../../src/components/AwdSelect.vue', import.meta.url), 'utf8'), {})
const projects = [{ id: 1, projectType: 'SCRATCH', myRole: 'OWNER', name: 'Scratch' }, { id: 2, projectType: 'BLANK', myRole: 'OWNER', name: 'Destination' }, { id: 3, projectType: 'BLANK', myRole: 'MEMBER', name: 'Other' }]
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick() }
async function mount(copy, beforeCopy = async () => {}, options = {}) {
  const root = document.createElement('div'); document.body.append(root)
  const events = []
  const Component = component(source, { AwdSelect, getMyProjects: async () => projects, copyScratchToProject: copy })
  const app = Vue.createApp(Component, { sourceProjectId: '1', files: [{ id: 92420, name: 'Document.docx' }], conversations: [{ id: 'conv-internal', title: 'Conversation' }], beforeCopy, onCopied: result => events.push(result), ...options })
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = () => {}
  const vm = app.mount(root); await settle()
  return { root, vm, events, close: () => { app.unmount(); root.remove() } }
}
async function choose(root) {
  root.querySelector('.awd-select-trigger').dispatchEvent(new window.Event('tap', { bubbles: true })); await Vue.nextTick()
  root.querySelectorAll('.awd-select-item')[1].dispatchEvent(new window.Event('tap', { bubbles: true })); await Vue.nextTick()
  root.querySelector('input[type="checkbox"]').click(); await Vue.nextTick()
}
test('real picker and checkbox enable confirmation and submit only selected content', async () => {
  let received, saved = false
  const view = await mount(async data => { assert.equal(saved, true); received = data; return { data: { sourcePreserved: true } } }, async () => { saved = true })
  try {
    assert.deepEqual(view.vm.projects.map(p => p.id), [2])
    assert.equal(view.root.querySelector('.scratch-copy-submit').disabled, true)
    await choose(view.root)
    assert.equal(view.root.querySelector('.scratch-copy-submit').disabled, false)
    assert.equal(view.root.querySelectorAll('input:not([type="checkbox"])').length, 0)
    assert.doesNotMatch(view.root.textContent, /92420|conv-internal/)
    view.root.querySelector('.scratch-copy-submit').click(); await settle()
    assert.deepEqual(JSON.parse(JSON.stringify(received)), { sourceProjectId: 1, targetProjectId: 2, selectedFileIds: [92420], conversationIds: [] })
    assert.equal(view.events[0].sourcePreserved, true)
  } finally { view.close() }
})
test('failed copy retains selection and error; retry succeeds without duplicate concurrent submits', async () => {
  let calls = 0, finish
  const view = await mount(() => { calls++; if (calls === 1) throw new Error('quota'); return new Promise(resolve => { finish = resolve }) })
  try {
    await choose(view.root); await view.vm.copy()
    assert.equal(view.vm.error, 'quota'); assert.equal(view.vm.busy, false)
    assert.deepEqual([...view.vm.fileIds], [92420]); assert.equal(view.vm.target, '2')
    const retry = view.vm.copy(); await settle(); await view.vm.copy()
    assert.equal(calls, 2); assert.equal(view.root.querySelector('.scratch-copy-submit').disabled, true)
    finish({ data: { sourcePreserved: true } }); await retry
    assert.equal(view.events.length, 1)
  } finally { view.close() }
})
test('failed editor save prevents copying stale bytes and preserves selection', async () => {
  const view = await mount(() => assert.fail('must not copy'), async () => { throw new Error('save failed') })
  try { await choose(view.root); await view.vm.copy(); assert.equal(view.vm.error, 'save failed'); assert.deepEqual([...view.vm.fileIds], [92420]); assert.equal(view.events.length, 0) } finally { view.close() }
})
test('select all and clear update both groups; invalid target never submits', async () => {
  const view = await mount(() => assert.fail('must not copy without a destination'))
  try {
    view.root.querySelector('.scratch-copy-select-all').click(); await Vue.nextTick()
    assert.deepEqual([...view.vm.fileIds], [92420]); assert.deepEqual([...view.vm.conversationIds], ['conv-internal'])
    await view.vm.copy(); assert.equal(view.vm.busy, false)
    view.root.querySelector('.scratch-copy-select-all').click(); await Vue.nextTick()
    assert.equal(view.vm.fileIds.length + view.vm.conversationIds.length, 0)
  } finally { view.close() }
})
test('checkboxes and buttons bypass uni tag rewriting that rendered IDs as text inputs', () => {
  assert.doesNotMatch(source, /<input\b[^>]*type="checkbox"/)
  assert.doesNotMatch(source, /<button\b/)
  assert.match(source, /:is="'input'" type="checkbox" class="scratch-copy-checkbox" :checked=/)
})
