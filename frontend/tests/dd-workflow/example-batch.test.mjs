// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditor, deferred } from './editor-harness.mjs'

const data = () => ({ request: { id: 1, name: '清单', status: 'DRAFT' }, items: [
  { id: 1, title: '公司材料' }, { id: 2, parentId: 1, title: '执照' },
  { id: 3, parentId: 1, title: '章程' }, { id: 4, title: '已生成项', exampleFileId: 8 },
] })

test('missing examples are generated serially for leaves only and advance only on completed jobs', async t => {
  const source = data(), calls = [], gates = [deferred(), deferred()]; let active = 0, peak = 0
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: async () => structuredClone(source) }, services: {
    generateDdExample: async id => { calls.push(id); return { id, status: 'QUEUED' } },
    waitForDdJob: async job => { const index = active++; peak = Math.max(peak, active); await gates[calls.length - 1].promise; source.items.find(item => item.id === job.id).exampleFileId = 100 + job.id; active--; return {} }
  } }); t.after(dispose)
  await vm.fetchData(); assert.deepEqual(vm.missingExamples.map(item => item.id), [2, 3])
  const pending = vm.generateMissingExamples(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls,[2]); assert.equal(vm.exampleBatch.index,0)
  gates[0].resolve(); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls,[2,3]); assert.equal(vm.exampleBatch.index,1)
  gates[1].resolve(); await pending; assert.equal(peak,1); assert.equal(vm.exampleBatch,null); assert.equal(vm.missingExamples.length,0)
})

test('interrupted observation resumes the same job and never regenerates completed items', async t => {
  const source = data(), calls = []; let failedOnce = false
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: async () => structuredClone(source) }, services: {
    generateDdExample: async id => { calls.push(id); return { id, status: 'RUNNING' } },
    waitForDdJob: async job => { if (job.id === 3 && !failedOnce) { failedOnce = true; throw new Error('网络中断') }; source.items.find(item => item.id === job.id).exampleFileId = 100 + job.id; return {} }
  } }); t.after(dispose)
  await vm.fetchData(); await vm.generateMissingExamples()
  assert.deepEqual(calls,[2,3]); assert.equal(vm.exampleBatch.index,1); assert.match(vm.error,/章程.*网络中断/); assert.equal(vm.pendingJob.job.id,3)
  await vm.resumeJob(); assert.deepEqual(calls,[2,3]); assert.equal(vm.exampleBatch,null); assert.equal(vm.error,'')
})

test('known backend failure stops at its item and retries it only after an explicit action', async t => {
  const source=data(),calls=[];let fail=true
  const { vm, dispose } = createEditor({ api:{ getDdRequestDetails:async()=>structuredClone(source) },services:{
    generateDdExample:async id=>{calls.push(id);return{id,status:fail?'FAILED':'SUCCEEDED'}},
    waitForDdJob:async job=>{if(job.status==='FAILED')throw new Error('生图服务不可用');source.items.find(i=>i.id===job.id).exampleFileId=100+job.id;return{}}
  }});t.after(dispose)
  await vm.fetchData();await vm.generateMissingExamples();assert.deepEqual(calls,[2]);assert.equal(vm.pendingJob,null);assert.equal(vm.exampleBatch.index,0)
  fail=false;await vm.generateMissingExamples();assert.deepEqual(calls,[2,2,3]);assert.equal(vm.exampleBatch,null)
})

test('queue stops after unmount even when the create-job response arrives late', async () => {
  const gate = deferred(), calls=[]
  const { vm, dispose } = createEditor({ api:{getDdRequestDetails:async()=>data()},services:{generateDdExample:async id=>{calls.push(id);return gate.promise},waitForDdJob:async()=>{throw new Error('must not poll')}}})
  await vm.fetchData();const pending=vm.generateMissingExamples();await new Promise(resolve=>setImmediate(resolve));dispose();gate.resolve({id:2,status:'QUEUED'});await pending;assert.deepEqual(calls,[2]);assert.equal(vm.error,'')
})
