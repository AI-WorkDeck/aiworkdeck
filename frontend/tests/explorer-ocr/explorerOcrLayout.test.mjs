// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Explorer OCR phase 2 (tutorial-series#155): layout Word / searchable PDF statuses and the
// local-first route (local failure asks before anything is uploaded).
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOcrBatch, summarizeOcrBatch } from '../../src/utils/explorerOcr.js'

const f = (id, name) => ({ id, name, fileType: name.split('.').pop() })

function fakeServer(script) {
  const calls = []
  const recognize = async (item, opts) => {
    calls.push({ id: item.id, ...opts })
    const r = script(item, opts, calls.length)
    if (r instanceof Error) throw r
    return r
  }
  return { calls, recognize }
}

test('a PDF that already has a text layer is reported, not counted as a failure', async () => {
  const server = fakeServer(() => ({ status: 'already_searchable' }))
  const batch = await runOcrBatch({ items: [f(1, 'digital.pdf')], recognize: server.recognize })
  const summary = summarizeOcrBatch(batch)
  assert.equal(summary.failed.length, 0)
  assert.deepEqual(summary.alreadySearchable.map(r => r.item.name), ['digital.pdf'])
})

test('local failure asks once; agreeing retries this and later local failures in the cloud', async () => {
  const server = fakeServer((item, opts) => opts.route === 'cloud'
    ? { status: 'done', file: { name: `${item.id}.docx` } }
    : { status: 'local_failed', notice: '本地识别未返回内容', version: 'v3' })
  const asked = []
  const batch = await runOcrBatch({
    items: [f(1, 'a.png'), f(2, 'b.png')],
    recognize: server.recognize,
    requestCloudFallback: async info => { asked.push(info); return true },
  })
  assert.equal(asked.length, 1, 'asked once per batch')
  assert.equal(asked[0].reason, '本地识别未返回内容')
  assert.equal(asked[0].version, 'v3')
  const retries = server.calls.filter(c => c.route === 'cloud')
  assert.equal(retries.length, 2)
  assert.ok(retries.every(c => c.consentVersion === 'v3'), 'the fallback dialog is the upload consent')
  assert.equal(summarizeOcrBatch(batch).done.length, 2)
})

test('declining the cloud fallback fails those files with the local reason and never retries', async () => {
  const server = fakeServer(() => ({ status: 'local_failed', notice: '本机识别服务未启动', version: 'v3' }))
  let asked = 0
  const batch = await runOcrBatch({
    items: [f(1, 'a.png'), f(2, 'b.png')],
    recognize: server.recognize,
    requestCloudFallback: async () => { asked++; return false },
  })
  assert.equal(asked, 1)
  assert.equal(server.calls.filter(c => c.route === 'cloud').length, 0)
  const failed = summarizeOcrBatch(batch).failed
  assert.deepEqual(failed.map(r => r.error), ['本机识别服务未启动', '本机识别服务未启动'])
})

test('without a fallback handler a local failure is just a failure (no silent upload)', async () => {
  const server = fakeServer(() => ({ status: 'local_failed', notice: 'x', version: 'v3' }))
  const batch = await runOcrBatch({ items: [f(1, 'a.png')], recognize: server.recognize })
  assert.equal(server.calls.length, 1)
  assert.equal(summarizeOcrBatch(batch).failed.length, 1)
})

test('cloud layout unsupported stops the batch so later files are not billed for nothing', async () => {
  const server = fakeServer(() => ({ status: 'layout_unsupported', notice: '服务端暂不支持保留版式' }))
  const batch = await runOcrBatch({ items: [f(1, 'a.png'), f(2, 'b.png'), f(3, 'c.png')], recognize: server.recognize })
  assert.equal(server.calls.length, 1)
  const summary = summarizeOcrBatch(batch)
  assert.deepEqual(summary.failed.map(r => r.error), ['服务端暂不支持保留版式'])
  assert.equal(summary.notRun.length, 2)
  assert.equal(batch.cancelled, false, 'stopped, not cancelled by the user')
  assert.equal(batch.stopped, '服务端暂不支持保留版式')
})

test('an outdated local component fails that file with the update hint', async () => {
  const server = fakeServer(() => ({ status: 'component_outdated', notice: '请更新组件' }))
  const batch = await runOcrBatch({ items: [f(1, 'a.pdf')], recognize: server.recognize })
  assert.deepEqual(summarizeOcrBatch(batch).failed.map(r => r.error), ['请更新组件'])
})
