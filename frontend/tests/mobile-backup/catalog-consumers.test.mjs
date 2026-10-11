// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computed, ref } from 'vue'

const catalogSource = readFileSync(new URL('../../src/components/project-list/AccountProjectCatalog.vue', import.meta.url), 'utf8')
const catalogScript = catalogSource.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
function catalogFixture() {
  const imports = [], requests = [], events = []
  const component = new Function('importAccountCatalogFile', 'uni', catalogScript)(
    async body => { imports.push(body); return { fileId: 9 } }, { showToast() {} })
  const vm = { ...component.data(), targetId: '1', selected: { projectUid: 'project', accountScope: 'account' },
    $t: key => key, $emit: (...args) => events.push(args) }
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  vm.request = async (...args) => { requests.push(args); throw Error('Unexpected transfer') }
  return { vm, imports, requests, events }
}
test('desktop catalog folder cannot quote, pull or import even via direct handler invocation', async () => {
  const f = catalogFixture()
  for (const source of ['desktop', 'cloud', 'backup']) {
    await f.vm.download({ id: 'folder', uid: 'folder-uid', source, online: true, isFolder: true })
  }
  assert.deepEqual(f.imports, [])
  assert.deepEqual(f.requests, [])
  assert.deepEqual(f.events, [])
  assert.match(catalogSource, /:disabled="file\.isFolder \|\| importing/)
})
test('desktop backup uses the persistent import path with account and file identity, without charged PULL', async () => {
  const f = catalogFixture()
  await f.vm.download({ id: 'f', uid: 'backup-file', source: 'backup', online: false, name: 'a.pdf' })
  assert.deepEqual(f.imports, [{ accountScope: 'account', targetProjectId: 1, projectUid: 'project', fileUid: 'backup-file' }])
  assert.deepEqual(f.requests, [])
  assert.deepEqual(f.events, [['imported', { fileId: 9 }]])
})
test('desktop live LIST replaces an old backup snapshot consistently with the server source priority', async () => {
  const f = catalogFixture()
  f.vm.request = async method => method === 'GET'
    ? { files: [{ id: 'f', uid: 'file', source: 'backup', online: false }], truncated: false }
    : { id: 2 }
  f.vm.poll = async () => ({ files: [{ id: 'f', uid: 'file', name: 'a.pdf' }], truncated: false })
  await f.vm.openLocations({ projectUid: 'project', accountScope: 'account', locations: [{ kind: 'desktop', deviceId: 'desk', key: '1', online: true }] })
  assert.equal(f.vm.files.length, 1)
  assert.equal(f.vm.files[0].source, 'desktop')
})

const officeSource = readFileSync(new URL('../../../office-addin/taskpane/components/TransferPanel.vue', import.meta.url), 'utf8')
const officeScript = officeSource.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*\n/gm, '')
function officeFixture(files) {
  const calls = { quote: 0, pull: 0 }
  const deps = { ref, computed, onMounted() {}, watch() {}, t: key => key,
    defineProps: () => ({ settings: {}, devices: [{ deviceId: 'desk', online: true, projects: [] }] }), defineEmits() {},
    transferPreset: ref(null), MAX_TRANSFER_BYTES: 200 * 1024 * 1024,
    createList: async () => 1, fetchTransfer: async () => ({ status: 'DONE', files }), pollUntil: async check => check(), newRequestId: () => 'request',
    fetchQuote: async () => { calls.quote++; return { credits: 0 } }, createPull: async () => { calls.pull++; throw Error('Must not pull directory') },
  }
  const panel = new Function('deps', `const { ${Object.keys(deps).join(',')} } = deps;\n${officeScript}\nreturn { fetchList, selectPullFile, loadPullQuote, confirmPull, pullFiles, pullSelectedFile, pullDeviceId, pullProjectKey };`)(deps)
  panel.pullDeviceId.value = 'desk'; panel.pullProjectKey.value = '1'
  return { panel, calls }
}
test('Office LIST excludes folders while retaining old file entries without isFolder', async () => {
  const { panel } = officeFixture([{ id: 'folder', name: 'Empty', isFolder: true, size: 0 }, { id: 'old', name: 'a.docx', size: 10 }, { id: 'new', name: 'b.pdf', isFolder: false, size: 20 }])
  await panel.fetchList()
  assert.deepEqual(panel.pullFiles.value.map(f => f.id), ['old', 'new'])
})
test('Office folder cannot be selected, quoted or pulled even through stale/direct handler state', async () => {
  const { panel, calls } = officeFixture([])
  const folder = { id: 'folder', name: 'Empty', isFolder: true, size: 0 }
  panel.selectPullFile(folder)
  assert.equal(panel.pullSelectedFile.value, null)
  panel.pullSelectedFile.value = folder
  await panel.loadPullQuote()
  await panel.confirmPull()
  assert.deepEqual(calls, { quote: 0, pull: 0 })
})
