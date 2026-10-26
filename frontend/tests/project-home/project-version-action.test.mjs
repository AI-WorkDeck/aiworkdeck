// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectVersionActionRunner } from '../../src/utils/projectVersionAction.js'
import { protectProjectVersionEditors } from '../../src/utils/projectVersionEditors.js'
import { beginDocumentSave, checkpointSaveBarrier } from '../../src/utils/checkpointSaveBarrier.js'

const command = (operation = 'commit') => ({ requestId: 'req', conversationId: 'conv', params: { operationId: 'op', projectId: 7, operation } })
function fixture(overrides = {}) {
  const calls = []
  const protection = {
    reload: async () => { calls.push('reload'); return true },
    release: () => calls.push('release'), invalidate: () => calls.push('invalidate'),
  }
  const deps = {
    capture: () => () => true,
    state: async () => ({ valid: true, status: 'prepared', projectId: 7, operation: 'commit', canContinue: true }),
    unsupportedEditor: () => false, streaming: () => false,
    block: active => calls.push(active ? 'block' : 'unblock'), progress: () => {},
    save: async () => { calls.push('save'); return true },
    protect: async () => { calls.push('protect'); return protection },
    execute: async () => { calls.push('execute'); return { status: 'succeeded', result: { success: true } } },
    readStatus: async () => ({ enabled: true }), merge: async () => { calls.push('merge'); return { merged: true } },
    refresh: async () => calls.push('refresh'), openOverview: () => calls.push('overview'), wait: async () => {},
    ...overrides,
  }
  return { calls, protection, deps, runner: createProjectVersionActionRunner(deps) }
}

test('saving and reload both precede success; SSE replay cannot repeat the mutation', async () => {
  const f = fixture()
  const first = f.runner.run(command()), replay = f.runner.run(command())
  assert.equal(first, replay)
  assert.deepEqual(await first, { success: true, operationId: 'op', hostReloaded: true })
  assert.deepEqual(f.calls, ['block', 'save', 'protect', 'execute', 'reload', 'refresh', 'release', 'unblock'])
  await f.runner.run(command())
  assert.equal(f.calls.filter(c => c === 'execute').length, 1)
})

test('save failure preserves the buffer and never claims a write', async () => {
  const f = fixture({ save: async () => false })
  assert.equal((await f.runner.run(command())).code, 'saveBeforeCommitFailed')
  assert.deepEqual(f.calls, ['block', 'unblock'])
})

test('identity change while saving refuses the operation', async () => {
  let current = true
  const f = fixture({ capture: () => () => current, save: async () => { current = false; return true } })
  assert.equal((await f.runner.run(command())).code, 'aiActionExpired')
  assert.ok(!f.calls.includes('execute'))
})

test('expired operation after saving reloads the protected buffer without executing', async () => {
  let reads = 0
  const f = fixture({ state: async () => ++reads === 1
    ? { valid: true, status: 'prepared', projectId: 7, operation: 'commit' }
    : { valid: false, status: 'cancelled' } })
  assert.equal((await f.runner.run(command())).code, 'aiActionExpired')
  assert.ok(!f.calls.includes('execute'))
  assert.ok(f.calls.includes('reload'))
  assert.ok(f.calls.includes('release'))
})

test('lost HTTP receipt reconciles state without a second execute', async () => {
  let executions = 0, reads = 0
  const f = fixture({
    state: async () => ++reads <= 2 ? { valid: true, status: 'prepared', projectId: 7, operation: 'commit' }
      : { status: 'succeeded', result: { success: true } },
    execute: async () => { executions++; throw Error('connection lost') },
  })
  assert.equal((await f.runner.run(command())).success, true)
  assert.equal(executions, 1)
})

test('unknown execution keeps the stale editor fenced and does not claim success', async () => {
  let reads = 0
  const f = fixture({
    state: async () => ++reads <= 2 ? { valid: true, status: 'prepared', projectId: 7, operation: 'commit' }
      : { status: 'executing' },
    execute: async () => ({ status: 'executing' }),
  })
  assert.equal((await f.runner.run(command())).code, 'aiActionUnknown')
  assert.ok(f.calls.includes('invalidate'))
  assert.ok(!f.calls.includes('release'))
  assert.ok(!f.calls.includes('reload'))
})

const conflict = { sessionId: 1, mainlineTip: 'main', sessionTip: 'work', conflictingPaths: ['合同.docx'] }
for (const receipt of [{status: 'cancelled'}, {status: 'failed', result: {success: false, error: 'prior conflict'}}]) {
  test(`${receipt.status} action cannot start an unrelated existing merge`, async () => {
    const f = fixture({ execute: async () => receipt, readStatus: async () => ({ enabled: true, sessionEndConflict: conflict }) })
    const r = await f.runner.run(command())
    assert.equal(r.success, false)
    assert.equal(r.hostReloaded, true)
    assert.ok(!f.calls.includes('merge'))
  })
}

test('same conflict automatically merges only while the operation is still live', async () => {
  for (const live of [true, false]) {
    let merged = false
    const f = fixture({
      state: async () => ({ valid: true, status: 'prepared', projectId: 7, operation: 'commit', canContinue: live }),
      execute: async () => ({ status: 'failed', result: { success: false, conflict } }),
      readStatus: async () => ({ enabled: true, ...(merged ? {} : { sessionEndConflict: conflict }) }),
      merge: async () => { merged = true; return { merged: true } },
    })
    const r = await f.runner.run(command())
    assert.equal(merged, live)
    assert.equal(r.success, live)
    if (live) assert.equal(r.autoMerged, true)
  }
})

test('reload failure leaves the stale editor disabled even though the backend succeeded', async () => {
  const f = fixture()
  f.protection.reload = async () => false
  assert.equal((await f.runner.run(command())).code, 'aiReloadFailed')
  assert.ok(f.calls.includes('invalidate'))
  assert.ok(!f.calls.includes('release'))
})

test('unreadable post-operation status cannot masquerade as an empty clean project', async () => {
  const f = fixture({ readStatus: async () => ({}) })
  assert.equal((await f.runner.run(command())).success, false)
  assert.ok(f.calls.includes('invalidate'))
  assert.ok(!f.calls.includes('release'))
})

test('an existing project merge blocks a new operation', async () => {
  const f = fixture({ busy: () => true })
  assert.equal((await f.runner.run(command())).success, false)
  assert.ok(!f.calls.includes('execute'))
})

for (const [guard, code] of [['unsupportedEditor', 'aiDrawioSaveFirst'], ['streaming', 'aiStreamBusy']]) {
  test(`${guard} blocks before saving or executing`, async () => {
    const f = fixture({ [guard]: () => true })
    assert.equal((await f.runner.run(command())).code, code)
    assert.deepEqual(f.calls, [])
  })
}

function editor(id, calls) {
  return { file: { id }, prepareCheckpointRestore: async () => { calls.push(`prepare:${id}`); return true },
    reloadFromBackend: async () => { calls.push(`reload:${id}`); return true },
    failCheckpointRestore: () => calls.push(`invalid:${id}`) }
}

test('all panes and unregistered in-flight uploads stay fenced until durable reload', async () => {
  const calls = [], instances = [editor(1, calls), editor(2, calls)]
  const save = beginDocumentSave('version-protect', 3)
  let ready = false
  const pending = protectProjectVersionEditors({projectId: 'version-protect', operationId: 'op', fileIds: [1,2,3],
    instances, current: () => true, registered: () => true, readWriteState: async () => ({mayWrite:false})}).then(p => {ready=true;return p})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ready, false)
  assert.equal(beginDocumentSave('version-protect', 1), null)
  save.finish(true)
  const p = await pending
  assert.equal(await p.reload(), true)
  assert.equal(await p.reload(), true)
  assert.deepEqual(calls, ['prepare:1','prepare:2','reload:1','reload:2'])
  p.release()
  for (const id of [1,2,3]) assert.equal(checkpointSaveBarrier('version-protect',id),null)
})

test('unmounted editor cannot be acknowledged as reloaded and its old buffer is invalidated', async () => {
  const calls = [], inst = editor(1,calls)
  let registered = true
  const p = await protectProjectVersionEditors({projectId:'version-unmounted',operationId:'op',fileIds:[1],instances:[inst],
    current:()=>true, registered:()=>registered,readWriteState:async()=>({mayWrite:false})})
  registered = false
  assert.equal(await p.reload(),false)
  assert.deepEqual(calls,['prepare:1','invalid:1'])
  assert.ok(checkpointSaveBarrier('version-unmounted',1))
  p.release()
})

test('uncertain earlier upload prevents starting a version overwrite', async () => {
  const save = beginDocumentSave('version-uncertain', 1)
  save.finish(false)
  await assert.rejects(protectProjectVersionEditors({projectId:'version-uncertain',operationId:'op',fileIds:[1],instances:[],
    current:()=>true,registered:()=>true,readWriteState:async()=>({mayWrite:false})}),/aiEditorNotReady/)
  assert.equal(checkpointSaveBarrier('version-uncertain',1),null)
})
