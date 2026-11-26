// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * C11 gate fail (lane C, master c1cb22412, 2026-11-26): offline, 协作 → 交稿 opened the guide on
 * 「暂时连不上案件库」 with all steps grey. No submit was ever attempted, so nothing was queued, and
 * 7 minutes after the network came back nothing had been submitted. The guide now queues the submit
 * as soon as it learns, while opened to submit, that the library is unreachable.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { errorText } from '../_lib/error-text.mjs'
globalThis.errorText = errorText

const source = readFileSync(new URL('../../src/components/collab/SubmitDraftGuide.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^import[\s\S]*?from .*$/gm, '').replace('export default', 'return')

function guide({ cloud, mode = 'guide' }) {
  const api = {
    endWorkSession: async () => ({}), updateFromCloud: async () => ({}), uploadToCloud: async () => ({}),
    getVersionStatus: async () => ({ data: { working: false } }),
    getCloudStatus: async () => ({ data: cloud }),
    checkCloud: async () => ({ data: cloud }),
  }
  const component = new Function('endWorkSession', 'updateFromCloud', 'uploadToCloud', 'getVersionStatus', 'getCloudStatus', 'checkCloud', 'submitGuideSteps', 'pullStepText', 'uni', 'console', script)(
    api.endWorkSession, api.updateFromCloud, api.uploadToCloud, api.getVersionStatus, api.getCloudStatus, api.checkCloud, () => ({ steps: [] }), () => '', { showToast() {} }, { warn() {} })
  const vm = { ...component.data(), projectId: 7, visible: true, mode, working: false, cloud: {}, events: [], $emit(name) { this.events.push(name) }, $t: (k) => k }
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  return { vm, component }
}

test('opening the guide to submit while the library is unreachable queues the submit once', async () => {
  const { vm } = guide({ cloud: { offline: true, pendingUpload: true } })
  await vm.refresh({ online: true })
  assert.equal(vm.queuedOffline, true)
  assert.deepEqual(vm.events.filter((e) => e === 'queued'), ['queued'])
  await vm.refresh({ online: true }) // the 30 s live re-check while still offline
  assert.deepEqual(vm.events.filter((e) => e === 'queued'), ['queued'], 'queued only once per opening')
})

test('online, the help view, or a local (non-network) read never queue', async () => {
  for (const [cloud, mode, online] of [[{ offline: false }, 'guide', true], [{ offline: true }, 'help', true], [{ offline: true }, 'guide', false]]) {
    const { vm } = guide({ cloud, mode })
    await vm.refresh({ online })
    assert.equal(vm.events.includes('queued'), false, JSON.stringify({ cloud, mode, online }))
  }
})

test('reopening resets the queued note', () => {
  const realSet = globalThis.setInterval
  globalThis.setInterval = () => 0
  try {
    const { vm, component } = guide({ cloud: { offline: true } })
    vm.queuedOffline = true
    vm.refresh = async () => false
    component.watch.visible.call(vm, true)
    assert.equal(vm.queuedOffline, false)
  } finally { globalThis.setInterval = realSet }
})

test('the offline text says it will submit automatically once queued', () => {
  assert.match(source, /\$t\(queuedOffline \? 'version\.submitGuideOfflineQueuedDesc' : 'version\.submitGuideOfflineDesc'\)/)
  const zh = readFileSync(new URL('../../src/locales/zh-CN/version.js', import.meta.url), 'utf8')
  assert.match(zh, /submitGuideOfflineQueuedDesc: '.*联网后会自动交/)
})

test('the page acts on queued: it retries after the next successful online check', () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  assert.match(page, /@queued="onSubmitQueuedOffline"/)
  assert.match(page, /if \(online && typeof this\.retryQueuedSubmit === 'function'\) this\.retryQueuedSubmit\(\)/)
})
