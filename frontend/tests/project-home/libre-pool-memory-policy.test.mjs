// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../../src/pages/project-overview/librePool.js', import.meta.url), 'utf8')
const GiB = 1024 ** 3
function vmFor(totalBytes, timers = { setTimeout, clearTimeout }) {
  const body = src.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace(/export const librePoolMethods = \{/, 'return {')
  const methods = new Function('isDesktopHost', 'host', 'setTimeout', 'clearTimeout', body)(() => true, totalBytes === undefined ? {} : { systemMemory: { totalBytes } }, timers.setTimeout, timers.clearTimeout)
  const vm = {
    libreLruKeys: [], libreSpares: [], _libreRefs: {}, _libreExecMap: {},
    leftFiles: [], rightFiles: [], splitMode: false, activeFileIdLeft: null, activeFileIdRight: null,
    useLibreEditor: () => true,
  }
  for (const [key, fn] of Object.entries(methods)) vm[key] = fn.bind(vm)
  return vm
}
function add(vm, pane, id, flushSave = async () => true) {
  if (pane === 'right') vm.splitMode = true
  const file = { id, fileSize: 300 * 1024 }
  vm[pane + 'Files'].push(file)
  vm['activeFile' + (pane === 'left' ? 'Left' : 'Right')] = file
  vm._libreRefs[pane + ':' + id] = { file, ready: true, flushSave }
  vm['activeFileId' + (pane === 'left' ? 'Left' : 'Right')] = id
  vm.onActiveOfficeFileChanged(pane, file)
  return file
}
const settle = () => new Promise(resolve => setImmediate(resolve))

function warmupVm() {
  const pending = new Map()
  let seq = 0
  let now = 0
  const vm = vmFor(16 * GiB, {
    setTimeout(fn, ms) { const id = ++seq; pending.set(id, { fn, ms, due: now + ms }); return id },
    clearTimeout(id) { pending.delete(id) },
  })
  const advance = ms => {
    const end = now + ms
    for (;;) {
      const next = [...pending.entries()].sort((a, b) => a[1].due - b[1].due)[0]
      if (!next || next[1].due > end) break
      const [id, timer] = next
      now = timer.due
      pending.delete(id)
      timer.fn()
    }
    now = end
  }
  const tick = () => {
    assert.equal(pending.size, 1)
    const { ms, due } = pending.values().next().value
    assert.equal(ms, 4000)
    advance(due - now)
  }
  return { vm, pending, tick, advance }
}

test('foreground ready restarts the full warmup delay before another engine can boot', () => {
  const { vm, pending, advance } = warmupVm()
  add(vm, 'left', 1)
  vm._libreRefs['left:1'].ready = false
  vm.scheduleLibreSpare()
  advance(3800)
  vm._libreRefs['left:1'].ready = true
  vm.onLibreReady({ executeCommand() {} }, 'left', 1)
  assert.equal(pending.size, 1)
  advance(200)
  assert.equal(vm.libreSpares.length, 0, 'the original empty-workbench deadline must be cancelled')
  advance(3799)
  assert.equal(vm.libreSpares.length, 0)
  advance(1)
  assert.equal(vm.libreSpares.length, 1)
})

test('warmup yields to every loading document and resumes when all are ready', () => {
  const { vm, pending, tick } = warmupVm()
  add(vm, 'left', 1)
  add(vm, 'right', 2)
  vm._libreRefs['left:1'].ready = false
  vm._libreRefs['right:2'].ready = false
  vm.scheduleLibreSpare()
  tick()
  assert.equal(vm.libreSpares.length, 0)
  vm._libreRefs['left:1'].ready = true
  tick()
  assert.equal(vm.libreSpares.length, 0)
  vm._libreRefs['right:2'].ready = true
  tick()
  assert.equal(vm.libreSpares.length, 1)
  assert.equal(pending.size, 0)
})

for (const statusKey of ['bootFailed', 'loadFailed', 'desktopOnly', 'unsupported']) {
  test(`warmup resumes after a document reaches ${statusKey}`, () => {
    const { vm, tick } = warmupVm()
    add(vm, 'left', 1)
    vm._libreRefs['left:1'].ready = false
    vm.scheduleLibreSpare()
    tick()
    assert.equal(vm.libreSpares.length, 0)
    vm._libreRefs['left:1'].statusKey = statusKey
    tick()
    assert.equal(vm.libreSpares.length, 1)
  })
}

test('warmup waits for a pending mount and resumes after its tab closes, ignoring a stale ref', () => {
  const { vm, tick } = warmupVm()
  add(vm, 'left', 1)
  delete vm._libreRefs['left:1']
  vm.scheduleLibreSpare()
  tick()
  assert.equal(vm.libreSpares.length, 0)
  vm.leftFiles = []
  vm.activeFileIdLeft = null
  vm._libreRefs['left:1'] = { file: { id: 1 }, ready: false }
  tick()
  assert.equal(vm.libreSpares.length, 1)
})

test('a closed right pane and inactive unmounted tabs do not block warmup', () => {
  const { vm, tick } = warmupVm()
  add(vm, 'right', 1)
  vm._libreRefs['right:1'].ready = false
  vm.leftFiles = [{ id: 2 }]
  vm.scheduleLibreSpare()
  tick()
  assert.equal(vm.libreSpares.length, 0)
  vm.splitMode = false
  tick()
  assert.equal(vm.libreSpares.length, 1)
})

test('an existing blank spare survives a loading document without another timer', () => {
  const { vm, pending, tick } = warmupVm()
  vm.initLibreSpare()
  const spare = vm.libreSpares[0]
  add(vm, 'right', 1)
  vm._libreRefs['right:1'].ready = false
  vm.scheduleLibreSpare()
  tick()
  assert.deepEqual(vm.libreSpares, [spare])
  assert.equal(pending.size, 0)
})

test('a deferred warmup stops when its overview becomes inactive', () => {
  const { vm, pending, tick } = warmupVm()
  add(vm, 'left', 1)
  vm._libreRefs['left:1'].ready = false
  vm.scheduleLibreSpare()
  tick()
  assert.equal(vm.libreSpares.length, 0)
  vm.isActiveOverviewInstance = () => false
  tick()
  assert.equal(vm.libreSpares.length, 0)
  assert.equal(pending.size, 0)
})

for (const total of [8 * GiB, 7.7 * GiB, undefined, 0, NaN]) {
  test(`8 GiB or unknown memory keeps first-open prewarming but never adds a spare beside a document (${total})`, () => {
    const vm = vmFor(total)
    vm.initLibreSpare()
    assert.equal(vm.libreSpares.length, 1)
    const spare = vm.libreSpares[0]
    add(vm, 'left', 1)
    assert.equal(spare.file.id, 1)
    vm.onLibreSpareReady(spare, { executeCommand() {} })
    assert.equal(vm._libreSpareTimer, undefined)
    vm.initLibreSpare()
    assert.equal(vm.libreSpares.length, 1)
  })
}
test('known 16 GiB device retains prewarming', () => {
  const vm = vmFor(16 * GiB)
  vm.initLibreSpare()
  vm.initLibreSpare()
  assert.equal(vm.libreSpares.length, 1)
})
test('8 GiB keeps active document and one recent background document; adopted entries leave too', async () => {
  const vm = vmFor(8 * GiB)
  const first = add(vm, 'left', 1)
  vm.libreSpares.push({ key: 1, file: first })
  add(vm, 'left', 2)
  add(vm, 'left', 3)
  await settle()
  assert.deepEqual(vm.libreLruKeys, ['left:3', 'left:2'])
  assert.equal(vm.libreSpares.length, 0)
})
test('two active split documents reserve both slots even when an inactive document is more recent', async () => {
  const vm = vmFor(8 * GiB)
  add(vm, 'right', 1)
  add(vm, 'left', 2)
  add(vm, 'left', 3)
  await settle()
  assert.deepEqual(vm.libreLruKeys, ['left:3', 'right:1'])
})
test('failed save retains the only unsaved copy even above the instance budget', async () => {
  const vm = vmFor(8 * GiB)
  let saves = 0
  add(vm, 'left', 1, async () => { saves++; return false })
  add(vm, 'left', 2)
  add(vm, 'left', 3)
  await settle()
  assert.ok(saves > 0)
  assert.ok(vm.libreLruKeys.includes('left:1'))
})
test('activation during pending save cancels eviction', async () => {
  const vm = vmFor(8 * GiB)
  let finishSave
  const first = add(vm, 'left', 1, () => new Promise(resolve => { finishSave = resolve }))
  add(vm, 'left', 2)
  add(vm, 'left', 3)
  assert.equal(typeof finishSave, 'function')
  vm.activeFileIdLeft = 1
  vm.onActiveOfficeFileChanged('left', first)
  finishSave(true)
  await settle()
  assert.ok(vm.libreLruKeys.includes('left:1'))
})
test('low memory policy leaves hidden merge engines untouched and permits their release', async () => {
  const vm = vmFor(8 * GiB)
  const pending = vm.acquireLibreHiddenInstance({ timeoutMs: 500 })
  const sp = vm.libreSpares[0]
  assert.equal(sp.hidden, true)
  vm.onLibreSpareReady(sp, { executeCommand: async () => ({ success: true }) })
  const handle = await pending
  assert.ok(handle)
  vm.initLibreSpare()
  assert.equal(vm.libreSpares.length, 2)
  add(vm, 'left', 1)
  assert.equal(sp.file, null, 'hidden merge instance must never be adopted')
  vm.releaseLibreHiddenInstance(handle)
  assert.equal(vm.libreSpares.length, 1)
})

test('closing another document while a save is pending keeps the newly affordable cached instance', async () => {
  const vm = vmFor(8 * GiB)
  let finishSave
  add(vm, 'left', 1, () => new Promise(resolve => { finishSave = resolve }))
  add(vm, 'left', 2)
  add(vm, 'left', 3)
  assert.equal(typeof finishSave, 'function')
  vm.leftFiles = vm.leftFiles.filter(file => file.id !== 2)
  vm.libreLruKeys = vm.libreLruKeys.filter(key => key !== 'left:2')
  finishSave(true)
  await settle()
  assert.deepEqual(vm.libreLruKeys, ['left:3', 'left:1'])
})

test('closing split view does not spend a resident-engine slot on the unmounted right pane', async () => {
  const vm = vmFor(8 * GiB)
  add(vm, 'right', 1)
  const a = add(vm, 'left', 2)
  vm.splitMode = false
  delete vm._libreRefs['right:1']
  const b = add(vm, 'left', 3)
  await settle()
  assert.ok(vm.libreLruKeys.includes('left:2'))
  for (const file of [a, b]) {
    vm.activeFileIdLeft = file.id
    vm.onActiveOfficeFileChanged('left', file)
    await settle()
    assert.ok(vm.libreLruKeys.includes('left:2'))
    assert.ok(vm.libreLruKeys.includes('left:3'))
  }
})

test('reopening split view reapplies the budget without changing the remembered right document', async () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const watch = page.match(/    splitMode\(\) \{([\s\S]*?)\n    activeToolKey/)[1].replace(/\},\s*$/, '')
  const onSplitMode = new Function(watch)
  const vm = vmFor(8 * GiB)
  vm.pushMenuState = () => {}
  vm.$nextTick = fn => fn()
  vm.rebindTabsWheel = () => {}
  add(vm, 'right', 1)
  add(vm, 'left', 2)
  vm.splitMode = false
  onSplitMode.call(vm)
  delete vm._libreRefs['right:1']
  add(vm, 'left', 3)
  await settle()
  assert.ok(vm.libreLruKeys.includes('left:2'))
  vm.splitMode = true
  onSplitMode.call(vm)
  await settle()
  assert.ok(vm.libreLruKeys.includes('left:3'))
  assert.ok(vm.libreLruKeys.includes('right:1'))
  assert.ok(!vm.libreLruKeys.includes('left:2'))
})

test('a document opened before the warmup timer prevents a second blank engine', () => {
  const vm = vmFor(8 * GiB)
  vm.scheduleLibreSpare()
  assert.ok(vm._libreSpareTimer)
  clearTimeout(vm._libreSpareTimer)
  add(vm, 'left', 1)
  vm.initLibreSpare()
  assert.equal(vm.libreSpares.length, 0)
})
test('closing all documents schedules first-open prewarming again; reopening before it fires cancels the extra instance', () => {
  const vm = vmFor(8 * GiB)
  const first = add(vm, 'left', 1)
  vm.libreSpares.push({ key: 1, file: first })
  vm.leftFiles = []
  vm.activeFileIdLeft = null
  vm.pruneClosedLibreSpares()
  assert.ok(vm._libreSpareTimer)
  clearTimeout(vm._libreSpareTimer)
  assert.equal(vm.libreSpares.length, 0)
  add(vm, 'left', 2)
  vm.initLibreSpare()
  assert.equal(vm.libreSpares.length, 0)
  vm.leftFiles = []
  vm.activeFileIdLeft = null
  vm.pruneClosedLibreSpares()
  clearTimeout(vm._libreSpareTimer)
  vm.initLibreSpare()
  assert.equal(vm.libreSpares.length, 1)
  assert.equal(vm.libreSpares[0].file, null)
})

test('opening the first document directly in the right pane retires the unusable left warm spare', () => {
  const vm = vmFor(8 * GiB)
  vm.initLibreSpare()
  vm.libreSpares.push({ key: 99, file: null, hidden: true })
  add(vm, 'right', 1)
  assert.equal(vm.libreSpares.length, 1)
  assert.equal(vm.libreSpares[0].hidden, true)
})

test('closing the sole Office pane restores prewarming beside a non-Office left tab', () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const watch = page.match(/    splitMode\(\) \{([\s\S]*?)\n    activeToolKey/)[1].replace(/\},\s*$/, '')
  const vm = vmFor(8 * GiB)
  vm.pushMenuState = () => {}
  vm.$nextTick = fn => fn()
  vm.rebindTabsWheel = () => {}
  vm.useLibreEditor = file => file.fileSize != null
  vm.leftFiles = [{ id: 'home' }]
  vm.activeFileIdLeft = 'home'
  vm.initLibreSpare()
  add(vm, 'right', 1)
  assert.equal(vm.libreSpares.length, 0)
  vm.splitMode = false
  delete vm._libreRefs['right:1']
  new Function(watch).call(vm)
  assert.ok(vm._libreSpareTimer, 'closing the only Office pane must schedule first-open prewarming')
  clearTimeout(vm._libreSpareTimer)
  vm.initLibreSpare()
  assert.equal(vm.libreSpares.length, 1)
  assert.equal(vm.libreSpares[0].file, null)
})

test('acquiring a hidden merge instance under 8 GiB evicts inactive background instances first (#1269 E-3)', async () => {
  const vm = vmFor(8 * GiB)
  add(vm, 'left', 1)
  add(vm, 'left', 2)
  await settle()
  assert.deepEqual(vm.libreLruKeys, ['left:2', 'left:1'])
  const pending = vm.acquireLibreHiddenInstance({ timeoutMs: 500 })
  await settle()
  assert.deepEqual(vm.libreLruKeys, ['left:2'], 'inactive background instance should be evicted to free WASM memory before merge')
  const sp = vm.libreSpares.find(s => s.hidden)
  vm.onLibreSpareReady(sp, { executeCommand: async () => ({ success: true }) })
  const handle = await pending
  vm.releaseLibreHiddenInstance(handle)
})

test('failed eviction schedules a bounded retry that evicts once save succeeds (#1269 E-2)', async () => {
  const vm = vmFor(8 * GiB)
  let allowSave = false
  add(vm, 'left', 1, async () => allowSave)
  add(vm, 'left', 2)
  add(vm, 'left', 3)
  await settle()
  assert.ok(vm.libreLruKeys.includes('left:1'), 'retained while save fails')
  assert.equal(vm._libreEvictRetryCounts['left:1'], 1, 'retry scheduled')
  clearTimeout(vm._libreEvictRetryTimers['left:1'])
  allowSave = true
  await vm.evictLibreInstance('left:1')
  assert.ok(!vm.libreLruKeys.includes('left:1'), 'evicted once subsequent save succeeds')
  assert.equal(vm._libreEvictRetryCounts['left:1'], undefined, 'retry state cleared')
})

