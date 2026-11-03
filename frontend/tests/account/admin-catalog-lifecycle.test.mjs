// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRenderer } from 'vue'
import { createI18n } from 'vue-i18n'

const source = readFileSync(new URL('../../src/components/admin/AdminPane.vue', import.meta.url), 'utf8')
const methodStart = source.indexOf('    async loadModelCatalog() {')
const method = source.slice(methodStart, source.indexOf('\n    },', methodStart) + '\n    }'.length)
const hookStart = source.indexOf('  beforeUnmount() {')
const hook = source.slice(hookStart, source.indexOf('\n  methods: {', hookStart))

function mountCatalog(t) {
  const requests = []
  const fetchAiModels = options => new Promise((resolve, reject) => requests.push({ options, resolve, reject }))
  const methods = new Function('fetchAiModels', `return ({ ${method} })`)(fetchAiModels)
  const lifecycle = new Function(`return ({ ${hook} })`)()
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({
    ...lifecycle, methods, render: () => null,
    data: () => ({ modelCatalog: { models: [{ id: 'saved-model' }] }, modelCatalogError: 'previous-state' }),
  })
  app.use(createI18n({ legacy: true, locale: 'en-US', messages: {
    'en-US': { admin: { catalogLoadFailedWithMsg: 'Catalog failed: {msg}', catalogLoadFailedRetry: 'Retry catalog' } },
  } }))
  const vm = app.mount({})
  let unmounted = false
  const unmount = () => { if (!unmounted) { app.unmount(); unmounted = true } }
  t.after(unmount)
  return { vm, requests, unmount }
}

for (const outcome of ['success', 'failure']) {
  test(`unmounted settings ignore a late catalog ${outcome} after real i18n cleanup`, async t => {
    const { vm, requests, unmount } = mountCatalog(t)
    const previousCatalog = vm.modelCatalog
    const pending = vm.loadModelCatalog()
    assert.deepEqual(requests[0].options, { accountPrompt: false })
    assert.equal(typeof vm.$t, 'function')
    unmount()
    assert.equal(vm.$t, undefined, 'The real vue-i18n unmount hook removes the translator')
    if (outcome === 'success') requests[0].resolve({ models: [{ id: 'late-model' }] })
    else requests[0].reject(new Error('Synthetic disconnected account'))
    await assert.doesNotReject(pending)
    assert.equal(vm.modelCatalog, previousCatalog, 'Late completion cannot mutate a discarded settings pane')
    assert.equal(vm.modelCatalogError, 'previous-state')
    await vm.loadModelCatalog()
    assert.equal(requests.length, 1, 'Discarded panes do not start another request')
  })
}

test('mounted settings retain translated failure and recover with a later catalog', async t => {
  const { vm, requests } = mountCatalog(t)
  const pending = vm.loadModelCatalog()
  requests[0].reject(new Error('Synthetic disconnected account'))
  await pending
  assert.equal(vm.modelCatalog, null)
  assert.equal(vm.modelCatalogError, 'Catalog failed: Synthetic disconnected account')
  const refreshed = vm.loadModelCatalog()
  const catalog = { models: [{ id: 'current-model' }] }
  requests[1].resolve(catalog)
  await refreshed
  assert.deepEqual(vm.modelCatalog, catalog)
  assert.equal(vm.modelCatalogError, '')
})
