// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createProcessChannel } = require('../main/native/process-channel')
async function channel(source, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'awd-channel-'))
  const failures = [], events = []
  const rpc = createProcessChannel({ command: process.execPath, args: ['-e', source], cwd: root, env: process.env,
    log: path.join(root, 'stderr'), framed: false, timeoutMs: 2000, onFailure: error => failures.push(error),
    onEvent: event => events.push(event), ...options })
  return { rpc, failures, events, async close() { await rpc.stop(); await fs.rm(root, { recursive: true, force: true }) } }
}
test('JSON channel preserves Chinese split across child stdout chunks', async () => {
  const h = await channel(`process.stdin.on('data', data => {const q=JSON.parse(data); const b=Buffer.from(JSON.stringify({id:q.id,result:{text:'中文'}})+'\\n'); const split=b.indexOf(Buffer.from('中'))+1;process.stdout.write(b.subarray(0,split));setTimeout(()=>process.stdout.write(b.subarray(split)),10)});`)
  try { assert.deepEqual(await h.rpc.call('read'), { text: '中文' }) } finally { await h.close() }
})
test('operation timeout locks the channel; subsequent calls cannot write or retry', async () => {
  const h = await channel(`process.stdin.resume()`, { timeoutMs: 100 })
  try {
    await assert.rejects(h.rpc.call('edit'), { code: 'OUTCOME_UNKNOWN' })
    await assert.rejects(h.rpc.call('edit'), { code: 'OUTCOME_UNKNOWN' })
    assert.equal(h.failures.length, 1)
  } finally { await h.close() }
})
test('framed process without ready has a bounded startup and is reaped', async () => {
  const h = await channel(`process.stdin.resume()`, { framed: true, timeoutMs: 100 })
  try { await assert.rejects(h.rpc.ready, /startup timed out/) } finally { await h.close() }
  assert.notEqual(h.rpc.process.exitCode ?? h.rpc.process.signalCode, null)
})
test('ordinary action errors do not report engine success or kill independent reads', async () => {
  const h = await channel(`process.stdin.on('data',data=>{const q=JSON.parse(data);process.stdout.write(JSON.stringify(q.method==='bad'?{id:q.id,error:'rejected'}:{id:q.id,result:{ok:true}})+'\\n')})`)
  try {
    await assert.rejects(h.rpc.call('bad'), /rejected/)
    assert.deepEqual(await h.rpc.call('read'), { ok: true }); assert.equal(h.failures.length, 0)
  } finally { await h.close() }
})
