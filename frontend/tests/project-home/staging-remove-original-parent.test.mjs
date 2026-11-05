// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程问题 85（dev-board#1713）：文件从资源管理器拖进暂存区再「移出」，回到了根目录
// 而不是原文件夹。根因：FileTree 的拖拽载荷没带 parentId → FileStagingArea.onDrop
// 也没透传 → stagingArea.js#onStagingDrop 记不下原目录，handleStagingRemove 只能回根。
// 修法：载荷补 parentId 并透传；载荷缺失时按 id 从文件树数据反查父目录兜底。
//   cd frontend && node --test tests/project-home/staging-remove-original-parent.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const STAGING_JS = read('../../src/pages/project-overview/stagingArea.js')
const FILE_TREE = read('../../src/components/FileTree.vue')
const STAGING_VUE = read('../../src/components/FileStagingArea.vue')

function loadMethods(moves) {
  const body = STAGING_JS
    .replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace(/export const stagingAreaMethods = \{/, 'return {')
  const factory = new Function(
    'getProjectFiles', 'createFolder', 'batchMoveFiles', 'getStageUsage',
    'openExternalUrl', 'accountPageUrl', 'uni', body)
  return factory(
    async () => ({ data: [] }), async () => ({ id: 'stage-1' }),
    async (...a) => { moves.push(a) }, async () => null,
    () => {}, () => '', { showToast: () => {} })
}

function makeVm(allFiles = []) {
  const moves = []
  const methods = loadMethods(moves)
  const vm = {
    projectId: 1,
    stagingFolderId: 'stage-1',
    stagingOriginalParents: {},
    stagingPinned: false,
    $refs: { fileTree: { allFiles, loadFiles() {} } },
    $t: (k) => k,
  }
  for (const [k, fn] of Object.entries(methods)) vm[k] = fn.bind(vm)
  vm.loadStagingFiles = async () => {}
  vm.moves = moves
  return vm
}

test('载荷带 parentId：移出时回原文件夹', async () => {
  const vm = makeVm()
  await vm.onStagingDrop([{ id: 7, name: 'a.docx', parentId: 30 }])
  await vm.handleStagingRemove(7)
  assert.deepEqual(vm.moves.at(-1), [1, [7], 30])
})

test('载荷缺 parentId：按 id 从文件树数据反查原文件夹', async () => {
  const vm = makeVm([{ id: 30, isFolder: true, parentId: null }, { id: 7, name: 'a.docx', parentId: 30 }])
  await vm.onStagingDrop([{ id: '7', name: 'a.docx' }])
  await vm.handleStagingRemove('7')
  assert.deepEqual(vm.moves.at(-1), [1, ['7'], 30])
})

test('原本就在根目录：移出仍回根目录', async () => {
  const vm = makeVm([{ id: 7, name: 'a.docx', parentId: null }])
  await vm.onStagingDrop([{ id: 7, name: 'a.docx' }])
  await vm.handleStagingRemove(7)
  assert.deepEqual(vm.moves.at(-1), [1, [7], null])
})

test('FileTree 拖拽载荷（dataTransfer 与全局兜底）都带 parentId，暂存区两条读取分支都透传', () => {
  const start = FILE_TREE.indexOf('document.__checkbaDraggedFile = {')
  const seg = FILE_TREE.slice(start, FILE_TREE.indexOf("dt.setData('text/checkba-file-json'", start))
  assert.equal((seg.match(/parentId: item\.parentId \?\? null/g) || []).length, 2)
  const drop = STAGING_VUE.slice(STAGING_VUE.indexOf('// 1. Try to get data from dataTransfer'), STAGING_VUE.indexOf("this.$emit('drop', files)"))
  assert.equal((drop.match(/\{ parentId: data\.parentId \}/g) || []).length, 2)
})
