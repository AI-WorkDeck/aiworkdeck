// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * QA D10：交稿清单在「结束本次工作」成功后退回第 1 步，后端同时记了一条
 * 「正在整理版本，请稍后重试」——提交刚结束时仓库锁可能还被占着，/version/status
 * 回 VERSION_BUSY，清单读失败就保留了页面那份「工作中」的旧快照。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { errorText } from '../_lib/error-text.mjs'
// Sources are evaluated with new Function (global scope): give them the real X-S1 toast-text helper.
globalThis.errorText = errorText

const source = readFileSync(new URL('../../src/components/collab/SubmitDraftGuide.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^import[\s\S]*?from .*$/gm, '').replace('export default', 'return')

function guide({ statuses, end = async () => ({ data: {} }) }) {
  const reads = []
  const busy = () => Object.assign(new Error('正在整理版本，请稍后重试'), { kind: 'VERSION_BUSY' })
  const api = {
    endWorkSession: end,
    getVersionStatus: async (id) => { reads.push(id); const next = statuses.shift(); if (next === 'busy') throw busy(); return { data: next } },
    getCloudStatus: async () => ({ data: { remoteAhead: false } }),
    checkCloud: async () => ({ data: { remoteAhead: false } }),
    updateFromCloud: async () => ({}), uploadToCloud: async () => ({}),
  }
  const component = new Function('endWorkSession', 'updateFromCloud', 'uploadToCloud', 'getVersionStatus', 'getCloudStatus', 'checkCloud', 'submitGuideSteps', 'pullStepText', 'uni', 'console', script)(
    api.endWorkSession, api.updateFromCloud, api.uploadToCloud, api.getVersionStatus, api.getCloudStatus, api.checkCloud, () => ({}), () => '', { showToast() {} }, { warn() {} })
  const vm = { ...component.data(), projectId: 7, visible: true, events: [], $emit(name) { this.events.push(name) }, $t: (k) => k }
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  vm.localWorking = true
  return { vm, reads }
}

test('a busy status read right after ending the session is retried, not shown as still working', async () => {
  const { vm, reads } = guide({ statuses: ['busy', { working: false }] })
  await vm.doEndSession()
  assert.equal(vm.localWorking, false)
  assert.equal(reads.length, 2, 'the VERSION_BUSY read is retried once the lock is released')
})

test('even if the re-read keeps failing, a successful end of session is not undone on the checklist', async () => {
  const { vm } = guide({ statuses: ['busy'] })
  vm.visible = false // closing the dialog stops the retries; the end-session result must still stand
  await vm.doEndSession()
  assert.equal(vm.localWorking, false)
})

test('a failed end of session keeps the first step active', async () => {
  const { vm, reads } = guide({ statuses: [], end: async () => { throw new Error('提交失败') } })
  await vm.doEndSession()
  assert.equal(vm.localWorking, true)
  assert.equal(reads.length, 0)
})

// C29 (lane C, C24 retest): the push behind 交稿 holds the lock 4–6 s on a saturated link; the checklist's
// re-read gave up after ~4.5 s and repainted from a stale snapshot. It now waits the push out.
test('the checklist re-read waits out a busy window as long as a push under load', async () => {
  const statuses = Array(11).fill('busy').concat([{ working: false }])
  const { vm, reads } = guide({ statuses })
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn) => realTimeout(fn, 0)
  try { await vm.refresh() } finally { globalThis.setTimeout = realTimeout }
  assert.equal(reads.length, 12, 'kept reading until the lock was released')
  assert.equal(vm.localWorking, false)
})
