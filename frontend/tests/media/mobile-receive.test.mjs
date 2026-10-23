// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import zh from '../../src/locales/zh-CN/workbench.js'
const source = readFileSync(new URL('../../src/components/MobileReceiveStatus.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
function create(load, onEmit = () => {}) {
  const component = new Function('getMobileReceiveStatus', 'checkMobileReceive', 'setTimeout', 'clearTimeout', script)(load, async () => {}, () => 1, () => {})
  const events = []
  const vm = { ...component.data(), projectId: 42, $emit: (...args) => { events.push(args); onEmit(...args) }, $t: (key, params = {}) => key.split('.').slice(1).reduce((o, k) => o[k], zh).replace(/\{(\w+)\}/g, (_, k) => params[k]) }
  for (const [key, fn] of Object.entries(component.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(component.computed)) Object.defineProperty(vm, key, { get: () => fn.call(vm) })
  return { vm, events }
}
const row = (phase, key = 42, id = 1) => ({ id, phase, fileName: '录音.m4a', project: { key: String(key), name: '同名项目' } })
function workbenchReceiptHandler(refs) {
  const workbench = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const tag = workbench.match(/<MobileReceiveStatus\b[^>]*\/>/)[0]
  const render = new Function('Vue', compile(tag).code)({ ...Vue, resolveComponent: () => 'MobileReceiveStatus' })
  return render({
    isDesktopApp: true, hasNamedProject: true, projectId: 42, $refs: refs,
    onVersionReloadFiles() { assert.fail('Receiving a photo must not reload open documents') },
  }, []).props.onReceived
}
test('saved receipt refreshes the file tree through the actual workbench event binding', async () => {
  let phase = 'receiving', reloads = 0
  const receive = workbenchReceiptHandler({ fileTree: { loadFiles() { reloads++ } } })
  const { vm } = create(async () => ({ active: true, items: [row(phase)] }), event => {
    if (event === 'received') receive()
  })
  await vm.refresh(); assert.equal(reloads, 0)
  phase = 'saved'
  await vm.refresh(); assert.equal(reloads, 1)
  await vm.refresh(); assert.equal(reloads, 1)
})
test('receiving with the file tree unmounted is safe', () => {
  assert.doesNotThrow(() => workbenchReceiptHandler({})())
})
test('only actual saved receipts refresh the matching project, once', async () => {
  let phase = 'receiving'
  const { vm, events } = create(async () => ({ active: true, items: [row(phase), row('saved', 43, 2)] }))
  await vm.refresh(); assert.equal(events.length, 0); assert.equal(vm.summary, '1 件待收取')
  phase = 'savedPendingAck'
  await vm.refresh(); assert.deepEqual(events, [['received']]); assert.equal(vm.summary, '已保存 2 件')
  phase = 'saved'
  await vm.refresh(); assert.equal(events.length, 1)
})
test('failed status and endpoint failures stay visible', async () => {
  const { vm } = create(async () => { throw Error('offline') })
  await vm.refresh(); assert.equal(vm.summary, '需要处理')
  vm.loadError = false; vm.status = { active: true, items: [row('failed')] }
  assert.equal(vm.summary, '需要处理')
})
test('switching projects cannot be overwritten by a late previous response', async () => {
  const pending = []
  const { vm } = create(key => new Promise(resolve => pending.push({ key, resolve })))
  const a = vm.refresh(); vm.projectId = 43; const b = vm.refresh()
  pending[1].resolve({ active: true, project: { key: '43' }, items: [] }); await b
  pending[0].resolve({ active: true, project: { key: '42' }, items: [] }); await a
  assert.equal(vm.status.project.key, '43')
})
test('late responses after component removal do not update state or notify', async () => {
  let finish
  const { vm, events } = create(() => new Promise(resolve => { finish = resolve }))
  const run = vm.refresh(); vm.stopped = true
  finish({ active: true, items: [row('saved')] }); await run
  assert.deepEqual(events, []); assert.equal(vm.status.active, false)
})
