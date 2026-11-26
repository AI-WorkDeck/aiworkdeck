// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * C20 (lane C, 2026-11-26): a 交稿 guide left open after a refused submit still said step 2
 * 「案件库里没有你还没取回的稿」 four minutes after the partner had submitted two versions.
 * While open, the guide now re-checks the library every 30 s and on window focus.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { errorText } from '../_lib/error-text.mjs'
globalThis.errorText = errorText

const source = readFileSync(new URL('../../src/components/collab/SubmitDraftGuide.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^import[\s\S]*?from .*$/gm, '').replace('export default', 'return')

function guide({ clouds }) {
  const checks = []
  const api = {
    endWorkSession: async () => ({}), updateFromCloud: async () => ({}), uploadToCloud: async () => ({}),
    getVersionStatus: async () => ({ data: { working: false } }),
    getCloudStatus: async () => ({ data: { remoteAhead: false } }),
    checkCloud: async () => { checks.push(1); return { data: clouds.length > 1 ? clouds.shift() : clouds[0] } },
  }
  const component = new Function('endWorkSession', 'updateFromCloud', 'uploadToCloud', 'getVersionStatus', 'getCloudStatus', 'checkCloud', 'submitGuideSteps', 'pullStepText', 'uni', 'console', script)(
    api.endWorkSession, api.updateFromCloud, api.uploadToCloud, api.getVersionStatus, api.getCloudStatus, api.checkCloud, () => ({ steps: [] }), () => '', { showToast() {} }, { warn() {} })
  const vm = { ...component.data(), projectId: 7, visible: true, mode: 'guide', working: false, cloud: {}, events: [], $emit(name) { this.events.push(name) }, $t: (k) => k }
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  return { vm, component, checks }
}

test('a guide left open picks up a colleague\'s new versions and tells the page once', async () => {
  const { vm, checks } = guide({ clouds: [{ remoteAhead: true, remoteAheadCount: 2 }] })
  vm.localCloud = { remoteAhead: false }
  await vm.liveRefresh()
  assert.equal(checks.length, 1, 'the live re-check goes online (checkCloud), not the local snapshot')
  assert.equal(vm.localCloud.remoteAhead, true)
  assert.equal(vm.localCloud.remoteAheadCount, 2)
  assert.deepEqual(vm.events, ['changed'])
})

test('an unchanged library does not make the page reload every 30 seconds', async () => {
  const { vm } = guide({ clouds: [{ remoteAhead: false }] })
  vm.localCloud = { remoteAhead: false }
  await vm.liveRefresh()
  assert.deepEqual(vm.events, [])
})

test('no live re-check while a step runs, after closing, or in help mode', async () => {
  for (const setup of [(vm) => { vm.busy = true }, (vm) => { vm.visible = false }, (vm) => { vm.mode = 'help' }]) {
    const { vm, checks } = guide({ clouds: [{ remoteAhead: true }] })
    setup(vm)
    await vm.liveRefresh()
    assert.equal(checks.length, 0)
  }
})

test('opening starts the 30 s re-check and closing stops it', async () => {
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval
  const timers = new Map(); let next = 1
  globalThis.setInterval = (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id }
  globalThis.clearInterval = (id) => timers.delete(id)
  try {
    const { vm, component } = guide({ clouds: [{ remoteAhead: false }] })
    component.watch.visible.call(vm, true)
    assert.equal(timers.size, 1)
    assert.equal([...timers.values()][0].ms, 30000)
    component.watch.visible.call(vm, false)
    assert.equal(timers.size, 0)
    vm.mode = 'help'
    component.watch.visible.call(vm, true)
    assert.equal(timers.size, 0, 'the help view never polls the library')
  } finally {
    globalThis.setInterval = realSet
    globalThis.clearInterval = realClear
  }
})
