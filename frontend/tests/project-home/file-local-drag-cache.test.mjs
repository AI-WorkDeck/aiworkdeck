// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearLocalPathCache, cacheLocalFilePath, getCachedLocalFilePath,
  prefetchLocalFilePath, resolveLocalFilePathSync, startExternalFileDrag,
} from '../../src/utils/fileLocalDrag.js'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test.beforeEach(() => clearLocalPathCache())
test.afterEach(() => clearLocalPathCache())

for (const [scope, clear] of [['single', () => clearLocalPathCache(1)], ['all', () => clearLocalPathCache()]]) {
  test(`${scope} cache invalidation prevents an old prefetch from restoring its path`, async () => {
    const request = deferred()
    const old = prefetchLocalFilePath(1, () => request.promise)
    await Promise.resolve()
    clear()
    request.resolve({ path: '/old/file.txt', exists: true })
    assert.equal(await old, '')
    assert.equal(getCachedLocalFilePath(1), '')
  })
}

test('late old response cannot replace a fresh synchronous path', async () => {
  const request = deferred()
  const old = prefetchLocalFilePath(1, () => request.promise)
  clearLocalPathCache(1)
  class XHR {
    open() {}
    send() { this.status = 200; this.responseText = JSON.stringify({ path: '/moved/file.txt' }) }
  }
  assert.equal(resolveLocalFilePathSync(1, { XMLHttpRequest: XHR }), '/moved/file.txt')
  request.resolve({ path: '/old/file.txt' })
  assert.equal(await old, '')
  assert.equal(getCachedLocalFilePath(1), '/moved/file.txt')
})

test('synchronous cache write supersedes an outstanding prefetch without an explicit clear', async () => {
  const request = deferred()
  const old = prefetchLocalFilePath(1, () => request.promise)
  cacheLocalFilePath(1, '/moved/file.txt')
  request.resolve({ path: '/old/file.txt' })
  assert.equal(await old, '')
  assert.equal(getCachedLocalFilePath(1), '/moved/file.txt')
})

test('invalidated request settling keeps newer prefetch shared until it completes', async () => {
  const first = deferred(), second = deferred()
  const old = prefetchLocalFilePath(1, () => first.promise)
  clearLocalPathCache(1)
  let fetches = 0
  const fetch = () => { fetches += 1; return second.promise }
  const current = prefetchLocalFilePath(1, fetch)
  first.resolve({ path: '/old/file.txt' })
  await old
  assert.equal(getCachedLocalFilePath(1), '')
  assert.equal(prefetchLocalFilePath('1', fetch), current)
  assert.equal(fetches, 1)
  second.resolve({ data: { path: '/moved/file.txt', exists: true } })
  assert.equal(await current, '/moved/file.txt')
  assert.equal(getCachedLocalFilePath(1), '/moved/file.txt')
})

test('an old prefetch arriving after a newer prefetch cannot replace its path', async () => {
  const first = deferred()
  const old = prefetchLocalFilePath(1, () => first.promise)
  await Promise.resolve()
  clearLocalPathCache(1)
  const current = prefetchLocalFilePath(1, () => ({ path: '/moved/file.txt' }))
  assert.equal(await current, '/moved/file.txt')
  first.resolve({ path: '/old/file.txt' })
  assert.equal(await old, '')
  assert.equal(getCachedLocalFilePath(1), '/moved/file.txt')
})

test('missing native path invalidates the selected cached paths so the next drag resolves again', async () => {
  cacheLocalFilePath(1, '/old/one.txt')
  cacheLocalFilePath(2, '/old/two.txt')
  cacheLocalFilePath(3, '/unrelated.txt')
  const items = [{ id: 1 }, { id: 2 }]
  const failed = await startExternalFileDrag(items, {
    fs: { startDrag: () => Promise.resolve({ ok: false, reason: 'not-found' }) },
  })
  assert.equal(failed.ok, false)
  assert.equal(getCachedLocalFilePath(1), '')
  assert.equal(getCachedLocalFilePath(2), '')
  assert.equal(getCachedLocalFilePath(3), '/unrelated.txt')
  class XHR {
    open(_method, url) { this.id = url.match(/files\/(\d+)\//)[1] }
    send() { this.status = 200; this.responseText = JSON.stringify({ path: `/moved/${this.id}.txt` }) }
  }
  let actualPaths
  const retried = startExternalFileDrag(items, {
    XMLHttpRequest: XHR,
    fs: { startDrag: paths => { actualPaths = paths; return { ok: true } } },
  })
  assert.equal(retried.ok, true)
  assert.deepEqual(actualPaths, ['/moved/1.txt', '/moved/2.txt'])
})

test('late missing-path failure preserves an updated cache', async () => {
  cacheLocalFilePath(1, '/old/file.txt')
  const request = deferred()
  const drag = startExternalFileDrag({ id: 1 }, { fs: { startDrag: () => request.promise } })
  cacheLocalFilePath(1, '/moved/file.txt')
  request.resolve({ ok: false, reason: 'not-found' })
  await drag
  assert.equal(getCachedLocalFilePath(1), '/moved/file.txt')
})
