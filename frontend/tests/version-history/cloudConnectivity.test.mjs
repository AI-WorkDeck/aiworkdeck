// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCloudConnectivity } from '../../src/utils/cloudConnectivity.js'
const cached = { code: 0, data: { linked: true, remoteAhead: false, pendingUpload: false } }
const response = data => Promise.resolve({ code: 0, data })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('revocation receipt: failed check + OFFLINE pull + all cached refreshes never become synchronized', async () => {
  const observe = createCloudConnectivity()
  await observe(5, 'check', () => response({ ...cached.data, offline: true }))
  await observe(5, 'update', () => response({ status: 'OFFLINE' }))
  for (let i = 0; i < 3; i++) {
    assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  }
  assert.equal(cached.data.offline, undefined, 'do not mutate the transport response')
  assert.equal((await observe(6, 'status', () => Promise.resolve(cached))).data.offline, undefined)
})

test('OFFLINE pull alone is sufficient; confirmed network recovery clears it', async () => {
  const observe = createCloudConnectivity()
  await observe(5, 'update', () => response({ status: 'OFFLINE' }))
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  await observe(5, 'check', () => response({ ...cached.data, merging: true }))
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  await observe(5, 'check', () => Promise.resolve(cached))
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
})

test('an older successful check arriving after the failed pull cannot clear the failure', async () => {
  const observe = createCloudConnectivity(), old = deferred()
  const pending = observe(5, 'check', () => old.promise)
  await observe(5, 'update', () => response({ status: 'OFFLINE' }))
  old.resolve(cached)
  assert.equal((await pending).data.offline, true)
})

test('business rejection remains intact and unknown results cannot verify synchronization', async () => {
  const observe = createCloudConnectivity(), denied = new Error('No project access')
  await observe(5, 'check', () => response({ ...cached.data, offline: true }))
  await assert.rejects(observe(5, 'update', () => Promise.reject(denied)), error => error === denied)
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  for (const status of [undefined, 'UNRECOGNIZED', 'OFFLINE_PENDING']) {
    await observe(5, 'update', () => response({ status }))
    assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  }
  await observe(5, 'update', () => response({ status: 'UP_TO_DATE' }))
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
})

test('API facade sends all four operations through the shared observation state', async () => {
  const api = fs.readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  const observe = createCloudConnectivity()
  const calls = []
  let transportResult = { status: 'OFFLINE' }
  const request = async opts => { calls.push(opts); return { code: 0, data: transportResult } }
  const facades = Object.fromEntries(['getCloudStatus', 'checkCloud', 'uploadToCloud', 'updateFromCloud'].map(name => {
    const start = api.indexOf(`export function ${name}(`)
    const source = api.slice(start + 7, api.indexOf('\n}', start) + 2)
    return [name, new Function('request', 'observeCloudConnectivity', `return (${source})`)(request, observe)]
  }))
  await facades.updateFromCloud(5)
  transportResult = cached.data
  assert.equal((await facades.getCloudStatus(5)).data.offline, true)
  await facades.checkCloud(5)
  assert.equal((await facades.getCloudStatus(5)).data.offline, undefined)
  transportResult = { status: 'OFFLINE_PENDING' }
  await facades.uploadToCloud(5)
  transportResult = cached.data
  assert.equal((await facades.getCloudStatus(5)).data.offline, true)
  assert.equal(calls[0].url, '/api/cloud/projects/5/update')
  assert.equal(calls[0].method, 'POST')
})

test('actual dialog method only announces alreadyLatest for UP_TO_DATE', async () => {
  const vue = fs.readFileSync(new URL('../../src/components/collab/CollabDialog.vue', import.meta.url), 'utf8')
  const start = vue.indexOf('    async onUpdate() {')
  const method = vue.slice(start, vue.indexOf('    async onRefresh()', start)).trim().replace(/,$/, '')
  for (const status of ['OFFLINE', 'NOT_LINKED', 'NEW_STATUS', undefined, 'UP_TO_DATE', 'UPDATED', 'CONFLICT']) {
    const messages = [], events = []
    const methodFn = new Function('updateFromCloud', 'uni', `return ({${method}}).onUpdate`)(
      () => response({ status }), { showToast: msg => messages.push(msg.title) })
    await methodFn.call({ busy: false, projectId: 5, $t: key => key, $emit: (...args) => events.push(args), close() {} })
    assert.equal(messages.includes('version.alreadyLatest'), status === 'UP_TO_DATE', String(status))
    assert.ok(events.some(([event]) => event === 'changed'))
  }
})


test('local merging upload REMOTE_AHEAD neither clears nor invents an offline observation', async () => {
  const observe = createCloudConnectivity()
  await observe(5, 'check', () => response({ ...cached.data, offline: true }))
  await observe(5, 'upload', () => response({ status: 'REMOTE_AHEAD', message: 'Please finish choosing your files first' }))
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  await observe(6, 'upload', () => response({ status: 'REMOTE_AHEAD' }))
  assert.equal((await observe(6, 'status', () => Promise.resolve(cached))).data.offline, undefined)
})

test('local preflight rejection cannot invent remote network failure or clear an existing one', async () => {
  for (const operation of ['check', 'update', 'upload']) {
    const observe = createCloudConnectivity()
    const localGuard = Object.assign(new Error('Finish your current work session first'), { code: 1 })
    await assert.rejects(observe(5, operation, () => Promise.reject(localGuard)), error => error === localGuard)
    assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
    await observe(5, 'check', () => response({ ...cached.data, offline: true }))
    await assert.rejects(observe(5, operation, () => Promise.reject(localGuard)), error => error === localGuard)
    assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  }
})

test('unknown operation outcomes preserve the last observation without claiming remote failure', async () => {
  const observe = createCloudConnectivity()
  for (const operation of ['update', 'upload']) {
    await observe(5, operation, () => response({ status: 'FUTURE_STATUS' }))
    assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
  }
})

test('a late failed check cannot undo a newer verified recovery', async () => {
  const observe = createCloudConnectivity(), old = deferred()
  const pending = observe(5, 'check', () => old.promise)
  await observe(5, 'update', () => response({ status: 'UPDATED' }))
  old.resolve({ code: 0, data: { ...cached.data, offline: true } })
  assert.equal((await pending).data.offline, false)
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
})

test('backend or account changes discard observations and reject old in-flight replies', async () => {
  for (const replacement of ['other-session@same-backend', 'same-session@other-backend']) {
    let scope = 'same-session@same-backend'
    const observe = createCloudConnectivity(() => scope), old = deferred()
    await observe(5, 'update', () => response({ status: 'OFFLINE' }))
    const pending = observe(5, 'check', () => old.promise)
    scope = replacement
    assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
    old.resolve({ code: 0, data: { ...cached.data, offline: true } })
    await assert.rejects(pending, error => error.name === 'AbortError' && error.aborted)
    assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
  }
})

test('real API observation factory scopes by current backend and session', async () => {
  const api = fs.readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  const match = api.match(/const observeCloudConnectivity = ([\s\S]*?)\n\n/)
  let backend = 'http://synthetic.invalid', session = 'synthetic-A'
  const observe = new Function('createCloudConnectivity', 'getApiBaseUrl', 'getSessionId', 'getCloudAccountGeneration', `return ${match[1]}`)(
    createCloudConnectivity, () => backend, () => session, () => 0)
  await observe(5, 'update', () => response({ status: 'OFFLINE' }))
  session = 'synthetic-B'
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
  await observe(5, 'update', () => response({ status: 'OFFLINE' }))
  backend = 'http://other.synthetic.invalid'
  assert.equal((await observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined)
})

function accountApiFixture(request) {
  const source = fs.readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  const names = ['getAccountStatus', 'connectAccount', 'loginAccount', 'disconnectAccount', 'activateLicense', 'deactivateLicense', 'selectSite']
  const functions = names.map(name => {
    const start = source.indexOf(`export function ${name}(`)
    return source.slice(start + 7, source.indexOf('\n}', start) + 2)
  }).join('\n')
  const start = source.indexOf('let cloudAccountGeneration =')
  const lifecycle = source.slice(start, source.indexOf('\n\n/**', start)).replace('export function', 'function')
  return new Function('createCloudConnectivity', 'getApiBaseUrl', 'getSessionId', 'request', 'unwrapEnvelope',
    `${lifecycle}\n${functions}\nreturn { ${names.join(',')}, observe: observeCloudConnectivity, generation: getCloudAccountGeneration }`)(
    createCloudConnectivity, () => 'http://synthetic.invalid', () => 'unchanged-local-session', request,
    result => result?.data || result)
}

test('real desktop account mutation exits invalidate cloud observations even when local session is unchanged', async () => {
  const names = ['connectAccount', 'loginAccount', 'disconnectAccount', 'activateLicense', 'deactivateLicense', 'selectSite']
  for (const name of names) {
    let reject = false
    const fixture = accountApiFixture(async () => {
      if (reject) throw new Error('synthetic account mutation failed')
      return { code: 0, data: { connected: true } }
    })
    await fixture.observe(5, 'update', () => response({ status: 'OFFLINE' }))
    const old = deferred(), pending = fixture.observe(5, 'check', () => old.promise)
    await fixture[name]('synthetic-only')
    assert.equal(fixture.generation(), 1, name)
    assert.equal((await fixture.observe(5, 'status', () => Promise.resolve(cached))).data.offline, undefined, name)
    old.resolve(cached)
    await assert.rejects(pending, error => error.aborted, name)
    await fixture.observe(5, 'update', () => response({ status: 'OFFLINE' }))
    await fixture.getAccountStatus()
    assert.equal(fixture.generation(), 1, 'account status polling must not invalidate observations')
    reject = true
    await assert.rejects(fixture[name]('synthetic-only'))
    assert.equal(fixture.generation(), 1, 'failed account mutation must preserve prior identity')
    assert.equal((await fixture.observe(5, 'status', () => Promise.resolve(cached))).data.offline, true)
  }
})
