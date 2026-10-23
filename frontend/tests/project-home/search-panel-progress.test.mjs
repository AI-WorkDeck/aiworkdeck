// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/SearchPanel.vue', import.meta.url), 'utf8')
function fixture(api) {
  const body = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .*$/gm, '').replace('export default', 'return')
  const options = new Function('searchProjectContent', 'getProjectTags', 'FileTypeIcon', 'TagFilter', 'uni', body)(
    api, async () => [], {}, {}, { showToast() {} })
  const vm = { ...options.data(), projectId: 1, $t: key => key }
  for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
  return { vm, options }
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const names = { totalMatches: 0, totalFiles: 1, results: [{ fileId: 7, fileName: '锦江.txt', matchCount: 0, matches: [] }] }
const full = { totalMatches: 3, totalFiles: 2, results: [...names.results, { fileId: 8, fileName: '记录.txt', matchCount: 3, matches: [] }] }

test('filename matches arrive before the full scan finishes', async () => {
  const gate = deferred(), calls = []
  const { vm } = fixture((_id, payload) => { calls.push(payload); return payload.filenameOnly ? Promise.resolve(names) : gate.promise })
  vm.searchQuery = '锦江'
  const pending = vm.performSearch()
  await Promise.resolve()
  assert.equal(calls[0].filenameOnly, true)
  assert.equal(calls.length, 2)
  assert.deepEqual(vm.results, names)
  assert.equal(vm.loading, true)
  assert.equal(vm.searchPhase, 'content')
  gate.resolve(full)
  await pending
  assert.deepEqual(vm.results, full)
  assert.equal(vm.loading, false)
})

test('a failed full scan preserves this query’s filename matches and says it is incomplete', async () => {
  const { vm } = fixture((_id, payload) => payload.filenameOnly ? Promise.resolve(names) : Promise.reject(new Error('timeout')))
  vm.searchQuery = '锦江'
  await vm.performSearch()
  assert.deepEqual(vm.results, names)
  assert.equal(vm.searchError, 'files.searchContentFailed')
})

test('clearing the query cancels requests and clears results without starting another scan', async () => {
  const calls = []
  const { vm } = fixture((_id, payload, opts) => { calls.push(opts); return new Promise(() => {}) })
  vm.searchQuery = '锦江'
  vm.performSearch()
  vm.results = names
  vm.searchQuery = ''
  await vm.performSearch()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].signal.aborted, true)
  assert.deepEqual(vm.results.results, [])
  assert.equal(vm.hasSearched, false)
})

test('composition suppresses pinyin searches and the final Chinese value is searched once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const { vm } = fixture((_id, payload) => { calls.push(payload); return new Promise(() => {}) })
  vm.onCompositionStart()
  vm.searchQuery = 'jinjiang'
  vm.onSearchInput()
  t.mock.timers.tick(1000)
  await vm.performSearch()
  assert.equal(calls.length, 0)
  vm.onCompositionEnd({ target: { value: '锦江' } })
  vm.onSearchInput()
  t.mock.timers.tick(300)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].query, '锦江')
})

test('a superseded filename response cannot start a stale full scan', async () => {
  const old = deferred(), calls = []
  const { vm } = fixture((_id, payload) => { calls.push(payload); return payload.query === '旧' ? old.promise : Promise.resolve(names) })
  vm.searchQuery = '旧'
  const first = vm.performSearch()
  vm.searchQuery = '锦江'
  await vm.performSearch()
  old.resolve(full)
  await first
  assert.equal(calls.filter(p => p.query === '旧').length, 1)
  assert.deepEqual(vm.results, names)
})

test('stop waiting also cancels a pending input debounce and rejects late results', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = deferred(), calls = []
  const { vm } = fixture((_id, payload) => { calls.push(payload); return payload.filenameOnly ? Promise.resolve(names) : gate.promise })
  vm.searchQuery = '锦江'
  const pending = vm.performSearch()
  await Promise.resolve()
  vm.searchQuery = '下一词'
  vm.onSearchInput()
  vm.stopWaiting()
  t.mock.timers.tick(1000)
  gate.resolve(full)
  await pending
  assert.equal(calls.length, 2)
  assert.equal(vm.loading, false)
  assert.deepEqual(vm.results, names)
  assert.equal(vm.searchError, 'files.searchContentStopped')
})
