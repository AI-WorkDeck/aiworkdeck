// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { contentSha256, localContentUrl, downloadLocalContent, createLocalContentSave, saveLocalContent, cancelLocalContent, localContentCapability, observeLocalContentBackend } from '../../src/utils/localContentProtocol.js'
import { beginDocumentSave, beginCheckpointSaveBarrier, endCheckpointSaveBarrier, resolveDocumentSaveOperation } from '../../src/utils/checkpointSaveBarrier.js'

const url = 'http://127.0.0.1:8765/api/local-core/projects/1/files/2/content'
const response = (status, bytes, headers = {}) => ({ status, bytes, header: key => headers[key] ?? null })
const json = (status, body, headers = { 'X-AWD-Content-Protocol': '1' }) => response(status, new TextEncoder().encode(JSON.stringify(body)), headers)
const metadata = { url, uid: 'stable-file-uid', actorId: '7', sha256: 'a'.repeat(64), size: 3 }
const receipt = pending => json(200, { code: 0, data: { operationId: pending.operationId, uid: pending.metadata.uid,
  actorId: Number(pending.metadata.actorId), sha256: pending.sha256, size: pending.bytes.length } })

test('protocol stays on the same local backend and does not carry a query token', () => {
  assert.equal(localContentUrl('http://127.0.0.1:8765/api/files/2/download?token=local', 1, 2), url)
  for (const original of ['https://cloud.example/api/files/2/download', 'http://example.org/api/files/2/download',
    'http://localhost:8765/api/files/3/download', '/api/files/2/download']) assert.equal(localContentUrl(original, 1, 2), null)
})

test('download binds metadata to exact bytes and never downgrades a failed supported protocol', async () => {
  const bytes = new TextEncoder().encode('中文正文').buffer
  const headers = { 'X-AWD-Content-Protocol': '1', 'X-AWD-File-Uid': metadata.uid, 'X-AWD-Actor-Id': '7',
    'X-AWD-SHA256': await contentSha256(bytes), 'Content-Length': String(bytes.byteLength) }
  const downloaded = await downloadLocalContent({ url, send: async () => response(200, bytes, headers) })
  assert.deepEqual(downloaded.bytes, bytes); assert.equal(downloaded.metadata.sha256, headers['X-AWD-SHA256'])
  await assert.rejects(downloadLocalContent({ url, send: async () => response(404, new ArrayBuffer(0)) }), /HTTP 404/)
  await assert.rejects(downloadLocalContent({ url, send: async () => json(404, { reason: 'FILE_NOT_FOUND' }) }), /FILE_NOT_FOUND/)
  await assert.rejects(downloadLocalContent({ url, send: async () => response(200, new Uint8Array([9]).buffer, headers) }), /SNAPSHOT_INVALID/)
})

test('lost successful response is resolved by its receipt without another PUT or newer exported bytes', async () => {
  const source = new Uint8Array([1, 2, 3]), pending = await createLocalContentSave(metadata, source, 10)
  source[0] = 99
  const sent = []
  const send = async request => {
    sent.push(request)
    assert.equal(request.headers['X-AWD-Operation-Id'], pending.operationId)
    assert.equal(request.headers['X-AWD-Expected-SHA256'], metadata.sha256)
    if (request.method === 'PUT') { assert.deepEqual([...request.bytes], [1, 2, 3]); throw Error('lost response') }
    assert.equal(request.url, url + '/receipts/' + pending.operationId)
    return receipt(pending)
  }
  await assert.rejects(saveLocalContent(pending, { send }), /lost response/)
  assert.equal(pending.attempted, true)
  assert.equal((await saveLocalContent(pending, { send })).sha256, pending.sha256)
  assert.equal(sent.filter(item => item.method === 'PUT').length, 1)
})

test('missing receipt retries exactly the same operation and bytes; wrong receipt cannot resolve it', async () => {
  const pending = await createLocalContentSave(metadata, new Uint8Array([4, 5, 6]))
  pending.attempted = true
  const calls = []
  const send = async request => {
    calls.push(request)
    return request.method === 'PUT' ? receipt(pending) : json(404, { reason: 'RECEIPT_NOT_FOUND', writeState: 'unknown' })
  }
  await saveLocalContent(pending, { send })
  assert.equal(calls.length, 2); assert.equal(calls[1].bytes, pending.bytes)
  assert.equal(calls[0].headers['X-AWD-Operation-Id'], calls[1].headers['X-AWD-Operation-Id'])
  await assert.rejects(saveLocalContent(pending, { send: async () => json(200, { code: 0, data: {
    operationId: pending.operationId, uid: metadata.uid, actorId: 8, sha256: pending.sha256, size: 3,
  } }) }), /RECEIPT_INVALID/)
  await assert.rejects(saveLocalContent(pending, { send: async () => json(423, { reason: 'VERSION_BUSY', writeState: 'unknown' }) }),
    failure => failure.reason === 'VERSION_BUSY' && failure.saveNotPublished !== true)
})

test('one verified operation cannot clear another unknown upload or a legacy unknown upload', async () => {
  const project = 'local-content-receipt', file = 1
  const first = beginDocumentSave(project, file), second = beginDocumentSave(project, file)
  first.setOperationId('operation-a'); second.setOperationId('operation-b'); first.finish(false); second.finish(false)
  resolveDocumentSaveOperation(project, file, 'operation-a')
  const oneLeft = beginCheckpointSaveBarrier(project, file, 'one-left')
  assert.equal(await oneLeft.drained, false); endCheckpointSaveBarrier(project, file, 'one-left')
  resolveDocumentSaveOperation(project, file, 'operation-b')
  const cleared = beginCheckpointSaveBarrier(project, file, 'cleared')
  assert.equal(await cleared.drained, true); endCheckpointSaveBarrier(project, file, 'cleared')
  const legacy = beginDocumentSave(project, file); legacy.finish(false)
  resolveDocumentSaveOperation(project, file, 'operation-a')
  const unknown = beginCheckpointSaveBarrier(project, file, 'legacy')
  assert.equal(await unknown.drained, false); endCheckpointSaveBarrier(project, file, 'legacy')
})


test('capability uses one health probe, skips old core content routes, and invalidates after recovery starts', async () => {
  const origin = 'http://localhost:8766/api/local-core/projects/1/files/2/content'
  let calls = 0, advertised = 0
  const send = async request => {
    assert.equal(request.url, 'http://localhost:8766/api/desktop/startup-health')
    calls++
    return json(200, { status: 'UP', phase: 'core', coreContentProtocol: advertised })
  }
  assert.deepEqual(await Promise.all([localContentCapability(origin, { send }), localContentCapability(origin, { send })]), [false, false])
  assert.equal(calls, 1)
  advertised = 1
  observeLocalContentBackend({ state: 'restarting', updatedAt: 101 })
  assert.equal(await localContentCapability(origin, { send }), true)
  assert.equal(calls, 2)
  observeLocalContentBackend({ state: 'restarting', updatedAt: 101 })
  assert.equal(await localContentCapability(origin, { send }), true)
  assert.equal(calls, 2)
})

test('in-flight old capability cannot install itself after an unhealthy event; transient failures do not downgrade', async () => {
  const origin = 'http://localhost:8767/api/local-core/projects/1/files/2/content'
  let resolve, calls = 0
  const first = new Promise(r => { resolve = r })
  const send = async () => ++calls === 1 ? first : json(200, { status: 'UP', phase: 'full', coreContentProtocol: 1 })
  const pending = localContentCapability(origin, { send })
  observeLocalContentBackend({ state: 'failed', updatedAt: 102 })
  resolve(json(200, { status: 'UP', phase: 'core' }))
  assert.equal(await pending, true)
  assert.equal(calls, 2)
  const other = 'http://localhost:8768/api/local-core/projects/1/files/2/content'
  await assert.rejects(localContentCapability(other, { send: async () => json(503, { reason: 'DOWN' }) }), /DOWN/)
  assert.equal(await localContentCapability(other, { send: async () => json(404, {}) }), false)
})

test('DELETE cancellation uses exact request identity and never replays PUT; completed response is also valid', async () => {
  const pending = await createLocalContentSave(metadata, new Uint8Array([4, 5, 6]))
  pending.attempted = true
  const cancelled = json(200, { code: 0, data: { state: 'cancelled', operationId: pending.operationId, uid: metadata.uid, actorId: 7 } })
  const result = await cancelLocalContent(pending, { send: async request => {
    assert.equal(request.method, 'DELETE')
    assert.equal(request.url, url + '/receipts/' + pending.operationId)
    assert.equal(request.headers['X-AWD-Expected-SHA256'], metadata.sha256)
    assert.equal(request.headers['X-AWD-Content-Length'], '3')
    assert.equal(request.headers['X-AWD-Actor-Id'], '7')
    assert.equal(request.bytes, undefined)
    return cancelled
  } })
  assert.equal(result.state, 'cancelled')
  await assert.rejects(saveLocalContent(pending, { send: async () => assert.fail('cancelled operation must never be sent again') }),
    e => e.operationFinished === true && e.requiresReload === true && e.saveNotPublished !== true)
  const completed = await createLocalContentSave(metadata, new Uint8Array([1]))
  assert.equal((await cancelLocalContent(completed, { send: async () => receipt(completed) })).sha256, completed.sha256)
})

test('cancelled GET receipt requires exact identity and is terminal, without clearing uncertainty on malformed replies', async () => {
  const pending = await createLocalContentSave(metadata, new Uint8Array([1]))
  pending.attempted = true
  const cancellation = actorId => json(200, { code: 0, data: { state: 'cancelled', operationId: pending.operationId, uid: metadata.uid, actorId } })
  await assert.rejects(cancelLocalContent(pending, { send: async () => cancellation(8) }), /CONTENT_RECEIPT_INVALID/)
  assert.equal(pending.cancelled, undefined)
  let requests = 0
  await assert.rejects(saveLocalContent(pending, { send: async request => {
    requests++; assert.equal(request.method, undefined); return cancellation(7)
  } }), e => e.operationFinished === true && e.operationId === pending.operationId)
  assert.equal(requests, 1)
  assert.equal(pending.cancelled, true)
})


test('an unrelated protocol 404 on receipt lookup cannot authorize another PUT', async () => {
  const pending = await createLocalContentSave(metadata, new Uint8Array([1]))
  pending.attempted = true
  let calls = 0
  await assert.rejects(saveLocalContent(pending, { send: async request => {
    calls++; assert.equal(request.method, undefined)
    return json(404, { code: -1, reason: 'FILE_NOT_FOUND' })
  } }), /FILE_NOT_FOUND/)
  assert.equal(calls, 1)
})
