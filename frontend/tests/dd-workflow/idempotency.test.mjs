// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { service, memoryStorage } from './service-harness.mjs'
import { createEditor } from './editor-harness.mjs'
import { waitForDdJob } from '../../src/utils/ddWorkflow.js'

test('unknown start survives a remount without persisting source text, filenames or credentials', async () => {
  const storage = memoryStorage(), first = service({ storage })
  const input = { name: '客户秘密清单', content: '客户未公开材料', file: new File(['secret bytes'], '客户秘密.txt') }
  const attempt = await first.getDdStartAttempt('IMPORT', 7, input)
  const restored = await service({ storage }).getDdStartAttempt('IMPORT', 7, input)
  assert.equal(restored.key, attempt.key)
  const persisted = JSON.stringify([...storage.values])
  for (const sensitive of ['客户', 'secret', 'synthetic-session']) assert.equal(persisted.includes(sensitive), false)
  assert.deepEqual(Object.keys(JSON.parse([...storage.values.values()][0])).sort(), ['fingerprint', 'key'])
})

test('changed file bytes, changed text, account, project and operation get distinct keys', async () => {
  let account = 'first-account'; const api = service({ session: () => account })
  const a = await api.getDdStartAttempt('IMPORT', 7, { name: '清单', file: new File(['aaa'], 'same.txt') })
  const b = await api.getDdStartAttempt('IMPORT', 7, { name: '清单', file: new File(['bbb'], 'same.txt') })
  assert.notEqual(a.key, b.key)
  const c = await api.getDdStartAttempt('IMPORT', 7, { content: 'A' }), d = await api.getDdStartAttempt('IMPORT', 7, { content: 'B' })
  assert.notEqual(c.key, d.key)
  const report = await api.getDdStartAttempt('REPORT', 7, { requestId: 2 })
  assert.equal((await api.getDdStartAttempt('REPORT', '7', { requestId: '2' })).key, report.key)
  const project = await api.getDdStartAttempt('REPORT', 8, { requestId: 2 })
  const materials = await api.getDdStartAttempt('MATERIALS', 7, { requestId: 2 })
  account = 'second-account'; const anotherUser = await api.getDdStartAttempt('REPORT', 7, { requestId: 2 })
  assert.equal(new Set([report.key, project.key, materials.key, anotherUser.key]).size, 4)
})

test('terminal outcome rotates the key; an older completion cannot erase a changed input attempt', async () => {
  const api = service(), first = await api.getDdStartAttempt('IMPORT', 7, { content: 'A' })
  const changed = await api.getDdStartAttempt('IMPORT', 7, { content: 'B' })
  api.finishDdStartAttempt(first)
  assert.equal((await api.getDdStartAttempt('IMPORT', 7, { content: 'B' })).key, changed.key)
  api.finishDdStartAttempt(changed)
  assert.notEqual((await api.getDdStartAttempt('IMPORT', 7, { content: 'B' })).key, changed.key)
})

test('storage denial still preserves retries for the current window', async () => {
  const api = service({ storage: { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } } })
  const first = await api.getDdStartAttempt('REPORT', 7, { requestId: 2 })
  assert.equal((await api.getDdStartAttempt('REPORT', 7, { requestId: 2 })).key, first.key)
})

for (const kind of ['report', 'materials']) test(`${kind} reuses lost-ack key after remount and rotates after success or terminal failure`, async t => {
  const storage = memoryStorage(), calls = []; let outcome = 'network'
  const make = () => {
    const keys = service({ storage })
    return createEditor({ services: { ...keys, waitForDdJob,
      draftDdReport: async (...args) => start(args[2]), importDdMaterials: async (...args) => start(args[3])
    } })
  }
  function start(key) { calls.push(key); if (outcome === 'network') throw new Error('response lost'); return { id: 1, status: outcome, result: { files: [] }, error: 'known failure' } }
  const first = make(); await first.vm.startMaterialJob(kind); assert.match(first.vm.error, /response lost/); first.dispose()
  const second = make(); t.after(second.dispose); outcome = 'SUCCEEDED'; await second.vm.startMaterialJob(kind)
  assert.equal(calls[1], calls[0]); outcome = 'FAILED'; await second.vm.startMaterialJob(kind); assert.notEqual(calls[2], calls[1])
  outcome = 'SUCCEEDED'; await second.vm.startMaterialJob(kind); assert.notEqual(calls[3], calls[2])
})

function importForm(services, api = {}) {
  const source = readFileSync(new URL('../../src/components/dd/DdImportForm.vue', import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const deps = { api, waitForDdJob, ...services }
  const options = new Function(...Object.keys(deps), script)(...Object.values(deps))
  const vm = { ...options.data(), projectId: 7, emitted: [], $t: key => key }; vm.$emit = (...args) => vm.emitted.push(args)
  for (const [key, method] of Object.entries(options.methods)) vm[key] = method.bind(vm)
  return { vm, dispose: () => options.beforeUnmount.call(vm) }
}

test('checklist import remount recovers lost ack and changed input, failure and success rotate keys', async t => {
  const storage = memoryStorage(), calls = []; let outcome = 'network'
  const make = () => importForm({ ...service({ storage }), importDdChecklist: async (project, input) => {
    calls.push(input.idempotencyKey); if (outcome === 'network') throw new Error('response lost')
    return { id: 1, status: outcome, result: { requestId: 9 }, error: 'known failure' }
  } }, { getDdRequestDetails: async () => ({ request: { id: 9 } }) })
  const first = make(); first.vm.content = '旧清单'; await first.vm.start(); first.dispose()
  const second = make(); t.after(second.dispose); second.vm.content = '旧清单'; await second.vm.start(); assert.equal(calls[1], calls[0])
  second.vm.content = '新清单'; await second.vm.start(); assert.notEqual(calls[2], calls[1])
  outcome = 'FAILED'; await second.vm.start(); assert.equal(calls[3], calls[2])
  outcome = 'SUCCEEDED'; await second.vm.start(); assert.notEqual(calls[4], calls[3]); assert.equal(second.vm.emitted.length, 1)
  await second.vm.start(); assert.notEqual(calls[5], calls[4])
})

test('known successful import keeps its key when loading the resulting checklist fails', async t => {
  const api = service(), calls = []; let fail = true
  const form = importForm({ ...api, importDdChecklist: async (project, input) => { calls.push(input.idempotencyKey); return { id: 1, status: 'SUCCEEDED', result: { requestId: 9 } } } }, { getDdRequestDetails: async () => { if (fail) throw new Error('details unavailable'); return { request: { id: 9 } } } })
  t.after(form.dispose); form.vm.content = '清单'; await form.vm.start(); fail = false; await form.vm.start()
  assert.equal(calls.length, 1); assert.equal(form.vm.emitted.length, 1)
})

test('report observation failure resumes the known job without another start request', async t => {
  const api = service(), starts = []; let lost = true
  const editor = createEditor({ services: { ...api,
    draftDdReport: async (...args) => { starts.push(args[2]); return { id: 8, status: 'RUNNING' } },
    waitForDdJob: async (job, load, options) => { if (lost) throw new Error('poll lost'); options.onUpdate({ ...job, status: 'SUCCEEDED' }); return { files: [] } }
  } }); t.after(editor.dispose)
  await editor.vm.createReport(); assert.equal(editor.vm.pendingJob.job.id, 8)
  lost = false; await editor.vm.resumeJob(); assert.equal(starts.length, 1)
  await editor.vm.createReport(); assert.equal(starts.length, 2); assert.notEqual(starts[0], starts[1])
})

test('editing import inputs after a polling failure starts a new job rather than observing the old input', async t => {
  const api = service(), starts = [], observed = []
  const form = importForm({ ...api,
    importDdChecklist: async (project, input) => { starts.push(input.idempotencyKey); return { id: starts.length, status: 'RUNNING' } },
    waitForDdJob: async job => { observed.push(job.id); throw new Error('poll lost') }
  }); t.after(form.dispose)
  form.vm.content = 'A'; await form.vm.start(); form.vm.content = 'B'; await form.vm.start()
  assert.equal(starts.length, 2); assert.notEqual(starts[0], starts[1]); assert.deepEqual(observed, [1, 2])
})
