// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSfc } from './sfcLoader.mjs'

const component = await loadSfc('components/media/MediaPlayer.vue')

function player(t, { sourceUrl = '', fileType = 'QTA' } = {}) {
  const requests = []
  const old = { window: globalThis.window, document: globalThis.document, XMLHttpRequest: globalThis.XMLHttpRequest }
  class Audio {
    addEventListener() {}
    removeEventListener() {}
    removeAttribute(name) { delete this[name] }
    pause() {}
    load() {}
  }
  globalThis.window = { Audio }
  globalThis.document = {}
  globalThis.XMLHttpRequest = class {
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader() {}
    getResponseHeader() { return this.contentType || 'audio/mpeg' }
    send() { requests.push(this) }
    abort() { this.aborted = true }
  }
  t.after(() => Object.assign(globalThis, old))
  const vm = {
    file: { id: 5, name: 'recording.qta', fileType }, sourceUrl, kind: 'audio',
    _off: [], _mediaReqId: 0, _destroyed: false, volume: 1, muted: false, rate: 1,
    $t: key => key, $emit() {},
  }
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  return { vm, requests }
}

test('QTA loads converted MP3 before setting media src, and disposes its blob', async t => {
  const { vm, requests } = player(t)
  t.mock.method(URL, 'createObjectURL', blob => {
    assert.equal(blob.type, 'audio/mpeg')
    return 'blob:converted'
  })
  const revoked = []
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url))
  vm.failureMessage = 'previous failure'
  vm.failed = true
  vm.setupMedia()
  assert.equal(vm.failureMessage, '')
  assert.equal(vm.failed, false)
  assert.equal(vm._media.src, undefined, 'must not feed the QTA container to the browser')
  assert.equal(vm._fellBack, true, 'failure must not fall back to downloading the raw QTA')
  assert.equal(requests.length, 1)
  const xhr = requests[0]
  assert.equal(xhr.url, '/api/files/5/audio-preview')
  assert.equal(xhr.timeout, 300000)
  xhr.status = 200
  xhr.response = new Blob(['converted mp3'], { type: 'audio/mpeg' })
  await xhr.onload()
  assert.equal(vm._media.src, 'blob:converted')
  vm.teardownMedia()
  assert.deepEqual(revoked, ['blob:converted'])
})

test('QTA rejected by converter shows its actionable message, never starts playback', async t => {
  const { vm, requests } = player(t)
  vm.setupMedia()
  const xhr = requests[0]
  xhr.status = 422
  xhr.contentType = 'text/plain;charset=UTF-8'
  xhr.response = new Blob(['Please export each recording layer as M4A.'])
  await xhr.onload()
  assert.equal(vm.failureMessage, 'Please export each recording layer as M4A.')
  assert.equal(vm.failed, true)
  assert.equal(vm._media.src, undefined)
})

test('QTA pending conversion is aborted and late success cannot change the next file', async t => {
  const { vm, requests } = player(t)
  vm.setupMedia()
  const xhr = requests[0]
  vm.teardownMedia()
  assert.equal(xhr.aborted, true)
  vm._media = { src: 'next-file' }
  xhr.status = 200
  xhr.response = new Blob(['late'])
  await xhr.onload()
  assert.equal(vm._media.src, 'next-file')
})

test('QTA late error text and timeout cannot overwrite another file', async t => {
  const { vm, requests } = player(t)
  vm.setupMedia()
  const xhr = requests[0]
  let resolve
  xhr.status = 422
  xhr.contentType = 'text/plain'
  xhr.response = { text: () => new Promise(done => { resolve = done }) }
  const pending = xhr.onload()
  vm.teardownMedia()
  vm.failureMessage = 'next-file-error'
  resolve('old QTA error')
  await pending
  xhr.ontimeout()
  assert.equal(vm.failureMessage, 'next-file-error')
})

test('QTA conversion timeout produces persistent guidance', t => {
  const { vm, requests } = player(t)
  vm.setupMedia()
  requests[0].ontimeout()
  assert.equal(vm.failed, true)
  assert.equal(vm.failureMessage, 'files.player.previewTimeout')
})

test('QTA inside an archive asks for extraction without requesting a synthetic file id', t => {
  const { vm, requests } = player(t, { sourceUrl: 'blob:archive-entry' })
  vm.setupMedia()
  assert.equal(requests.length, 0)
  assert.equal(vm.failureMessage, 'files.player.qtaExtractFirst')
  assert.equal(vm._media.src, undefined)
})

test('ordinary audio retains direct streaming', t => {
  const { vm, requests } = player(t, { fileType: 'm4a' })
  vm.setupMedia()
  assert.equal(requests.length, 0)
  assert.equal(vm._media.src, '/api/files/5/download?token=sid')
})
