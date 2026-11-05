// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1713 #117/#118：录音转写告知只留宿主可信弹窗一处（全文 + 不预勾选的勾选项）；
// 面板不再自画勾选块；没确认时点「开始录音 / 开始转写」直接拉起告知，确认后接着做。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const strip = src => src.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')

// ---------- 宿主告知框 ----------

function noticeDialog({ notice, confirm = true, ack } = {}) {
  const src = strip(readFileSync(new URL('../../src/utils/asrNoticeDialog.js', import.meta.url), 'utf8'))
    .replace('export async function', 'return async function')
  const calls = { dialogs: [], acks: 0, reads: 0 }
  const fn = new Function('getMeetingAsrNotice', 'acknowledgeMeetingAsrNotice', 'showDialog', 't', src)(
    async () => { calls.reads++; return notice },
    async (value) => { assert.equal(value, true); calls.acks++; return ack === undefined ? { ...notice, acknowledged: true } : ack },
    async (o) => { calls.dialogs.push(o); return { confirm, cancel: !confirm } },
    key => key,
  )
  return { fn, calls }
}

test('告知框：带全文与勾选项，确认后才落库', async () => {
  const notice = { body: '告知全文', acknowledged: false }
  const { fn, calls } = noticeDialog({ notice })
  const result = await fn()
  assert.equal(result.acknowledged, true)
  assert.equal(calls.acks, 1)
  assert.deepEqual(calls.dialogs, [{
    title: 'meeting.noticeTitle', content: '告知全文',
    checkLabel: 'meeting.noticeCheckLabel', confirmText: 'meeting.noticeConfirm',
  }])
})

test('告知框：取消或调用方已失效都不落库；已确认过不弹', async () => {
  const pending = { body: 'x', acknowledged: false }
  const cancelled = noticeDialog({ notice: pending, confirm: false })
  assert.equal(await cancelled.fn(), null)
  assert.equal(cancelled.calls.acks, 0)
  const stale = noticeDialog({ notice: pending })
  assert.equal(await stale.fn({ isCurrent: () => false }), null)
  assert.equal(stale.calls.acks, 0)
  const done = noticeDialog({ notice: { body: 'x', acknowledged: true } })
  assert.equal((await done.fn()).acknowledged, true)
  assert.equal(done.calls.dialogs.length, 0)
  // 调用方已读到的状态直接用，不再多问一次
  const given = noticeDialog({ notice: pending })
  await given.fn({ notice: pending })
  assert.equal(given.calls.reads, 0)
})

// ---------- 面板 ----------

const panelSource = readFileSync(new URL('../../src/components/MeetingRecordingPanel.vue', import.meta.url), 'utf8')

test('面板不再有自己的勾选块，只给「查看并确认告知」入口', () => {
  const template = panelSource.slice(0, panelSource.indexOf('<script>'))
  assert.doesNotMatch(template, /noticeChecked|mr-notice-check|asrNotice\.body/)
  assert.match(template, /@tap="ensureAsrNotice"[^>]*>\s*\{\{ noticeCopy\.review \}\}/)
})

function panel({ acknowledged = false, dialog = 'confirm' } = {}) {
  const script = strip(panelSource.slice(panelSource.indexOf('<script>') + 8, panelSource.indexOf('</script>')))
    .replace('export default', 'return')
  const calls = { dialogs: 0, transcribe: [], start: [], toasts: [] }
  const component = new Function('AwdSwitch', 'AwdSelect', 'acknowledgeMeetingAsrNotice', 'transcribeMeetingRecording',
    'confirmPaidTranscription', 'startRecording', 'recorderState', 'uni', 'formatSeconds', script)(
    {}, {},
    async () => {
      calls.dialogs++
      if (dialog === 'cancel') throw Object.assign(new Error('Cancelled'), { code: 'cancelled' })
      if (dialog === 'fail') throw new Error('network down')
      return { body: 'x', acknowledged: true }
    },
    async (id) => { calls.transcribe.push(id) },
    async () => true,
    async (...args) => { calls.start.push(args) },
    { configured: null },
    { showToast: o => calls.toasts.push(o.title) },
    v => String(v),
  )
  const vm = {
    projectId: 9, asrProvider: 'platform', asrNotice: { body: 'x', acknowledged }, noticeBusy: false,
    audioDevices: [], selectedDeviceIndex: 0,
    $t: k => k, loadMeetings: async () => {}, loadAudioDevices: async () => {}, ensurePlatformAccount: async () => true,
    ...component.methods,
  }
  Object.defineProperty(vm, 'needsAsrNotice', { get: () => component.computed.needsAsrNotice.call(vm) })
  Object.defineProperty(vm, 'noticeCopy', { get: () => component.computed.noticeCopy.call(vm) })
  return { vm, calls }
}

test('没确认告知时点「开始转写」：拉起告知，确认后接着转写（不再静默无反应）', async () => {
  const { vm, calls } = panel()
  await vm.onTranscribe({ id: 3, durationMs: 1000 })
  assert.equal(calls.dialogs, 1)
  assert.deepEqual(calls.transcribe, [3])
  assert.equal(vm.asrNotice.acknowledged, true)
})

test('没确认告知时点「开始录音」：拉起告知，确认后接着开录', async () => {
  const { vm, calls } = panel()
  await vm.onStartRecording()
  assert.equal(calls.dialogs, 1)
  assert.equal(calls.start.length, 1)
})

test('取消告知：不转写、不提示错误；保存失败才提示', async () => {
  const cancelled = panel({ dialog: 'cancel' })
  await cancelled.vm.onTranscribe({ id: 3 })
  assert.deepEqual(cancelled.calls.transcribe, [])
  assert.deepEqual(cancelled.calls.toasts, [])
  assert.equal(cancelled.vm.asrNotice.acknowledged, false)
  const failed = panel({ dialog: 'fail' })
  await failed.vm.onTranscribe({ id: 3 })
  assert.deepEqual(failed.calls.transcribe, [])
  assert.deepEqual(failed.calls.toasts, ['network down'])
})

test('已确认过告知：不弹告知，直接走计费确认与转写', async () => {
  const { vm, calls } = panel({ acknowledged: true })
  await vm.onTranscribe({ id: 3 })
  assert.equal(calls.dialogs, 0)
  assert.deepEqual(calls.transcribe, [3])
})
