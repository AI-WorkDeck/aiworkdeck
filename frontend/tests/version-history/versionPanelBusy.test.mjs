// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/version/VersionPanel.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const body = script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'return')
const busy = () => Object.assign(new Error('busy'), { kind: 'VERSION_BUSY' })
const ready = { data: { enabled: true, working: false, changedCount: 0 } }
function setup(getStatus, timer = (fn) => fn()) {
  let toasts = 0
  let checks = 0
  const options = new Function('getVersionStatus', 'shouldAcceptResponse', 'checkCloud', 'uni', 'setTimeout',
    'WorkSessionBar', 'VersionTimeline', 'DraftList', 'AdoptConflictDialog', 'CloudSyncBar', body)(
    getStatus, (seq, latest) => seq === latest, async () => { checks++; return { data: { linked: true } } },
    { showToast: () => toasts++ }, timer, {}, {}, {}, {}, {})
  const vm = { ...options.data(), projectId: 7, $t: (key) => key, $emit() {} }
  for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
  vm.fetchDrafts = async () => {}
  vm.fetchCloudState = async () => { vm.cloud = { linked: true } }
  return { vm, options, toasts: () => toasts, checks: () => checks }
}

test('temporary repository busy recovers without hiding the collaboration panel', async () => {
  let calls = 0
  const { vm, toasts } = setup(async () => { if (++calls < 3) throw busy(); return ready })
  await vm.refresh()
  assert.equal(calls, 3)
  assert.equal(vm.enabled, true)
  assert.equal(vm.cloud.linked, true)
  assert.equal(vm.loadError, false)
  assert.equal(vm.loading, false)
  assert.equal(toasts(), 0)
})

test('persistent busy is bounded and retains a visible error', async () => {
  let calls = 0
  const { vm, toasts } = setup(async () => { calls++; throw busy() })
  await vm.refresh()
  assert.equal(calls, 10)
  assert.equal(vm.loadError, true)
  assert.equal(vm.loading, false)
  assert.equal(toasts(), 1)
})

test('a genuine status failure is not retried or reported as success', async () => {
  let calls = 0
  const { vm, toasts } = setup(async () => { calls++; throw new Error('storage failure') })
  await vm.refresh()
  assert.equal(calls, 1)
  assert.equal(vm.loadError, true)
  assert.equal(toasts(), 1)
})

test('unmount invalidates a sleeping retry before another request or error toast', async () => {
  let wake
  let calls = 0
  const { vm, options, toasts } = setup(async () => { calls++; throw busy() }, (fn) => { wake = fn })
  const pending = vm.refresh()
  await Promise.resolve()
  assert.equal(typeof wake, 'function')
  options.beforeUnmount.call(vm)
  wake()
  await pending
  assert.equal(calls, 1)
  assert.equal(toasts(), 0)
  assert.equal(vm.loadError, false)
})

test('a stale busy request cannot overwrite a newer successful refresh', async () => {
  let wake
  let calls = 0
  const { vm, toasts } = setup(async () => { if (++calls === 1) throw busy(); return ready }, (fn) => { wake = fn })
  const stale = vm.refresh()
  await Promise.resolve()
  await vm.refresh()
  wake()
  await stale
  assert.equal(calls, 2)
  assert.equal(vm.enabled, true)
  assert.equal(vm.loadError, false)
  assert.equal(toasts(), 0)
})

test('mount finishes the initial status read before starting the cloud fetch', async () => {
  let resolve
  const { vm, options, checks } = setup(() => new Promise((r) => { resolve = r }))
  const mounted = options.mounted.call(vm)
  assert.equal(checks(), 0)
  resolve(ready)
  await mounted
  assert.equal(checks(), 1)
  assert.equal(vm.cloud.linked, true)
})
