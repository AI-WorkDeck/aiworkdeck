// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#363 / #409 / #513：把 Finder / 资源管理器 / 微信里的文件或文件夹直接拖进左栏
// 「资源管理器」。   cd frontend && npm run test:project-home
//
// 两处根因（#363）：
// ① FileTree.vue 的 handleDrop / onRootDrop 只认得应用内拖拽的两种 payload
//    （application/x-checkba-file JSON、document.__checkbaDraggedFile 兜底），
//    dataTransfer.files 这份 OS 原生 File 列表从来没人读——拖进来什么都不发生。
// ② uni-h5 的 $nne 把 <view> 上的事件重建成普通对象（createNativeEvent），只补
//    click/mouse/touch 三类字段，drag 系事件的 dataTransfer 直接丢了；要从正在派发的
//    原生事件 window.event 上取（同 fileOpenTabs.js 的 mouseButtonOf 老地雷）。
//
// #513 起资源管理器只剩「导入本机路径」一条通道：dataTransfer.files 的**顶层条目**
// （可能是文件，也可能是目录）逐个解析出本机绝对路径，调 import-local 让后端复制进来，
// 目录由后端递归建行。解析不出路径（非桌面端）只弹一句「拖入导入仅桌面端支持」。
// FileTree.vue 是 Options API，照 staging-drop-external-files.test.mjs 的套路把
// <script> 抠出来 new Function 求值，真跑 handleDrop / onRootDrop / onTreeDrop。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  nativeEvent,
  nativeDataTransfer,
  isExternalFileDrag,
  compatibleDropEffect,
  claimExternalDrop, captureDroppedFiles, importDroppedFile,
} from '../../src/utils/fileTreeExternalDrop.js'
import {
  prefetchLocalFilePath,
  cacheLocalFilePath,
  getCachedLocalFilePath,
  startExternalFileDrag,
  clearLocalPathCache,
  installExternalDragCleanup,
} from '../../src/utils/fileLocalDrag.js'
import { collapseToTopmostSelected } from '../../src/utils/fileTreeRecycle.js'

const SRC = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')

// <script> 里的 import 有单行也有多行块（api.js 那组 tag 接口），一并剥掉；
// 被引用的符号全部由 new Function 的形参喂桩。
const IMPORT_NAMES = [
  'isDesktopHost', 'subscribeLocalProjectFileChanges', 'getProjectFiles', 'createFolder', 'createFile', 'renameFile', 'deleteFile', 'deleteFilePerm',
  'getFilePermDiskPaths', 'restoreFileApi', 'getRecycleBinFiles', 'moveFile', 'batchDeleteFiles', 'batchMoveFiles',
  'batchCopyFiles', 'getApiBaseUrl', 'getContributedTemplates', 'createFileFromContributedTemplate',
  'getSessionId', 'getAuthHeaders', 'getFileLocalPath', 'host', 'findTopmostDeletedAncestor', 'summarizeDeleteResults',
  'collapseToTopmostSelected', 'computeDisplayFiles',
  'groupByParent', 'buildTreeFromGroups', 'evidenceRefCounts', 'createRefCountsFetcher',
  'warmDragImage', 'applyDragImage', 'FileTypeIcon', 'TagChip', 'TagFilter', 'TagSelector',
  'TagManager', 'ExplorerCreateMenu', 'AwdDatePicker', 'ICONS', 'getProjectTags', 'addTagToFile', 'removeTagFromFile',
  'createTag', 'createTask', 'importLocalFile', 'getProjectFileAccess', 'updateProjectFileAccess',
  'isArchiveEntryDrag', 'readArchiveEntryDrag', 'importArchiveEntry',
  'nativeEvent', 'nativeDataTransfer', 'isExternalFileDrag', 'compatibleDropEffect', 'claimExternalDrop', 'captureDroppedFiles', 'importDroppedFile',
  'prefetchLocalFilePath', 'startExternalFileDrag', 'clearLocalPathCache',
]

function loadOptions(stubs) {
  const body = SRC.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
    .replace(/export default \{/, 'return {')
  const factory = new Function(...IMPORT_NAMES, body)
  const args = IMPORT_NAMES.map(n => (n in stubs ? stubs[n] : (() => {})))
  return factory(...args)
}

// desktopPaths: File 对象 → 本机绝对路径的映射（桌面壳 host.fs.getPathForFile 的桩）。
// 不传 = 浏览器态，host.fs 整个缺席，一条都导不进去。
function makeVm({ moveFile, batchMoveFiles, createFolder, desktopPaths, desktopFs, importLocalFails, getFileLocalPath } = {}) {
  const calls = { moveFile: [], batchMoveFiles: [], importLocal: [], loadFiles: 0, emits: [], toasts: [] }
  const stubs = {
    moveFile: async (...a) => { calls.moveFile.push(a); return { parentId: a[2] } },
    batchMoveFiles: batchMoveFiles || (async (...a) => { calls.batchMoveFiles.push(a); return { data: { files: a[1].map(id => ({ id, parentId: a[2] })) } } }),
    collapseToTopmostSelected, clearLocalPathCache,
    createFolder: createFolder || (async () => ({ id: 999 })),
    ICONS: {},
    getApiBaseUrl: () => 'http://127.0.0.1:5269',
    getAuthHeaders: () => ({ 'X-Session-Id': 's-test' }),
    getFileLocalPath: getFileLocalPath || (async (id) => ({ data: { path: `/Users/me/proj/${id}.docx`, exists: true } })),
    host: desktopFs ? { fs: desktopFs } : desktopPaths
      ? { fs: { getPathForFile: (f) => desktopPaths.get(f) || '' } }
      : {},
    importLocalFile: async (...a) => {
      calls.importLocal.push(a)
      if (importLocalFails) throw new Error('boom')
      return { id: 100 + calls.importLocal.length }
    },
    nativeEvent, nativeDataTransfer, isExternalFileDrag, compatibleDropEffect, claimExternalDrop, captureDroppedFiles, importDroppedFile,
    prefetchLocalFilePath, startExternalFileDrag,
  }
  if (moveFile) stubs.moveFile = moveFile
  const options = loadOptions(stubs)
  const vm = Object.assign({}, options.data.call({}))
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  vm.projectId = 42
  vm.$t = (k) => k
  vm.$emit = (...a) => { calls.emits.push(a) }
  vm.$el = null
  vm.loadFiles = async () => { calls.loadFiles += 1 }
  vm.showErrorModal = (msg, title) => { calls.toasts.push(title || msg) }
  vm.calls = calls
  globalThis.__awdToasts = calls.toasts
  return vm
}

function installGlobals() {
  const prior = { uni: globalThis.uni, window: globalThis.window, document: globalThis.document, log: console.log }
  console.log = () => {}
  globalThis.uni = {
    showToast(o) { if (globalThis.__awdToasts) globalThis.__awdToasts.push(o && o.title) },
    $emit() {}, $on() {}, $off() {},
  }
  globalThis.window = { event: null }
  globalThis.document = {}
  return () => {
    console.log = prior.log
    globalThis.uni = prior.uni
    globalThis.window = prior.window
    globalThis.document = prior.document
    globalThis.__awdToasts = null
  }
}

const folder = { id: 7, name: '合同', isFolder: true, parentId: null, sortOrder: 3 }
const doc = { id: 1, name: '起诉状.docx', isFolder: false, parentId: 7, sortOrder: 1 }

function osFile(name, size = 10) {
  return { name, size, slice() {} }
}

// 真实 OS 拖拽的 dataTransfer：dragover 阶段 files 为空、types 里只有 'Files'，
// drop 阶段 files 才有内容（顶层条目，目录也在里面占一条）。
function osDataTransfer(files, items = []) {
  return { types: ['Files'], files, items, getData: () => '' }
}

function wrappedEvent(extra = {}) {
  // uni 重建后的事件对象：没有 dataTransfer，只有转发方法
  return { preventDefault() {}, stopPropagation() {}, ...extra }
}

// ---------- 纯函数 ----------

test('isExternalFileDrag：dragover 阶段 files 为空但 types 含 Files 也算外部文件拖拽；应用内拖拽不算', () => {
  assert.equal(isExternalFileDrag({ types: ['Files'], files: [] }), true)
  assert.equal(isExternalFileDrag({ types: ['text/plain', 'application/x-checkba-file'], files: [] }), false)
  assert.equal(isExternalFileDrag(null), false)
})

test('nativeDataTransfer：包装事件没有 dataTransfer 时从 window.event 上取', () => {
  const restore = installGlobals()
  try {
    const dt = osDataTransfer([osFile('a.pdf')])
    globalThis.window.event = { dataTransfer: dt }
    assert.equal(nativeDataTransfer(wrappedEvent()), dt)
    assert.equal(nativeDataTransfer({ dataTransfer: 'own' }), 'own', '回调自带的优先')
  } finally { restore() }
})

test('claimExternalDrop：同一个原生事件只认领一次（节点与容器各收一次 drop 时不重复导入）', () => {
  const native = {}
  assert.equal(claimExternalDrop(native), true)
  assert.equal(claimExternalDrop(native), false)
  assert.equal(claimExternalDrop(null), true, '拿不到原生事件时不拦')
})

// ---------- FileTree 接线：顶层条目逐个 import-local ----------

test('桌面端拖文件到文件夹节点：import-local 到该文件夹，不调 moveFile，落点文件夹被展开，不插乐观行', async () => {
  const restore = installGlobals()
  try {
    const file = osFile('证据.pdf')
    const vm = makeVm({ desktopPaths: new Map([[file, '/Users/me/tmp/证据.pdf']]) })
    vm.windowedDisplayFiles = [folder, doc]
    vm.displayFiles = [folder, doc]
    vm.files = []
    vm.allFiles = []

    await vm.handleDrop(wrappedEvent({ dataTransfer: osDataTransfer([file]) }), 0)

    assert.deepEqual(vm.calls.importLocal, [[42, '/Users/me/tmp/证据.pdf', 7]],
      'projectId / 绝对路径 / 落点目录三样都要传对')
    assert.deepEqual(vm.calls.moveFile, [], '外部文件不是移动')
    assert.equal(vm.calls.loadFiles, 1, '导入完刷新文件树')
    assert.deepEqual(vm.files, [], '没有传输阶段就没有占位行')
    assert.deepEqual(vm.allFiles, [])
    assert.equal(vm.expandedFolders.has(7), true, '落点文件夹展开，导完能看见')
    assert.equal(vm.dragOverIndex, -1)
    assert.equal(vm.externalDragActive, false)
  } finally { restore() }
})

test('拖整个文件夹进来：直接把目录路径交给 import-local（目录递归由后端做），不再前端展开', async () => {
  const restore = installGlobals()
  try {
    // 目录在 dataTransfer.files 里也是一个 File 条目，webUtils 解析得出它的绝对路径
    const dir = osFile('证据')
    const vm = makeVm({ desktopPaths: new Map([[dir, '/Users/me/证据']]) })
    vm.windowedDisplayFiles = [folder]
    vm.displayFiles = [folder]
    await vm.handleDrop(wrappedEvent({ dataTransfer: osDataTransfer([dir]) }), 0)
    assert.deepEqual(vm.calls.importLocal, [[42, '/Users/me/证据', 7]])
    assert.equal(vm.calls.loadFiles, 1)
  } finally { restore() }
})

test('一次拖多个顶层条目（文件 + 目录混着）：逐个调 import-local，落点一致', async () => {
  const restore = installGlobals()
  try {
    const f1 = osFile('a.pdf')
    const dir = osFile('证据')
    const vm = makeVm({
      desktopPaths: new Map([[f1, '/Users/me/a.pdf'], [dir, '/Users/me/证据']]),
    })
    await vm.onRootDrop(wrappedEvent({ dataTransfer: osDataTransfer([f1, dir]) }))
    assert.deepEqual(vm.calls.importLocal, [
      [42, '/Users/me/a.pdf', null],
      [42, '/Users/me/证据', null],
    ])
    assert.equal(vm.calls.loadFiles, 1, '整批导完只刷一次树')
  } finally { restore() }
})

test('uni 重建的事件没有 dataTransfer：从 window.event 上取原生 dataTransfer，照常导入', async () => {
  const restore = installGlobals()
  try {
    const file = osFile('a.pdf')
    const vm = makeVm({ desktopPaths: new Map([[file, '/Users/me/a.pdf']]) })
    vm.windowedDisplayFiles = [folder]
    vm.displayFiles = [folder]
    globalThis.window.event = { dataTransfer: osDataTransfer([file]) }
    await vm.handleDrop(wrappedEvent(), 0)
    assert.deepEqual(vm.calls.importLocal, [[42, '/Users/me/a.pdf', 7]])
  } finally { restore() }
})

test('drop 到文件节点：落到该文件所在目录（同级）', async () => {
  const restore = installGlobals()
  try {
    const file = osFile('a.pdf')
    const vm = makeVm({ desktopPaths: new Map([[file, '/Users/me/a.pdf']]) })
    vm.windowedDisplayFiles = [folder, doc]
    vm.displayFiles = [folder, doc]
    await vm.handleDrop(wrappedEvent({ dataTransfer: osDataTransfer([file]) }), 1)
    assert.deepEqual(vm.calls.importLocal, [[42, '/Users/me/a.pdf', 7]], 'doc 的 parentId 是 7')
  } finally { restore() }
})

test('drop 到根投放区 / 树空白区：落到项目根（parent=null）', async () => {
  const restore = installGlobals()
  try {
    const a = osFile('a.pdf')
    const vm = makeVm({ desktopPaths: new Map([[a, '/Users/me/a.pdf']]) })
    await vm.onRootDrop(wrappedEvent({ dataTransfer: osDataTransfer([a]) }))
    assert.deepEqual(vm.calls.importLocal, [[42, '/Users/me/a.pdf', null]])
    assert.deepEqual(vm.calls.moveFile, [])

    const b = osFile('b.pdf')
    const vm2 = makeVm({ desktopPaths: new Map([[b, '/Users/me/b.pdf']]) })
    vm2.externalDragActive = true
    await vm2.onTreeDrop(wrappedEvent({ dataTransfer: osDataTransfer([b]) }))
    assert.deepEqual(vm2.calls.importLocal, [[42, '/Users/me/b.pdf', null]])
    assert.equal(vm2.externalDragActive, false)
  } finally { restore() }
})

test('非桌面端（解析不出本机路径）：只提示「仅桌面端支持」，一条都不导、树也不刷', async () => {
  const restore = installGlobals()
  try {
    // 浏览器：host.fs 整个缺席
    const vm = makeVm()
    vm.windowedDisplayFiles = [folder]
    vm.displayFiles = [folder]
    await vm.handleDrop(wrappedEvent({ dataTransfer: osDataTransfer([osFile('a.pdf')]) }), 0)
    assert.deepEqual(vm.calls.importLocal, [])
    assert.equal(vm.calls.loadFiles, 0)
    assert.deepEqual(vm.calls.toasts, ['fileTree.importDesktopOnly'])

    // 桌面壳在，但这个 File 解析不出路径（webUtils 返回空串）：同样只提示一次
    const vm2 = makeVm({ desktopPaths: new Map() })
    vm2.windowedDisplayFiles = [folder]
    vm2.displayFiles = [folder]
    await vm2.handleDrop(
      wrappedEvent({ dataTransfer: osDataTransfer([osFile('b.pdf'), osFile('c.pdf')]) }), 0)
    assert.deepEqual(vm2.calls.importLocal, [])
    assert.deepEqual(vm2.calls.toasts, ['fileTree.importDropUnreadable'], '一次 drop 只提示一次')
  } finally { restore() }
})

test('同一次 drop 节点与容器各收到一次：只导入一次', async () => {
  const restore = installGlobals()
  try {
    const file = osFile('a.pdf')
    const vm = makeVm({ desktopPaths: new Map([[file, '/Users/me/a.pdf']]) })
    vm.windowedDisplayFiles = [folder]
    vm.displayFiles = [folder]
    const native = { dataTransfer: osDataTransfer([file]) }
    globalThis.window.event = native
    await vm.handleDrop(wrappedEvent(), 0)
    await vm.onTreeDrop(wrappedEvent())
    assert.deepEqual(vm.calls.importLocal, [[42, '/Users/me/a.pdf', 7]],
      '第一次认领的落点（文件夹）生效，容器那次不许再导一遍到根')
  } finally { restore() }
})

test('import-local 失败：照样刷新文件树，且不偷偷退回别的通道', async () => {
  const restore = installGlobals()
  try {
    const file = osFile('证据.pdf')
    const vm = makeVm({ desktopPaths: new Map([[file, '/Users/me/证据.pdf']]), importLocalFails: true })
    await vm.onRootDrop(wrappedEvent({ dataTransfer: osDataTransfer([file]) }))
    assert.equal(vm.calls.importLocal.length, 1)
    assert.equal(vm.calls.loadFiles, 1)
    assert.ok(vm.calls.toasts.includes('fileTree.importFailed'))
  } finally { restore() }
})

test('树内节点 drop 仍走原来的 moveFile 移动逻辑，不碰导入通道', async () => {
  const restore = installGlobals()
  try {
    const vm = makeVm()
    vm.windowedDisplayFiles = [doc, folder]
    vm.displayFiles = [doc, folder]
    vm.draggedIndex = 0
    vm.draggedFileId = 1
    const e = wrappedEvent({ dataTransfer: { types: ['text/plain', 'application/x-checkba-file'], files: [], getData: () => '' } })
    await vm.handleDrop(e, 1)
    assert.deepEqual(vm.calls.moveFile, [[42, 1, 7, 0]])
    assert.deepEqual(vm.calls.importLocal, [])
    assert.equal(vm.draggedIndex, -1)
  } finally { restore() }
})

test('回收站视图不接收外部文件', async () => {
  const restore = installGlobals()
  try {
    const file = osFile('a.pdf')
    const vm = makeVm({ desktopPaths: new Map([[file, '/Users/me/a.pdf']]) })
    vm.viewMode = 'recycle'
    vm.windowedDisplayFiles = [folder]
    vm.displayFiles = [folder]
    const dt = osDataTransfer([file])
    await vm.handleDrop(wrappedEvent({ dataTransfer: dt }), 0)
    await vm.onTreeDrop(wrappedEvent({ dataTransfer: dt }))
    vm.onTreeDragEnter(wrappedEvent({ dataTransfer: dt }))
    assert.deepEqual(vm.calls.importLocal, [])
    assert.equal(vm.externalDragActive, false)
  } finally { restore() }
})

test('dragenter 带外部文件时点亮 externalDragActive（根投放区据此出现），应用内拖拽不点亮', () => {
  const restore = installGlobals()
  try {
    const vm = makeVm()
    vm.onTreeDragEnter(wrappedEvent({ dataTransfer: { types: ['text/plain'], files: [] } }))
    assert.equal(vm.externalDragActive, false)
    vm.onTreeDragEnter(wrappedEvent({ dataTransfer: { types: ['Files'], files: [] } }))
    assert.equal(vm.externalDragActive, true)
    // 离开整个容器（relatedTarget 为 null = 拖出窗口）后复位
    globalThis.window.event = { relatedTarget: null }
    vm.onTreeDragLeave(wrappedEvent())
    assert.equal(vm.externalDragActive, false)
  } finally { restore() }
})

// ---------- 暂存区借用的入口 ----------

test('importDroppedLocalFiles 是暂存区能直接调的公开方法：吃 File 列表 + 落点 id', async () => {
  const restore = installGlobals()
  try {
    const a = osFile('a.pdf')
    const vm = makeVm({ desktopPaths: new Map([[a, '/Users/me/a.pdf']]) })
    assert.equal(typeof vm.importDroppedLocalFiles, 'function')
    await vm.importDroppedLocalFiles([a], 'stage-1')
    assert.deepEqual(vm.calls.importLocal, [[42, '/Users/me/a.pdf', 'stage-1']])
    assert.equal(vm.calls.loadFiles, 1)
  } finally { restore() }
})

test('generated files only move within the payload project, including global fallback', async () => {
  const restore = installGlobals()
  try {
    for (const root of [false, true]) for (const fallback of [false, true]) for (const projectId of [42, 99]) {
      const vm = makeVm(); vm.windowedDisplayFiles = [folder]; vm.displayFiles = [folder]
      const payload = { fileId: 123, name: '生成.docx', projectId, source: 'chat-generated' }
      document.__checkbaDraggedFile = fallback ? payload : null
      const dt = { files: [], types: ['application/x-checkba-file'], getData: () => fallback ? '' : JSON.stringify(payload) }
      const e = wrappedEvent({ dataTransfer: dt })
      if (root) await vm.onRootDrop(e); else await vm.handleDrop(e, 0)
      assert.equal(vm.calls.moveFile.length, projectId === 42 ? 1 : 0)
      if (projectId === 42) assert.equal(vm.calls.moveFile[0][1], 123)
    }
  } finally { restore() }
})

test('#1182 items-only 文件拖放也进入 import-local', async () => {
  const restore = installGlobals()
  try {
    const file = osFile('items.txt')
    const vm = makeVm({ desktopPaths: new Map([[file, '/tmp/awd-drop-fixture/items.txt']]) })
    await vm.onRootDrop(wrappedEvent({ dataTransfer: { files: [], types: [], items: [
      { kind: 'file', getAsFile: () => file },
    ], getData: () => '' } }))
    assert.deepEqual(vm.calls.importLocal, [[42, '/tmp/awd-drop-fixture/items.txt', null]])
  } finally { restore() }
})

test('#1182 只有 file URL 的拖放明确提示，不能把字符串当本机文件授权', async () => {
  const restore = installGlobals()
  try {
    const vm = makeVm({ desktopPaths: new Map() })
    await vm.onTreeDrop(wrappedEvent({ dataTransfer: { files: [], types: ['text/uri-list'], items: [],
      getData: type => type === 'text/uri-list' ? 'file:///tmp/awd-drop-fixture/example.txt' : '' } }))
    assert.deepEqual(vm.calls.importLocal, [])
    assert.deepEqual(vm.calls.toasts, ['fileTree.importDropUnreadable'])
  } finally { restore() }
})

test('#1182 桌面无路径且不可读的 File 不能误报为非桌面', async () => {
  const restore = installGlobals()
  try {
    const vm = makeVm({ desktopPaths: new Map() })
    await vm.onRootDrop(wrappedEvent({ dataTransfer: osDataTransfer([osFile('missing.txt')]) }))
    assert.deepEqual(vm.calls.importLocal, [])
    assert.deepEqual(vm.calls.toasts, ['fileTree.importDropUnreadable'])
  } finally { restore() }
})

test('#1182 无本机路径的 File 先按字节暂存，再原子导入并释放token', async () => {
  const restore = installGlobals()
  try {
    const calls = [], file = new File(['full original bytes'], 'source.txt')
    const vm = makeVm({ desktopFs: {
      getPathForFile: () => '',
      stageDroppedFile: async item => { calls.push(['stage', await new Blob([item.bytes]).text()]); return { ok: true, path: '/tmp/awd-drop-fixture/source.txt', token: 'fixture-token' } },
      releaseDroppedFile: async token => { calls.push(['release', token]); return { ok: true } },
    } })
    await vm.onRootDrop(wrappedEvent({ dataTransfer: osDataTransfer([file]) }))
    assert.deepEqual(calls, [['stage', 'full original bytes'], ['release', 'fixture-token']])
    assert.deepEqual(vm.calls.importLocal, [[42, '/tmp/awd-drop-fixture/source.txt', null]])
    assert.deepEqual(vm.calls.toasts, ['fileTree.importSuccessCount'])
    assert.equal(vm.calls.loadFiles, 1)
  } finally { restore() }
})

test('#1288 从资源管理器拖拽文件向软件外（微信聊天 / Finder）：预取本机路径并在 dragstart 启动系统级 startDrag，同时不破坏树内移动', async () => {
  const restore = installGlobals()
  clearLocalPathCache()
  try {
    const started = []
    const listeners = new Map()
    globalThis.window.addEventListener = (type, fn) => { listeners.set(type, fn) }
    globalThis.window.removeEventListener = (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type)
    }

    const vm = makeVm({
      desktopFs: {
        startDrag(p) {
          started.push(p)
          return { ok: true }
        },
      },
      getFileLocalPath: async (id) => ({
        data: { path: `/Users/me/Documents/案件/${id}-起诉状.docx`, exists: true },
      }),
    })
    vm.windowedDisplayFiles = [doc, folder]
    vm.displayFiles = [doc, folder]

    // 1. 鼠标移入/按下时预取本机路径
    vm.onItemPrimeDrag(doc)
    await new Promise((r) => setTimeout(r, 10))

    // 2. uni-h5 <view> 的 dragstart 事件没有 dataTransfer，靠 window.event 兜底，并启动原生 startDrag
    const setDataCalls = []
    const nativeDt = {
      effectAllowed: 'uninitialized',
      dropEffect: 'none',
      types: ['Files'], // startDrag 激活后 OS 会给拖拽会话挂上 Files
      files: [],
      setData(k, v) { setDataCalls.push([k, v]) },
      getData: () => '',
    }
    globalThis.window.event = { dataTransfer: nativeDt, clientX: 10, clientY: 10 }
    vm.handleDragStart(wrappedEvent(), doc, 0)

    assert.deepEqual(started, ['/Users/me/Documents/案件/1-起诉状.docx'], '应调用 host.fs.startDrag 把真实文件路径交给系统拖拽（微信可直接接收）')
    assert.ok(setDataCalls.some(([k]) => k === 'application/x-checkba-file'), '通过 nativeDataTransfer 写入内部自定义载荷')
    assert.equal(document.__checkbaDraggedFile.fileId, 1)

    // 3. startDrag 把 effectAllowed 锁成 copy 且 types 带 Files 时，树内移动仍走 moveFile 而非外部导入
    nativeDt.effectAllowed = 'copy'
    assert.equal(isExternalFileDrag(nativeDt), false, '内部拖拽在途时不应误判为外部文件拖入')
    vm.handleDragOver(wrappedEvent(), 1)
    assert.equal(nativeDt.dropEffect, 'copy', 'effectAllowed=copy 时兼容设置为 copy，避免禁止光标')

    globalThis.window.event = { dataTransfer: nativeDt, clientX: 40, clientY: 60 }
    await vm.handleDrop(wrappedEvent(), 1)
    assert.deepEqual(vm.calls.moveFile, [[42, 1, 7, 0]], '树内拖到文件夹仍正常移动')
    assert.deepEqual(vm.calls.importLocal, [], '绝不误走外部导入')

    // 4. 若拖到软件外（如微信窗口）松手后未触发 DOM dragend，鼠标移回窗口（buttons=0）自动清理拖拽态
    vm.handleDragStart(wrappedEvent(), doc, 0)
    assert.equal(vm.draggedIndex, 0)
    assert.ok(document.__checkbaDraggedFile)
    const onMove = listeners.get('mousemove')
    assert.equal(typeof onMove, 'function')
    onMove({ buttons: 0 })
    assert.equal(vm.draggedIndex, -1, '外部松手后移回窗口应自动复位 draggedIndex')
    assert.equal(document.__checkbaDraggedFile, null, '外部松手后应清理全局拖拽兜底')
  } finally {
    clearLocalPathCache()
    restore()
  }
})


function dragWindow() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
    fire(type, event = {}) { listeners.get(type)?.(event) },
  }
}

test('#1306 外拖工具整组解析路径，不静默漏掉一份文件', async () => {
  clearLocalPathCache()
  const win = dragWindow()
  const sent = []
  let cleaned = 0
  const options = {
    fs: { startDrag(paths) { sent.push(paths); return { ok: true } } },
    win,
    onCleanup: () => { cleaned++ },
  }
  const files = [
    { id: 700, localPath: '/synthetic/甲.docx' },
    { id: 701, localPath: '/synthetic/乙.pdf' },
  ]
  assert.deepEqual(startExternalFileDrag(files, options), { ok: true, paths: files.map(f => f.localPath) })
  assert.deepEqual(sent, [files.map(f => f.localPath)])
  win.fire('mousedown')
  assert.equal(cleaned, 1)
  assert.equal(win.listeners.size, 0)
  assert.equal(startExternalFileDrag([files[0], { id: 702 }], options).reason, 'no-local-path')
  assert.equal(sent.length, 1, '第二份路径缺失时，不启动只含第一份的原生拖拽')
  assert.equal(cleaned, 1, '缺少原生路径不能提前终止内部拖拽')
  assert.ok(win.listeners.has('drop'))
  win.fire('drop')
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(cleaned, 2)
  assert.equal(win.listeners.size, 0)
  clearLocalPathCache()
})

test('#1307 native同步/异步失败保留内部身份，到真实完成信号才清理', async () => {
  for (const failure of ['returned', 'thrown', 'resolved-failure', 'rejected']) {
    const win = dragWindow()
    let cleaned = 0
    let internalFileId = 700
    const result = await startExternalFileDrag({ id: 700, localPath: '/synthetic/甲.docx' }, {
      win,
      onCleanup() { cleaned++; internalFileId = null },
      fs: { startDrag() {
        assert.ok(win.listeners.has('focus'))
        assert.ok(win.listeners.has('mouseup'))
        if (failure === 'thrown') throw new Error('native failure')
        if (failure === 'rejected') return Promise.reject(new Error('native failure'))
        if (failure === 'resolved-failure') return Promise.resolve({ ok: false, reason: 'native failure' })
        return { ok: false, reason: 'native failure' }
      } },
    })
    assert.equal(result.ok, false)
    assert.equal(cleaned, 0)
    assert.equal(internalFileId, 700)
    assert.ok(win.listeners.has('dragend'))
    win.fire(failure === 'rejected' ? 'focus' : 'dragend')
    assert.equal(internalFileId, 700, '同步drop消费者仍能读取内部身份')
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(internalFileId, null)
    assert.equal(cleaned, 1)
    assert.equal(win.listeners.size, 0)
  }
})

test('#1307 丢失dragend后回焦、松鼠标、Esc均清理，drop同步消费者先读载荷', async () => {
  for (const type of ['focus', 'mouseup', 'pointerup', 'keydown', 'drop', 'dragend']) {
    const win = dragWindow()
    let armed = true
    let cleanups = 0
    installExternalDragCleanup(() => { armed = false; cleanups++ }, win)
    win.fire('blur')
    assert.equal(armed, true, '跨窗拖拽仍在进行时不能在blur清掉内部身份')
    win.fire('mousemove', { buttons: 1 })
    win.fire('keydown', { key: 'ArrowDown' })
    assert.equal(armed, true)
    win.fire(type, { key: 'Escape' })
    assert.equal(armed, true, '当次drop处理器应仍能同步消费载荷')
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(armed, false, `${type}必须撤掉透明投放层`)
    assert.equal(cleanups, 1)
    assert.equal(win.listeners.size, 0)
    win.fire('mousedown')
    assert.equal(cleanups, 1)
  }
})

test('#1307 连续拖拽清除前一次监听，不留下可重复执行的清理器', () => {
  const first = dragWindow()
  const second = dragWindow()
  let cleaned = 0
  installExternalDragCleanup(() => { cleaned++ }, first)
  installExternalDragCleanup(() => { cleaned++ }, second)
  assert.equal(first.listeners.size, 0)
  second.fire('mousemove', { buttons: 0 })
  assert.equal(cleaned, 1)
  assert.equal(second.listeners.size, 0)
})


test('#1306 资源管理器Cmd与勾选多选都预取并拖出整组，未选中行仍只拖自己', async () => {
  const restore = installGlobals()
  try {
    for (const selectionMode of [false, true]) {
      clearLocalPathCache()
      const win = dragWindow()
      Object.assign(window, win)
      const started = []
      const prefetched = []
      const vm = makeVm({
        desktopFs: { startDrag(paths) { started.push(paths); return { ok: true } } },
        getFileLocalPath: async id => {
          prefetched.push(id)
          return { path: `/synthetic/${id}.docx`, exists: true }
        },
      })
      const first = { id: 800, name: '甲.docx', fileType: 'docx' }
      const second = { id: 801, name: '乙.docx', fileType: 'docx' }
      const unselected = { id: 802, name: '未选.docx', fileType: 'docx' }
      vm.files = [first, second, unselected]
      vm.displayFiles = vm.files
      vm.windowedDisplayFiles = vm.files
      vm.selectionMode = selectionMode
      vm.multiSelectedIds = selectionMode ? [] : [first.id, second.id]
      vm.checkedMap = selectionMode ? { 800: true, 801: true } : {}
      Object.defineProperty(vm, 'checkedIds', { get: () => Object.keys(vm.checkedMap).filter(id => vm.checkedMap[id]).map(Number) })
      vm.onItemPrimeDrag(first)
      await new Promise(resolve => setTimeout(resolve, 5))
      assert.deepEqual(prefetched.sort(), [800, 801])
      vm.handleDragStart(wrappedEvent(), first, 0)
      assert.deepEqual(started, [['/synthetic/800.docx', '/synthetic/801.docx']])
      // 即便其他drop消费者已清掉global兜底与源索引，仍须发end撤掉透明层。
      document.__checkbaDraggedFile = null
      vm.draggedIndex = -1
      vm.rootDropActive = vm.externalDragActive = vm.stagingDragOver = vm.isAnyDragging = true
      win.fire('focus')
      await new Promise(resolve => setTimeout(resolve, 5))
      assert.ok(vm.calls.emits.some(([type]) => type === 'file-drag-end'))
      assert.equal(vm.rootDropActive, false)
      assert.equal(vm.externalDragActive, false)
      assert.equal(vm.stagingDragOver, false)
      assert.equal(vm.isAnyDragging, false)
      vm.onItemPrimeDrag(unselected)
      await new Promise(resolve => setTimeout(resolve, 5))
      vm.handleDragStart(wrappedEvent(), unselected, 2)
      assert.equal(started[1], '/synthetic/802.docx')
      win.fire('mousedown')
    }
  } finally {
    clearLocalPathCache()
    restore()
  }
})


test('#1307 异步预取失败后仍可用uni包装事件完成树内移动，drop后清理', async () => {
  const restore = installGlobals()
  clearLocalPathCache()
  try {
    const win = dragWindow()
    Object.assign(window, win)
    let nativeStarts = 0
    const vm = makeVm({
      desktopFs: { startDrag() { nativeStarts++; return { ok: true } } },
      getFileLocalPath: async () => { throw new Error('local path unavailable') },
    })
    vm.windowedDisplayFiles = [doc, folder]
    vm.displayFiles = [doc, folder]
    vm.onItemPrimeDrag(doc)
    await new Promise(resolve => setTimeout(resolve, 5))
    const nativeDt = { types: [], files: [], setData() {}, getData() { return '' } }
    window.event = { dataTransfer: nativeDt, clientX: 1, clientY: 1 }
    vm.handleDragStart(wrappedEvent(), doc, 0)
    assert.equal(nativeStarts, 0)
    assert.equal(vm.draggedFileId, doc.id)
    assert.equal(document.__checkbaDraggedFile.fileId, doc.id)
    assert.equal(vm.calls.emits.filter(e => e[0] === 'file-drag-end').length, 0)
    window.event = { dataTransfer: nativeDt, clientX: 40, clientY: 60 }
    win.fire('drop')
    await vm.handleDrop(wrappedEvent(), 1)
    assert.deepEqual(vm.calls.moveFile, [[42, doc.id, folder.id, 0]])
    assert.deepEqual(vm.calls.importLocal, [])
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(vm.draggedIndex, -1)
    assert.equal(document.__checkbaDraggedFile, null)
    assert.equal(win.listeners.size, 0)
  } finally {
    clearLocalPathCache()
    restore()
  }
})


test('#1307 cancel the browser drag before starting the native session', () => {
  const win = dragWindow(), order = []
  const event = { preventDefault() { order.push('cancel-html') } }
  let cleaned = 0
  const result = startExternalFileDrag({ id: 1, localPath: '/synthetic/a.docx' }, {
    event, win, onCleanup: () => { cleaned++ },
    fs: { startDrag() { order.push('native'); return { ok: true } } },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(order, ['cancel-html', 'native'])
  assert.equal(cleaned, 0, 'native dispatch is not drag completion')
  win.fire('mousemove', { buttons: 0 })
  assert.equal(cleaned, 1)
})

test('#1307 unsupported or unresolved native export keeps the browser drag', () => {
  clearLocalPathCache()
  for (const options of [{ fs: {} }, { fs: { startDrag() { assert.fail('no paths') } } }]) {
    let cancelled = false
    const win = dragWindow()
    const result = startExternalFileDrag({ id: 9999 }, {
      ...options, win, event: { preventDefault() { cancelled = true } }, onCleanup() {},
    })
    assert.equal(result.ok, false)
    assert.equal(cancelled, false)
    win.fire('mousedown')
  }
})

test('#1307 failed native dispatch after cancelling HTML releases the drag identity', async () => {
  for (const failure of ['returned', 'thrown', 'resolved-failure', 'rejected']) {
    const win = dragWindow()
    let cleaned = 0, cancelled = false
    const result = await startExternalFileDrag({ id: 700, localPath: '/synthetic/a.docx' }, {
      win, event: { preventDefault() { cancelled = true } }, onCleanup() { cleaned++ },
      fs: { startDrag() {
        assert.equal(cancelled, true)
        if (failure === 'thrown') throw new Error('native failure')
        if (failure === 'rejected') return Promise.reject(new Error('native failure'))
        const result = { ok: false, reason: 'native failure' }
        return failure === 'resolved-failure' ? Promise.resolve(result) : result
      } },
    })
    assert.equal(result.ok, false)
    assert.equal(cleaned, 1, failure)
    assert.equal(win.listeners.size, 0)
  }
})

test('#1307 FileTree passes the real uni-h5 native event to the handoff', () => {
  const restore = installGlobals()
  try {
    const order = []
    const vm = makeVm({ desktopFs: { startDrag() { order.push('native'); return { ok: true } } } })
    const item = { ...doc, localPath: '/synthetic/a.docx' }
    window.event = { dataTransfer: { setData() {} }, preventDefault() { order.push('cancel-html') } }
    vm.handleDragStart(wrappedEvent(), item, 0)
    assert.deepEqual(order, ['cancel-html', 'native'])
    assert.equal(document.__checkbaDraggedFile.fileId, item.id, 'retain identity for native internal drops')
    vm.handleDragEnd()
  } finally { restore() }
})


test('#1307 late native failure from the previous drag cannot clean the new drag', async () => {
  const win = dragWindow()
  let rejectFirst, oldCleaned = 0, newCleaned = 0
  const event = { preventDefault() {} }
  const first = startExternalFileDrag({ id: 1, localPath: '/synthetic/old.docx' }, {
    event, win, onCleanup: () => { oldCleaned++ },
    fs: { startDrag: () => new Promise((resolve, reject) => { rejectFirst = reject }) },
  })
  startExternalFileDrag({ id: 2, localPath: '/synthetic/new.docx' }, {
    event, win, onCleanup: () => { newCleaned++ }, fs: { startDrag: () => ({ ok: true }) },
  })
  rejectFirst(new Error('old native request failed'))
  assert.equal((await first).ok, false)
  assert.equal(oldCleaned, 0)
  assert.equal(newCleaned, 0)
  assert.ok(win.listeners.has('mousemove'))
  win.fire('mousemove', { buttons: 0 })
  assert.equal(newCleaned, 1)
})


// #1381: the native handoff and an internal folder drop must use the same selection.
for (const selectionMode of [false, true]) {
  for (const root of [false, true]) {
    test(`#1381 multi-selection moves both files (${selectionMode ? 'checkbox' : 'Cmd'}, ${root ? 'root' : 'folder'})`, async () => {
      const restore = installGlobals()
      try {
        const vm = makeVm()
        const a = { id: 801, name: '甲.txt', parentId: 9 }
        const b = { id: 802, name: '乙.txt', parentId: 9 }
        vm.files = vm.allFiles = vm.displayFiles = vm.windowedDisplayFiles = [a, b, folder]
        vm.selectionMode = selectionMode
        vm.multiSelectedIds = [801, 802]
        vm.checkedMap = { 801: true, 802: true }
        Object.defineProperty(vm, 'checkedIds', { get: () => Object.keys(vm.checkedMap).filter(id => vm.checkedMap[id]).map(Number) })
        vm.handleDragStart(wrappedEvent(), a, 0)
        // Background selection changes must not change the drag that is already in flight.
        vm.multiSelectedIds = [801]
        if (root) await vm.onRootDrop(wrappedEvent()); else await vm.handleDrop(wrappedEvent(), 2)
        assert.deepEqual(vm.calls.batchMoveFiles, [[42, [801, 802], root ? null : 7]])
        assert.deepEqual(vm.calls.moveFile, [])
        assert.equal(vm.calls.loadFiles, 1)
        assert.deepEqual(vm.multiSelectedIds, [])
        assert.deepEqual(vm.checkedMap, {})
      } finally { restore() }
    })
  }
}

test('#1381 folder plus selected descendants moves the folder once and never into itself', async () => {
  const restore = installGlobals()
  try {
    const vm = makeVm()
    const child = { id: 801, parentId: folder.id }
    const target = { id: 9, isFolder: true, parentId: null }
    vm.files = vm.allFiles = vm.displayFiles = vm.windowedDisplayFiles = [folder, child, target]
    vm.multiSelectedIds = [folder.id, child.id]
    vm.handleDragStart(wrappedEvent(), folder, 0)
    await vm.handleDrop(wrappedEvent(), 2)
    assert.deepEqual(vm.calls.batchMoveFiles, [[42, [folder.id], 9]])
    vm.multiSelectedIds = [folder.id, child.id]
    vm.handleDragStart(wrappedEvent(), folder, 0)
    await vm.handleDrop(wrappedEvent(), 1)
    assert.equal(vm.calls.batchMoveFiles.length, 1, 'must reject destination under a selected folder')
  } finally { restore() }
})

test('#1381 partial move response reports occupied and reloads, rejected batch also reloads', async () => {
  const restore = installGlobals()
  try {
    for (const reject of [false, true]) {
      const vm = makeVm({ batchMoveFiles: async () => {
        if (reject) throw new Error('move failed')
        return { data: { files: [{ id: 801, parentId: 7 }, { id: 802, parentId: null }] } }
      } })
      const a = { id: 801, parentId: null }, b = { id: 802, parentId: null }
      vm.files = vm.allFiles = vm.displayFiles = vm.windowedDisplayFiles = [a, b, folder]
      vm.multiSelectedIds = [801, 802]
      vm.handleDragStart(wrappedEvent(), a, 0)
      await vm.handleDrop(wrappedEvent(), 2)
      assert.equal(vm.calls.loadFiles, 1)
      assert.ok(!vm.calls.toasts.includes('fileTree.moveSuccess'))
      assert.equal(vm.draggedIndex, -1)
    }
  } finally { restore() }
})

test('#1381 reload invalidates drag paths and ignores a late pre-move listing', async () => {
  const restore = installGlobals()
  try {
    const pending = []
    const options = loadOptions({ ICONS: {}, clearLocalPathCache,
      getProjectFiles: () => new Promise(resolve => pending.push(resolve)),
    })
    const vm = { ...options.data(), projectId: 42, parentId: null, showTree: false,
      $t: key => key, scheduleRefCountsFetch() {},
    }
    const load = options.methods.loadFiles.bind(vm)
    cacheLocalFilePath(801, '/old/甲.txt')
    const oldLoad = load()
    const newLoad = load()
    pending[1]([{ id: 801, name: '甲.txt', parentId: 7 }])
    await newLoad
    assert.equal(getCachedLocalFilePath(801), '', 'refreshed listing cannot keep pre-move native paths')
    pending[0]([{ id: 801, name: '甲.txt', parentId: null }])
    await oldLoad
    assert.equal(vm.files[0].parentId, 7, 'late old response must not resurrect old parent')
  } finally { clearLocalPathCache(); restore() }
})

test('#1381 reordering the tree during a drag cannot mistake the destination for the old source index', async () => {
  const restore = installGlobals()
  try {
    const vm = makeVm()
    const a = { id: 801, parentId: null }, b = { id: 802, parentId: null }
    vm.files = vm.allFiles = vm.displayFiles = vm.windowedDisplayFiles = [a, b, folder]
    vm.multiSelectedIds = [801, 802]
    vm.handleDragStart(wrappedEvent(), a, 0)
    // An intervening file-tree refresh places the target at the drag's original index.
    vm.files = vm.allFiles = vm.displayFiles = vm.windowedDisplayFiles = [folder, a, b]
    await vm.handleDrop(wrappedEvent(), 0)
    assert.deepEqual(vm.calls.batchMoveFiles, [[42, [801, 802], folder.id]])
    assert.deepEqual(vm.calls.moveFile, [])
    assert.equal(vm.calls.loadFiles, 1)
  } finally { restore() }
})

test('#1381 a previous batch settling after a new drag starts preserves the new selection and drag', async () => {
  const restore = installGlobals()
  try {
    for (const reject of [false, true]) {
      let resolveFirst, rejectFirst
      const batches = []
      const vm = makeVm({ batchMoveFiles: (...args) => {
        batches.push(args)
        if (batches.length === 1) return new Promise((resolve, reject) => {
          resolveFirst = resolve
          rejectFirst = reject
        })
        return Promise.resolve({ data: { files: args[1].map(id => ({ id, parentId: args[2] })) } })
      } })
      const a = { id: 801, parentId: null }, b = { id: 802, parentId: null }
      const c = { id: 803, parentId: null }, d = { id: 804, parentId: null }
      vm.files = vm.allFiles = vm.displayFiles = vm.windowedDisplayFiles = [a, b, folder, c, d]
      vm.multiSelectedIds = [801, 802]
      vm.handleDragStart(wrappedEvent(), a, 0)
      const firstDrop = vm.handleDrop(wrappedEvent(), 2)
      vm.handleDragEnd()
      vm.multiSelectedIds = [803, 804]
      vm.checkedMap = { 803: true, 804: true }
      vm.handleDragStart(wrappedEvent(), c, 3)
      if (reject) rejectFirst(new Error('previous batch failed'))
      else resolveFirst({ data: { files: [{ id: 801, parentId: folder.id }, { id: 802, parentId: folder.id }] } })
      await firstDrop
      assert.deepEqual(vm.draggedFileIds, [803, 804])
      assert.equal(vm.draggedFileId, 803)
      assert.equal(vm.draggedIndex, 3)
      assert.deepEqual(vm.multiSelectedIds, [803, 804])
      assert.deepEqual(vm.checkedMap, { 803: true, 804: true })
      await vm.handleDrop(wrappedEvent(), 2)
      assert.deepEqual(batches, [[42, [801, 802], folder.id], [42, [803, 804], folder.id]])
      assert.equal(vm.calls.loadFiles, 2)
    }
  } finally { restore() }
})


test('#1381 local change subscription follows mount, project switch and unmount', async () => {
  const restore = installGlobals()
  try {
    const subscriptions = [], stopped = [], reloads = []
    const options = loadOptions({ isDesktopHost: () => true, ICONS: {},
      subscribeLocalProjectFileChanges: (id, onChange) => {
        subscriptions.push({ id, onChange }); return () => stopped.push(id)
      },
    })
    const vm = { ...options.data(), projectId: 42, watchLocalFiles: true, loadFiles: () => reloads.push(vm.projectId) }
    Object.assign(vm, options.methods)
    vm.loadFiles = () => reloads.push(vm.projectId)
    vm.subscribeLocalFileChanges()
    assert.equal(subscriptions.length, 0, 'immediate project watcher waits for mount')
    vm._fileChangesMounted = true
    vm.subscribeLocalFileChanges()
    subscriptions[0].onChange()
    assert.deepEqual(reloads, [42])
    vm.projectId = 43
    vm.subscribeLocalFileChanges()
    assert.deepEqual(stopped, [42])
    subscriptions[0].onChange()
    subscriptions[1].onChange()
    assert.deepEqual(reloads, [42, 43], 'old project events cannot reload the current project')
    window.removeEventListener = () => {}
    options.beforeUnmount.call(vm)
    subscriptions[1].onChange()
    assert.deepEqual(stopped, [42, 43])
    assert.deepEqual(reloads, [42, 43])
  } finally { restore() }
})
