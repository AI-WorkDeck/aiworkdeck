// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { groupByParent, buildTreeFromGroups } from '../../src/utils/fileTreeBuild.js'
import { computeDisplayFiles } from '../../src/utils/fileTreeRecycle.js'

const source = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
const tagA = { id: 7, name: '待审阅', color: '#B45309' }
const tagB = { id: 8, name: '证据' }
const fixture = () => [
  { id: 1, name: '证据目录', parentId: null, isFolder: true },
  { id: 2, name: '子目录', parentId: 1, isFolder: true },
  { id: 3, name: '合同.docx', parentId: 2, tags: [tagA, tagB] },
  { id: 4, name: '照片.jpg', parentId: 1, tags: [tagA] },
  { id: 5, name: '录音.mp3', parentId: null, tags: [tagB] },
  { id: 6, name: '未标记.txt', parentId: null, tags: [] },
  { id: 10, name: '__staging_area__', parentId: null, isFolder: true },
  { id: 11, name: '暂存.txt', parentId: 10, tags: [tagA] }
]
function setup(stubs = {}) {
  const deps = { groupByParent, buildTreeFromGroups, computeDisplayFiles, getProjectTags: async () => [tagA, tagB], addTagToFile: async () => {}, removeTagFromFile: async () => {}, ...stubs }
  const names = []
  const body = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]\s*$/gm, (_, binding) => {
    for (const name of binding.replace(/[{}]/g, '').split(',')) names.push(name.trim().split(/\s+as\s+/).at(-1))
    return ''
  }).replace('export default {', 'return {')
  const options = new Function(...names, body)(...names.map(name => deps[name] ?? (() => {})))
  const events = []
  const vm = { ...options.data(), projectId: 42, enableTagView: true, hiddenFileIds: [], parentId: null, $emit: (...args) => events.push(args), $t: key => key }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  vm.scheduleRefCountsFetch = () => {}
  vm.allFiles = fixture()
  vm.files = vm.buildTreeView(vm.allFiles, null)
  globalThis.uni = { $emit: (...args) => events.push(args), showToast() {} }
  return { vm, options, events }
}
const ids = vm => vm.displayFiles.map(file => file.id).sort((a, b) => a - b)

test('tag view finds tagged media and documents inside collapsed folders, excluding untagged and staging files', () => {
  const { vm } = setup()
  assert.deepEqual(ids(vm), [1, 5, 6])
  vm.tagView = true
  assert.deepEqual(ids(vm), [3, 4, 5])
  vm.selectedTagIds = ['7', 8]
  assert.deepEqual(ids(vm), [3], 'all selected tags must match, normalized across string/number ids')
  vm.selectedTagIds = [7]
  assert.deepEqual(ids(vm), [3, 4])
  vm.hiddenFileIds = [4]
  assert.deepEqual(ids(vm), [3])
  assert.deepEqual(vm.tagFileCounts, { 7: 1, 8: 2 })
  assert.equal(vm.tagFileLocation(vm.allFiles[2]), '证据目录 / 子目录')
  assert.equal(vm.getItemPadding(vm.allFiles[2]), '0')
})

test('switching back restores folder expansion; recycle bin ignores tag filtering', () => {
  const { vm } = setup()
  vm.expandedFolders.add(1)
  vm.files = vm.buildTreeView(vm.allFiles, null)
  const original = ids(vm)
  vm.setTagView(true)
  vm.setTagFilter([7])
  vm.setTagView(false)
  assert.deepEqual(ids(vm), original)
  assert.deepEqual([...vm.expandedFolders], [1])
  vm.tagView = true
  vm.viewMode = 'recycle'
  vm.recycleBin = [{ id: 91, name: '已删除.txt' }]
  assert.deepEqual(ids(vm), [91])
})

test('filter changes clear hidden selection; batch select only includes visible tagged files', () => {
  const { vm, options } = setup()
  vm.selectionMode = true
  vm.checkedMap = { 1: true, 6: true }
  vm.multiSelectedIds = [6]
  vm.selectedFileId = 6
  vm.setTagView(true)
  vm.setTagFilter([7, 8])
  assert.deepEqual(vm.checkedIds, [])
  assert.deepEqual(vm.multiSelectedIds, [])
  vm.selectAll()
  assert.deepEqual(vm.checkedIds, [3])
  vm.selectedFileId = 3
  vm.multiSelectedIds = [3]
  vm.allFiles[2].tags = []
  options.watch.displayFiles.call(vm, vm.displayFiles)
  assert.deepEqual(vm.checkedIds, [])
  assert.deepEqual(vm.multiSelectedIds, [])
  assert.equal(vm.selectedFileId, null)
})

test('tag edits update filtered results and notify search; add works when tags property is missing', async () => {
  const { vm, events } = setup()
  vm.tagView = true
  vm.selectedTagIds = [7]
  const file = vm.allFiles[5]
  delete file.tags
  vm.targetFileForTags = file
  await vm.handleAddTag(tagA)
  await vm.handleAddTag(tagA)
  assert.deepEqual(ids(vm), [3, 4, 6])
  assert.equal(file.tags.length, 1)
  await vm.handleRemoveTag(tagA)
  assert.deepEqual(ids(vm), [3, 4])
  assert.ok(events.some(([event, data]) => event === 'awd:files-changed' && data.projectId === 42))
})

test('a background tag change dismisses a context menu containing a now-hidden file', () => {
  const { vm, options } = setup()
  vm.tagView = true
  vm.selectedTagIds = [7]
  vm.multiSelectedIds = [3, 4]
  vm.contextMenu = { visible: true, targetItem: vm.allFiles[2], selectionIds: [3, 4] }
  vm.allFiles[3].tags = []
  options.watch.displayFiles.call(vm, vm.displayFiles)
  assert.deepEqual(vm.multiSelectedIds, [3])
  assert.equal(vm.contextMenu.visible, false)
  assert.equal(vm.contextMenu.targetItem, null)
})

test('late tag load cannot replace a newer project; deleting selected tag clears stale filter', async () => {
  let finish
  const { vm } = setup({ getProjectTags: () => new Promise(resolve => { finish = resolve }) })
  const pending = vm.refreshProjectTags()
  vm.projectId = 99
  vm.tagsRequest++
  finish([tagA]); await pending
  assert.deepEqual(vm.projectTags, [])
  const fresh = setup().vm
  fresh.selectedTagIds = [999]
  await fresh.refreshProjectTags()
  assert.deepEqual(fresh.selectedTagIds, [])
})


test('selection supplied by an external reveal cannot enter a filtered batch action', () => {
  const { vm } = setup()
  vm.tagView = true
  vm.selectedTagIds = [7, 8]
  vm.multiSelectedIds = [6, 3]
  assert.deepEqual(vm.currentSelectedIds(), [3])
  vm.selectionMode = true
  vm.checkedMap = { 3: true, 6: true }
  assert.deepEqual(vm.currentSelectedIds(), [3])
})

test('keyboard navigation reveals the 101st tag result across multiple original folders', () => {
  const { vm } = setup()
  vm.tagView = true
  vm.allFiles = [
    { id: 1, parentId: null, name: 'A', isFolder: true },
    { id: 2, parentId: null, name: 'B', isFolder: true },
    ...Array.from({ length: 120 }, (_, i) => ({ id: i + 10, parentId: i < 60 ? 1 : 2, name: String(i), tags: [tagA] }))
  ]
  vm.$nextTick = fn => fn()
  const file = vm.displayFiles[100]
  assert.equal(vm.windowedDisplayFiles.some(row => row.id === file.id), false)
  vm.selectKeyboardItem(file)
  assert.equal(vm.windowedDisplayFiles.some(row => row.id === file.id), true)
})


test('adding a tag after a global deletion uses the latest file tags rather than a stale edit dialog', async () => {
  const { vm } = setup()
  const oldFile = { ...vm.allFiles[2], tags: [tagA] }
  vm.targetFileForTags = oldFile
  vm.allFiles[2].tags = []
  await vm.handleAddTag(tagB)
  assert.deepEqual(vm.allFiles[2].tags.map(tag => tag.id), [8])
  assert.deepEqual(oldFile.tags.map(tag => tag.id), [8])
})


test('sidebar tag entry starts filtering directly; clear and back restore folders while all-tagged remains distinct', () => {
  const { vm } = setup()
  vm.setTagFilter([7])
  assert.equal(vm.isTagView, true)
  assert.deepEqual(ids(vm), [3, 4])
  vm.setTagFilter([])
  assert.equal(vm.isTagView, false)
  assert.deepEqual(ids(vm), [1, 5, 6])
  vm.showAllTaggedFiles()
  assert.equal(vm.isTagView, true)
  assert.deepEqual(ids(vm), [3, 4, 5])
  vm.setTagFilter([7])
  vm.setTagView(false)
  assert.deepEqual(vm.selectedTagIds, [])
  assert.deepEqual(ids(vm), [1, 5, 6])
})

test('tag browsing shows results from the top and restores the folder scroll position on return', () => {
  const { vm } = setup()
  const container = { scrollTop: 640 }
  vm.$el = { querySelector: () => container }
  vm.$nextTick = callback => callback()
  vm.setTagFilter([7])
  assert.equal(container.scrollTop, 0)
  container.scrollTop = 180
  vm.setTagFilter([7, 8])
  assert.equal(container.scrollTop, 0, 'changing an active filter shows its first result')
  vm.setTagFilter([])
  assert.equal(container.scrollTop, 640, 'clearing restores the directory position before the visit')
  container.scrollTop = 320
  vm.setTagFilter([])
  assert.equal(container.scrollTop, 320, 'background cleanup outside tag browsing must not move the directory')
})
