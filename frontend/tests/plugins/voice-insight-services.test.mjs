// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPluginBusinessServices, clonePluginData } from '../../src/utils/pluginBusinessServices.js'
import { resolveDocks } from '../../src/config/panelRegistry.js'
function factory(file, name, dependencies) {
  const source = readFileSync(new URL('../../src/utils/' + file, import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace('export function ' + name, 'function ' + name)
  return new Function(...Object.keys(dependencies), source + '\nreturn ' + name)(...Object.values(dependencies))
}
function voiceFixture(overrides = {}) {
  const calls = []
  const api = {
    getTtsVoices: async () => [], generateTtsAudio: async (...args) => { calls.push(['synthesize', ...args]); return new ArrayBuffer(44) },
    getMeetingRecordings: async () => ({ tier: 'local', meetings: [{ id: 8, audioFileId: 80, durationMs: 100 }] }),
    transcribeMeetingRecording: async id => calls.push(['transcribe', id]),
    ...overrides.api,
  }
  const recorder = { recorderState: { projectId: 12, status: 'recording' }, isRecordingActive: () => true, listAudioInputDevices: async () => [], pauseRecording: () => calls.push(['pause']), startRecording: (...args) => calls.push(['start', ...args]), ...overrides.recorder }
  const create = factory('pluginVoiceServices.js', 'createPluginVoiceServices', { api, host: {}, recorder, componentDownloads: {}, showDialog: overrides.showDialog || (async () => ({ confirm: true })), requireAccount: async () => true, confirmPaidTranscription: overrides.paid || (async () => true), readPcmWav: () => { throw new Error('invalid wav') }, getAuthHeaders: () => ({}) })
  let current = true
  const options = { projectId: () => 12, permissions: () => ['speech', 'file_read', 'file_write', 'editor', 'network'], isCurrent: () => current, actions: {}, ...overrides.options }
  const voice = create(options)
  const wrapper = createPluginBusinessServices({ ...options, delegates: { voice: (...args) => voice.request(...args) } })
  return { calls, wrapper, stale: () => { current = false } }
}
test('speech synthesis fixes synthesis rate to 1 and propagates real cancellation', async () => {
  let resolve, signal
  const f = voiceFixture({ api: { generateTtsAudio: (payload, options) => { assert.deepEqual(payload, { text: 'hello', voice: 'one', rate: 1 }); signal = options.signal; return new Promise(done => { resolve = done }) } } })
  const pending = f.wrapper.request('voice', 'synthesize', { requestId: 'a', text: 'hello', voice: 'one', rate: 2 })
  f.wrapper.cancel('a'); assert.equal(signal.aborted, true); resolve(new ArrayBuffer(44))
  await assert.rejects(pending, { code: 'cancelled' })
})
test('voice permission and cross-project recording controls fail before side effects', async () => {
  const denied = voiceFixture({ options: { permissions: () => ['file_read'] } })
  await assert.rejects(denied.wrapper.request('voice', 'voices'), { code: 'permission_denied' })
  const cross = voiceFixture({ recorder: { recorderState: { projectId: 99, status: 'recording' } } })
  await assert.rejects(cross.wrapper.request('voice', 'pause'), { code: 'permission_denied' })
  assert.deepEqual(cross.calls, [])
})
test('late trusted recording confirmation cannot start after disposal', async () => {
  let confirm
  const f = voiceFixture({ showDialog: () => new Promise(resolve => { confirm = resolve }) })
  const pending = f.wrapper.request('voice', 'start')
  await new Promise(resolve => setImmediate(resolve))
  f.wrapper.dispose(); confirm({ confirm: true })
  await assert.rejects(pending, { code: 'cancelled' }); assert.deepEqual(f.calls, [])
})
test('transcription verifies project membership and enforces host paid confirmation', async () => {
  const f = voiceFixture({ paid: async () => false })
  await assert.rejects(f.wrapper.request('voice', 'transcribe', { id: 9 }), { code: 'not_found' })
  await assert.rejects(f.wrapper.request('voice', 'transcribe', { id: 8 }), { code: 'cancelled' })
  assert.deepEqual(f.calls, [])
})
test('malformed audio download never reaches the host download action', async () => {
  let downloaded = false
  const f = voiceFixture({ options: { actions: { download: () => { downloaded = true } } } })
  await assert.rejects(f.wrapper.request('voice', 'download', { content: new ArrayBuffer(44) }), /invalid wav/)
  assert.equal(downloaded, false)
})
test('bridge copies reactive objects while preserving WAV binary payloads', () => {
  const bytes = new ArrayBuffer(10)
  const value = new Proxy({ rows: [new Proxy({ id: 1 }, {})], bytes }, {})
  assert.throws(() => structuredClone(value))
  const result = structuredClone(clonePluginData(value))
  assert.deepEqual(result.rows, [{ id: 1 }]); assert.equal(result.bytes.byteLength, 10)
})
test('dynamic docks only include installed contributions and respect declared positions', () => {
  const contributions = [{ key: 'plugin-voice', defaultDock: 'left', allowedDocks: ['left', 'right'] }, { key: 'plugin-clipboard', defaultDock: 'bottom', allowedDocks: ['left', 'right', 'bottom'] }]
  const docks = resolveDocks({ 'plugin-voice': 'bottom', 'plugin-clipboard': 'right' }, contributions)
  assert.deepEqual(docks.left.map(p => p.key), ['plugin-voice'])
  assert.deepEqual(docks.right.map(p => p.key), ['plugin-clipboard'])
  assert.deepEqual(resolveDocks({}, []), { left: [], right: [], bottom: [] })
})

function insightFixture() {
  let docFileId = 4, current = true, entities = [{ id: 5, text: 'verified' }]
  const calls = []
  const actions = { insightContext: () => ({ docFileId, canWrite: true }), insightEntities: data => calls.push(data), insightHover: data => calls.push(data), prepareInsight: async () => true, insightExecutor: () => async (name, params) => { calls.push([name, params]); return { success: true, found: true, total: 1 } } }
  const create = factory('pluginInsightServices.js', 'createPluginInsightServices', { getDocInsight: async () => ({ entities }), getDocInsightEntity: async (_, id) => ({ id }), reviews: {}, parseDocInsight: async () => ({}), refreshDocInsightEntity: async (_, id) => ({ id }) })
  const service = create({ projectId: () => 12, permissions: () => ['file_read', 'file_write', 'network', 'editor'], isCurrent: () => current, actions, listFiles: async () => [{ id: 4 }], openFile: file => calls.push(file) })
  return { calls, actions, service, change: () => { docFileId = 9 }, stale: () => { current = false } }
}
test('insight rejects cross-document entities and rehydrates trusted hover data', async () => {
  const f = insightFixture(), signal = new AbortController().signal
  await assert.rejects(f.service.request('entity', { entityId: 99 }, signal), { code: 'not_found' })
  await f.service.request('openHover', { payload: { entity: { id: 5, text: 'forged' }, x: 10, y: 20 } }, signal)
  assert.deepEqual(f.calls, [{ entity: { id: 5, text: 'verified' }, x: 10, y: 20 }])
})
test('insight cannot replace after the document changed while finding a match', async () => {
  const f = insightFixture(), signal = new AbortController().signal
  f.actions.insightExecutor = () => async (name) => { f.calls.push(name); f.change(); return { success: true, found: true, total: 1 } }
  await assert.rejects(f.service.request('execute', { action: 'find_replace', params: { findText: 'one', replaceText: 'two' } }, signal), { code: 'stale_document' })
  assert.deepEqual(f.calls, ['find_navigate'])
})
test('disposed insight and unknown speech requests have no side effects', async () => {
  const f = insightFixture(); f.stale()
  await assert.rejects(f.service.request('context', {}, new AbortController().signal), { code: 'cancelled' })
  const voice = voiceFixture()
  await assert.rejects(voice.wrapper.request('voice', 'arbitrary-operation'), { code: 'unknown_operation' })
})
