// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTtsReader } from '../../src/utils/ttsReader.js'
import { hasTtsText } from '../../src/utils/ttsText.js'

const source = readFileSync(new URL('../../src/components/EasyVoicePane.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .+$/gm, '').replace('export default', 'return')
const tick = () => new Promise(resolve => setImmediate(resolve))
const wave = () => {
  const buffer = new ArrayBuffer(48), v = new DataView(buffer)
  for (const [i, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) [...text].forEach((c, j) => v.setUint8(i + j, c.charCodeAt(0)))
  v.setUint32(4, 40, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); v.setUint32(40, 4, true)
  return buffer
}
function pane() {
  const requests = [], audios = [], events = [], notices = []
  const factory = new Function('hasTtsText', 'createTtsReader', 'generateTtsAudio', 'componentDownloads', 'host', 'ICONS', 'uni', 'AwdSelect', script)
  const component = factory(
    hasTtsText,
    options => createTtsReader({ ...options,
      urls: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
      createAudio: () => {
        const audio = { play: () => Promise.resolve(), pause() {}, load() {}, removeAttribute() {} }
        audios.push(audio); return audio
      }
    }),
    (payload, options) => new Promise((resolve, reject) => requests.push({ payload, options, resolve, reject })),
    {}, {}, {}, { $emit() {}, showToast: value => notices.push(value) }, {}
  )
  const vm = { ...component.data(), ...component.methods, fetchVoices() {}, loadModelState() {},
    $t: key => key, $emit: (...event) => events.push(event) }
  for (const [key, fn] of Object.entries(component.computed)) Object.defineProperty(vm, key, { get: () => fn.call(vm) })
  component.mounted.call(vm)
  return { vm, component, requests, audios, events, notices }
}

test('component renders a scrollable transcript and live rate controls; audio events select the spoken snapshot', async () => {
  const h = pane()
  h.vm.text = '旧文第一句。旧文第二句。'; h.vm.selectedVoiceId = 'test'
  const done = h.vm.handleGenerate()
  h.requests[0].resolve(wave()); await tick()
  assert.equal(h.vm.reading.currentIndex, -1)
  assert.ok(!h.events.some(event => event[0] === 'highlight-sentence'))
  h.audios[0].onplaying()
  assert.deepEqual(h.events.at(-1), ['highlight-sentence', '旧文第一句。'])
  assert.equal(h.vm.canPause, true)
  h.vm.onRateChange({ detail: { value: 175 } })
  assert.equal(h.audios[0].playbackRate, 1.75)
  assert.equal(h.vm.speedText, '1.75x')
  assert.equal(h.requests[0].payload.rate, '1')
  h.vm.togglePlay(); assert.equal(h.vm.reading.status, 'paused')
  h.requests[1].resolve(wave()); await done
  assert.equal(h.vm.reading.status, 'paused')
  assert.ok(h.vm.reading.exportBuffer)
  h.vm.togglePlay(); h.audios[0].onplaying(); h.audios[0].onended()
  h.audios[1].onplaying()
  assert.deepEqual(h.events.at(-1), ['highlight-sentence', '旧文第二句。'])
  h.audios[1].onended()
  assert.deepEqual(h.events.at(-1), ['clear-highlight'])
  assert.equal(h.vm.reading.status, 'complete')
  assert.match(source, /scroll-into-view=[\s\S]*?reading\.currentIndex/)
  assert.match(source, /v-for="\(segment, index\) in reading\.segments"/)
  assert.match(source, /active: index === reading\.currentIndex/)
  assert.match(source, /@changing="onRateChange"/)
  h.component.beforeUnmount.call(h.vm)
})

test('editing text synchronously stops the reader and rejects old highlights and late generation', async () => {
  const h = pane()
  h.vm.text = '旧文第一句。旧文第二句。'; h.vm.selectedVoiceId = 'test'
  const done = h.vm.handleGenerate()
  h.requests[0].resolve(wave()); await tick()
  const stalePlaying = h.audios[0].onplaying
  h.audios[0].onplaying()
  h.vm.text = '修改后的新文。'
  assert.equal(h.component.watch.text.flush, 'sync')
  h.component.watch.text.handler.call(h.vm)
  assert.equal(h.requests[1].options.signal.aborted, true)
  assert.deepEqual(h.events.at(-1), ['clear-highlight'])
  const count = h.events.length
  stalePlaying(); h.requests[1].resolve(wave()); await done
  assert.equal(h.events.length, count)
  assert.equal(h.vm.reading.status, 'idle')
  assert.deepEqual(h.vm.reading.segments, [])
  h.component.beforeUnmount.call(h.vm)
})

test('import stops the old reader before the parent can switch documents, even when the imported text is identical', async () => {
  const h = pane()
  h.vm.text = '旧文。'; h.vm.selectedVoiceId = 'test'
  const done = h.vm.handleGenerate()
  await h.vm.importFromDoc()
  assert.equal(h.requests[0].options.signal.aborted, true)
  const requestIndex = h.events.findIndex(event => event[0] === 'request-doc-text')
  const clearIndex = h.events.findIndex(event => event[0] === 'clear-highlight')
  assert.ok(clearIndex >= 0 && clearIndex < requestIndex)
  h.events[requestIndex][1]('旧文。')
  h.requests[0].resolve(wave()); await done
  assert.equal(h.audios.length, 0)
  assert.equal(h.vm.reading.status, 'idle')
  h.component.beforeUnmount.call(h.vm)
})

test('component teardown aborts unfinished synthesis and late document callbacks cannot update its text', async () => {
  const h = pane()
  await h.vm.importFromDoc()
  const callback = h.events.find(event => event[0] === 'request-doc-text')[1]
  h.vm.text = '旧文。'; h.vm.selectedVoiceId = 'test'
  const done = h.vm.handleGenerate()
  h.component.beforeUnmount.call(h.vm)
  assert.equal(h.requests[0].options.signal.aborted, true)
  h.requests[0].resolve(wave()); await done
  callback('新文。')
  assert.equal(h.audios.length, 0)
  assert.equal(h.vm.text, '旧文。')
  assert.deepEqual(h.events.at(-1), ['clear-highlight'])
})

test('voice selection applies to the next reading without changing the active synthesis voice', async () => {
  const h = pane()
  h.vm.voices = [{ voiceId: 'first', name: 'First' }, { voiceId: 'second', name: 'Second' }]
  h.vm.text = '第一句。第二句。'
  h.vm.selectVoiceIndex(1)
  const done = h.vm.handleGenerate()
  assert.equal(h.requests[0].payload.voice, 'second')
  h.vm.selectVoiceIndex(0)
  h.requests[0].resolve(wave()); await tick()
  assert.equal(h.requests[1].payload.voice, 'second')
  h.requests[1].resolve(wave()); await done
  const restarted = h.vm.handleGenerate()
  assert.equal(h.requests[2].payload.voice, 'first')
  h.component.beforeUnmount.call(h.vm)
  h.requests[2].resolve(wave()); await restarted
})

test('keyboard speed changes affect current audio, clamp the supported range, and reset without regeneration', async () => {
  const h = pane()
  h.vm.text = '朗读测试。'; h.vm.selectedVoiceId = 'test'
  const done = h.vm.handleGenerate()
  h.requests[0].resolve(wave()); await done
  for (const [key, expected] of [['ArrowRight', 105], ['PageUp', 130], ['End', 200], ['ArrowUp', 200], ['Home', 50], ['ArrowDown', 50]]) {
    let prevented = false
    h.vm.onRateKey({ key, preventDefault() { prevented = true } })
    assert.ok(prevented)
    assert.equal(h.vm.rate, expected)
    assert.equal(h.audios[0].playbackRate, expected / 100)
  }
  h.vm.resetRate()
  assert.equal(h.audios[0].playbackRate, 1)
  assert.equal(h.requests.length, 1)
  h.component.beforeUnmount.call(h.vm)
})

test('disabled or repeated keyboard actions cannot restart synthesis; active actions keep their component receiver', () => {
  const h = pane()
  let calls = 0
  const action = function () { assert.equal(this, h.vm); calls++ }
  for (const [key, disabled, repeat] of [['Enter', true, false], [' ', true, false], ['Enter', false, true], ['Escape', false, false]]) {
    h.vm.onActionKey({ key, repeat, preventDefault() {} }, action, disabled)
  }
  assert.equal(calls, 0)
  h.vm.onActionKey({ key: 'Enter', preventDefault() {} }, action)
  h.vm.onActionKey({ key: ' ', preventDefault() {} }, action)
  assert.equal(calls, 2)
  h.component.beforeUnmount.call(h.vm)
})

test('generation failure keeps an actionable error and text until retry succeeds', async () => {
  const h = pane()
  h.vm.text = '失败后保留原文。'; h.vm.selectedVoiceId = 'test'
  const failed = h.vm.handleGenerate()
  h.requests[0].reject(new Error('controlled failure')); await failed
  assert.equal(h.vm.readingError, 'generation')
  assert.equal(h.vm.text, '失败后保留原文。')
  assert.equal(h.vm.startLabel, 'panels.evRetry')
  assert.equal(h.vm.startDisabled, false)
  const retried = h.vm.handleGenerate()
  assert.equal(h.vm.readingError, '')
  h.requests[1].resolve(wave()); await retried
  h.audios[0].onplaying()
  assert.equal(h.vm.reading.status, 'playing')
  h.component.beforeUnmount.call(h.vm)
})

test('reading immediately after typing consumes the native textarea value before Uni emits its delayed update', async () => {
  const h = pane()
  h.vm.text = '旧'; h.vm.selectedVoiceId = 'test'
  const field = { value: '完整输入，没有截尾。', setAttribute() {} }
  h.vm.onTextInput({ target: field })
  const done = h.vm.handleGenerate()
  assert.equal(h.vm.text, field.value)
  assert.equal(h.requests[0].payload.text, field.value)
  h.requests[0].resolve(wave()); await done
  h.component.beforeUnmount.call(h.vm)
})

test('the focusable Uni textarea receives the translated name after mounting and language changes', () => {
  const h = pane()
  const labels = []
  h.vm.$el = { querySelector: () => ({ setAttribute: (name, value) => labels.push([name, value]), addEventListener() {}, removeEventListener() {} }) }
  h.vm.$t = () => '文本内容'
  h.vm.syncTextFieldLabel()
  h.vm.$t = () => 'Text Content'
  h.component.updated.call(h.vm)
  assert.deepEqual(labels, [['aria-label', '文本内容'], ['aria-label', 'Text Content']])
  h.component.beforeUnmount.call(h.vm)
})


test('reading immediately after importing preserves new text while the Uni textarea still displays the old value', async () => {
  const h = pane()
  h.vm.text = '旧正文。'; h.vm.selectedVoiceId = 'test'
  h.vm.$el = { querySelector: () => ({ value: '旧正文。' }) }
  await h.vm.importFromDoc()
  h.events.find(event => event[0] === 'request-doc-text')[1]('新导入正文。')
  const done = h.vm.handleGenerate()
  assert.equal(h.vm.text, '新导入正文。')
  assert.equal(h.requests[0].payload.text, '新导入正文。')
  h.requests[0].resolve(wave()); await done
  h.component.beforeUnmount.call(h.vm)
})


test('native textarea input subscription is installed once and removed on teardown', () => {
  const h = pane()
  let listener, installed = 0, removed = 0
  const field = {
    value: '', setAttribute() {},
    addEventListener(name, fn) { assert.equal(name, 'input'); listener = fn; installed++ },
    removeEventListener(name, fn) { assert.equal(name, 'input'); assert.equal(fn, listener); removed++ }
  }
  h.vm.$el = { querySelector: () => field }
  h.vm.syncTextFieldLabel(); h.vm.syncTextFieldLabel()
  listener({ target: { value: '完整输入。' } })
  assert.equal(h.vm.text, '完整输入。')
  assert.equal(installed, 1)
  h.component.beforeUnmount.call(h.vm)
  assert.equal(removed, 1)
})
