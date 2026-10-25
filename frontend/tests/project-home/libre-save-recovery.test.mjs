// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import * as barriers from '../../src/utils/checkpointSaveBarrier.js'
// A6/C10：运行真实组件保存方法，控制导出/上传的在途顺序。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*$/gm, '').replace(/export default \{/, 'return {')
function makeVm(extra = {}) {
  // stampApplication / documentStampApplication 是 B4 的打标链路，这里喂成「开关关着」，
  // 保存行为与打标前完全一致；打标本身另有 libre-save-generator-stamp.test.mjs。
  const options = new Function(...Object.keys(barriers), 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar', 'getFileWriteUrl',
    'stampApplication', 'documentStampApplication', body)(...Object.values(barriers),
    null, null, null, id => '/upload/' + id,
    async (bytes) => bytes, async () => null)
  const vm = {
    ready: true, file: { id: 7, name: '证据清单.docx' }, statusKey: 'ready',
    dirty: true, saving: false, _dirtySince: Date.now(),
    appendLog() {}, scheduleAnchorCheck() {}, $t: k => k,
    executor: { executeCommand: async () => ({ success: true, bytes: [1, 2, 3] }) },
    uploadBytes: async () => {},
  }
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  Object.assign(vm, { appendLog() {}, scheduleAnchorCheck() {}, uploadBytes: async () => {} }, extra)
  return vm
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('保存失败留脏并暂停自动重试；继续输入也不重新排队，手动重试恢复', async () => {
  let exports = 0
  const vm = makeVm({
    executor: { executeCommand: async () => { exports++; return { success: true, bytes: [1] } } },
    uploadBytes: async () => { throw new Error('offline') },
  })
  await vm.autoSave()
  assert.equal(vm.dirty, true)
  assert.equal(vm.statusKey, 'saveFailed')
  assert.equal(vm._savePaused, true)
  vm.onDocModified()
  await vm.autoSave()
  assert.equal(exports, 1, '失败后的自动保存不得继续把导出堆到 worker 上')
  vm.uploadBytes = async () => {}
  assert.equal(await vm.retrySave(), true)
  assert.equal(vm.statusKey, 'ready')
  assert.equal(vm.dirty, false)
  assert.equal(vm._savePaused, false)
})

test('关闭等待有上限：保存仍在途就返回 false，迟到成功仍能落盘且不并发重试', async () => {
  const gate = deferred()
  let uploads = 0
  const vm = makeVm({ uploadBytes: async () => { uploads++; await gate.promise } })
  const pending = vm.autoSave()
  await tick()
  assert.equal(await vm.flushSave({ timeoutMs: 5 }), false)
  assert.equal(vm.saving, true)
  assert.equal(await vm.flushSave({ timeoutMs: 5 }), false)
  assert.equal(uploads, 1)
  gate.resolve()
  await pending
  await vm._flushPromise
  assert.equal(vm.saving, false)
  assert.equal(vm.dirty, false)
})

test('明确放弃后，迟到的导出不得上传；已经在途的上传会被取消', async () => {
  const gate = deferred()
  let uploads = 0, aborted = 0
  const vm = makeVm({
    executor: { executeCommand: () => gate.promise },
    uploadBytes: async () => { uploads++ },
    _saveXhr: { abort: () => { aborted++ } },
  })
  const pending = vm.autoSave()
  vm.discardPendingSave()
  gate.resolve({ success: true, bytes: [1] })
  await pending
  vm.onDocModified()
  await vm.autoSave()
  assert.equal(uploads, 0)
  assert.equal(aborted, 1)
  assert.equal(vm.saving, false)
})

test('关闭保存失败不得清掉 dirty，重试时保存当前完整内容', async () => {
  const vm = makeVm({ uploadBytes: async () => { throw new Error('offline') } })
  assert.equal(await vm.flushSave(), false)
  assert.equal(vm.dirty, true)
  vm.uploadBytes = async () => {}
  assert.equal(await vm.retrySave(), true)
  assert.equal(vm.dirty, false)
})

test('上传请求具备超时和中止终态，不会永远保持 saving', async () => {
  let xhr
  class Xhr {
    constructor() { xhr = this }
    open() {} setRequestHeader() {} send() {}
  }
  const opts = new Function(...Object.keys(barriers), 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar', 'getAuthHeaders', 'XMLHttpRequest', body)(...Object.values(barriers), null, null, null, () => ({}), Xhr)
  const vm = { $t: k => k }
  const pending = opts.methods.uploadBytes.call(vm, '/upload/7', new Uint8Array([1]), 'a.docx')
  assert.equal(xhr.timeout, 60000)
  xhr.ontimeout()
  await assert.rejects(pending, /saveTimeout/)
  xhr.onloadend()
  assert.equal(vm._saveXhr, null)
})

function makeCloseVm(confirm) {
  const s = readFileSync(new URL('../../src/pages/project-overview/fileOpenTabs.js', import.meta.url), 'utf8')
    .replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace('export const fileOpenTabsMethods = {', 'return {')
  const modals = [], toasts = []
  const methods = new Function(...Object.keys(barriers), 'uni', 'activityTracker', s)(...Object.values(barriers), {
    showModal: opts => { modals.push(opts); opts.success({ confirm }) },
    showToast: opts => toasts.push(opts),
  }, { stopActivity() {} })
  let flushed = 0, discarded = 0
  const inst = { ready: true, isError: true, dirty: true, file: { id: 7 },
    flushSave: async () => { flushed++; return false },
    discardPendingSave: () => { discarded++ },
  }
  const vm = { leftFiles: [{ id: 7 }], rightFiles: [], activeFileIdLeft: 7,
    _libreRefs: { 'left:7': inst }, useLibreEditor: () => true,
    isBrowserTab: () => false, $t: k => k, lastActiveIdsByMode: { left: {} },
    saveActiveIdsByMode() {},
  }
  return { vm, close: methods.closeFile.bind(vm), modals, toasts,
    counts: () => ({ flushed, discarded }) }
}

test('保存失败状态也必须尝试落盘；取消放弃时文档留在标签页', async () => {
  const { vm, close, modals, counts } = makeCloseVm(false)
  await close(7, 'left')
  assert.equal(vm.leftFiles.length, 1)
  assert.equal(modals.length, 1)
  assert.deepEqual(counts(), { flushed: 1, discarded: 0 })
})

test('只有明确选择放弃才取消在途保存并关闭标签', async () => {
  const { vm, close, counts } = makeCloseVm(true)
  await close(7, 'left')
  assert.equal(vm.leftFiles.length, 0)
  assert.deepEqual(counts(), { flushed: 1, discarded: 1 })
})

test('关闭等待期间继续输入：保留标签后新改动必须重新进入自动保存队列', async () => {
  const gate = deferred()
  let uploads = 0
  const vm = makeVm({ uploadBytes: async () => { uploads++; if (uploads === 1) await gate.promise } })
  const pending = vm.flushSave()
  await tick()
  vm.onDocModified()
  assert.equal(vm.dirty, true)
  assert.equal(vm._saveTimer, undefined, 'flush 期间暂不并发排自动保存')
  gate.resolve()
  assert.equal(await pending, false, '关标签者必须知道仍有后来输入没保存')
  assert.ok(vm._saveTimer, '解除 flush 闸后必须给后来输入补排保存，不能一直 dirty + ready')
  clearTimeout(vm._saveTimer)
  await vm.autoSave()
  assert.equal(uploads, 2)
  assert.equal(vm.dirty, false)
})

for (const outcome of ['false', 'dirty', 'saving', 'throws', 'saved']) {
  test(`关闭文本标签 ${outcome}：未保存时保留正文并提示重试`, async () => {
    const { vm, close, toasts } = makeCloseVm(false)
    const inst = vm._libreRefs['left:7']
    vm.useLibreEditor = () => false
    vm.isPlainTextFile = () => true
    vm._plainTextRefs = { left: inst }
    inst.flushSave = async () => {
      if (outcome === 'throws') throw new Error('offline')
      if (outcome === 'saved' || outcome === 'saving') inst.dirty = false
      if (outcome === 'saving') inst.saving = true
      return outcome === 'false' ? false : undefined
    }
    await close(7, 'left')
    assert.equal(vm.leftFiles.length, outcome === 'saved' ? 0 : 1)
    assert.equal(toasts.length, outcome === 'saved' ? 0 : 1)
  })
}


test('Office 慢保存超过十秒仍保持等待，真正落盘后才关闭', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { vm, close, modals } = makeCloseVm(false)
  const gate = deferred()
  const inst = makeVm({ uploadBytes: () => gate.promise })
  vm._libreRefs['left:7'] = inst
  const saving = inst.autoSave()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  const closing = close(7, 'left')
  t.mock.timers.tick(11000)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(inst.saving, true)
  assert.equal(vm.leftFiles.length, 1)
  assert.equal(modals.length, 0, '仍在保存不能弹失败/放弃对话框')
  gate.resolve()
  await saving
  t.mock.timers.tick(100)
  await closing
  assert.equal(vm.leftFiles.length, 0)
  assert.equal(inst.dirty, false)
})

test('Office 保存期间重复关闭只等同一次保存，不弹多个放弃对话框', async () => {
  const { vm, close, modals } = makeCloseVm(false)
  const inst = vm._libreRefs['left:7']
  const gate = deferred()
  let calls = 0
  inst.flushSave = async () => {
    calls++
    inst.dirty = false
    inst.saving = true
    await gate.promise
    inst.saving = false
    inst.dirty = true
    return false
  }
  const first = close(7, 'left')
  const second = close(7, 'left')
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(modals.length, 1)
  assert.equal(vm.leftFiles.length, 1)
})

for (const state of ['dirty', 'saving']) {
  test(`Office flush 成功回执之后仍然 ${state} 时保留标签`, async () => {
    const { vm, close, modals, toasts } = makeCloseVm(false)
    const inst = vm._libreRefs['left:7']
    inst.isError = false
    inst.flushSave = async () => {
      inst.dirty = state === 'dirty'
      inst.saving = state === 'saving'
      return true
    }
    await close(7, 'left')
    assert.equal(vm.leftFiles.length, 1)
    assert.equal(modals.length, 0, '保存期间新输入不伪装成保存失败')
    assert.equal(toasts.length, 1)
  })
}

test('保存状态固定展示待保存、保存中、已保存及失败；不再使用保存浮动胶囊', () => {
  const options = new Function(...Object.keys(barriers), 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar', body)(...Object.values(barriers), null, null, null)
  const vm = { ready: true, file: { id: 7, fileSize: 100 }, statusKey: 'ready', dirty: true, saving: false, $t: k => k }
  vm.backendSaveRetryReady = options.methods.backendSaveRetryReady.bind(vm)
  const state = () => options.computed.saveStateText.call(vm)
  assert.equal(state(), 'editor.status.pendingSave')
  vm.saving = true
  assert.equal(state(), 'editor.status.saving')
  vm.dirty = false
  vm.saving = false
  assert.equal(state(), 'editor.status.saved')
  vm.statusKey = 'saveFailed'
  vm.dirty = true
  assert.equal(state(), 'editor.status.saveFailed')
  vm.backendHealthState = { state: 'healthy', ok: true }
  vm.backendHealthRecoverySeq = 1
  vm.backendFailedUpload = { fileId: 7, projectId: undefined, recoverySeq: 0 }
  assert.equal(state(), 'workbench.backendHealth.saveRetryReady', '服务恢复也必须明确文稿尚未保存')
  vm.backendFailedUpload = null
  vm.saving = true
  assert.equal(state(), 'editor.status.saving', '重试期间不能继续说保存失败')
  vm.saving = false
  vm.statusKey = 'ready'
  vm.dirty = false
  vm.file.fileSize = 0
  assert.equal(state(), 'editor.status.noPendingChanges', '新建空模板尚未上传，不谎称已落盘')
  vm._savedOnce = true
  assert.equal(state(), 'editor.status.saved')
  vm.docLoadFailed = true
  assert.equal(state(), '', '装载失败不显示已保存')
  assert.match(source, /class="libre-save-state"/)
  assert.match(source, /v-if="saveStateText \|\| provenanceBarVisible"/)
  for (const statusKey of ['saving', 'saveFailed', 'movedSaveFailed']) {
    assert.equal(options.computed.displayStatus.call({ statusKey, saveStateText: 'status', $t: k => k }), '')
  }
})

for (const recoveryFirst of [false, true]) {
  test(`本地服务恢复${recoveryFirst ? '先于' : '晚于'}上传失败：只提示手动重试，绝不自动补写`, async () => {
    const gate = deferred(); let uploads = 0
    const vm = makeVm({ backendHealthRecoverySeq: 0, backendHealthState: null, backendFailedUpload: null,
      uploadBytes: () => { uploads++; return gate.promise } })
    vm.onBackendHealth( { state: 'degraded', ok: false, updatedAt: 1 })
    const pending = vm.autoSave()
    await tick()
    if (recoveryFirst) vm.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 2 })
    gate.reject(Object.assign(new Error('network'), { backendUnavailable: true }))
    await pending
    if (!recoveryFirst) vm.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 2 })
    assert.equal(vm.backendSaveRetryReady(), true)
    assert.equal(vm.dirty, true)
    assert.equal(vm._savePaused, true)
    assert.equal(uploads, 1, '健康恢复只给恢复保存入口，不写入文稿')
    vm.discardPendingSave()
    assert.equal(vm.backendSaveRetryReady(), false)
  })
}

test('服务恢复不替引擎错误或404/409/权限错误声称可恢复；旧文件/重载/销毁不留恢复提示', async () => {
  for (const error of [new Error('export timeout'), Object.assign(new Error('HTTP 404'), { status: 404 }), Object.assign(new Error('HTTP 409'), { status: 409 }), Object.assign(new Error('HTTP 403'), { status: 403 })]) {
    const vm = makeVm({ backendHealthRecoverySeq: 0, backendHealthState: null, backendFailedUpload: null, uploadBytes: async () => { throw error } })
    vm.onBackendHealth({ state: 'degraded', ok: false, updatedAt: 1 })
    await vm.autoSave()
    vm.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 2 })
    assert.equal(vm.backendSaveRetryReady(), false)
  }
  const vm = makeVm({ backendHealthRecoverySeq: 1, backendHealthState: { state: 'healthy', ok: true }, backendFailedUpload: { fileId: 7, projectId: undefined, recoverySeq: 0 } })
  assert.equal(vm.backendSaveRetryReady(), true)
  vm.file = { id: 8 }
  assert.equal(vm.backendSaveRetryReady(), false)
  vm.file = { id: 7 }; vm._reloading = true
  assert.equal(vm.backendSaveRetryReady(), false)
  vm._reloading = false; vm._backendHealthDisposed = true
  assert.equal(vm.backendSaveRetryReady(), false)
})

test('仅上传网络/超时/5xx有恢复资格，取消及4xx没有', async () => {
  for (const outcome of ['error', 'timeout', 'abort', 500, 503, 404, 409, 403]) {
    let xhr
    class Xhr { constructor() { xhr = this } open() {} setRequestHeader() {} send() {} }
    const opts = new Function(...Object.keys(barriers), 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar', 'getAuthHeaders', 'XMLHttpRequest', body)(...Object.values(barriers), null, null, null, () => ({}), Xhr)
    const pending = opts.methods.uploadBytes.call({ $t: k => k }, '/upload/7', new Uint8Array([1]), 'a.docx')
    if (typeof outcome === 'number') { xhr.status = outcome; xhr.onload() } else xhr['on' + outcome]()
    await assert.rejects(pending, e => Boolean(e.backendUnavailable) === (outcome === 'error' || outcome === 'timeout' || outcome >= 500))
  }
})

test('编辑器健康监听忽略迟到初始响应，卸载清理订阅且迟到事件不能触发保存', async () => {
  const gate = deferred(); let handler, unsubscribed = 0
  const backend = { getHealth: () => gate.promise, onHealthChanged: fn => { handler = fn; return () => unsubscribed++ } }
  const opts = new Function(...Object.keys(barriers), 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar', 'host', 'uni', body)(...Object.values(barriers), null, null, null, { backend }, { $off() {} })
  const vm = makeVm({ backendHealthRecoverySeq: 0, backendHealthState: null, backendFailedUpload: null })
  const watching = opts.methods.watchBackendHealth.call(vm)
  handler({ state: 'failed', ok: false, updatedAt: 2 })
  gate.resolve({ state: 'healthy', ok: true, updatedAt: 1 }); await watching
  assert.equal(vm.backendHealthState.state, 'failed')
  opts.beforeUnmount.call(vm)
  handler({ state: 'healthy', ok: true, updatedAt: 3 })
  assert.equal(vm.backendHealthState.state, 'failed')
  assert.equal(unsubscribed, 1)
  assert.equal(vm.backendFailedUpload, null)
})

test('重载或身份换代后迟到的上传失败不能重新挂恢复提示，引擎错误也不冒充上传错误', async () => {
  const gate = deferred()
  const vm = makeVm({ backendHealthRecoverySeq: 0, backendHealthState: null, backendFailedUpload: null, uploadBytes: () => gate.promise })
  vm.onBackendHealth({ state: 'failed', ok: false, updatedAt: 1 })
  const pending = vm.autoSave(); await tick()
  vm.invalidateBackendSaveHint()
  vm.onBackendHealth({ state: 'healthy', ok: true, updatedAt: 2 })
  gate.reject(Object.assign(new Error('network'), { backendUnavailable: true })); await pending
  assert.equal(vm.backendFailedUpload, null)
  const engine = makeVm({ backendHealthRecoverySeq: 0, backendHealthState: null, backendFailedUpload: null,
    executor: { executeCommand: async () => { throw Object.assign(new Error('engine'), { backendUnavailable: true }) } } })
  await engine.autoSave()
  assert.equal(engine.backendFailedUpload, null)
})

test('版本忙碌只信任明确的未开始写入回执，其他HTTP错误保持未知结果', async () => {
  const confirmed = { code: -1, reason: 'VERSION_BUSY', writeState: 'not_started' }
  for (const [status, response, expected] of [
    [423, confirmed, true], [423, { code: -1, reason: 'VERSION_BUSY' }, false],
    [423, { ...confirmed, code: 0 }, false], [423, { ...confirmed, reason: 'OTHER' }, false],
    [500, confirmed, false], [404, confirmed, false], [423, 'invalid json', false],
  ]) {
    let xhr
    class Xhr { constructor() { xhr = this } open() {} setRequestHeader() {} send() {} }
    const opts = new Function(...Object.keys(barriers), 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar', 'getAuthHeaders', 'XMLHttpRequest', body)(...Object.values(barriers), null, null, null, () => ({}), Xhr)
    const pending = opts.methods.uploadBytes.call({ $t: k => k }, '/upload/7', new Uint8Array([1]), 'a.docx')
    xhr.status = status
    xhr.response = typeof response === 'string' ? response : JSON.stringify(response)
    xhr.onload()
    await assert.rejects(pending, error => error.saveNotPublished === expected)
  }
})

test('真实版本忙碌回执保留正文并可重试，不遗留阻断版本恢复的未知写入', async () => {
  let xhr
  class Xhr { constructor() { xhr = this } open() {} setRequestHeader() {} send() {} }
  const opts = new Function(...Object.keys(barriers), 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar', 'getAuthHeaders', 'XMLHttpRequest', body)(...Object.values(barriers), null, null, null, () => ({}), Xhr)
  const vm = makeVm({ projectId: 'known-version-busy' })
  vm.uploadBytes = opts.methods.uploadBytes.bind(vm)
  const pending = vm.autoSave()
  await tick()
  xhr.status = 423
  xhr.response = JSON.stringify({ code: -1, reason: 'VERSION_BUSY', writeState: 'not_started' })
  xhr.onload()
  await pending
  assert.equal(vm.dirty, true)
  assert.equal(vm._savePaused, true)
  assert.equal(vm.statusKey, 'saveFailed')
  assert.equal(vm.versionSaveBusy, true)
  assert.equal(opts.computed.saveStateText.call(vm), 'editor.status.versionSaveBusy')
  const retry = vm.retrySave()
  await tick()
  xhr.status = 200; xhr.response = '{"code":0}'; xhr.onload()
  assert.equal(await retry, true)
  assert.equal(vm.dirty, false)
  assert.equal(vm.versionSaveBusy, false)
  const barrier = barriers.beginCheckpointSaveBarrier(vm.projectId, vm.file.id, 'after-busy-retry')
  assert.equal(await barrier.drained, true, 'known unpublished saves must not leave an uncertain writer')
  barriers.endCheckpointSaveBarrier(vm.projectId, vm.file.id, 'after-busy-retry')
})

test('版本忙碌的安全回执不能抹掉更早一次网络上传的未知结果', async () => {
  const vm = makeVm({ projectId: 'prior-uncertain-before-busy', uploadBytes: async () => { throw new Error('offline') } })
  await vm.autoSave()
  vm.uploadBytes = async () => { throw Object.assign(new Error('HTTP 423'), { saveNotPublished: true }) }
  assert.equal(await vm.retrySave(), false)
  const barrier = barriers.beginCheckpointSaveBarrier(vm.projectId, vm.file.id, 'keep-uncertain')
  assert.equal(await barrier.drained, false)
  barriers.endCheckpointSaveBarrier(vm.projectId, vm.file.id, 'keep-uncertain')
})
