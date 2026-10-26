// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRenderer, h, nextTick, ref } from 'vue'
import * as locator from '../../src/utils/evidenceLocator.js'
import * as zoom from '../../src/utils/imageWheelZoom.js'

const source = readFileSync(new URL('../../src/components/FilePreview.vue', import.meta.url), 'utf8')
const renderer = createRenderer({
  createElement: type => ({ type, children: [] }),
  createText: text => ({ text }),
  createComment: text => ({ text }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
  remove: node => { node.parent.children.splice(node.parent.children.indexOf(node), 1) },
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text },
  patchProp() {},
  parentNode: node => node.parent,
  nextSibling: () => null,
})

async function fixture(initial = { id: 1, fileType: 'pdf', wpsFileId: 'a' }, initialLocator = null) {
  const requests = [], created = [], revoked = [], emitted = []
  class Xhr {
    open(method, url) { this.url = url }
    setRequestHeader() {}
    send() { requests.push(this) }
    abort() { this.aborted = true }
    complete(text) {
      this.status = 200
      this.response = new Blob([text], { type: 'application/pdf' })
      this.onload()
    }
  }
  const values = {
    getFileBytesUrl: id => '/synthetic/' + id + '/download',
    getAuthHeaders: () => ({}), host: {}, MediaPlayer: {}, ArchiveEntriesPane: {},
    previewKindOf: () => '', shouldGrabMediaFocus: () => false,
    ...locator, ...zoom,
    console: { log() {}, warn() {}, error() {} }, XMLHttpRequest: Xhr,
    URL: {
      createObjectURL: blob => { created.push(blob); return 'blob:test-' + created.length },
      revokeObjectURL: url => revoked.push(url),
    },
    window: { addEventListener() {}, removeEventListener() {} },
    uni: { showToast() {} },
  }
  let script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  script = script.replace(/\/\/ #ifndef H5[\s\S]*?\/\/ #endif/g, '')
  const names = [...script.matchAll(/^import ([\s\S]*?) from ['"][^'"]+['"]\s*$/gm)]
    .flatMap(m => m[1].replace(/[{}]/g, '').split(',').map(name => name.trim()).filter(Boolean))
  script = script.replace(/^import [\s\S]*? from ['"][^'"]+['"]\s*$/gm, '').replace('export default', 'return')
  const bindings = [...new Set([...names, 'console', 'XMLHttpRequest', 'URL', 'window', 'uni'])]
  const options = new Function(...bindings, script)(...bindings.map(name => values[name]))
  options.render = () => h('div')
  const file = ref(initial), pendingLocator = ref(initialLocator)
  let vm
  const app = renderer.createApp({ render: () => h(options, {
    file: file.value, locator: pendingLocator.value, ref: value => { if (value) vm = value },
    onLocatorConsumed: id => emitted.push(id),
  }) })
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = () => {}
  app.mount({ children: [] })
  await nextTick()
  return { file, pendingLocator, vm, requests, created, revoked, emitted, stop: () => app.unmount() }
}

test('switching PDF identity and content version starts only one replacement download', async () => {
  const f = await fixture()
  try {
    assert.equal(f.requests.length, 1)
    f.file.value = { id: 2, fileType: 'pdf', wpsFileId: 'b' }
    await nextTick()
    assert.deepEqual(f.requests.map(r => r.url), ['/synthetic/1/download', '/synthetic/2/download'])
    assert.equal(f.requests[0].aborted, true)
  } finally { f.stop() }
})

test('same-file in-place version update reloads once; different file with the same version also reloads', async () => {
  const f = await fixture()
  try {
    f.file.value.wpsFileId = 'updated'
    await nextTick()
    assert.equal(f.requests.length, 2)
    f.file.value = { id: 2, fileType: 'pdf', wpsFileId: 'updated' }
    await nextTick()
    assert.equal(f.requests.length, 3)
    assert.equal(f.requests[2].url, '/synthetic/2/download')
    f.file.value.wpsFileId = ''
    await nextTick()
    assert.equal(f.requests.length, 3, 'empty version still does not signal a content refresh')
  } finally { f.stop() }
})

test('Word and PPT read-only previews also render once when identity and version change together', async () => {
  const f = await fixture()
  try {
    const rendered = []
    f.vm.renderDocx = () => rendered.push('docx')
    f.vm.renderPptx = () => rendered.push('pptx')
    f.file.value = { id: 2, fileType: 'docx', wpsFileId: 'b' }
    await nextTick()
    f.file.value = { id: 3, fileType: 'pptx', wpsFileId: 'c' }
    await nextTick()
    assert.deepEqual(rendered, ['docx', 'pptx'])
  } finally { f.stop() }
})

test('same-tick file and locator change preserves the requested PDF page', async () => {
  const f = await fixture()
  try {
    f.file.value = { id: 2, fileType: 'pdf', wpsFileId: 'b' }
    f.pendingLocator.value = { type: 'pdf', page: 3, quote: 'synthetic quote' }
    await nextTick()
    assert.equal(f.vm.pdfLocate?.page, 3)
    assert.equal(f.vm.pdfLocateVisible, true)
    await nextTick() // applyLocator emits its consumption receipt on the next tick.
    assert.deepEqual(f.emitted, [2])
    f.pendingLocator.value = null
    await nextTick()
    assert.equal(f.vm.pdfLocate?.page, 3, 'consuming locator does not jump back to page one')
  } finally { f.stop() }
})

test('late PDF responses cannot replace the selected file; clear and unmount abort active reads', async () => {
  const f = await fixture()
  try {
    const old = f.requests[0]
    f.file.value = { id: 2, fileType: 'pdf', wpsFileId: 'b' }
    await nextTick()
    const current = f.requests.at(-1)
    current.complete('new')
    const currentUrl = f.vm.blobUrl
    old.complete('old')
    assert.equal(f.vm.blobUrl, currentUrl)
    assert.equal(f.created.length, 1)
    f.file.value = null
    await nextTick()
    assert.equal(f.vm.blobUrl, '')
    assert.equal(current.aborted, true)
    assert.deepEqual(f.revoked, [currentUrl])
    f.file.value = { id: 3, fileType: 'pdf', wpsFileId: 'c' }
    await nextTick()
    const last = f.requests.at(-1)
    f.stop()
    assert.equal(last.aborted, true)
    last.complete('late after unmount')
    assert.equal(f.created.length, 1)
  } finally { f.stop() }
})
