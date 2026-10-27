// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/pages/project-overview/explorerRecording.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replace('export default', 'return')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(overrides = {}) {
  const calls = []
  const state = { status: 'idle', projectId: null, meetingId: null, ...overrides.state }
  const active = () => !['idle', 'error'].includes(state.status)
  const mixin = new Function('getMeetingRecordings', 'getMeetingAsrNotice', 'recorderState', 'isRecordingActive', 'startRecording', 'uni', source)(
    async id => { calls.push(['tier', id]); return overrides.tier ? overrides.tier() : { tier: 'local' } },
    async () => { calls.push(['notice']); return overrides.notice || { acknowledged: true } },
    state, active,
    async (...args) => {
      calls.push(['start', ...args])
      if (overrides.start) return overrides.start(...args)
      Object.assign(state, { status: 'recording', projectId: args[0], meetingId: 91 })
    },
    { $emit: (event, payload) => calls.push(['event', event, payload]), showToast: payload => calls.push(['toast', payload.title]) },
  )
  const vm = {
    projectId: 12, canWriteProject: true, dynamicPluginsLoaded: true, meetingRecorderEnabled: true,
    $t: key => key, $nextTick: async () => calls.push(['tick']),
    isActiveOverviewInstance: () => true,
    loadDynamicPlugins: async () => { calls.push(['plugins']); if (overrides.loadPlugins) await overrides.loadPlugins(vm); vm.dynamicPluginsLoaded = true },
    openMarketDetail: spec => calls.push(['market', spec]),
    openPanelInItsDock: key => calls.push(['panel', key]),
    ...mixin.methods, ...overrides.vm,
  }
  return { vm, calls, state, mixin }
}

test('new recording opens the dock and focuses the tab before one default-microphone start', async () => {
  const { vm, calls } = fixture()
  await vm.onCreateRecording()
  assert.deepEqual(calls.slice(0, 4).map(c => c[0]), ['panel', 'tick', 'event', 'tier'])
  const start = calls.find(c => c[0] === 'start')
  assert.equal(start[1], 12)
  assert.equal(start[2], undefined)
  assert.equal(start[3].signal.aborted, false)
  assert.equal(start[3].isCurrent(), true)
  assert.deepEqual(calls.at(-1)[2], { pluginId: 'voice', command: 'recording-focus', meetingId: 91 })
  assert.equal(calls.some(c => c[0] === 'notice'), false)
})

test('plugin discovery completes before starting; unavailable voice opens its existing details', async () => {
  const { vm, calls } = fixture({ vm: { dynamicPluginsLoaded: false, meetingRecorderEnabled: false } })
  await vm.onCreateRecording()
  assert.deepEqual(calls.map(c => c[0]), ['plugins', 'market', 'toast'])
  assert.equal(calls[1][1].id, 'voice')
  assert.equal(calls[2][1], 'fileTree.recordingPluginRequired')
})

test('unacknowledged cloud notice keeps the recording panel open without starting', async () => {
  const { vm, calls } = fixture({ tier: async () => ({ tier: 'platform' }), notice: { acknowledged: false } })
  await vm.onCreateRecording()
  assert.equal(calls.some(c => c[0] === 'start'), false)
  assert.deepEqual(calls.at(-1), ['toast', 'fileTree.recordingNoticeRequired'])
})

test('all active recording states only focus the current recording without restarting', async () => {
  for (const status of ['starting', 'recording', 'paused', 'stopping', 'interrupted']) {
    const { vm, calls } = fixture({ state: { status, projectId: 12, meetingId: 91 } })
    await vm.onCreateRecording()
    assert.deepEqual(calls.map(c => c[0]), ['panel', 'tick', 'event'], status)
    assert.equal(calls.at(-1)[2].meetingId, 91)
  }
})

test('another project recording remains running and explains the global capsule controls', async () => {
  const { vm, calls, state } = fixture({ state: { status: 'recording', projectId: 99, meetingId: 90 } })
  await vm.onCreateRecording()
  assert.deepEqual(calls.map(c => c[0]), ['panel', 'tick', 'event', 'toast'])
  assert.equal(calls[2][2].meetingId, null)
  assert.equal(calls.at(-1)[1], 'meeting.otherProjectRecording')
  assert.equal(state.projectId, 99)
})

test('double clicks while checking the tier create only one recording', async () => {
  const gate = deferred()
  const { vm, calls } = fixture({ tier: () => gate.promise })
  const first = vm.onCreateRecording()
  const second = vm.onCreateRecording()
  await new Promise(resolve => setImmediate(resolve))
  gate.resolve({ tier: 'local' })
  await Promise.all([first, second])
  assert.equal(calls.filter(c => c[0] === 'start').length, 1)
})

test('navigation during readiness checks cancels the pending start', async () => {
  const gate = deferred()
  const { vm, calls, mixin } = fixture({ tier: () => gate.promise })
  const pending = vm.onCreateRecording()
  await new Promise(resolve => setImmediate(resolve))
  mixin.onUnload.call(vm)
  gate.resolve({ tier: 'local' })
  await pending
  assert.equal(calls.some(c => c[0] === 'start' || c[0] === 'toast'), false)
  assert.equal(vm._explorerRecordingRequest, null)
})

test('navigation during microphone authorization passes cancellation to the singleton', async () => {
  const permission = deferred()
  let options
  const { vm, calls, mixin } = fixture({ start: async (_id, _device, value) => { options = value; await permission.promise; if (!value.isCurrent()) throw Object.assign(new Error('cancelled'), { code: 'cancelled' }) } })
  const pending = vm.onCreateRecording()
  await new Promise(resolve => setImmediate(resolve))
  mixin.beforeUnmount.call(vm)
  assert.equal(options.signal.aborted, true)
  assert.equal(options.isCurrent(), false)
  permission.resolve()
  await pending
  assert.equal(calls.some(c => c[0] === 'toast'), false)
})

test('a completed recording survives page teardown and permission failures are visible', async () => {
  const done = fixture()
  await done.vm.onCreateRecording()
  done.mixin.beforeUnmount.call(done.vm)
  assert.equal(done.state.status, 'recording')
  assert.equal(done.calls.find(c => c[0] === 'start')[3].signal.aborted, false)
  const denied = fixture({ start: async () => { throw new Error('Microphone access denied') } })
  await denied.vm.onCreateRecording()
  assert.deepEqual(denied.calls.at(-1), ['toast', 'Microphone access denied'])
  assert.equal(denied.vm._explorerRecordingRequest, null)
})

test('read-only projects and a stale project never create a recording', async () => {
  const readonly = fixture({ vm: { canWriteProject: false } })
  await readonly.vm.onCreateRecording()
  assert.deepEqual(readonly.calls, [])
  const stale = fixture({ vm: { isActiveOverviewInstance: () => false } })
  await stale.vm.onCreateRecording()
  assert.deepEqual(stale.calls, [])
})
