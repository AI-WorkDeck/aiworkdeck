// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createJavaAuthority } = require('./java-authority.cjs')
const { SQLiteCache } = require('./sqlite-cache.cjs')
const output = process.env.COMPAT_TEST_OUTPUT
if (!output || !path.isAbsolute(output)) throw new Error('Set COMPAT_TEST_OUTPUT to an isolated artifact directory')

async function fixture(t, name, editor = {}) {
  const directory = path.join(output, name)
  await fs.mkdir(directory, { recursive: true })
  const state = { identityId: 7, root: '/synthetic/managed', build: 'synthetic-build', bytes: Buffer.from('original'), posts: [], drop: false, uploads: 0 }
  const file = { id: 91, projectId: 11, uid: 'synthetic-file-uid', name: 'contract.txt', parentId: null, isFolder: false }
  const server = http.createServer(async (req, res) => {
    const body = []
    for await (const chunk of req) body.push(chunk)
    const bytes = Buffer.concat(body)
    if (req.method === 'POST') state.posts.push(req.url)
    const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)) }
    if (req.url === '/api/desktop/health') return send({ status: 'UP', build: state.build })
    if (req.url === '/api/local-identity/status') return send({ localMode: true, needsSelection: false, userId: state.identityId })
    if (req.url === '/api/storage/location') return send({ code: 0, data: { path: state.root, available: true } })
    if (req.url === '/api/projects/my') return send([{ id: 11, name: 'Synthetic old project', myRole: 'OWNER' }])
    if (req.url.startsWith('/api/projects/11/files?')) return send([file])
    if (req.url === '/api/files/91/download') {
      if (state.readFailAfterUpload && state.uploads) { res.statusCode = 404; return res.end() }
      return res.end(state.bytes)
    }
    if (req.url === '/api/files/91/upload?mustExist=1') {
      if (state.uploadError) {
        res.statusCode = state.uploadError.status
        return send(state.uploadError.body)
      }
      state.bytes = bytes; state.uploads++
      if (state.drop) return req.socket.destroy()
      return send({ code: 0 })
    }
    if (req.url.startsWith('/api/projects/11/version/timeline')) return send({ code: 0, data: { versions: [{ sha: 'real-api-sha', title: 'Original version' }] } })
    if (req.url === '/api/projects/11/version/session/end') return send({ code: 0, data: { sha: 'created-api-sha', notice: '' } })
    if (req.url === '/api/projects/11/version/revert') {
      state.bytes = Buffer.from('restored')
      if (state.drop) return req.socket.destroy()
      return send({ code: 0, data: { sha: 'revert-api-sha', affectedFileIds: [91] } })
    }
    res.statusCode = 404; send({ message: 'missing' })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const options = { baseUrl: `http://127.0.0.1:${server.address().port}`, profileId: `fixture-${name}`,
    expectedBuild: state.build, cacheDirectory: path.join(directory, 'cache'), editor }
  const adapter = createJavaAuthority(options)
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { adapter, options, state, directory }
}

test('real SQLite cache preserves original DTO IDs and is explicitly non-authoritative', async t => {
  const { adapter } = await fixture(t, 'snapshot')
  const snapshot = await adapter.snapshot()
  assert.equal(snapshot.projects[0].files[0].id, 91)
  assert.equal(snapshot.projects[0].files[0].uid, 'synthetic-file-uid')
  const cached = await adapter.cachedSnapshot()
  assert.equal(cached.authoritative, false)
  assert.equal(cached.source, 'cache')
  assert.equal(cached.generation, snapshot.generation)
  await adapter.clearCache()
  assert.equal(await adapter.cachedSnapshot(), null)
  assert.equal((await adapter.listProjects())[0].id, 11)
})

test('authority identity and storage-root changes invalidate old cache', async t => {
  const { adapter, state } = await fixture(t, 'scope')
  await adapter.snapshot()
  state.identityId = 8
  await assert.rejects(adapter.ready(), { code: 'SOURCE_CHANGED' })
  assert.equal(await adapter.cachedSnapshot(), null)
  await adapter.snapshot()
  state.root = '/synthetic/relocated'
  await assert.rejects(adapter.ready(), { code: 'SOURCE_CHANGED' })
  assert.equal(await adapter.cachedSnapshot(), null)
})

test('backend build mismatch refuses authority and stale cache', async t => {
  const { adapter, state } = await fixture(t, 'build')
  await adapter.snapshot()
  state.build = 'different'
  await assert.rejects(adapter.ready(), { code: 'BUILD_CHANGED' })
  assert.equal(await adapter.cachedSnapshot(), null)
})

test('byte read/save routes through Java mustExist and detects stale observed bytes', async t => {
  const { adapter, state } = await fixture(t, 'save')
  assert.equal((await adapter.readFile(11, 91)).bytes.toString(), 'original')
  await adapter.saveFile(11, 91, Buffer.from('saved'))
  assert.equal(state.bytes.toString(), 'saved')
  assert.equal(state.posts[0], '/api/files/91/upload?mustExist=1')
  state.bytes = Buffer.from('external')
  await assert.rejects(adapter.saveFile(11, 91, Buffer.from('stale')), { code: 'CONFLICT' })
  assert.equal(state.uploads, 1)
})

test('explicit unpublished busy upload keeps original bytes and permits a manual retry', async t => {
  const { adapter, state } = await fixture(t, 'busy-unpublished')
  await adapter.readFile(11, 91)
  state.uploadError = { status: 423, body: { code: -1, reason: 'VERSION_BUSY', writeState: 'not_started' } }
  await assert.rejects(adapter.saveFile(11, 91, Buffer.from('retry later')), { code: 'VERSION_BUSY' })
  assert.equal(state.bytes.toString(), 'original')
  assert.equal((await adapter.blockedOperations()).length, 0)
  state.uploadError = null
  await adapter.saveFile(11, 91, Buffer.from('manual retry'))
  assert.equal(state.bytes.toString(), 'manual retry')
  assert.equal(state.uploads, 1)
})

test('incomplete busy responses never claim that an upload was unpublished', async t => {
  const cases = [
    { status: 423, body: { code: -1, reason: 'VERSION_BUSY' } },
    { status: 423, body: { code: -1, reason: 'OTHER', writeState: 'not_started' } },
    { status: 423, body: { code: 0, reason: 'VERSION_BUSY', writeState: 'not_started' } },
    { status: 500, body: { code: -1, reason: 'VERSION_BUSY', writeState: 'not_started' } },
    { status: 423, body: 'not JSON metadata' },
  ]
  for (const [index, uploadError] of cases.entries()) {
    const { adapter, state } = await fixture(t, `busy-unknown-${index}`)
    await adapter.readFile(11, 91)
    state.uploadError = uploadError
    await assert.rejects(adapter.saveFile(11, 91, Buffer.from('unknown')), { code: 'OUTCOME_UNKNOWN' })
    assert.equal((await adapter.blockedOperations()).length, 1)
  }
})

test('a prior uncertain upload stays blocked even if the backend would now return unpublished busy', async t => {
  const { adapter, state } = await fixture(t, 'busy-after-unknown')
  await adapter.readFile(11, 91)
  state.drop = true
  await assert.rejects(adapter.saveFile(11, 91, Buffer.from('unknown')), { code: 'OUTCOME_UNKNOWN' })
  const posts = state.posts.length
  state.drop = false
  state.uploadError = { status: 423, body: { code: -1, reason: 'VERSION_BUSY', writeState: 'not_started' } }
  await assert.rejects(adapter.saveFile(11, 91, Buffer.from('do not retry')), { code: 'OUTCOME_UNKNOWN' })
  assert.equal(state.posts.length, posts)
  assert.equal((await adapter.blockedOperations()).length, 1)
})

test('createVersion flush can call saveFile without a recursive action deadlock', async t => {
  let adapter
  const f = await fixture(t, 'flush-reentrant', { flush: async () => { await adapter.saveFile(11, 91, Buffer.from('flushed')); return true } })
  adapter = f.adapter
  await adapter.readFile(11, 91)
  const result = await adapter.createVersion(11, { title: 'Named' })
  assert.equal(result.sha, 'created-api-sha')
  assert.deepEqual(f.state.posts, ['/api/files/91/upload?mustExist=1', '/api/projects/11/version/session/end'])
})

test('version history is the original Java timeline response', async t => {
  const { adapter } = await fixture(t, 'history')
  assert.deepEqual((await adapter.history(11, 91)).entries, [{ sha: 'real-api-sha', title: 'Original version' }])
})

test('restore requires exact close and reload ACKs and reload may read actual bytes', async t => {
  const events = []; let adapter
  const f = await fixture(t, 'restore', {
    flush: async () => { events.push('flush'); return true },
    close: async c => { events.push('close'); return { ok: true, operationId: c.operationId, closed: true } },
    reload: async c => {
      events.push('reload'); assert.deepEqual(c.affectedFileIds, [91])
      assert.equal((await adapter.readFile(11, 91)).bytes.toString(), 'restored')
      return { ok: true, operationId: c.operationId }
    }
  }); adapter = f.adapter
  const result = await adapter.restore(11, { ref: 'old-real-sha' })
  assert.equal(result.sha, 'revert-api-sha')
  assert.deepEqual(events, ['flush', 'close', 'reload'])
  assert.deepEqual(await adapter.blockedOperations(), [])
})

test('bad close ACK never sends the version restore request', async t => {
  const { adapter, state } = await fixture(t, 'bad-close', { flush: async () => true, close: async () => ({ ok: true, operationId: 'wrong', closed: true }) })
  await assert.rejects(adapter.restore(11, { ref: 'old' }), { code: 'CLOSE_REQUIRED' })
  assert.deepEqual(state.posts, [])
})

test('bad reload ACK retains write guard despite known HTTP success', async t => {
  const { adapter } = await fixture(t, 'bad-reload', { flush: async () => true,
    close: async c => ({ ok: true, operationId: c.operationId, closed: true }), reload: async () => ({ ok: true, operationId: 'wrong' }) })
  await assert.rejects(adapter.restore(11, { ref: 'old' }), { code: 'OUTCOME_UNKNOWN' })
  assert.equal((await adapter.blockedOperations()).length, 1)
  await adapter.clearCache()
  assert.equal((await adapter.blockedOperations()).length, 1)
})

test('unknown upload persists guard across adapter recreation and never retries', async t => {
  const { adapter, state, options } = await fixture(t, 'unknown')
  await adapter.readFile(11, 91); state.drop = true
  await assert.rejects(adapter.saveFile(11, 91, Buffer.from('may have saved')), { code: 'OUTCOME_UNKNOWN' })
  assert.equal(state.bytes.toString(), 'may have saved')
  await adapter.close()
  const reopened = createJavaAuthority(options)
  t.after(() => reopened.close())
  await assert.rejects(reopened.readFile(11, 91), { code: 'OUTCOME_UNKNOWN' })
  await assert.rejects(reopened.saveFile(11, 91, Buffer.from('must not retry')), { code: 'OUTCOME_UNKNOWN' })
  assert.equal(state.uploads, 1)
})

test('post-success verification failure retains the unknown write guard', async t => {
  const { adapter, state } = await fixture(t, 'verify-failure')
  await adapter.readFile(11, 91)
  state.readFailAfterUpload = true
  await assert.rejects(adapter.saveFile(11, 91, Buffer.from('written')), { code: 'OUTCOME_UNKNOWN' })
  assert.equal((await adapter.blockedOperations()).length, 1)
})

test('new uploads are blocked while restore awaits editor close', async t => {
  let entered, release
  const closeEntered = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const { adapter, state } = await fixture(t, 'restore-upload-race', { flush: async () => true,
    close: async c => { entered(); await gate; return { ok: true, operationId: c.operationId, closed: true } },
    reload: async c => ({ ok: true, operationId: c.operationId }) })
  await adapter.readFile(11, 91)
  const restore = adapter.restore(11, { ref: 'old' })
  await closeEntered
  await assert.rejects(adapter.saveFile(11, 91, Buffer.from('racing upload')), { code: 'PROJECT_BUSY' })
  await assert.rejects(adapter.close(), { code: 'PROJECT_BUSY' })
  release(); await restore
  assert.equal(state.uploads, 0)
})

test('cache directory and SQLite symlinks cannot create files outside owned root', async t => {
  const dir = path.join(output, 'unsafe-cache'); await fs.mkdir(dir, { recursive: true })
  const outside = path.join(dir, 'outside'); await fs.mkdir(outside)
  const linked = path.join(dir, 'linked'); await fs.symlink(outside, linked)
  await assert.rejects(new SQLiteCache(linked, 'safe').read(), /symlinks/)
  assert.deepEqual(await fs.readdir(outside), [])
})

test('unowned nonempty cache directory is never adopted', async t => {
  const dir = path.join(output, 'unowned'); await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'synthetic.mv.db'), 'preserve')
  await assert.rejects(new SQLiteCache(dir, 'safe').read(), /unowned/)
  assert.deepEqual(await fs.readdir(dir), ['synthetic.mv.db'])
})
