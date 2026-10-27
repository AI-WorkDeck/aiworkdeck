// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reactive } from 'vue'
import { createComponentDownloadManager } from '../../src/composables/useComponentDownloads.js'
import { createPluginBusinessServices, clonePluginData } from '../../src/utils/pluginBusinessServices.js'
import { resolveTrackEndedStatus, decideAutoTranscribe } from '../../src/utils/meetingRecorderStatus.js'
import { insightEntityTabMethods } from '../../src/pages/project-overview/insightEntityTab.js'

function load(path, name, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ')
  return new Function(...Object.keys(dependencies), source + '\nreturn ' + name)(...Object.values(dependencies))
}
function insightFixture(docFileId = 10) {
  const calls = []
  const basis = { id: 20, name: '合成依据.docx' }
  const host = {
    leftFiles: [{ id: 10, name: '合成正文.docx' }], rightFiles: [], activeFileIdLeft: 10,
    splitMode: false, focusedPane: 'left', $refs: { fileTree: { allFiles: [basis] } },
    closeInsightHoverCard() {}, triggerWorkbenchResize() {}, $nextTick: fn => fn(),
    openFile(file) { calls.push(['open', file.id, this.focusedPane]) }, ...insightEntityTabMethods,
  }
  let writable = true
  const permissions = ['file_read', 'file_write', 'editor', 'network']
  const standard = { id: 4, version: 1, confirmedVersion: null, name: '合成标准', rules: [] }
  const reviews = {
    listReviewStandards: async () => [standard],
    saveReviewStandard: async (_pid, value) => { calls.push(['save', value]); return value },
    confirmReviewStandard: async (_pid, id, version) => { calls.push(['confirm', id, version]); return standard },
  }
  const create = load('../../src/utils/pluginInsightServices.js', 'createPluginInsightServices', {
    getDocInsight: async () => ({ code: 0, data: { entities: [{ id: 31, kind: 'DOC', name: '依据' }] } }),
    getDocInsightEntity: async () => ({}), refreshDocInsightEntity: async () => ({}), parseDocInsight: async () => ({}), reviews,
  })
  const service = create({ projectId: () => 12, permissions: () => permissions, isCurrent: () => true,
    actions: {
      insightContext: () => ({ docFileId, canWrite: writable }),
      insightOpenDoc: payload => host.openInsightDocFile(payload),
      insightHover: payload => calls.push(['hover', payload]),
    }, openFile: file => host.openFile(file), listFiles: async () => [basis],
  })
  return { calls, host, permissions, readOnly: () => { writable = false }, request: (op, params = {}) => service.request(op, params, new AbortController().signal) }
}

test('insight opens a referenced project file through the original right-pane host action', async () => {
  const f = insightFixture()
  await f.request('openDoc', { fileId: 20 })
  assert.deepEqual(f.calls, [['open', 20, 'right']])
  assert.equal(f.host.splitMode, true)
  assert.equal(f.host.activeFileIdLeft, 10)
  await assert.rejects(f.request('openDoc', { fileId: 99 }), { code: 'not_found' })
})
test('project review standards remain available without an active document, retaining write checks', async () => {
  const f = insightFixture(null)
  assert.equal((await f.request('standards'))[0].id, 4)
  await f.request('saveStandard', { id: 4, expectedVersion: 1, name: '合成标准', rules: [] })
  await f.request('confirmStandard', { id: 4, version: 1 })
  await assert.rejects(f.request('confirmStandard', { id: 99, version: 1 }), { code: 'not_found' })
  await assert.rejects(f.request('parse'), { code: 'stale_document' })
  f.readOnly()
  await assert.rejects(f.request('saveStandard', { name: 'blocked' }), { code: 'permission_denied' })
  f.permissions.splice(f.permissions.indexOf('file_write'), 1)
  await assert.rejects(f.request('confirmStandard', { id: 4, version: 1 }), { code: 'permission_denied' })
})
test('insight does not invent hover coordinates when the editor supplied none', async () => {
  const f = insightFixture()
  for (const point of [{}, { x: null, y: null }, { x: NaN, y: 40 }]) {
    await f.request('openHover', { payload: { entity: { id: 31 }, ...point } })
  }
  assert.deepEqual(f.calls, [])
  await f.request('openHover', { payload: { entity: { id: 31 }, x: 120, y: 80 } })
  assert.deepEqual(f.calls, [['hover', { entity: { id: 31, kind: 'DOC', name: '依据' }, x: 120, y: 80 }]])
})

for (const outcome of ['model-failed', 'service-failed', 'ready']) {
  test('voice install adapter respects the real download manager result: ' + outcome, async () => {
    let progress, modelInstalled = false
    const manager = createComponentDownloadManager({
      state: reactive({}),
      optionalComponents: async () => ({ components: [{ packId: 'kokoro-runtime', installed: true, modelId: 'kokoro-models', service: 'kokoro-service' }] }),
      modelStatus: async () => ({ components: [{ id: 'kokoro-models', state: modelInstalled ? 'installed' : 'absent' }] }),
      onModelProgress: callback => { progress = callback; return () => {} },
      modelDownload: async () => {
        modelInstalled = outcome !== 'model-failed'
        progress({ id: 'kokoro-models', phase: modelInstalled ? 'done' : 'error', message: 'synthetic model failure' })
      },
      ensureService: async () => outcome === 'service-failed' ? { ok: false, message: 'synthetic engine failure' } : { ok: true },
    })
    const create = load('../../src/utils/pluginVoiceServices.js', 'createPluginVoiceServices', {
      api: {}, host: {}, recorder: {}, componentDownloads: manager,
      showDialog: async () => ({ confirm: true }), requireAccount: async () => true,
      confirmPaidTranscription: async () => true, readPcmWav() {}, getAuthHeaders: () => ({}),
    })
    const service = create({ projectId: () => 12, permissions: () => ['speech'], isCurrent: () => true, actions: {} })
    const adapter = load('../../plugin-app/voice/componentDownloads.js', 'componentDownloads', {
      reactive,
      voice: async (operation, params = {}) => structuredClone(clonePluginData(await service.request(operation, params, new AbortController().signal))),
      setTimeout: callback => setTimeout(callback, 0),
    })
    await adapter.load()
    const item = adapter.state.items[0]
    assert.equal(await adapter.installOne(item), outcome === 'ready')
    if (outcome !== 'ready') assert.match(item.error, /synthetic .* failure/)
    assert.equal(manager.isInstalling('kokoro-runtime'), false)
    modelInstalled = true
    await adapter.load()
    assert.equal(item.phase, manager.state.items[0].phase, 'later inventory must retain the manager state')
    assert.equal(item.error, '', 'a past attempt must not overwrite later recovery')
  })
}


for (const outcome of ['finished', 'finish-failed', 'revoked']) test('voice stop after RPC deadline preserves original recorder result: ' + outcome, async () => {
  let consent, finished = 0, released = 0
  const paid = new Promise(resolve => { consent = resolve })
  const engine = load('../../src/utils/meetingRecorder.js', '({ recorderState, isRecordingActive, startRecording, stopRecording })', {
    reactive, resolveTrackEndedStatus, decideAutoTranscribe,
    getApiBaseUrl: () => '', getAuthHeaders: () => ({}), t: key => key,
    createMeetingRecording: async () => ({ meeting: { id: 71, audioFileId: 72 }, configured: true }),
    finishMeetingRecording: async () => { finished++; if (outcome === 'finish-failed') throw new Error('synthetic finish failure'); return { id: 71, status: 'RECORDED' } },
    deleteMeetingRecording: async () => {}, confirmPaidTranscription: () => paid,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { released++ } }] }) } },
    window: {}, MediaRecorder: class { constructor() { this.state = 'recording' } start() {} stop() { this.state = 'inactive'; this.onstop() } },
    setInterval: () => null, clearInterval() {},
  })
  await engine.startRecording(12)
  engine.recorderState.seconds = 10
  const create = load('../../src/utils/pluginVoiceServices.js', 'createPluginVoiceServices', {
    api: { getMeetingRecordings: async () => ({ meetings: [{ id: 71 }] }), getMeetingRecording: async () => ({ id: 71, status: 'RECORDED' }) },
    host: {}, recorder: engine, componentDownloads: {}, showDialog: async () => ({ confirm: true }),
    requireAccount: async () => true, confirmPaidTranscription: () => paid, readPcmWav() {}, getAuthHeaders: () => ({}),
  })
  const options = { projectId: () => 12, permissions: () => ['speech', 'file_read', 'file_write'], isCurrent: () => true, actions: {} }
  const service = create(options)
  const wrapper = createPluginBusinessServices({ ...options, delegates: { voice: (...args) => service.request(...args) } })
  let seq = 0
  const adapter = load('../../plugin-app/voice/meetingRecorder.js', '({ recorderState, refreshRecorder, stopRecording })', {
    reactive, setTimeout: callback => setTimeout(callback, 1),
    voice: (op, params = {}, options = {}) => {
      const requestId = 'stop-test-' + ++seq
      const pending = wrapper.request('voice', op, { ...params, requestId }).then(result => structuredClone(clonePluginData(result)))
      if (op !== 'stop') return pending
      assert.equal(options.timeoutMs, 120000)
      return Promise.race([pending, new Promise((_, reject) => setTimeout(() => { wrapper.cancel(requestId); reject(Object.assign(new Error('deadline'), { code: 'timeout' })) }, 5))])
    },
  })
  await adapter.refreshRecorder()
  const pending = adapter.stopRecording().catch(error => error)
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(engine.recorderState.status, 'stopping')
  assert.equal(finished, 0)
  assert.equal(released, 1, 'media tracks release before waiting on paid consent')
  if (outcome === 'revoked') wrapper.dispose()
  consent(false)
  const result = await pending
  if (outcome === 'revoked') assert.equal(result.code, 'cancelled')
  else if (outcome === 'finish-failed') { assert.equal(result, null); assert.equal(adapter.recorderState.error, 'meeting.finishWriteBackFailed') }
  else assert.deepEqual(result, { id: 71, status: 'RECORDED' })
  assert.equal(engine.recorderState.status, 'idle')
  if (outcome !== 'revoked') assert.equal(adapter.recorderState.status, 'idle')
  assert.equal(finished, 1)
})
