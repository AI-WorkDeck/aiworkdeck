// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive } from 'vue'
const src = readFileSync(new URL('../../src/pages/project-overview/librePool.js', import.meta.url), 'utf8')
function makeVm() {
  const body = src.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace(/export const librePoolMethods = \{/, 'return {')
  const methods = new Function('isDesktopHost', 'host', body)(() => true, {})
  const vm = reactive({ libreSpares: [], _libreSpareSeq: 0 })
  for (const [key, fn] of Object.entries(methods)) vm[key] = fn.bind(vm)
  return vm
}
async function acquire(vm) {
  const pending = vm.acquireLibreHiddenInstance()
  vm.libreSpares.at(-1).executor = { executeCommand: () => ({ success: true }) }
  return pending
}
test('real Vue proxy entry is removed by the raw acquire handle', async () => {
  const vm = makeVm(), handle = await acquire(vm)
  assert.notEqual(handle._spare, vm.libreSpares[0], 'exercise the raw/proxy identity mismatch')
  vm.releaseLibreHiddenInstance(handle)
  assert.equal(vm.libreSpares.length, 0)
})
test('a late old handle cannot remove a newly acquired hidden engine', async () => {
  const vm = makeVm(), old = await acquire(vm)
  vm.releaseLibreHiddenInstance(old)
  const current = await acquire(vm)
  vm.releaseLibreHiddenInstance(old)
  assert.deepEqual(vm.libreSpares.map(x => x.key), [current._spare.key])
  vm.releaseLibreHiddenInstance(current)
  assert.equal(vm.libreSpares.length, 0)
})
test('cold-start timeout removes its raw spare and preserves other pool entries', async () => {
  const vm = makeVm()
  vm._libreSpareSeq = 1
  vm.libreSpares.push({ key: 1, file: { id: 10 } })
  assert.equal(await vm.acquireLibreHiddenInstance({ timeoutMs: -1 }), null)
  assert.deepEqual(vm.libreSpares.map(x => x.key), [1])
})
test('missing, invalid and unknown handles leave the reactive pool unchanged', () => {
  const vm = makeVm()
  vm.libreSpares.push({ key: 1, file: null }, { key: 2, hidden: true, file: null })
  for (const handle of [null, undefined, {}, { _spare: {} }, { key: null }, { key: NaN }, { key: 0 }, { key: '1' }, { key: 999 }])
    vm.releaseLibreHiddenInstance(handle)
  assert.deepEqual(vm.libreSpares.map(x => x.key), [1, 2])
  vm.releaseLibreHiddenInstance(vm.libreSpares[1])
  assert.deepEqual(vm.libreSpares.map(x => x.key), [1])
})

test('hidden handle forwards completion policy and native progress callback unchanged', async () => {
  const vm = makeVm(), pending = vm.acquireLibreHiddenInstance(), calls = []
  vm.libreSpares.at(-1).executor = { executeCommand: (...args) => { calls.push(args); return { success: true } } }
  const handle = await pending, options = { waitForCompletion: true, onProgress() {} }
  await handle.run('build_comparison_document', { name: 'result.docx' }, options)
  assert.equal(calls[0][2], options)
  assert.equal(calls[0][0], 'build_comparison_document')
  vm.releaseLibreHiddenInstance(handle)
})
test('fatal event removing a starting hidden engine ends acquisition without waiting for its boot deadline', async () => {
  const vm = makeVm(), pending = vm.acquireLibreHiddenInstance()
  vm.releaseLibreHiddenInstance(vm.libreSpares.at(-1))
  assert.equal(await pending, null)
  assert.equal(vm.libreSpares.length, 0)
})

// ---- 台账 B5：QuickLook 借的预热备胎换回空白文档后原样归还 ----
function warmVm(executeCommand) {
  const vm = makeVm()
  let scheduled = 0
  vm.scheduleLibreSpare = () => { scheduled++ }
  vm._libreSpareSeq = 1
  vm.libreSpares.push({ key: 1, file: null, executor: { executeCommand } })
  return { vm, scheduled: () => scheduled }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('recycle: a borrowed warm spare is reset to a blank document and returned to the pool', async () => {
  const calls = []
  const { vm, scheduled } = warmVm((action, p) => { calls.push([action, p]); return { success: true, blank: !!p?.blank } })
  const handle = await vm.acquireLibreHiddenInstance()
  assert.equal(vm.libreSpares[0].borrowed, true)
  vm.releaseLibreHiddenInstance(handle, { recycle: true })
  assert.equal(vm.libreSpares[0].borrowed, true, 'still borrowed while the blank reset runs, so it cannot be adopted mid-reset')
  await tick()
  assert.deepEqual(calls, [['load_document', { blank: true, name: 'blank.docx' }]])
  assert.deepEqual(vm.libreSpares.map(x => [x.key, !!x.borrowed]), [[1, false]], 'same warm engine is back in the pool')
  assert.equal(scheduled(), 0, 'no replacement spare needed')
  // 下一次借用拿到的仍是这台热引擎，而不是冷启动一台新的
  const again = await vm.acquireLibreHiddenInstance()
  assert.equal(again._spare.key, 1)
})

test('recycle: a failed or rejected blank reset falls back to discarding the spare and re-warming', async () => {
  for (const exec of [() => ({ success: false }), () => ({ success: true }), () => Promise.reject(new Error('worker gone'))]) {
    const { vm, scheduled } = warmVm(exec)
    const handle = await vm.acquireLibreHiddenInstance()
    vm.releaseLibreHiddenInstance(handle, { recycle: true })
    await tick(); await tick()
    assert.equal(vm.libreSpares.length, 0)
    assert.equal(scheduled(), 1)
  }
})

test('recycle does not apply to a cold hidden instance (nothing warm was borrowed)', async () => {
  const vm = makeVm(), handle = await acquire(vm)
  vm.releaseLibreHiddenInstance(handle, { recycle: true })
  assert.equal(vm.libreSpares.length, 0)
})
