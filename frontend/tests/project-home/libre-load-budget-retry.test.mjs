// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import * as barriers from '../../src/utils/checkpointSaveBarrier.js'
// dev-board#1018：AI 生成 docx 后自动开新标签，加载页停在 95%「正在打开文档」几分钟。
//
// 三处病灶，逐条锁住：
//   ① load_document 一律 180s 墙钟预算、超时自愈再 180s——小文档也要干等六七分钟；
//      改成按字节数分级（≤1MB 30s / ≤10MB 90s / 更大 180s）。
//   ② 第二次超时 / 引擎明确拒收只落一句泛泛的 loadFailed；改成「文档无法打开」终态
//      （docOpenFailed）+ 诊断码，拒收的文件不做无意义的重启重装。
//   ③ 「一直卡着？点此重试」在 load_document 在途时再追加一条命令，排在挂住那条后面
//      越点越卡；改成重建引擎，且在途那条超时回来不许把新引擎 boot 期间的状态落成失败。
//
// 同 libre-editor-retry-reentrancy：把 .vue 的 <script> 抠出来 new Function 求值，真跑方法。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  classifyLoadFailure, shouldSelfHealLoadFailure, loadBudgetMs, openFailureOf, STATUS_OPEN_FAILED,
  DIAG_DOC_REJECTED, DIAG_LOAD_TIMEOUT, DIAG_DOC_ENCRYPTED, isEncryptedOoxml,
} from '../../src/utils/editorLoadFailure.js'
import { createAuthorNameResolver } from '../../src/utils/editorAuthor.js'

const SRC = readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')

function loadOptions() {
  const body = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
    .replace(/^import OfficeNavigation .*$/m, 'const OfficeNavigation = {}')
    .replace(/^import .*$/gm, '')
    .replace(/import\('@\/utils\/officeEncryption\.js'\)/g, '__officeEncryption()')
    .replace(/export default \{/, 'return {')
  const factory = new Function('__officeEncryption', ...Object.keys(barriers),
    'getFileBytesUrl', 'getCurrentUser', 'createRelayExecutor',
    'webviewTransport', 'iframeTransport', 'ReviewPanel', 'EditorToolbar', 'EvidenceStaleBar',
    'getAuthHeaders', 'host', 'classifyLoadFailure', 'shouldSelfHealLoadFailure',
    'createAuthorNameResolver', 'loadBudgetMs', 'openFailureOf', 'STATUS_OPEN_FAILED', 'DIAG_DOC_REJECTED', 'DIAG_DOC_ENCRYPTED', 'isEncryptedOoxml', body)
  return factory(() => import('../../src/utils/officeEncryption.js'), ...Object.values(barriers), (id) => '/download/' + id, () => ({ name: '测试用户' }),
    null, null, null, null, null, null, null,
    { zetaoffice: { getEditor: async () => ({ kind: 'iframe', url: 'about:blank' }) } },
    classifyLoadFailure, shouldSelfHealLoadFailure, createAuthorNameResolver,
    loadBudgetMs, openFailureOf, STATUS_OPEN_FAILED, DIAG_DOC_REJECTED, DIAG_DOC_ENCRYPTED, isEncryptedOoxml)
}
const OPTIONS = loadOptions()
const METHODS = OPTIONS.methods
const tick = () => new Promise((r) => setTimeout(r, 0))
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}
const TIMEOUT = { success: false, message: 'Editor result timed out', code: 'EDITOR_RESULT_TIMEOUT', outcomeUnknown: true }

// 引擎已空白就绪、正要装真文档的组件状态。executor.executeCommand 由各用例接管。
function makeVm(exec, fileSize = 4096) {
  const vm = {
    file: { id: 7, name: 'AI生成报告.docx', fileType: 'docx', fileSize },
    ready: false, statusKey: 'loadingDoc', docKind: 'writer', docLoadFailed: false,
    bootPct: 75, bootCap: 95, bootStageKey: 'openingDoc', dlLoaded: 0, dlTotal: 0, stuck: false,
    openFailCode: '',
    _endpointUp: true,
    emitted: [], calls: [], remounts: 0,
    $emit(ev, arg) { this.emitted.push([ev, arg]) },
    appendLog() {}, startBootTrickle() {}, logLoadFailure() {}, initEvidence() {},
    fetchDocumentBytes: async () => new ArrayBuffer(fileSize),
    executor: { executeCommand: (action, params, opts) => {
      vm.calls.push({ action, params, opts })
      if (action === 'set_chrome') return Promise.resolve({ success: true, applied: { menubar: false, statusbar: false, toolbars: { standardbar: false } } })
      return exec(action, params, opts)
    } },
  }
  for (const name of ['finishDocLoad', 'prepareInitialChrome', 'loadDocument', 'retryLoad', 'bootMilestone', 'initWritingAssistance', 'loadWaitBudgetMs']) if (METHODS[name]) vm[name] = METHODS[name].bind(vm)
  // remountEditor 用真实现（它负责让在途链路作废），只把建元素那一步桩掉。
  // 新引擎的 executor 由 mountEditor 接线；这里复用同一个桩（各用例可改它的 executeCommand）。
  const execStub = vm.executor
  vm.mountEditor = () => { vm.executor = execStub }
  vm.remountEditor = function () { vm.remounts++; return METHODS.remountEditor.call(vm) }
  return vm
}

test('装载预算按字节数分级：≤1MB 30s、≤10MB 90s、更大 180s；未知按最大档', () => {
  assert.equal(loadBudgetMs(0), 30000)
  assert.equal(loadBudgetMs(9618), 30000)
  assert.equal(loadBudgetMs(1024 * 1024), 30000)
  assert.equal(loadBudgetMs(1024 * 1024 + 1), 90000)
  assert.equal(loadBudgetMs(10 * 1024 * 1024), 90000)
  assert.equal(loadBudgetMs(10 * 1024 * 1024 + 1), 180000)
  assert.equal(loadBudgetMs(undefined), 180000)
  assert.equal(loadBudgetMs(-1), 180000)
})

test('load_document 带着按字节数分级的预算发出，而不是一律 180s', async () => {
  const vm = makeVm(async () => ({ success: true, kind: 'writer' }), 9618)
  await vm.finishDocLoad()
  const load = vm.calls.find((c) => c.action === 'load_document')
  assert.equal(load.opts && load.opts.timeoutMs, 30000)
  assert.equal(vm.statusKey, 'ready')
})

test('「一直卡着」的 30s 计时从 load_document 真正发出时起算', async () => {
  const hang = deferred()
  const vm = makeVm(() => hang.promise)
  vm._stageChangedAt = Date.now() - 60000   // openingDoc 阶段早在空白就绪时就进入了
  vm.stuck = true
  const p = vm.finishDocLoad()
  await tick(); await tick()
  assert.ok(Date.now() - vm._stageChangedAt < 1000, '计时起点必须重置到命令发出那一刻')
  assert.equal(vm.stuck, false)
  hang.resolve({ success: true, kind: 'writer' })
  await p
})

test('引擎明确拒收（DOC_REJECTED）：直接落「文档无法打开」+ 诊断码，不重启重装', async () => {
  const vm = makeVm(async () => ({ success: false, code: 'DOC_REJECTED', message: 'load_document failed: file: loadComponentFromURL returned null' }))
  await vm.finishDocLoad()
  assert.equal(vm.remounts, 0)
  assert.equal(vm.statusKey, STATUS_OPEN_FAILED)
  assert.equal(vm.openFailCode, DIAG_DOC_REJECTED)
  assert.equal(vm.docLoadFailed, true, '保存闸必须落下：画布上是空白原型')
  assert.equal(OPTIONS.computed.loadingOverlayVisible.call({ statusKey: STATUS_OPEN_FAILED, ready: true, isError: true }), true,
    '失败原因与出路只有加载面板能放，终态下面板必须留着')
})

test('普通拒收仍是 DOC_REJECTED；CFB 头但不是加密包的 xlsx 落 DOC_ENCRYPTED 等用户输密码，不交给引擎', async () => {
  const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]).buffer
  for (const [bytes, want, engineCalls] of [[cfb, DIAG_DOC_ENCRYPTED, 0], [new ArrayBuffer(16), DIAG_DOC_REJECTED, 1]]) {
    const vm = makeVm(async () => ({ success: false, code: 'DOC_REJECTED', message: 'load_document failed' }))
    vm.file = { id: 7, name: '员工信息.xlsx', fileType: 'xlsx', fileSize: 16 }
    vm._bytesPromise = Promise.resolve(bytes)
    await vm.finishDocLoad()
    assert.equal(vm.statusKey, STATUS_OPEN_FAILED)
    assert.equal(vm.openFailCode, want)
    assert.equal(vm.calls.filter(c => c.action === 'load_document').length, engineCalls)
  }
})

test('设了打开密码（O14）：输对密码后引擎拿到明文；保存按原密码重新加密；重载沿用密钥；明文文件清掉密钥', async () => {
  const { decryptOoxml } = await import('../../src/utils/officeEncryption.js')
  const encrypted = new Uint8Array(readFileSync(new URL('../lowa-e2e/fixtures/encrypted/case-ledger.xlsx', import.meta.url)))
  const plain = new Uint8Array(readFileSync(new URL('../../../scripts/eval/fixtures/case-ledger.xlsx', import.meta.url)))
  const vm = makeVm(async (action) => action === 'load_document' ? { success: true, kind: 'calc' } : { success: true })
  vm.file = { id: 7, name: '案件台账.xlsx', fileType: 'xlsx', fileSize: encrypted.length }
  vm.passwordInput = ''
  vm.passwordState = ''
  for (const name of ['submitPassword', 'sealForStorage', 'scheduleSlidePreviewCapture']) vm[name] = METHODS[name].bind(vm)
  vm._bytesPromise = Promise.resolve(encrypted.slice().buffer)
  const loads = () => vm.calls.filter(c => c.action === 'load_document' && c.params.bytes)

  await vm.finishDocLoad()
  assert.equal(vm.openFailCode, DIAG_DOC_ENCRYPTED)
  assert.equal(vm.docLoadFailed, true, '没解开之前保存闸关着')
  assert.equal(loads().length, 0, '密文不交给引擎')

  vm.passwordInput = 'awd-0415'
  await vm.submitPassword()
  assert.equal(vm.passwordState, 'wrong')
  assert.equal(vm.openFailCode, DIAG_DOC_ENCRYPTED)

  vm.passwordInput = 'awd-0414'
  await vm.submitPassword()
  for (let i = 0; i < 50 && vm.statusKey !== 'ready'; i++) await tick()
  assert.equal(vm.statusKey, 'ready')
  assert.equal(vm.docLoadFailed, false)
  assert.equal(vm.passwordInput, '', '密码提交后不留在组件里')
  assert.deepEqual(new Uint8Array(loads().at(-1).params.bytes), plain, '引擎拿到的是解开的明文')

  const sealed = await vm.sealForStorage(plain, 7)
  assert.equal(isEncryptedOoxml(sealed, 'a.xlsx'), true, '保存出去仍是加密文件')
  assert.deepEqual((await decryptOoxml(sealed, 'awd-0414')).plain, plain, '原密码能打开保存后的文件')
  await assert.rejects(vm.sealForStorage(plain, 8), '换了文件 id 绝不按别的文件的密钥写，也不写明文')

  // 保存后的重载 / 引擎重启：用内存里的文件密钥直接解，不再问密码
  vm._bytesPromise = Promise.resolve(sealed.slice().buffer)
  await vm.finishDocLoad()
  assert.equal(vm.openFailCode, '')
  assert.deepEqual(new Uint8Array(loads().at(-1).params.bytes), plain)
  assert.ok(vm._docCrypto, '重载后仍按密码保存')

  // 文件在别处去掉了密码：明文装载后清掉密钥，之后保存写明文（与磁盘上的文件一致）
  vm._bytesPromise = Promise.resolve(plain.slice().buffer)
  await vm.finishDocLoad()
  assert.equal(vm._docCrypto, null)
  assert.equal(await vm.sealForStorage(plain, 7), plain)
})

test('第一次超时自愈重装一次；第二次超时落「文档无法打开」+ EDITOR_LOAD_TIMEOUT', async () => {
  const vm = makeVm(async () => TIMEOUT)
  await vm.finishDocLoad()
  assert.equal(vm.remounts, 1, '第一次超时重启引擎')
  assert.notEqual(vm.statusKey, STATUS_OPEN_FAILED)
  // 新引擎就绪 → onEndpointReady → finishDocLoad
  vm._endpointUp = true
  await vm.finishDocLoad()
  assert.equal(vm.remounts, 1, '只自愈一次')
  assert.equal(vm.statusKey, STATUS_OPEN_FAILED)
  assert.equal(vm.openFailCode, DIAG_LOAD_TIMEOUT)
})

test('load_document 在途时点重试：重建引擎，不再追加第二条 load_document', async () => {
  const hang = deferred()
  const vm = makeVm(() => hang.promise)
  const p = vm.finishDocLoad()
  await tick(); await tick()
  assert.equal(vm.calls.filter((c) => c.action === 'load_document').length, 1)
  vm.retryLoad()
  await tick(); await tick()
  assert.equal(vm.remounts, 1, '必须走 remountEditor')
  assert.equal(vm.calls.filter((c) => c.action === 'load_document').length, 1, '不许再往挂住的队列后面排一条')
  // 挂住的那条在新引擎 boot 期间以超时收场：不许把状态落成失败、不许发 ready
  hang.resolve(TIMEOUT)
  await p
  assert.equal(vm.statusKey, 'booting')
  assert.equal(vm.ready, false)
  assert.equal(vm.emitted.filter(([e]) => e === 'ready').length, 0)
  assert.equal(vm.remounts, 1, '作废的那条不许再触发一次自愈重启')
})

test('重建后的新链路仍超时：用户那次重试算作自愈，直接落终态（不无限重启）', async () => {
  const hang = deferred()
  const vm = makeVm(() => hang.promise)
  vm.finishDocLoad()
  await tick(); await tick()
  vm.retryLoad()
  await tick()
  hang.resolve(TIMEOUT)
  vm.executor.executeCommand = async () => TIMEOUT
  vm._endpointUp = true
  await vm.finishDocLoad()
  assert.equal(vm.remounts, 1)
  assert.equal(vm.statusKey, STATUS_OPEN_FAILED)
  assert.equal(vm.openFailCode, DIAG_LOAD_TIMEOUT)
})

test('「文档无法打开」终态上的重试：重建引擎并清掉诊断码', async () => {
  const vm = makeVm(async () => ({ success: false, code: 'DOC_REJECTED', message: 'x' }))
  await vm.finishDocLoad()
  vm.retryLoad()
  assert.equal(vm.remounts, 1)
  assert.equal(vm.openFailCode, '')
})

test('没有装载在途（下载卡住）时的重试保持原语义：重走装载，不重建引擎', async () => {
  const hung = deferred()
  const vm = makeVm(async () => ({ success: true, kind: 'writer' }))
  vm._bytesPromise = hung.promise
  vm.finishDocLoad()
  await tick()
  vm.retryLoad()
  await tick(); await tick()
  assert.equal(vm.remounts, 0)
  assert.equal(vm.statusKey, 'ready')
})

test('openFailureOf：普通 relay 超时（未自愈过）不落终态；非拒收的引擎失败不落终态', () => {
  assert.equal(openFailureOf(Object.assign(new Error('t'), { code: 'EDITOR_RESULT_TIMEOUT' }), false), null)
  assert.equal(openFailureOf(new Error('HTTP 404'), true), null)
  assert.deepEqual(openFailureOf(Object.assign(new Error('x'), { code: 'DOC_REJECTED' }), false), { statusKey: STATUS_OPEN_FAILED, code: DIAG_DOC_REJECTED })
})

test('宿主等待预算：引擎未就绪多算一段冷启动', () => {
  const vm = makeVm(async () => ({ success: true }), 9618)
  assert.equal(vm.loadWaitBudgetMs(), 30000)
  vm._endpointUp = false
  assert.equal(vm.loadWaitBudgetMs(), 120000)
})
