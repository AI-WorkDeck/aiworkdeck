// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 资源管理器右键补齐常用项：打印… / 移动到… / 压缩为 ZIP / 解压到此处。跑法：npm run test:project-home
// 套路同 file-tree-batch-menu.test.mjs：把 FileTree.vue 的 <script> 抠出来真跑。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collapseToTopmostSelected } from '../../src/utils/fileTreeRecycle.js'
import { canPrintItem, canExtractItem, canMoveItems, canCompressItems } from '../../src/utils/fileTreeExtraActions.js'

const SRC = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')

const FILES = [
  { id: 1, name: '证据', isFolder: true, parentId: null },
  { id: 11, name: '合同.docx', fileType: 'docx', isFolder: false, parentId: 1 },
  { id: 12, name: '扫描件.pdf', fileType: 'pdf', isFolder: false, parentId: 1 },
  { id: 13, name: '附件.zip', fileType: 'zip', isFolder: false, parentId: null },
  { id: 14, name: 'README.txt', fileType: 'txt', isFolder: false, parentId: null },
]

function makeVm() {
  const calls = { printed: [], fetched: [], zipped: [], extracted: [], moved: [], toasts: [], emits: [] }
  const stubs = {
    collapseToTopmostSelected, canPrintItem, canExtractItem, canMoveItems, canCompressItems,
    fetchPrintablePdf: async (...a) => { calls.fetched.push(a); return 'BLOB' },
    printPdfBlob: (blob) => { calls.printed.push(blob) },
    compressFilesToZip: async (...a) => { calls.zipped.push(a); return { data: { id: 99, name: '证据.zip' } } },
    extractArchive: async (...a) => { calls.extracted.push(a); return { id: 98, name: '附件' } },
    batchMoveFiles: async (...a) => { calls.moved.push(a); return { data: { files: [] } } },
    ICONS: {},
    host: {},
  }
  const body = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
  const names = [...new Set([...body.matchAll(/^import\s+\{([^}]*)\}\s+from/gm)]
    .flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean))
    .concat([...body.matchAll(/^import\s+(\w+)\s+from/gm)].map(m => m[1])))]
  const stripped = body.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '').replace(/export default \{/, 'return {')
  const options = new Function(...names, stripped)(...names.map(n => (n in stubs ? stubs[n] : (() => {}))))
  const vm = Object.assign({}, options.data.call({}))
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  Object.assign(vm, { projectId: 42, showTree: true, selectionMode: false, viewMode: 'files', allFiles: FILES, files: FILES, expandedFolders: new Set([1]) })
  Object.defineProperty(vm, 'displayFiles', { get: () => vm.files })
  Object.defineProperty(vm, 'checkedIds', { get: () => Object.keys(vm.checkedMap).filter(k => vm.checkedMap[k]).map(Number) })
  vm.$t = (k, params) => (params ? `${k}:${JSON.stringify(params)}` : k)
  vm.$emit = (...a) => { calls.emits.push(a) }
  vm.loadFiles = async () => {}
  vm.revealFile = () => true
  vm.clearChecked = () => { vm.checkedMap = {} }
  vm.calls = calls
  globalThis.uni = { showToast(o) { calls.toasts.push(o) }, showLoading() {}, hideLoading() {} }
  return vm
}

const rightClick = () => ({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 20 })

test('判定：打印限 PDF/Office/图片单文件；解压限压缩包；回收站里都不给', () => {
  assert.equal(canPrintItem(FILES[1]), true)
  assert.equal(canPrintItem(FILES[2]), true)
  assert.equal(canPrintItem(FILES[0]), false, '文件夹不能打印')
  assert.equal(canPrintItem(FILES[4]), false, 'txt 后端转不了 PDF，不给打印')
  assert.equal(canPrintItem(FILES[2], 'recycle'), false)
  assert.equal(canExtractItem(FILES[3]), true)
  assert.equal(canExtractItem(FILES[2]), false)
  assert.equal(canExtractItem({ ...FILES[3], readOnly: true }), false, '只读不能解压（要写权限）')
  assert.equal(canMoveItems([FILES[1], { ...FILES[2], readOnly: true }]), false)
  assert.equal(canCompressItems([FILES[0]], 'recycle'), false)
})

test('右键 PDF「打印…」：取 print-pdf 字节交给打印，不落新文件', async () => {
  const vm = makeVm()
  vm.handleContextMenu(FILES[2], rightClick())
  assert.equal(vm.canPrintContext(), true)
  await vm.handleContextPrint()
  assert.deepEqual(vm.calls.fetched, [[42, 12]])
  assert.deepEqual(vm.calls.printed, ['BLOB'])
  assert.equal(vm.contextMenu.visible, false)
})

test('多选时不给打印与解压，但给移动与压缩', () => {
  const vm = makeVm()
  vm.multiSelectedIds = [11, 12]
  vm.handleContextMenu(FILES[2], rightClick())
  assert.equal(vm.canPrintContext(), false)
  assert.equal(vm.canExtractContext(), false)
  assert.equal(vm.canMoveContext(), true)
  assert.equal(vm.canCompressContext(), true)
})

test('「移动到…」：复用选择文件夹弹窗，移动的是右键对象而不是批量勾选', async () => {
  const vm = makeVm()
  vm.checkedMap = { 14: true } // 另有勾选残留，不能被带进来
  vm.multiSelectedIds = [11, 12]
  vm.handleContextMenu(FILES[1], rightClick())
  vm.handleContextMove()
  assert.equal(vm.showFolderSelector, true)
  vm.tempSelectedParent = null
  vm.confirmFolderSelection()
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(vm.calls.moved, [[42, [11, 12], null]])
  assert.equal(vm.contextActionIds, null, '用完即清，之后的批量移动回到读勾选')
})

test('「压缩为 ZIP」：文件夹连子孙都选中时只发文件夹本身，完成后定位到新 zip', async () => {
  const vm = makeVm()
  vm.multiSelectedIds = [1, 11, 13]
  vm.handleContextMenu(FILES[3], rightClick())
  await vm.handleContextCompress()
  assert.deepEqual(vm.calls.zipped, [[42, [1, 13]]])
  assert.ok(vm.calls.emits.some(e => e[0] === 'files-changed'))
  assert.match(vm.calls.toasts.at(-1).title, /compressSuccess.*证据\.zip/)
})

test('「解压到此处」：调既有解压接口', async () => {
  const vm = makeVm()
  vm.handleContextMenu(FILES[3], rightClick())
  assert.equal(vm.canExtractContext(), true)
  await vm.handleContextExtract()
  assert.deepEqual(vm.calls.extracted, [[42, 13]])
  assert.match(vm.calls.toasts.at(-1).title, /extractSuccess/)
})

test('菜单模板四项都接了 i18n 键', () => {
  for (const key of ['fileTree.print', 'fileTree.moveTo', 'fileTree.compressToZip', 'fileTree.extractHere']) {
    assert.ok(SRC.includes(`$t('${key}')`), key)
  }
})
