// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCloudEpochGate, needsCloudEpoch } from '../cloud-epoch.mjs'
const cn = 'https://addin.aiworkdeck.com/api/files/42/content'
const intl = 'https://addin.workdeck.ai/api/files/42/content'
const auth = { 'X-Session-Id': 'synthetic-a' }
test('only authenticated official cloud mutations require a snapshot', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(needsCloudEpoch(cn, method, auth), true)
  for (const url of ['http://localhost:9696/api/files/42', 'https://selfhost.invalid/api/files/42', 'https://addin.aiworkdeck.com.evil.invalid/api/files/42', 'https://user@addin.aiworkdeck.com/api/files/42', cn.replace('/files/42/content', '/auth/login'), cn.replace('/files/42/content', '/mobile/billing/postpaid-accept')]) assert.equal(needsCloudEpoch(url, 'POST', auth), false)
  assert.equal(needsCloudEpoch(cn, 'GET', auth), false)
  assert.equal(needsCloudEpoch(cn, 'POST', {}), false)
})
test('concurrent requests share one frozen snapshot; region and identity do not', async () => {
  const loads = []
  const gate = createCloudEpochGate(async (origin, headers) => { loads.push([origin, headers]); return { cloudAccess: { epoch: loads.length } } })
  assert.deepEqual(await Promise.all([gate.headers(cn, 'PUT', auth), gate.headers(cn, 'POST', auth)]), [{ 'X-Cloud-Epoch': '1' }, { 'X-Cloud-Epoch': '1' }])
  assert.deepEqual(await gate.headers(cn, 'PUT', auth), { 'X-Cloud-Epoch': '1' })
  assert.deepEqual(await gate.headers(intl, 'PUT', auth), { 'X-Cloud-Epoch': '2' })
  assert.deepEqual(await gate.headers(cn, 'PUT', { 'X-Session-Id': 'synthetic-b' }), { 'X-Cloud-Epoch': '3' })
  assert.equal(loads.length, 3)
})
test('unavailable or malformed state fails closed; only explicit legacy 404 permits no epoch', async () => {
  for (const state of [{}, {cloudAccess:{canWrite:false}}, {cloudAccess:{epoch:-1}}, {cloudAccess:{epoch:'2'}}]) {
    const gate = createCloudEpochGate(async () => state)
    await assert.rejects(gate.headers(cn, 'POST', auth), /CLOUD_EPOCH_UNAVAILABLE/)
  }
  assert.deepEqual(await createCloudEpochGate(async () => null).headers(cn, 'POST', auth), {})
})
test('identity change cancels an in-flight handshake and never forwards its write', async () => {
  let finish
  const gate = createCloudEpochGate(() => new Promise(resolve => { finish = resolve }))
  const headers = gate.headers(cn, 'PUT', auth)
  await Promise.resolve()
  gate.clear()
  finish({ cloudAccess: { epoch: 4 } })
  await assert.rejects(headers, /CLOUD_EPOCH_CHANGED/)
})
test('a rejected write keeps its snapshot until an explicit lifecycle reset', async () => {
  let epoch = 1, loads = 0
  const gate = createCloudEpochGate(async () => { loads++; return {cloudAccess:{epoch}} })
  assert.equal((await gate.headers(cn, 'PUT', auth))['X-Cloud-Epoch'], '1')
  epoch = 2 // server cleanup happened; an old-operation retry must still be rejected by server
  assert.equal((await gate.headers(cn, 'PUT', auth))['X-Cloud-Epoch'], '1')
  assert.equal(loads, 1)
  gate.clear()
  assert.equal((await gate.headers(cn, 'PUT', auth))['X-Cloud-Epoch'], '2')
})
