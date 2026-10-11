// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/project-list/AccountProjectCatalog.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
const component = new Function('requestAccountCatalog', script)(() => {})
function fixture(request) {
  const events = []
  const vm = { ...component.data(), $t: k => k, $emit: (...args) => events.push(args) }
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  vm.request = request
  return { vm, events }
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
test('local project enters immediately without waiting for the cloud, even when marked unavailable', async () => {
  const { vm, events } = fixture(() => { throw new Error('must not request cloud') })
  await vm.open({ projectUid: 'a', localProjectId: 12, locations: [{ online: false }] })
  assert.deepEqual(events, [['open-project', 12]])
  assert.equal(vm.listing, false)
})
test('same name is not proof a remote project exists on this computer', async () => {
  let requests = 0
  const { vm, events } = fixture(async () => { requests++; return { files: [] } })
  vm.localProjects = [{ id: 12, name: '合同审查' }]
  await vm.open({ projectUid: 'remote', name: '合同审查', locations: [] })
  assert.equal(requests, 1)
  assert.deepEqual(events, [])
})
test('switching projects ignores a late file list and preserves the new list', async () => {
  const first = deferred()
  const { vm } = fixture(async (_, path) => path.includes('/first/') ? first.promise : { files: [{ uid: 'new-file' }] })
  const old = vm.open({ projectUid: 'first', accountScope: 'scope-a' })
  await vm.open({ projectUid: 'second', accountScope: 'scope-b' })
  first.resolve({ files: [{ uid: 'old-file' }] }); await old
  assert.equal(vm.selected.projectUid, 'second')
  assert.deepEqual(vm.files.map(f => f.uid), ['new-file'])
  assert.equal(vm.listing, false)
})
test('closing a pending list stops polling and cannot repopulate the closed panel', async () => {
  const first = deferred()
  const { vm } = fixture(() => first.promise)
  const pending = vm.open({ projectUid: 'first' })
  vm.close(); first.resolve({ files: [{ uid: 'old-file' }] }); await pending
  assert.equal(vm.selected, null); assert.deepEqual(vm.files, []); assert.equal(vm.listing, false)
})
test('a cloud file is available while a remote device is still responding', async () => {
  const response = deferred()
  const { vm } = fixture(async method => method === 'GET' ? { files: [{ uid: 'cloud-file', source: 'cloud' }] } : { id: 'list-id' })
  vm.poll = () => response.promise
  const pending = vm.open({ projectUid: 'remote', locations: [{ kind: 'desktop', online: true, deviceId: 'device', key: '1' }] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(vm.listing, true); assert.equal(vm.files[0].uid, 'cloud-file')
  vm.close(); response.resolve({ files: [{ uid: 'stale' }] }); await pending
  assert.deepEqual(vm.files, [])
})
test('a local entry can be opened while an unrelated remote request is waiting', async () => {
  const response = deferred()
  const { vm, events } = fixture(() => response.promise)
  const pending = vm.open({ projectUid: 'remote' })
  await vm.open({ projectUid: 'local', localProjectId: 19 })
  assert.deepEqual(events, [['open-project', 19]])
  response.resolve({ files: [{ uid: 'stale' }] }); await pending
  assert.equal(vm.selected, null)
})
const paneSource = readFileSync(new URL('../../src/components/project-list/ProjectListPane.vue', import.meta.url), 'utf8')
const navigateBody = paneSource.match(/goToProject\(projectId\) \{([\s\S]*?)\n    \},/)[1]
const goToProject = new Function('uni', `return function(projectId) {${navigateBody}}`)({ reLaunch() { throw new Error('bypassed editor save barrier') } })
test('catalog entry navigates through the editor save barrier and explicitly opens files', () => {
  const calls = []
  goToProject.call({ currentProjectId: null, leaveWorkbench: url => calls.push(url) }, 12)
  assert.deepEqual(calls, ['/pages/project-overview/project-overview?id=12&pane=files'])
})
test('clicking the current project shows its files without destroying editors', () => {
  const events = []
  goToProject.call({ currentProjectId: 12, $emit: (...args) => events.push(args), leaveWorkbench() { throw new Error('should keep editors mounted') } }, '12')
  assert.deepEqual(events, [['activate-current-project']])
})

test('other locations opens cloud attachments for a local project without navigating away', async () => {
  const { vm, events } = fixture(async () => ({ files: [{ uid: 'plugin-attachment', source: 'cloud' }] }))
  const project = { projectUid: 'local', localProjectId: 12, accountScope: 'account', locations: [{ kind: 'desktop', online: false }, { kind: 'cloud' }] }
  await vm.openLocations(project)
  assert.deepEqual(events, [])
  assert.equal(vm.selected.projectUid, 'local')
  assert.equal(vm.files[0].uid, 'plugin-attachment')
  await vm.open(project)
  assert.deepEqual(events, [['open-project', 12]])
})
