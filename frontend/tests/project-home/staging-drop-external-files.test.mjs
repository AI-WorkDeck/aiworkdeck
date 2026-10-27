// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 审计（dev-board#74）两条，都在 FileStagingArea.vue 的 onDrop：
//
// HIGH：暂存区放置区静默丢弃真实的系统文件拖拽。面板对任意拖拽都亮起"松手暂存
// 文件"遮罩，但 onDrop 只认得"项目里已有文件"的内部格式（应用内 JSON /
// document.__checkbaDraggedFile 兜底）；真实拖一个 Finder/Explorer 里的文件进来，
// 两条路径都取不出数据，以前直接什么都不做——遮罩消失，用户以为暂存了，其实
// 什么也没发生。
//
// MEDIUM：把文件夹拖进暂存区没有类型守卫。FileTree.vue 的拖拽对文件/文件夹一视
// 同仁，folder 的 payload 里 fileType==='folder'；暂存区消费端是给 AI 读内容用的，
// 读一个文件夹只会拿到空/报错。
//
// 修法：onDrop 新增第 3 分支，识别到 dataTransfer.files（浏览器原生 File 列表，
// 内部格式两条路径都判定为空时才会走到这里）就 emit('drop-files', ...) 交给宿主
// 走真实上传；两条内部格式解析路径都加 fileType !== 'folder' 守卫。
//
// FileStagingArea.vue 是 Options API 且依赖不多（ICONS 常量 + UnlockHint 组件，
// 组件 import 只在 template/components 里用到，跟 methods 逻辑无关），照
// libre-editor-retry-reentrancy.test.mjs 的套路把 <script> 抠出来 new Function
// 求值，真跑 onDrop。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { captureDroppedFiles, isExternalFileDrag, importDroppedFile, nativeEvent, nativeDataTransfer } from '../../src/utils/fileTreeExternalDrop.js'
import { prefetchLocalFilePath, startExternalFileDrag } from '../../src/utils/fileLocalDrag.js'
import { applyDragImage } from '../../src/utils/dragImage.js'

const SRC = readFileSync(new URL('../../src/components/FileStagingArea.vue', import.meta.url), 'utf8')

function loadOptions(host = {}) {
  const body = SRC.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '')
    .replace(/export default \{/, 'return {')
  const dependencies = {
    ICONS: {}, UnlockHint: {}, FileTypeIcon: {}, host,
    captureDroppedFiles, isExternalFileDrag, nativeEvent, nativeDataTransfer,
    prefetchLocalFilePath, startExternalFileDrag, applyDragImage,
    getApiBaseUrl: () => 'http://fixture.invalid', getAuthHeaders: () => ({}),
  }
  const factory = new Function(...Object.keys(dependencies), body)
  return factory(...Object.values(dependencies))
}

function makeVm(host) {
  const options = loadOptions(host)
  const vm = Object.assign({}, options.data())
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  vm.emitted = []
  vm.$emit = (name, payload) => vm.emitted.push({ name, payload })
  vm.$t = key => key
  return vm
}

function nativeDragFixture(startDrag) {
  const previous = Object.fromEntries(['window', 'document', 'uni'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const listeners = new Map(), signals = [], toasts = [], order = []
  const event = new Event('dragstart', { cancelable: true })
  event.dataTransfer = { setData() {}, types: [], files: [] }
  const preventDefault = event.preventDefault.bind(event)
  event.preventDefault = () => { order.push('prevent-default'); preventDefault() }
  globalThis.window = {
    event,
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type) },
  }
  globalThis.document = {}
  globalThis.uni = {
    $emit: type => signals.push(type),
    showToast: toast => toasts.push(toast),
  }
  const vm = makeVm({ fs: { startDrag(paths) {
    order.push('start-drag')
    assert.equal(event.defaultPrevented, true, '必须在原生启动前取消 Chromium 默认拖拽')
    return startDrag(paths)
  } } })
  const file = { id: 501, name: '暂存合同.docx', fileType: 'docx', localPath: '/synthetic/staging-contract.docx' }
  return {
    vm, file, event, order, signals, toasts, listeners,
    // uni-h5 回调缺 dataTransfer；组件须从 window.event 取得原生事件。
    wrappedEvent: { preventDefault() { throw new Error('应使用已捕获的原生 dragstart') } },
    release() { listeners.get('mousemove')?.({ buttons: 0 }) },
    restore() {
      listeners.get('mousedown')?.()
      for (const [key, descriptor] of Object.entries(previous)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

test('暂存区原生外拖在 IPC 前取消原生 dragstart，成功回执不冒充拖拽结束', async () => {
  const paths = []
  const fixture = nativeDragFixture(path => { paths.push(path); return Promise.resolve({ ok: true }) })
  try {
    fixture.vm.onDragStart(fixture.file, fixture.wrappedEvent)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(fixture.order, ['prevent-default', 'start-drag'])
    assert.deepEqual(paths, [fixture.file.localPath])
    assert.deepEqual(fixture.signals, ['file-drag-start'])
    assert.equal(document.__checkbaDraggedFile.fileId, fixture.file.id)
    assert.deepEqual(fixture.toasts, [])
    fixture.release()
    assert.deepEqual(fixture.signals, ['file-drag-start', 'file-drag-end'])
  } finally { fixture.restore() }
})

test('暂存区外拖身份已被消费者清空时，结束仍广播 file-drag-end 解除编辑器接收层', () => {
  const fixture = nativeDragFixture(() => ({ ok: true }))
  try {
    fixture.vm.onDragStart(fixture.file, fixture.wrappedEvent)
    document.__checkbaDraggedFile = null
    fixture.release()
    assert.deepEqual(fixture.signals, ['file-drag-start', 'file-drag-end'])
    assert.equal(fixture.listeners.size, 0)
  } finally { fixture.restore() }
})

test('暂存区原生启动 Promise 拒绝后清理已取消的拖拽并显示失败提示', async () => {
  const fixture = nativeDragFixture(() => Promise.reject(new Error('native drag unavailable')))
  try {
    fixture.vm.onDragStart(fixture.file, fixture.wrappedEvent)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(fixture.order, ['prevent-default', 'start-drag'])
    assert.equal(document.__checkbaDraggedFile, null)
    assert.deepEqual(fixture.signals, ['file-drag-start', 'file-drag-end'])
    assert.equal(fixture.listeners.size, 0)
    assert.deepEqual(fixture.toasts, [{ title: 'fileTree.externalDragFailed', icon: 'none' }])
  } finally { fixture.restore() }
})

test('真实 OS 文件拖拽（dataTransfer.files，内部格式两条路径都取不到数据）触发 drop-files，而不是被静默丢弃', () => {
  const vm = makeVm()
  const fakeFile = { name: 'report.docx', size: 1024 }
  const e = {
    dataTransfer: {
      getData: () => '', // 两条内部格式（application/x-checkba-file、text/checkba-file-json、text/plain）都空
      files: [fakeFile],
    },
  }
  vm.onDrop(e)
  assert.deepEqual(vm.emitted, [{ name: 'drop-files', payload: [fakeFile] }])
})

test('多个真实文件一起拖入，drop-files 带上完整列表', () => {
  const vm = makeVm()
  const files = [{ name: 'a.pdf' }, { name: 'b.docx' }]
  const e = { dataTransfer: { getData: () => '', files } }
  vm.onDrop(e)
  assert.deepEqual(vm.emitted, [{ name: 'drop-files', payload: files }])
})

test('内部格式拖了个文件夹（fileType===folder）不许被当成可暂存文件收进列表，也不会误落进 OS 兜底分支', () => {
  const vm = makeVm()
  const e = {
    dataTransfer: {
      getData: (type) => type === 'application/x-checkba-file'
        ? JSON.stringify({ fileId: 99, name: '合同文件夹', fileType: 'folder', wpsFileId: null })
        : '',
      files: [], // 内部拖拽没有原生 File 列表
    },
  }
  vm.onDrop(e)
  assert.deepEqual(vm.emitted, [], '文件夹必须被拒绝，且不产生任何 emit（不是"暂存"也不是"上传"）')
})

test('正常文件（非文件夹）内部拖拽照常工作——回归保护，不能因为加了文件夹守卫就误伤普通文件', () => {
  const vm = makeVm()
  const e = {
    dataTransfer: {
      getData: (type) => type === 'application/x-checkba-file'
        ? JSON.stringify({ fileId: 7, name: '起诉状.docx', fileType: 'docx', wpsFileId: 'w1' })
        : '',
      files: [],
    },
  }
  vm.onDrop(e)
  assert.deepEqual(vm.emitted, [{
    name: 'drop',
    payload: [{ id: 7, name: '起诉状.docx', fileType: 'docx', wpsFileId: 'w1' }],
  }])
})

test('全局兜底变量路径（document.__checkbaDraggedFile）同样挡文件夹，且无论是否收进列表都要消费掉该变量', () => {
  const vm = makeVm()
  const priorDocument = globalThis.document
  globalThis.document = { __checkbaDraggedFile: { fileId: 5, name: '文件夹', fileType: 'folder' } }
  try {
    const e = { dataTransfer: { getData: () => '', files: [] } }
    vm.onDrop(e)
    assert.deepEqual(vm.emitted, [])
    assert.equal(globalThis.document.__checkbaDraggedFile, null)
  } finally {
    globalThis.document = priorDocument
  }
})

test('全局兜底变量路径对普通文件仍然照常工作（回归保护）', () => {
  const vm = makeVm()
  const priorDocument = globalThis.document
  globalThis.document = { __checkbaDraggedFile: { fileId: 6, name: 'x.pdf', fileType: 'pdf' } }
  try {
    const e = { dataTransfer: { getData: () => '', files: [] } }
    vm.onDrop(e)
    assert.deepEqual(vm.emitted, [{ name: 'drop', payload: [{ id: 6, name: 'x.pdf', fileType: 'pdf', wpsFileId: undefined }] }])
  } finally {
    globalThis.document = priorDocument
  }
})

test('#1182 暂存区 items-only File 在创建暂存目录前同步启动字节读取', async () => {
  let stillInDrop = true, reads = 0, released = false
  const fs = {
    getPathForFile: () => '',
    stageDroppedFile: async ({ bytes }) => { assert.equal(new Uint8Array(bytes)[0], 97); return { ok: true, path: '/tmp/awd-drop-fixture/a.txt', token: 'token' } },
    releaseDroppedFile: async () => { released = true },
  }
  const vm = makeVm({ fs })
  const file = { name: 'a.txt', size: 1, arrayBuffer() { assert.equal(stillInDrop, true); reads++; return Promise.resolve(Uint8Array.of(97).buffer) } }
  vm.onDrop({ dataTransfer: { files: [], items: [{ kind: 'file', getAsFile: () => file }], getData: () => '' } })
  stillInDrop = false
  assert.equal(reads, 1)
  assert.deepEqual(vm.emitted, [{ name: 'drop-files', payload: [file] }])
  await Promise.resolve() // ensureStagingFolder may await before FileTree sees the File
  await importDroppedFile(vm.emitted[0].payload[0], fs, async () => ({ id: 1 }))
  assert.equal(reads, 1)
  assert.equal(released, true)
})
