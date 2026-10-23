// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginBusinessServices } from '../../src/utils/pluginBusinessServices.js'
import { pluginViews, isGlobalPlugin } from '../../src/utils/pluginViews.js'

function fixture(overrides = {}) {
  const calls = []
  const options = { api: {
    getProjectTags: async id => { calls.push(['tags', id]); return [] },
    searchProjectContent: async (...args) => { calls.push(args); return { results: [] } },
  }, projectId: () => 12, permissions: () => ['file_read'], isCurrent: () => true,
  listFiles: async () => [{ id: 1, path: 'one.md' }], openFile: file => calls.push(['open', file]), ...overrides }
  return { services: createPluginBusinessServices(options), calls }
}
test('search scopes to mounted project and forwards only documented input', async () => {
  const { services, calls } = fixture()
  await services.request('search', 'query', { projectId: 99, query: 'case', url: '/api/admin', tagIds: [1, 'bad'], fileTypes: ['exe'] })
  assert.equal(calls[0][0], 12)
  assert.deepEqual(calls[0][1], { query: 'case', filenameOnly: false, caseSensitive: false, wholeWord: false, useRegex: false, tagIds: [1] })
  await assert.rejects(services.request('http', 'get', {}), { code: 'unknown_service' })
  await assert.rejects(services.request('search', 'delete', {}), { code: 'unknown_operation' })
})
test('filename-only searches preserve the host project and cannot expand permissions', async () => {
  const { services, calls } = fixture()
  await services.request('search', 'query', { projectId: 99, query: '锦江', filenameOnly: true })
  assert.equal(calls[0][0], 12)
  assert.equal(calls[0][1].filenameOnly, true)
  await services.request('search', 'query', { query: '锦江', filenameOnly: 'true' })
  assert.equal(calls[1][1].filenameOnly, false)
})
test('permission and no-project checks happen before any data access', async () => {
  for (const override of [{ permissions: () => [] }, { projectId: () => null }]) {
    const { services, calls } = fixture(override)
    await assert.rejects(services.request('search', 'tags', {}))
    assert.deepEqual(calls, [])
  }
})
test('cancel and dispose abort HTTP work and reject late results', async () => {
  let resolve, signal
  const { services } = fixture({ api: { searchProjectContent: (_id, _params, options) => {
    signal = options.signal
    return new Promise(done => { resolve = done })
  } } })
  const result = services.request('search', 'query', { query: 'case', requestId: 'a' })
  services.cancel('a')
  assert.equal(signal.aborted, true)
  resolve({ results: ['late'] })
  await assert.rejects(result, { code: 'cancelled' })
  const result2 = services.request('search', 'query', { query: 'case', requestId: 'b' })
  services.dispose()
  assert.equal(signal.aborted, true)
  resolve({ results: ['late'] })
  await assert.rejects(result2, { code: 'cancelled' })
})
test('account generation change rejects results and prevents file-open side effects', async () => {
  const { services, calls } = fixture({ isCurrent: () => false })
  await assert.rejects(services.request('search', 'tags'), { code: 'cancelled' })
  await assert.rejects(services.request('search', 'open', { fileId: 1 }), { code: 'cancelled' })
  assert.equal(calls.some(c => c[0] === 'open'), false)
})
test('open revalidates membership instead of trusting plugin paths', async () => {
  const { services, calls } = fixture()
  await assert.rejects(services.request('search', 'open', { fileId: 2, path: '/private' }), { code: 'not_found' })
  await services.request('search', 'open', { fileId: 1 })
  assert.deepEqual(calls, [['open', { id: 1, path: 'one.md' }]])
})
test('view contributions reject escaped entries, unknown placement, duplicate ids', () => {
  const valid = { id: 'main', name: 'Search', entry: 'web/index.html', placement: 'sidebar', scope: 'project' }
  const views = pluginViews({ id: 'search', contributes: { views: [valid, valid,
    { ...valid, id: 'bad', entry: 'web/../host.html' }, { ...valid, id: 'url', entry: 'https://outside' },
    { ...valid, id: 'unknown', placement: 'host' }, { ...valid, id: 'global', scope: 'global' },
  ] } }, (id, entry) => id + '/' + entry)
  assert.deepEqual(views.map(v => v.id), ['main', 'global'])
  assert.equal(views[0].url, 'search/web/index.html')
  assert.equal(isGlobalPlugin({ views }), true)
})

test('the packaged search bridge includes tagged media and archives, with or without a keyword', async () => {
  const files = ['photo.png', 'voice.mp3', 'recording.mp4', 'archive.zip'].map((fileName, i) => ({
    fileId: i + 1, fileName, fileType: fileName.split('.').pop(), tags: [{ id: 7 }]
  }))
  const { services } = fixture({ api: { searchProjectContent: async (_projectId, params) => {
    const results = files.filter(file => (!params.fileTypes || params.fileTypes.includes(file.fileType))
      && file.fileName.includes(params.query)
      && params.tagIds.every(id => file.tags.some(tag => tag.id === id)))
    return { totalMatches: 0, totalFiles: results.length, results }
  } } })
  const tagged = await services.request('search', 'query', { query: '', tagIds: [7] })
  assert.deepEqual(tagged.results.map(file => file.fileName), files.map(file => file.fileName))
  const keyword = await services.request('search', 'query', { query: 'photo', tagIds: [7] })
  assert.deepEqual(keyword.results.map(file => file.fileName), ['photo.png'])
})
