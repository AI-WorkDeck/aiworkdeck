// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * C32 freeze re-run (lane C, 11-28, readiness/qa/C32/r4-after-freeze.png): the transfer watchdog ended
 * a 交稿 14 s after the backend froze, but the guide then awaited the C11 "really offline?" re-check
 * (status + check against the same frozen backend) before saying anything. The button stayed busy for
 * 70 s, and when the backend came back that refresh threw and skipped the toast altogether.
 * A transport failure to the local backend means the local service is down, not the internet:
 * say so at once, and never let a failing refresh swallow the toast.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { errorText } from '../_lib/error-text.mjs'
import { submitFailedOffline } from '../../src/utils/submitGuide.js'
globalThis.errorText = errorText

const source = readFileSync(new URL('../../src/components/collab/SubmitDraftGuide.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^import[\s\S]*?from .*$/gm, '').replace('export default', 'return')

const dead = () => Object.assign(new Error('request:fail local service not responding'), { errMsg: 'request:fail local service not responding' })
const hang = () => new Promise(() => {})

function guide({ upload, status, check }) {
  const toasts = []
  const component = new Function('endWorkSession', 'updateFromCloud', 'uploadToCloud', 'getVersionStatus', 'getCloudStatus', 'checkCloud', 'submitGuideSteps', 'pullStepText', 'showLargeFileBackupBlock', 'uni', 'console', script)(
    async () => ({}), async () => ({}), upload, status, status, check, () => ({ steps: [] }), () => '', () => false,
    { showToast: (o) => toasts.push(o.title) }, { warn() {} })
  const vm = { ...component.data(), projectId: 7, visible: true, mode: 'guide', working: false, cloud: {}, events: [], $emit(n) { this.events.push(n) }, $t: (k) => k }
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  return { vm, toasts }
}

const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`still busy after ${ms} ms`)), ms))])

test('a dead local service: the guide frees the button and says so at once, without the online re-check', async () => {
  const { vm, toasts } = guide({ upload: async () => { throw dead() }, status: hang, check: hang })
  await within(vm.doSubmit(), 200)
  assert.equal(vm.busy, false)
  assert.equal(toasts.length, 1)
  assert.match(toasts[0], /^errors\./, `a catalogue message, not raw text: ${toasts[0]}`)
  assert.equal(vm.events.includes('queued'), false, 'a dead local service is not "offline, submit later"')
})

test('a failing refresh after a failed submit never swallows the toast', async () => {
  const { vm, toasts } = guide({
    upload: async () => { throw new Error('案件库拒绝了这次交稿') },
    status: async () => { throw dead() }, check: async () => { throw dead() },
  })
  await within(vm.doSubmit(), 200)
  assert.equal(vm.busy, false)
  assert.equal(toasts.length, 1, `exactly one message: ${toasts}`)
})

test('CollabDialog / CommitHistoryTab: no online re-check after a transport failure to the local service', async () => {
  let checked = 0
  const check = async () => { checked++; return hang() }
  assert.equal(await within(submitFailedOffline(7, check, dead()), 200), false)
  assert.equal(checked, 0)
  for (const f of ['../../src/components/collab/CollabDialog.vue', '../../src/components/version/CommitHistoryTab.vue']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.match(src, /submitFailedOffline\(this\.projectId, checkCloud, e\)/, `${f} passes the failure so a dead local service skips the re-check`)
  }
})

test('a genuine offline answer still queues (C11 unchanged)', async () => {
  assert.equal(await submitFailedOffline(7, async () => ({ data: { offline: true } }), new Error('案件库连不上')), true)
})
