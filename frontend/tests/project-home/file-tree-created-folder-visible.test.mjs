// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { groupByParent, buildTreeFromGroups } from '../../src/utils/fileTreeBuild.js'
import { computeDisplayFiles } from '../../src/utils/fileTreeRecycle.js'

const source = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
function setup(initial, overrides = {}) {
  const files = initial.slice()
  const calls = { scrolls: [], created: [], createdFiles: [], toasts: [] }
  const dependencies = {
    groupByParent, buildTreeFromGroups, computeDisplayFiles,
    getProjectFiles: async () => files.slice(),
    createFolder: async (projectId, parentId, name) => {
      const folder = { id: 10000, projectId, parentId, name, isFolder: true }
      files.push(folder); calls.created.push(folder)
      return folder
    },
    createFile: async (projectId, parentId, name, fileType) => {
      const file = { id: 10001, projectId, parentId, name, fileType, isFolder: false }
      files.push(file); calls.createdFiles.push(file)
      return file
    },
    getProjectTags: async () => [], ...overrides,
  }
  const imports = []
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]\s*$/gm, (_, bindings) => {
      imports.push(...bindings.replace(/[{}]/g, '').split(',').map(name => name.trim().split(/\s+as\s+/).at(-1)))
      return ''
    }).replace('export default {', 'return {')
  const options = new Function(...imports, script)(...imports.map(name => dependencies[name] ?? (() => {})))
  const vm = { ...options.data(), projectId: 42, parentId: null, showTree: true, enableTagView: true,
    hiddenFileIds: [], $t: key => key, $emit() {}, $nextTick: callback => callback?.(),
    $el: { querySelector: selector => {
      const id = selector.match(/data-file-id="([^"]+)"/)?.[1]
      return vm.windowedDisplayFiles.some(file => String(file.id) === id)
        ? { scrollIntoView: () => calls.scrolls.push(Number(id)) } : null
    } },
  }
  for (const [name, method] of Object.entries(options.methods)) vm[name] = method.bind(vm)
  for (const [name, getter] of Object.entries(options.computed)) Object.defineProperty(vm, name, { get: getter.bind(vm) })
  vm.scheduleRefCountsFetch = () => {}
  vm.allFiles = files.slice()
  vm.files = vm.buildTreeView(vm.allFiles, vm.parentId)
  globalThis.uni = { $emit() {}, showToast: toast => calls.toasts.push(toast) }
  return { vm, calls }
}
const folders = (count, parentId = null, first = 1) => Array.from({ length: count }, (_, index) => ({
  id: first + index, name: `合成目录${String(index + 1).padStart(3, '0')}`, isFolder: true, parentId,
}))

test('new root folder beyond 100 siblings is rendered, selected and scrolled into view', async () => {
  const { vm, calls } = setup(folders(148))
  assert.equal(vm.windowedDisplayFiles.filter(file => !file.__loadMore).length, 100)
  await vm.handleCreateFolder()
  assert.equal(calls.created.length, 1)
  assert.ok(vm.windowedDisplayFiles.some(file => file.id === 10000), 'creation must reveal a folder past the rendering window')
  assert.equal(vm.selectedFileId, 10000)
  assert.deepEqual(vm.multiSelectedIds, [10000])
  assert.deepEqual(calls.scrolls, [10000])
})

test('creation reveals a collapsed parent past its own window and the new child past 100 siblings', async () => {
  const initial = folders(148)
  initial.push(...folders(148, 148, 1000))
  const { vm, calls } = setup(initial)
  await vm.handleCreateFolder(148)
  assert.equal(vm.expandedFolders.has(148), true)
  assert.ok(vm.windowedDisplayFiles.some(file => file.id === 148), 'parent must be rendered too')
  assert.ok(vm.windowedDisplayFiles.some(file => file.id === 10000))
  assert.deepEqual(calls.scrolls, [10000])
})

test('the next document is created inside the newly created and selected folder', async () => {
  const { vm, calls } = setup(folders(148))
  await vm.handleCreateFolder()
  assert.equal(vm.selectedFileId, 10000)
  await vm.createBlankWord('后续文档')
  assert.equal(calls.createdFiles.length, 1)
  assert.equal(calls.createdFiles[0].parentId, 10000, 'creation target must agree with the selected new folder')
})

test('creation waits for a newer concurrent refresh before revealing its folder', async () => {
  const gates = []
  const initial = folders(148)
  const created = { id: 10000, parentId: null, name: 'Untitled Folder', isFolder: true }
  const { vm, calls } = setup(initial, {
    createFolder: async () => created,
    getProjectFiles: () => new Promise(resolve => gates.push(resolve)),
  })
  const pending = vm.handleCreateFolder()
  await Promise.resolve()
  const competing = vm.loadFiles()
  assert.equal(gates.length, 2)
  gates[0]([...initial, created])
  // The discarded first request must not announce success while the current one is pending.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.toasts.length, 0)
  gates[1]([...initial, created])
  await Promise.all([pending, competing])
  assert.ok(vm.windowedDisplayFiles.some(file => file.id === 10000))
  assert.equal(vm.selectedFileId, 10000)
  assert.equal(vm.activeFolderId, 10000)
  assert.deepEqual(calls.scrolls, [10000])
  assert.equal(calls.toasts.at(-1).title, 'fileTree.createSuccess')
})

test('creating in tag view returns to folder view so the untagged folder is visible', async () => {
  const { vm, calls } = setup(folders(2))
  vm.tagView = true
  vm.selectedTagIds = [7]
  assert.equal(vm.displayFiles.length, 0)
  await vm.handleCreateFolder()
  assert.equal(vm.isTagView, false)
  assert.ok(vm.windowedDisplayFiles.some(file => file.id === 10000))
  assert.deepEqual(calls.scrolls, [10000])
})

test('a completed creation does not select or change the view of a subsequently opened project', async () => {
  let finish
  const { vm, calls } = setup([], { createFolder: () => new Promise(resolve => { finish = resolve }) })
  const pending = vm.handleCreateFolder()
  vm.projectId = 99
  vm.tagView = true
  finish({ id: 10000 }); await pending
  assert.equal(vm.selectedFileId, null)
  assert.equal(vm.isTagView, true)
  assert.deepEqual(calls.scrolls, [])
  assert.deepEqual(calls.toasts, [])
})

test('creation is selected after the workbench refresh finishes syncing its previous tab selection', async () => {
  const { vm } = setup(folders(2))
  globalThis.uni.$emit = event => {
    if (event === 'awd:files-changed') queueMicrotask(() => queueMicrotask(() => {
      vm.selectedFileId = null
      vm.multiSelectedIds = []
    }))
  }
  vm.$nextTick = callback => Promise.resolve().then(() => callback?.())
  await vm.handleCreateFolder()
  assert.equal(vm.selectedFileId, 10000)
  assert.deepEqual(vm.multiSelectedIds, [10000])
})

test('failed creation keeps the current folder/tag view and reports failure', async () => {
  const { vm, calls } = setup(folders(2), { createFolder: async () => { throw new Error('Cannot create folder') } })
  vm.tagView = true
  await vm.handleCreateFolder()
  assert.equal(vm.isTagView, true)
  assert.deepEqual(calls.scrolls, [])
  assert.equal(calls.toasts.at(-1).title, 'Cannot create folder')
})

test('a failed refresh does not announce creation success before the new folder can be displayed', async () => {
  const { vm, calls } = setup(folders(2), { getProjectFiles: async () => { throw new Error('Cannot load files') } })
  await vm.handleCreateFolder()
  assert.equal(vm.selectedFileId, null)
  assert.deepEqual(calls.scrolls, [])
  assert.deepEqual(calls.toasts.map(toast => toast.title), ['Cannot load files'])
})
