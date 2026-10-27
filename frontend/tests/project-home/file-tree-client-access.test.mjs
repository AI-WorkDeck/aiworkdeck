// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import zh from '../../src/locales/zh-CN/fileTree.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
function setup(overrides = {}) {
  const calls = { reads: [], writes: [], dialogs: [], errors: [], reloads: 0, toasts: [] }
  const stubs = {
    getProjectFileAccess: async (...args) => { calls.reads.push(args); return overrides.read ? overrides.read(...args) : { clientVisible: false, canManageAccess: true } },
    updateProjectFileAccess: async (...args) => { calls.writes.push(args); return overrides.write ? overrides.write(...args) : { clientVisible: args[2] } },
    showDialog: async (options) => { calls.dialogs.push(options); return overrides.dialog ? overrides.dialog(options) : { confirm: true } },
    ICONS: {}, host: {}
  }
  const names = []
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]\s*$/gm, (_, binding) => {
      for (const name of binding.replace(/[{}]/g, '').split(',')) names.push(name.trim().split(/\s+as\s+/).at(-1))
      return ''
    }).replace('export default {', 'return {')
  const options = new Function(...names, script)(...names.map((name) => stubs[name] ?? (() => {})))
  const vm = { ...options.data(), projectId: 1, $t: (key, params = {}) => Object.entries(params).reduce((s, [k, v]) => s.replaceAll('{' + k + '}', v), zh[key.replace('fileTree.', '')] || key) }
  for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
  vm.loadFiles = async () => { calls.reloads++ }
  vm.closeContextMenu = () => {}
  vm.showErrorModal = (message) => calls.errors.push(message)
  globalThis.uni = { showToast: (o) => calls.toasts.push(o) }
  return { vm, calls, options }
}
const item = () => ({ id: 7, name: '合成合同.docx', isFolder: false })
test('reads current ACL before offering an explicit change, persists boolean and refreshes tree', async () => {
  const { vm, calls } = setup(); const file = item()
  await vm.handleFileClientAccess(file)
  assert.deepEqual(calls.reads, [[1, 7]])
  assert.match(calls.dialogs[0].content, /默认仅内部.*逐个开放/s)
  assert.match(calls.dialogs[0].content, /客户本人上传.*自行读取/)
  assert.equal(calls.dialogs[0].confirmText, '向客户开放')
  assert.deepEqual(calls.writes, [[1, 7, true]])
  assert.equal(file.clientVisible, true); assert.equal(calls.reloads, 1); assert.equal(vm.fileAccessBusy, false)
})
test('revoke explains saved copies and cancelled confirmation never changes ACL', async () => {
  const { vm, calls } = setup({ read: async () => ({ clientVisible: true, canManageAccess: true }), dialog: async () => ({ confirm: false }) })
  await vm.handleFileClientAccess(item())
  assert.equal(calls.dialogs[0].confirmText, '设为内部'); assert.match(calls.dialogs[0].content, /副本无法收回/)
  assert.equal(calls.writes.length, 0)
})
test('missing or false canManageAccess shows read-only explanation and never saves', async () => {
  for (const canManageAccess of [undefined, false]) {
    const { vm, calls } = setup({ read: async () => ({ clientVisible: false, canManageAccess }) })
    await vm.handleFileClientAccess(item())
    assert.equal(calls.dialogs[0].showCancel, false); assert.equal(calls.dialogs[0].confirmText, '知道了')
    assert.match(calls.dialogs[0].content, /不能修改/); assert.equal(calls.writes.length, 0)
  }
})
test('late read after project switch never opens a dialog', async () => {
  let release; const { vm, calls } = setup({ read: () => new Promise((r) => { release = r }) })
  const operation = vm.handleFileClientAccess(item()); vm.projectId = 2; release({ clientVisible: false, canManageAccess: true }); await operation
  assert.equal(calls.dialogs.length, 0); assert.equal(calls.writes.length, 0)
})
test('project switch during confirmation invalidates permission change', async () => {
  let release; const { vm, calls } = setup({ dialog: () => new Promise((r) => { release = r }) })
  const operation = vm.handleFileClientAccess(item()); await new Promise((r) => setImmediate(r)); vm.projectId = 2; release({ confirm: true }); await operation
  assert.equal(calls.writes.length, 0)
})
test('server denial leaves file unchanged, reports error and permits retry', async () => {
  const { vm, calls } = setup({ write: async () => { throw Error('没有修改权限') } }); const file = item()
  await vm.handleFileClientAccess(file)
  assert.equal(file.clientVisible, undefined); assert.deepEqual(calls.errors, ['没有修改权限']); assert.equal(calls.toasts.length, 0); assert.equal(vm.fileAccessBusy, false)
})
test('folders, readonly files, recycled files and concurrent opens cannot change access', async () => {
  const { vm, calls } = setup()
  await vm.handleFileClientAccess({ ...item(), isFolder: true }); await vm.handleFileClientAccess({ ...item(), readOnly: true })
  vm.viewMode = 'recycle'; await vm.handleFileClientAccess(item()); vm.viewMode = 'files'; vm.fileAccessBusy = true; await vm.handleFileClientAccess(item())
  assert.equal(calls.reads.length, 0)
})
test('API methods use the project-scoped endpoint and preserve boolean instead of truthy strings', async () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  const calls = []
  const body = ['getProjectFileAccess', 'updateProjectFileAccess'].map(name =>
    api.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`))[0].replace('export function', 'function')
  ).join('\n')
  const functions = new Function('request', 'unwrapEnvelope', body + '; return {getProjectFileAccess,updateProjectFileAccess}')(async (args) => { calls.push(args); return { code: 0, data: { clientVisible: false } } }, (r) => r.data)
  assert.deepEqual(await functions.getProjectFileAccess(1, 7), { clientVisible: false })
  await functions.updateProjectFileAccess(1, 7, false)
  assert.equal(calls[0].url, '/api/projects/1/files/7/access'); assert.equal(calls[1].method, 'PUT'); assert.deepEqual(calls[1].data, { clientVisible: false })
})
