// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVersionExitGuard } from '../../src/utils/versionExitGuard.js'

const status = (overrides = {}) => ({ enabled: true, working: true, changedCount: 2, onDraft: null, ...overrides })
const clean = () => status({ working: false, changedCount: 0 })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function setup(overrides = {}) {
  const calls = [], blocked = []
  let reads = 0
  const deps = {
    save: async () => { calls.push('save'); return true },
    readStatus: async () => { calls.push('status'); return ++reads < 3 ? status() : clean() },
    choose: async value => { calls.push(['choose', value]); return 'commit' },
    commit: async value => { calls.push(['commit', value]); return { sha: 'saved-version' } },
    onBlocked: reason => { blocked.push(reason) },
    isCurrent: () => true,
    ...overrides,
  }
  return { ...createVersionExitGuard(deps), calls, blocked }
}

test('save precedes the prompt; commit re-saves and reads latest status before and after submission', async () => {
  const h = setup()
  assert.equal(await h.confirm(), true)
  assert.deepEqual(h.calls, ['save', 'status', ['choose', status()], 'save', 'status', ['commit', status()], 'status'])
  assert.deepEqual(h.blocked, [])
})

test('commit progress follows actual save, commit and verification boundaries and then becomes idle', async () => {
  const h = setup({ progress: stage => { h.calls.push(['progress', stage]) } })
  assert.equal(await h.confirm(), true)
  assert.deepEqual(h.calls, [
    'save', 'status', ['choose', status()], ['progress', 'saving'], 'save', 'status',
    ['progress', 'committing'], ['commit', status()], ['progress', 'checking'], 'status', ['progress', 'idle'],
  ])
})

test('skip and cancel do not start or clear progress', async () => {
  for (const choice of ['skip', 'cancel']) {
    const stages = []
    const h = setup({ choose: async () => choice, progress: stage => stages.push(stage) })
    assert.equal(await h.confirm(), choice === 'skip')
    assert.deepEqual(stages, [])
  }
})

test('failed saving and conflicting commits always clear only the progress that actually began', async () => {
  for (const failAt of ['saving', 'committing', 'checking']) {
    const stages = []
    let saves = 0, reads = 0
    const h = setup({
      save: async () => !(++saves === 2 && failAt === 'saving'),
      readStatus: async () => ++reads === 3 ? status({ cloudConflict: { paths: ['test.docx'] } }) : status(),
      commit: async () => failAt === 'committing' ? { conflict: true } : { sha: 'done' },
      progress: stage => stages.push(stage),
    })
    assert.equal(await h.confirm(), false)
    assert.deepEqual(stages, ['saving', ...(failAt !== 'saving' ? ['committing'] : []), ...(failAt === 'checking' ? ['checking'] : []), 'idle'])
  }
})

test('a slow submission keeps its real stage and concurrent confirmation never restarts progress', async () => {
  const commit = deferred(), entered = deferred(), stages = []
  const h = setup({ commit: () => { entered.resolve(); return commit.promise }, progress: stage => stages.push(stage) })
  const first = h.confirm()
  await entered.promise
  assert.equal(h.confirm(), first)
  assert.deepEqual(stages, ['saving', 'committing'])
  commit.resolve({ sha: 'done' })
  assert.equal(await first, true)
  assert.deepEqual(stages, ['saving', 'committing', 'checking', 'idle'])
})

test('progress callback failures cannot skip saving, commit verification or cleanup', async () => {
  for (const asyncCallback of [false, true]) {
    const stages = []
    const h = setup({ progress: stage => {
      stages.push(stage)
      if (asyncCallback) return Promise.reject(new Error('UI unavailable'))
      throw new Error('UI unavailable')
    } })
    assert.equal(await h.confirm(), true)
    assert.deepEqual(stages, ['saving', 'committing', 'checking', 'idle'])
    assert.equal(h.calls.filter(call => call === 'save').length, 2)
    assert.equal(h.calls.filter(call => call === 'status').length, 3)
  }
})

test('destruction during commit still clears its own progress without reading or exiting', async () => {
  let current = true
  const stages = []
  const h = setup({
    isCurrent: () => current,
    commit: async () => { current = false; return { sha: 'done' } },
    progress: stage => stages.push(stage),
  })
  assert.equal(await h.confirm(), false)
  assert.deepEqual(stages, ['saving', 'committing', 'idle'])
  assert.equal(h.calls.filter(call => call === 'status').length, 2)
})

for (const state of [{ enabled: false }, clean(), status({ working: false, changedCount: 0, onDraft: { id: 4 } })]) {
  test(`no prompt for a saved project without pending work: ${JSON.stringify(state)}`, async () => {
    const h = setup({ readStatus: async () => state })
    assert.equal(await h.confirm(), true)
    assert.deepEqual(h.calls, ['save'])
    assert.deepEqual(h.blocked, [])
  })
}

test('an open work session still prompts after its files have been automatically captured', async () => {
  const state = status({ changedCount: 0 })
  const h = setup({ readStatus: async () => state, choose: async value => { h.calls.push(['choose', value]); return 'cancel' } })
  assert.equal(await h.confirm(), false)
  assert.deepEqual(h.calls, ['save', ['choose', state]])
  assert.deepEqual(h.blocked, [])
})

for (const [choice, result] of [['skip', true], ['cancel', false], ['unknown', false]]) {
  test(`${choice} never submits a version or reports a cancelled prompt as an error`, async () => {
    const h = setup({ choose: async () => choice })
    assert.equal(await h.confirm(), result)
    assert.deepEqual(h.calls, ['save', 'status'])
    assert.deepEqual(h.blocked, [])
  })
}

test('a pending draft may commit without a work session; the draft remaining selected is not new work', async () => {
  const draft = { id: 9, name: 'Alternate draft' }
  let reads = 0
  const h = setup({ readStatus: async () => status({ working: false, changedCount: ++reads < 3 ? 1 : 0, onDraft: draft }) })
  assert.equal(await h.confirm(), true)
  assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === 'commit'), ['commit', status({ working: false, changedCount: 1, onDraft: draft })])
  assert.deepEqual(h.blocked, [])
})

for (const onDraft of [{ id: 9, name: 'Alternate draft' }, null]) {
  test(`an active mainline work session after commit ${onDraft ? 'does not block a clean draft' : 'still blocks mainline exit'}`, async () => {
    let reads = 0
    const h = setup({ readStatus: async () => status({ working: true, changedCount: ++reads < 3 ? 1 : 0, onDraft }) })
    assert.equal(await h.confirm(), !!onDraft)
    assert.equal(reads, 3)
    assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === 'commit'), ['commit', status({ working: true, changedCount: 1, onDraft })])
    assert.deepEqual(h.blocked, onDraft ? [] : ['new-changes'])
  })
}

test('a clean selected draft does not prompt about the independent mainline work session', async () => {
  const h = setup({ readStatus: async () => status({ working: true, changedCount: 0, onDraft: { id: 9 } }) })
  assert.equal(await h.confirm(), true)
  assert.deepEqual(h.calls, ['save'])
  assert.deepEqual(h.blocked, [])
})

test('pending files without a change signal use the backend fallback and still verify the result', async () => {
  let reads = 0
  const pending = status({ working: false })
  const h = setup({ readStatus: async () => ++reads < 3 ? pending : clean() })
  assert.equal(await h.confirm(), true)
  assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === 'commit'), ['commit', pending])
  assert.equal(reads, 3)
  assert.deepEqual(h.blocked, [])
})

for (const conflict of ['adoptConflict', 'sessionEndConflict', 'cloudConflict']) {
  test(`latest ${conflict} prevents committing after confirmation`, async () => {
    let reads = 0
    const h = setup({ readStatus: async () => ++reads === 1 ? status() : status({ [conflict]: { id: 1 } }) })
    assert.equal(await h.confirm(), false)
    assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'commit'), false)
    assert.deepEqual(h.blocked, ['conflict'])
  })
}

test('work already completed while the prompt was open requires no duplicate commit', async () => {
  let reads = 0
  const h = setup({ readStatus: async () => ++reads === 1 ? status() : clean() })
  assert.equal(await h.confirm(), true)
  assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'commit'), false)
})

test('a conflict returned by commit keeps the project open', async () => {
  const h = setup({ commit: async () => ({ conflict: { paths: ['test.docx'] } }) })
  assert.equal(await h.confirm(), false)
  assert.deepEqual(h.blocked, ['conflict'])
  assert.equal(h.calls.filter(call => call === 'status').length, 2)
})

for (const final of [status({ changedCount: 0 }), status({ working: false, changedCount: 1 })]) {
  test(`new work found after commit prevents exit: ${JSON.stringify(final)}`, async () => {
    const h = setup({ readStatus: async () => final })
    assert.equal(await h.confirm(), false)
    assert.deepEqual(h.blocked, ['new-changes'])
    assert.equal(h.calls.filter(call => Array.isArray(call) && call[0] === 'commit').length, 1)
  })
}

for (const [operation, reason] of [['save', 'save-failed'], ['readStatus', 'status-failed'], ['choose', 'choice-failed'], ['commit', 'commit-failed']]) {
  test(`${operation} failure is reported with a bounded reason, never the original error`, async () => {
    const h = setup({ [operation]: async () => { throw new Error('PRIVATE raw error and credentials') } })
    assert.equal(await h.confirm(), false)
    assert.deepEqual(h.blocked, [reason])
  })
}

for (const result of [false, undefined]) {
  test(`save must explicitly confirm success (${result})`, async () => {
    const h = setup({ save: async () => result })
    assert.equal(await h.confirm(), false)
    assert.deepEqual(h.blocked, ['save-failed'])
    assert.deepEqual(h.calls, [])
  })
}

test('a second save failure does not submit the version', async () => {
  let saves = 0
  const h = setup({ save: async () => ++saves === 1 })
  assert.equal(await h.confirm(), false)
  assert.deepEqual(h.blocked, ['save-failed'])
  assert.equal(h.calls.filter(call => call === 'status').length, 1)
})

test('an unavailable status is not treated as an unchanged project', async () => {
  for (const value of [null, undefined, {}, { enabled: true }, status({ changedCount: NaN }), status({ changedCount: -1 })]) {
    const h = setup({ readStatus: async () => value })
    assert.equal(await h.confirm(), false)
    assert.deepEqual(h.blocked, ['status-failed'])
  }
})

test('even failure to display the blocking notification cannot permit exit or leak an exception', async () => {
  const h = setup({ save: async () => false, onBlocked: async () => { throw new Error('notification failed') } })
  assert.equal(await h.confirm(), false)
})

test('a destroyed guard does not start saving or checking status', async () => {
  const h = setup({ isCurrent: () => false })
  assert.equal(await h.confirm(), false)
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.blocked, [])
})

test('a long save is awaited without a deadline and concurrent closes share one request', async () => {
  const save = deferred(), entered = deferred()
  let saves = 0
  const h = setup({ save: () => { saves++; entered.resolve(); return save.promise }, choose: async () => 'skip' })
  const first = h.confirm(), second = h.confirm()
  assert.equal(first, second)
  await entered.promise
  assert.equal(saves, 1)
  assert.deepEqual(h.calls, [], 'no status request or prompt before durable save')
  save.resolve(true)
  assert.equal(await first, true)
  assert.deepEqual(h.calls, ['status'])
  assert.equal(await h.confirm(), true, 'a later close can make a fresh request')
  assert.equal(saves, 2)
})

test('concurrent confirmation while choosing does not open a second prompt', async () => {
  const choice = deferred(), entered = deferred()
  let prompts = 0
  const h = setup({ choose: () => { prompts++; entered.resolve(); return choice.promise } })
  const first = h.confirm()
  await entered.promise
  assert.equal(h.confirm(), first)
  assert.equal(prompts, 1)
  choice.resolve('cancel')
  assert.equal(await first, false)
  assert.deepEqual(h.blocked, [])
})

for (const operation of ['save', 'readStatus', 'choose', 'commit']) {
  test(`project switch or destruction while awaiting ${operation} aborts silently`, async () => {
    let current = true
    const value = { save: true, readStatus: status(), choose: 'commit', commit: { sha: 'done' } }[operation]
    const h = setup({ isCurrent: () => current, [operation]: async () => { current = false; return value } })
    assert.equal(await h.confirm(), false)
    assert.deepEqual(h.blocked, [])
    assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'commit'), false)
  })
}
