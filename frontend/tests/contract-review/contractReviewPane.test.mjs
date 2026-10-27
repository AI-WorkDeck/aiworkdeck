// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'

const standard = () => ({ id: 3, name: 'Buyer', position: 'Buyer', jurisdiction: 'China', version: 2, confirmedVersion: 2,
  rules: [{ id: 'rule-one', title: 'Payment', instruction: 'Check payment conditions' }] })
function setup(overrides = {}) {
  const calls = { save: [], confirm: [], run: [], prepare: [] }
  const deps = {
    listReviewStandards: async () => [standard()],
    getContractReview: async () => null,
    saveReviewStandard: async (pid, value) => { calls.save.push([pid, value]); return { ...value, id: value.id || 3, version: 3, confirmedVersion: null } },
    confirmReviewStandard: async (pid, id, version) => { calls.confirm.push([pid, id, version]); return { ...standard(), version, confirmedVersion: version } },
    runContractReview: async (pid, value) => { calls.run.push([pid, value]); return { id: 7, standard: standard(), status: 'DONE', results: [] } },
    crypto: webcrypto,
    ...overrides,
  }
  const source = readFileSync(new URL('../../src/components/ContractReviewPane.vue', import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
  const component = new Function(...Object.keys(deps), script.replace('export default', 'return'))(...Object.values(deps))
  const vm = { projectId: 1, docFileId: 9, docName: 'contract.docx', canWrite: true,
    $t: (key) => key, $emit: (name, payload) => { calls.emitted = [name, payload] }, prepareDocument: async (did) => { calls.prepare.push(did); return true } }
  Object.assign(vm, component.data(), component.methods)
  for (const [key, value] of Object.entries(component.computed)) Object.defineProperty(vm, key, { get: () => value.call(vm) })
  return { vm, component, calls, source }
}

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

test('opening loads saved standards/results without spending or writing', async () => {
  const { vm, component, calls } = setup()
  component.mounted.call(vm)
  await vm._loading
  assert.equal(vm.confirmed, true)
  assert.deepEqual(calls, { save: [], confirm: [], run: [], prepare: [] })
})

test('editing confirmed rules invalidates local confirmation; save and confirm are separate actions', async () => {
  const { vm, calls } = setup()
  await vm.refresh()
  vm.draft.rules[0].instruction = 'New requirement'
  assert.equal(vm.confirmed, false)
  assert.equal(vm.canRun, false)
  await vm.confirm()
  assert.equal(calls.confirm.length, 0)
  await vm.save()
  assert.equal(calls.save[0][1].expectedVersion, 2)
  assert.equal(calls.save[0][1].rules[0].id, 'rule-one')
  assert.equal(vm.confirmed, false)
  assert.equal(vm.dirty, false)
  await vm.confirm()
  assert.deepEqual(calls.confirm, [[1, 3, 3]])
  assert.equal(vm.confirmed, true)
})

test('new rules have stable distinct ids and cannot overwrite a dirty draft by selecting another standard', async () => {
  const { vm } = setup()
  await vm.refresh()
  vm.newStandard()
  const firstId = vm.draft.rules[0].id
  vm.addRule()
  assert.notEqual(firstId, vm.draft.rules[1].id)
  vm.selectStandard(standard())
  assert.equal(vm.draft.rules[0].id, firstId)
  vm.removeRule(1)
  assert.equal(vm.draft.rules[0].id, firstId)
})

test('read-only users can read but never save, confirm or run', async () => {
  const { vm, calls } = setup()
  vm.canWrite = false
  await vm.refresh()
  await vm.save(); await vm.confirm(); await vm.startReview(); vm.newStandard(); vm.addRule(); vm.removeRule(0)
  assert.equal(vm.draft.rules.length, 1)
  assert.deepEqual(calls, { save: [], confirm: [], run: [], prepare: [] })
})

test('run uses confirmed version and waits for exact document save', async () => {
  const { vm, calls } = setup()
  await vm.refresh()
  const saved = deferred()
  vm.prepareDocument = (did) => { assert.equal(did, 9); return saved.promise }
  const pending = vm.startReview()
  assert.equal(calls.run.length, 0)
  await vm.startReview()
  saved.resolve(true)
  await pending
  assert.deepEqual(calls.run, [[1, { docFileId: 9, standardId: 3, version: 2 }]])
})

test('failed document save prevents review request', async () => {
  const { vm, calls } = setup()
  await vm.refresh()
  vm.prepareDocument = async () => false
  await vm.startReview()
  assert.equal(calls.run.length, 0)
  assert.equal(vm.error, 'contractReview.saveRequired')
})

for (const change of ['project', 'document', 'unmount', 'permission']) {
  test(`changing ${change} while saving prevents review`, async () => {
    const { vm, calls, component } = setup()
    await vm.refresh()
    vm.prepareDocument = async () => {
      if (change === 'project') vm.projectId = 2
      if (change === 'document') vm.docFileId = 10
      if (change === 'unmount') component.beforeUnmount.call(vm)
      if (change === 'permission') vm.canWrite = false
      return true
    }
    await vm.startReview()
    assert.equal(calls.run.length, 0)
  })
}

test('old read response cannot replace results after switching projects with same document id', async () => {
  const old = deferred()
  const { vm } = setup({ getContractReview: (pid) => pid === 1 ? old.promise : Promise.resolve(null) })
  const pending = vm.reset(true)
  vm.projectId = 2
  await vm.reset(true)
  old.resolve({ id: 'old-project-result' })
  await pending
  assert.equal(vm.run, null)
})

test('old run response cannot appear in a newly opened document', async () => {
  const old = deferred()
  const { vm } = setup({ runContractReview: () => old.promise })
  await vm.refresh()
  const pending = vm.startReview()
  await Promise.resolve()
  vm.docFileId = 10
  await vm.reset(false)
  old.resolve({ id: 'old-document-result' })
  await pending
  assert.equal(vm.run, null)
  assert.equal(vm.running, false)
})

test('results use immutable rule snapshot and missing results remain explicitly unchecked', async () => {
  const { vm } = setup()
  await vm.refresh()
  const snapshot = standard()
  snapshot.rules.push({ id: 'missing', title: 'Absent result', instruction: 'Must be checked' })
  vm.run = { standard: snapshot, results: [{ ruleId: 'rule-one', status: 'ISSUE', quote: 'original clause', reason: 'reason', suggestion: 'suggestion' }] }
  vm.draft.rules[0].title = 'Edited title'
  assert.equal(vm.resultRows[0].rule.title, 'Payment')
  assert.equal(vm.resultRows[1].result.status, 'UNREVIEWED')
  assert.equal(vm.resultRows[0].result.quote, 'original clause')
})

test('save conflict preserves draft and does not falsely confirm', async () => {
  const { vm } = setup({ saveReviewStandard: async () => { throw new Error('Version conflict') } })
  await vm.refresh()
  vm.draft.name = 'New title'
  await vm.save()
  assert.equal(vm.error, 'Version conflict')
  assert.equal(vm.dirty, true)
  assert.equal(vm.confirmed, false)
})

test('unsupported file cannot start a review', async () => {
  const { vm, calls } = setup()
  await vm.refresh()
  vm.docName = 'other.pdf'
  await vm.startReview()
  assert.equal(calls.run.length, 0)
})

test('quote action delegates to host locator, and review UI never offers an automatic write', () => {
  const { source } = setup()
  assert.match(source, /@tap="locateResult\(item.result\)"/)
  assert.doesNotMatch(source, /find_replace|find_text_locations/)
  const host = readFileSync(new URL('../../src/components/InsightPane.vue', import.meta.url), 'utf8')
  assert.match(host, /<ContractReviewPane[\s\S]*?@locate="locate"/)
})

test('stale review quotes never navigate; fresh historical quotes delegate to existing locator', () => {
  const { vm, calls } = setup()
  vm.run = { stale: true }
  vm.locateResult({ quote: 'historical clause' })
  assert.equal(calls.emitted, undefined)
  vm.run.stale = false
  vm.locateResult({ quote: 'historical clause' })
  assert.deepEqual(calls.emitted, ['locate', 'historical clause'])
})
