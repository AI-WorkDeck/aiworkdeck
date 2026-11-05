// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程问题 88（dev-board#1713）：两页小文件的文档对比卡在「正在启动比对 / 正在加载文档」。
// ① acquireLibreHiddenInstance 每次都冷启一台隐藏引擎（实测 90 秒级），旁边已经 ready 的
//    空闲预热备胎不用 → 优先借用备胎（只打 borrowed，不翻 hidden，免得换桶重挂载）；
// ② 取消比对时仍在冷启动的隐藏实例不放手，下一次比对再叠一台 → 会话作废即释放；
// ③ 导出阶段（waitForCompletion 无截止）没有兜底 → 5 分钟上限，超时给明确提示。
//   cd frontend && node --test tests/project-home/compare-engine-reuse-timeout.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive } from 'vue'
import { runDocxComparison } from '../../src/utils/docxComparison.js'

const src = readFileSync(new URL('../../src/pages/project-overview/librePool.js', import.meta.url), 'utf8')
function makeVm() {
  const body = src.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace(/export const librePoolMethods = \{/, 'return {')
  const methods = new Function('isDesktopHost', 'host', body)(() => true, { systemMemory: { totalBytes: 32 * 1024 ** 3 } })
  const vm = reactive({ libreSpares: [], _libreSpareSeq: 1, libreLruKeys: [], scheduled: 0 })
  for (const [key, fn] of Object.entries(methods)) vm[key] = fn.bind(vm)
  vm.scheduleLibreSpare = () => { vm.scheduled++ }
  return vm
}

test('已有 ready 的空闲预热备胎时直接借用，不再冷启新实例', async () => {
  const vm = makeVm()
  const calls = []
  vm.libreSpares.push({ key: 1, file: null, executor: { executeCommand: (...a) => { calls.push(a); return { success: true } } } })
  const handle = await vm.acquireLibreHiddenInstance({ timeoutMs: -1 })
  assert.ok(handle, '借到了热引擎')
  assert.equal(vm.libreSpares.length, 1, '没有新挂一台隐藏实例')
  assert.equal(vm.libreSpares[0].hidden, undefined, '不翻 hidden：两桶 v-for 不同，翻了会卸掉这台热引擎')
  await handle.run('build_comparison_document', {}, {})
  assert.equal(calls[0][0], 'build_comparison_document')
  // 借走期间不许被过继成律师正打开的文档
  vm.useLibreEditor = () => true
  vm.maybeAdoptLibreSpare({ id: 5, name: 'a.docx' })
  assert.equal(vm.libreSpares[0].file, null)
  // 归还：条目删掉（组件卸载），并重新排一次备胎预热
  vm.releaseLibreHiddenInstance(handle)
  assert.equal(vm.libreSpares.length, 0)
  assert.equal(vm.scheduled, 1)
})

test('还没 ready 的备胎不借，照旧挂隐藏实例等启动', async () => {
  const vm = makeVm()
  vm.libreSpares.push({ key: 1, file: null })
  const pending = vm.acquireLibreHiddenInstance()
  assert.equal(vm.libreSpares.length, 2)
  vm.libreSpares.at(-1).executor = { executeCommand: () => ({}) }
  const handle = await pending
  vm.releaseLibreHiddenInstance(handle)
  assert.deepEqual(vm.libreSpares.map(x => x.key), [1])
  assert.equal(vm.scheduled, 0, '新建的隐藏实例归还时不额外排备胎')
})

test('会话作废（取消比对）时立即释放仍在冷启动的隐藏实例', async () => {
  const vm = makeVm()
  let cancelled = false
  const pending = vm.acquireLibreHiddenInstance({ isCancelled: () => cancelled })
  assert.equal(vm.libreSpares.length, 1)
  cancelled = true
  assert.equal(await pending, null)
  assert.equal(vm.libreSpares.length, 0, '不留一台引擎在后台跑满启动预算')
})

test('导出阶段超过上限：给出明确的超时提示并归还引擎，不再无限等待', async () => {
  const order = []
  await assert.rejects(runDocxComparison({
    source: { id: 1, name: 'A.docx' }, target: { id: 2, name: 'B.docx' }, name: 'R.docx',
    t: (k) => k,
    fetchBytes: async (doc) => new Uint8Array([doc.id, 1]),
    acquireEngine: async () => ({
      run: async (action) => (action === 'export_document' ? new Promise(() => {}) : { success: true }),
    }),
    releaseEngine: () => order.push('release'),
    saveFile: async () => { order.push('save'); return { id: 9 } },
    exportTimeoutMs: 20,
  }), /editor\.compare\.failTimeout/)
  assert.deepEqual(order, ['release'])
})
