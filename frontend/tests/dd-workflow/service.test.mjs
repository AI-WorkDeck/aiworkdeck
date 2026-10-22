// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { service } from './service-harness.mjs'

test('checklist upload uses multipart boundary and real bytes, with only auth headers copied', async () => {
  const api = service(), progress = []
  const result = await api.importDdChecklist(2, { file: new File(['test'], 'list.txt'), name: '测试清单', idempotencyKey: 'import-retry-key', onProgress: p => progress.push(p.percent) })
  assert.equal(result.status,'QUEUED'); assert.equal(api.uploads.length,1)
  const upload = api.uploads[0]
  assert.equal(upload.url,'http://localhost/api/dd/projects/2/import')
  assert.equal(upload.headers['Content-Type'],undefined)
  assert.equal(upload.headers['X-Session-Id'],'synthetic-session')
  assert.equal(upload.body.get('file').name,'list.txt'); assert.equal(upload.body.get('name'),'测试清单')
  assert.equal(upload.body.get('idempotencyKey'),'import-retry-key')
  assert.deepEqual(progress,[50])
})

test('cloud DD operations carry project mapping but material jobs stay on the local project path', async () => {
  const calls = []; const api = service({ request: async args => { calls.push(args); return { code: 200, data: { id: 1 } } } })
  await api.getDdJob(1,7); await api.reviewDdSubmission(5,{status:'APPROVED',submissionId:10,revision:2},7); await api.getDdMaterialJob(7,4)
  assert.equal(calls[0].url,'/api/dd/jobs/1?projectId=7')
  assert.deepEqual(calls[1].data,{status:'APPROVED',submissionId:10,revision:2})
  assert.equal(calls[1].url,'/api/dd/items/5/status?projectId=7')
  assert.equal(calls[2].url,'/api/projects/7/dd-materials/jobs/4')
})

test('material and report starts send their stable idempotency keys', async () => {
  const calls = [], api = service({ request: async args => { calls.push(args); return { id: 1 } } })
  await api.importDdMaterials(7, 3, undefined, 'materials-key')
  await api.draftDdReport(7, 3, 'report-key')
  assert.deepEqual(calls.map(call => call.data), [{ requestId: 3, idempotencyKey: 'materials-key' }, { requestId: 3, idempotencyKey: 'report-key' }])
})
