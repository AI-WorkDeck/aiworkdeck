// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTtsReader } from '../../src/utils/ttsReader.js'
import { splitTtsText } from '../../src/utils/ttsText.js'
import { mergePcmWavs, readPcmWav } from '../../src/utils/ttsWav.js'

function wav(samples = [1, -2], sampleRate = 24000) {
  const result = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(result)
  for (const [offset, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) {
    [...value].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)))
  }
  v.setUint32(4, result.byteLength - 8, true); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  v.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => v.setInt16(44 + i * 2, sample, true))
  return result
}
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness({ rejectedPlayback = false, pendingPlayback = false } = {}) {
  const requests = [], audios = [], changes = [], errors = [], revoked = [], created = [], playPromises = []
  const reader = createTtsReader({
    generate: (payload, options) => new Promise((resolve, reject) => requests.push({ payload, options, resolve, reject })),
    onChange: state => changes.push(state),
    onError: (error, phase) => errors.push({ error, phase }),
    urls: { createObjectURL: blob => { created.push(blob); return 'blob:' + created.length }, revokeObjectURL: url => revoked.push(url) },
    createAudio: url => {
      const audio = { url, plays: 0, pauses: 0, loads: 0, paused: true, ended: false,
        play() {
          this.plays++
          this.paused = rejectedPlayback
          this.ended = false
          if (pendingPlayback) return new Promise((resolve, reject) => playPromises.push({ resolve, reject }))
          return rejectedPlayback ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve()
        },
        pause() { this.pauses++; this.paused = true }, load() { this.loads++ }, removeAttribute() {},
        playing() { this.onplaying?.() }, end() { this.paused = true; this.ended = true; this.onended?.() }
      }
      audios.push(audio)
      return audio
    }
  })
  return { reader, requests, audios, changes, errors, revoked, created, playPromises }
}

test('segmentation preserves punctuation, decimals, quotes and every Unicode character', () => {
  const text = '  第一段：“价格为3.14元。”\n\n第二段！第三段?' + '测😀试'.repeat(100) + '结束\n  '
  const segments = splitTtsText(text)
  assert.equal(segments.join(''), text)
  assert.ok(segments.every(part => part.trim() && Array.from(part.trim()).length <= 120))
  assert.ok(Array.from(segments[0].trim()).length <= 36)
  assert.ok(segments.some(part => part.includes('3.14')))
  assert.ok(segments.some(part => part.includes('元。”')))
  assert.deepEqual(splitTtsText(' \n \t'), [])
  assert.deepEqual(splitTtsText(''), [])
  for (const digitsAt of [34, 35]) {
    assert.ok(splitTtsText('甲'.repeat(digitsAt) + '1.23元。').some(part => part.includes('1.23')))
  }
})

test('leading whitespace and consecutive newlines never create blank synthesis requests', async () => {
  const text = (' \n'.repeat(150)) + '第一句。\n\n第二句。\n\n'
  const parts = splitTtsText(text)
  assert.equal(parts.join(''), text)
  assert.ok(parts.every(part => part.trim().length > 0))
  const h = harness()
  const done = h.reader.start({ text, voice: 'zf_xiaoxiao' })
  for (let index = 0; index < parts.length; index++) {
    assert.ok(h.requests[index].payload.text.trim())
    assert.ok(h.requests[index].payload.text.length <= 120)
    h.requests[index].resolve(wav()); await tick()
  }
  await done
  h.reader.destroy()
})

test('punctuation-only runs stay in readable segments and never become synthesis requests', async () => {
  for (const text of ['你好！！下一句。', '第一句。。。第二句。', '……\n——\n第一句。\n……\n第二句。', '“مرحبا!”\nПривет!\n123.45元。']) {
    const parts = splitTtsText(text)
    assert.equal(parts.join(''), text)
    assert.ok(parts.every(part => /[\p{L}\p{N}]/u.test(part)))
    const h = harness()
    const done = h.reader.start({ text, voice: 'test' })
    for (let i = 0; i < parts.length; i++) {
      assert.match(h.requests[i].payload.text, /[\p{L}\p{N}]/u)
      h.requests[i].resolve(wav()); await tick()
    }
    await done
    h.reader.destroy()
  }
  assert.deepEqual(splitTtsText('……\n！！！。。。——'), [])
  const h = harness()
  await h.reader.start({ text: '……\n！！！。。。——', voice: 'test' })
  assert.equal(h.requests.length, 0)
})

test('first audio plays while the final request is pending; captions follow playing events', async () => {
  const h = harness()
  const done = h.reader.start({ text: '第一句。第二句。第三句。', voice: 'zf_xiaoxiao' })
  assert.equal(h.reader.getState().generating, true)
  h.requests[0].resolve(wav([1, 2])); await tick()
  assert.equal(h.audios.length, 1, 'first segment must create audio before final request resolves')
  assert.equal(h.audios[0].plays, 1)
  assert.equal(h.requests.length, 2)
  assert.equal(h.reader.getState().exportBuffer, null)
  assert.equal(h.reader.getState().currentIndex, -1, 'request completion must not guess playback position')
  h.audios[0].playing()
  assert.equal(h.reader.getState().currentIndex, 0)
  h.requests[1].resolve(wav([3, 4])); await tick()
  assert.equal(h.requests.length, 3)
  h.audios[0].end()
  assert.equal(h.reader.getState().currentIndex, -1)
  h.audios[1].playing()
  assert.equal(h.reader.getState().currentIndex, 1)
  h.requests[2].resolve(wav([5, 6])); await done
  assert.equal(h.reader.getState().generating, false)
  const merged = readPcmWav(h.reader.getState().exportBuffer)
  assert.deepEqual([...new Int16Array(merged.data[0].buffer, merged.data[0].byteOffset, 6)], [1, 2, 3, 4, 5, 6])
  h.audios[1].end(); h.audios[2].playing(); h.audios[2].end()
  assert.equal(h.reader.getState().status, 'complete')
  assert.equal(h.reader.getState().currentIndex, -1)
  h.reader.resume()
  assert.equal(h.audios.length, 4, 'replay uses the existing first segment')
  assert.equal(h.requests.length, 3)
  h.reader.destroy()
  assert.equal(h.created.length, h.revoked.length)
})

test('pause during synthesis prevents the next segment from starting until resume', async () => {
  const h = harness()
  const done = h.reader.start({ text: '一句。二句。', voice: 'test' })
  h.requests[0].resolve(wav()); await tick()
  h.audios[0].playing(); h.reader.pause(); h.audios[0].end()
  h.requests[1].resolve(wav()); await done
  assert.equal(h.audios.length, 1)
  assert.equal(h.reader.getState().status, 'paused')
  h.reader.resume()
  assert.equal(h.audios.length, 2)
  h.audios[1].playing()
  assert.equal(h.reader.getState().currentIndex, 1)
  h.reader.destroy()
})

test('pause before first response stays paused, while speed changes apply immediately and to following segments', async () => {
  const h = harness()
  const done = h.reader.start({ text: '一句。二句。', voice: 'test', playbackRate: 1.5 })
  h.reader.pause(); h.requests[0].resolve(wav()); await tick()
  assert.equal(h.audios.length, 0)
  h.reader.resume(); h.audios[0].playing()
  assert.equal(h.audios[0].playbackRate, 1.5)
  h.reader.setRate(2)
  assert.equal(h.audios[0].playbackRate, 2)
  assert.ok(h.requests.every(request => request.payload.rate === '1'))
  h.requests[1].resolve(wav()); await done
  h.audios[0].end()
  assert.equal(h.audios[1].playbackRate, 2)
  assert.equal(h.requests.length, 2)
  h.reader.destroy()
})

test('stop aborts the request and late responses cannot create audio or overwrite a restarted session', async () => {
  const h = harness()
  const old = h.reader.start({ text: '旧句。', voice: 'test' })
  h.reader.stop()
  assert.equal(h.requests[0].options.signal.aborted, true)
  const fresh = h.reader.start({ text: '新句。', voice: 'test' })
  h.requests[0].resolve(wav()); await old
  assert.equal(h.audios.length, 0)
  assert.deepEqual(h.reader.getState().segments, ['新句。'])
  h.requests[1].resolve(wav()); await fresh
  assert.equal(h.audios.length, 1)
  const oldPlaying = h.audios[0].onplaying
  const oldEnded = h.audios[0].onended
  h.reader.stop(); oldPlaying(); oldEnded()
  assert.equal(h.reader.getState().status, 'idle')
  assert.equal(h.reader.getState().currentIndex, -1)
})

test('destroy aborts synthesis and rejects all late playback events and promise results', async () => {
  const h = harness()
  const done = h.reader.start({ text: '一句。二句。', voice: 'test' })
  h.requests[0].resolve(wav()); await tick()
  const stalePlaying = h.audios[0].onplaying
  h.reader.destroy()
  assert.equal(h.requests[1].options.signal.aborted, true)
  const count = h.changes.length
  stalePlaying(); h.requests[1].resolve(wav()); await done
  assert.equal(h.changes.length, count)
  assert.equal(h.audios.length, 1)
  assert.equal(h.audios[0].pauses, 1)
  assert.equal(h.revoked.length, 1)
})

test('autoplay rejection leaves a recoverable pause; generation failure ends busy state and clears audio', async () => {
  const h = harness({ rejectedPlayback: true })
  const done = h.reader.start({ text: '一句。二句。', voice: 'test' })
  h.requests[0].resolve(wav()); await tick()
  assert.equal(h.reader.getState().status, 'paused')
  assert.equal(h.errors[0].phase, 'playback')
  h.requests[1].resolve(wav()); await done
  assert.equal(h.reader.getState().generating, false)
  assert.ok(h.reader.getState().exportBuffer)
  h.audios[0].play = function () { this.plays++; this.paused = false; return Promise.resolve() }
  h.reader.resume(); h.audios[0].playing()
  assert.equal(h.reader.getState().status, 'playing')
  h.reader.destroy()

  const f = harness()
  const failed = f.reader.start({ text: '一句。二句。', voice: 'test' })
  f.requests[0].resolve(wav()); await tick(); f.audios[0].playing()
  f.requests[1].reject(new Error('engine failed')); await failed
  assert.equal(f.reader.getState().generating, false)
  assert.equal(f.reader.getState().status, 'error')
  assert.equal(f.reader.getState().currentIndex, -1)
  assert.equal(f.reader.getState().exportBuffer, null)
  assert.equal(f.revoked.length, 1)
  assert.equal(f.errors[0].phase, 'generation')
})

test('pause invalidates pending play rejection, and an old rejection cannot interrupt a resumed attempt', async () => {
  const h = harness({ pendingPlayback: true })
  const done = h.reader.start({ text: '一句。', voice: 'test' })
  h.requests[0].resolve(wav()); await done
  h.reader.pause()
  h.playPromises[0].reject(new Error('AbortError')); await tick()
  assert.equal(h.errors.length, 0, 'a deliberate pause is not a playback failure')
  assert.equal(h.reader.getState().status, 'paused')
  h.reader.resume()
  h.reader.pause()
  h.reader.resume()
  h.audios[0].playing()
  h.playPromises[1].reject(new Error('AbortError')); await tick()
  assert.equal(h.reader.getState().status, 'playing', 'the previous play attempt must not pause the new one')
  assert.equal(h.errors.length, 0)
  h.playPromises[2].reject(new Error('NotAllowedError')); await tick()
  assert.equal(h.reader.getState().status, 'paused')
  assert.equal(h.errors.length, 1, 'a failure of the current attempt must still be reported')
  h.reader.destroy()
})

test('a queued pause event cannot undo a newer resume when the audio is already unpaused', async () => {
  const h = harness()
  const done = h.reader.start({ text: '一句。二句。', voice: 'test' })
  h.requests[0].resolve(wav()); await tick()
  const audio = h.audios[0]
  audio.playing()
  h.reader.pause()
  assert.equal(audio.paused, true)
  h.reader.resume()
  assert.equal(audio.paused, false)
  audio.onpause() // The old pause event is delivered after resume() called play().
  audio.playing()
  assert.equal(h.reader.getState().status, 'playing', 'the stale pause event must not cancel the resumed playback')
  assert.equal(audio.paused, false)
  h.requests[1].resolve(wav()); await done
  audio.end()
  assert.equal(h.audios.length, 2, 'the resumed reader must advance to the next segment')
  assert.equal(h.errors.length, 0)
  h.reader.destroy()
})

test('a real audio pause stops automatic advancement, and stale audio errors cannot stop its replacement', async () => {
  const h = harness()
  const done = h.reader.start({ text: '一句。二句。', voice: 'test' })
  h.requests[0].resolve(wav()); await tick()
  h.audios[0].playing()
  const staleError = h.audios[0].onerror
  h.audios[0].pause(); h.audios[0].onpause()
  assert.equal(h.reader.getState().status, 'paused')
  h.requests[1].resolve(wav()); await done
  h.audios[0].end()
  assert.equal(h.audios.length, 1)
  h.reader.resume(); h.audios[1].playing()
  staleError()
  assert.equal(h.reader.getState().status, 'playing')
  assert.equal(h.errors.length, 0)
  h.reader.destroy()
})

test('empty text or missing voice never starts work, and one segment can finish and replay', async () => {
  const h = harness()
  await h.reader.start({ text: ' ', voice: 'test' })
  await h.reader.start({ text: '正文', voice: '' })
  assert.equal(h.requests.length, 0)
  const done = h.reader.start({ text: '一句。', voice: 'test' })
  h.requests[0].resolve(wav()); await done
  h.audios[0].playing(); h.audios[0].end()
  assert.equal(h.reader.getState().status, 'complete')
  h.reader.resume()
  assert.equal(h.audios.length, 2)
  h.reader.destroy()
})

test('WAV export combines sample frames under one valid header and rejects truncation or format mismatch', () => {
  const merged = mergePcmWavs([wav([123, -321]), wav([25])])
  assert.equal(merged.byteLength, 50)
  const view = new DataView(merged)
  assert.equal(view.getUint32(4, true), 42)
  assert.equal(view.getUint32(40, true), 6)
  assert.deepEqual([...new Int16Array(merged, 44)], [123, -321, 25])
  assert.throws(() => mergePcmWavs([wav().slice(0, -1)]), /Truncated/)
  assert.throws(() => mergePcmWavs([wav(), wav([3], 44100)]), /formats differ/)
  assert.throws(() => mergePcmWavs([new ArrayBuffer(60)]), /Expected WAV/)
  const invalid = wav(); new DataView(invalid).setUint32(40, 100, true)
  assert.throws(() => readPcmWav(invalid), /Truncated/)
  const partial = wav(); new DataView(partial).setUint32(40, 3, true)
  assert.throws(() => readPcmWav(partial), /samples/)
})
