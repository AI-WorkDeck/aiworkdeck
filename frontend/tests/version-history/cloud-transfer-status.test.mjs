// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lane C slow-link run 2026-11-26: a background 交稿 (after ending a work session) and pulls showed no
// progress at all, because the line followed only the 交稿 request. The status bar item follows the
// transfer itself, whoever started it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatTransfer } from '../../src/utils/transferProgress.js'

const source = readFileSync(new URL('../../src/components/collab/CloudTransferStatus.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^import[\s\S]*?from .*$/gm, '').replace('export default', 'return')
const MB = 1024 * 1024

function mount({ answers, projectId = 7 }) {
  const reads = [], delays = [], handlers = {}
  const uni = { $on: (e, f) => { handlers[e] = f }, $off: (e) => { delete handlers[e] } }
  const getCloudTransfer = async (id) => { reads.push(id); const a = answers.length > 1 ? answers.shift() : answers[0]; if (a instanceof Error) throw a; return { data: a } }
  const component = new Function('getCloudTransfer', 'formatTransfer', 'uni', script)(getCloudTransfer, formatTransfer, uni)
  const vm = { ...component.data(), projectId, $t: (k, p) => `${k}:${p.done}/${p.total}` }
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  Object.defineProperty(vm, 'text', { get: component.computed.text.bind(vm) })
  vm.schedule = (ms) => { delays.push(ms) } // record the cadence instead of waiting
  return { vm, component, reads, delays, handlers }
}

test('a running transfer shows in the status bar and is polled every 2 s; idle polls every 15 s', async () => {
  const { vm, delays } = mount({ answers: [{ active: true, direction: 'upload', doneBytes: 6 * MB, totalBytes: 30 * MB }] })
  await vm.poll()
  assert.equal(vm.text, 'version.transferUploading:6.0/30.0')
  assert.equal(delays.at(-1), 2000)
  const idle = mount({ answers: [{ active: false }] })
  await idle.vm.poll()
  assert.equal(idle.vm.text, '')
  assert.equal(idle.delays.at(-1), 15000)
})

test('a background or API-started download shows too (not tied to a request on this page)', async () => {
  const { vm } = mount({ answers: [{ active: true, direction: 'download', doneBytes: 20 * MB, totalBytes: 60 * MB }] })
  await vm.poll()
  assert.equal(vm.text, 'version.transferDownloading:20.0/60.0')
})

test('a 交稿/取回 kick polls fast for a while even before bytes move', async () => {
  const { vm, component, delays, handlers } = mount({ answers: [{ active: false }] })
  component.mounted.call(vm)
  assert.equal(typeof handlers['awd:cloud-transfer-kick'], 'function')
  handlers['awd:cloud-transfer-kick'](7)
  await vm.poll()
  assert.equal(delays.at(-1), 2000, 'fast window after a kick')
  handlers['awd:cloud-transfer-kick'](99)
  vm.fastUntil = 0
  await vm.poll()
  assert.equal(delays.at(-1), 15000, 'a kick for another case does not speed this one up')
  component.beforeUnmount.call(vm)
  assert.equal(handlers['awd:cloud-transfer-kick'], undefined)
})

test('a failed read clears the line, and an answer for a case the page has left is dropped', async () => {
  const { vm } = mount({ answers: [new Error('offline')] })
  vm.progress = { active: true, direction: 'upload', doneBytes: 1, totalBytes: 2 }
  await vm.poll()
  assert.equal(vm.text, '')
  const slow = mount({ answers: [{ active: true, direction: 'upload', doneBytes: MB, totalBytes: 2 * MB }] })
  const pending = slow.vm.poll()
  slow.vm.projectId = 8 // the lawyer switched cases while the read was in flight
  await pending
  assert.equal(slow.vm.text, '')
})

test('the workbench status bar mounts it for linked cases, and every submit/pull kicks it', () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  assert.match(page, /<CloudTransferStatus v-if="collabLinked" :project-id="projectId" \/>/)
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  assert.match(api, /uni\.\$emit\('awd:cloud-transfer-kick', projectId\)/)
  assert.match(source, /const TRANSFER_KICK_EVENT = 'awd:cloud-transfer-kick'/)
})

// C12 nit (lane C r2-01a-30mb-progress.png): during a 交稿 the same 「正在上传大文件 x / y MB」 line showed twice -
// above the guide (the foreground progress line) and in this status-bar cell, with slightly different numbers.
// While a foreground transfer is on screen the cell stands down; it keeps polling and comes back afterwards
// (background 交稿 after ending a session, pulls started elsewhere).
test('the status-bar cell stands down while a foreground transfer line is shown', async () => {
  const { vm, component, handlers } = mount({ answers: [{ active: true, direction: 'upload', doneBytes: 5 * MB, totalBytes: 29 * MB }] })
  component.mounted.call(vm)
  assert.equal(typeof handlers['awd:cloud-transfer-foreground'], 'function')
  handlers['awd:cloud-transfer-foreground']({ projectId: 7, on: true })
  await vm.poll()
  assert.equal(vm.text, '', 'one progress line, not two')
  handlers['awd:cloud-transfer-foreground']({ projectId: 99, on: false })
  assert.equal(vm.text, '', 'another case ending does not bring it back')
  handlers['awd:cloud-transfer-foreground']({ projectId: 7, on: false })
  assert.equal(vm.text, 'version.transferUploading:5.0/29.0', 'back when the foreground transfer ends')
  component.beforeUnmount.call(vm)
  assert.equal(handlers['awd:cloud-transfer-foreground'], undefined)
})
