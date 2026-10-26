// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const { installBackendRequestGate, coreReadMatchers } = require('../main/services/backend-request-gate')

function fixture(t) {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1000 })
  const launch = { process: { exitCode: null, signalCode: null }, deadline: 6000, fullReady: false,
    coreReadPaths: ['/api/projects/my', '/api/projects/:id/files', '/api/files/:id/download'] }
  const state = { launch, port: 8765, closing: false }
  let listener, error, completed, requestId = 0, registrations = 0
  const session = { webRequest: { onBeforeRequest(fn) { listener = fn; registrations++ },
    onErrorOccurred(fn) { error = fn }, onCompleted(fn) { completed = fn } } }
  const dispose = installBackendRequestGate(session, { getState: () => state })
  t.after(dispose)
  const send = (path, method = 'GET') => {
    const results = []
    listener({ id: ++requestId, url: path.startsWith('http') ? path : `http://127.0.0.1:8765${path}`, method }, value => results.push(value))
    return results
  }
  return { launch, state, session, send, dispose, registrations: () => registrations,
    error: id => error({ id, error: 'net::ERR_ABORTED' }), completed: id => completed({ id }) }
}

for (const terminal of ['error', 'completed']) {
  test(`a ${terminal} request never receives its stale callback after ready, deadline or dispose`, t => {
    const fixtureValue = fixture(t), { send, launch, dispose } = fixtureValue
    const abandoned = send('/api/optional'), live = send('/api/other')
    fixtureValue[terminal](1)
    launch.fullReady = true
    t.mock.timers.tick(100)
    assert.deepEqual(abandoned, [])
    assert.deepEqual(live, [{ cancel: false }])
    t.mock.timers.tick(10000); dispose()
    assert.deepEqual(abandoned, [])
    assert.equal(live.length, 1)
  })
}

test('six optional requests stay unsent while file reads can start immediately', t => {
  const { send, launch } = fixture(t)
  const held = ['/api/app/language', '/api/telemetry/event', '/api/trial/balance', '/api/account/balance',
    '/api/site', '/api/packs/optional-components'].map(path => send(path))
  held.forEach(result => assert.deepEqual(result, []))
  assert.deepEqual(send('/api/projects/1/files?tree=true'), [{ cancel: false }])
  assert.deepEqual(send('/api/files/17/download', 'HEAD'), [{ cancel: false }])
  assert.deepEqual(send('/api/site', 'OPTIONS'), [{ cancel: false }])
  launch.fullReady = true
  t.mock.timers.tick(100)
  held.forEach(result => assert.deepEqual(result, [{ cancel: false }]))
  t.mock.timers.tick(1000)
  held.forEach(result => assert.equal(result.length, 1))
})

test('writes to a read route wait, and a different origin or port is unaffected', t => {
  const { send, launch } = fixture(t)
  const write = send('/api/projects/1/files', 'POST')
  assert.deepEqual(write, [])
  for (const url of ['https://127.0.0.1:8765/api/site', 'http://127.0.0.1:8766/api/site', 'https://example.org/api/site']) {
    assert.deepEqual(send(url), [{ cancel: false }])
  }
  launch.fullReady = true
  t.mock.timers.tick(100)
  assert.deepEqual(write, [{ cancel: false }])
})

test('advertised save metadata reads do not wait for the full backend; settings writes still wait', t => {
  const { send, launch } = fixture(t)
  const path = '/api/document/generator/settings'
  launch.coreReadPaths.push(path)
  assert.deepEqual(send(path), [{ cancel: false }])
  assert.deepEqual(send(path, 'HEAD'), [{ cancel: false }])
  const write = send(path, 'PUT')
  assert.deepEqual(write, [])
  launch.fullReady = true
  t.mock.timers.tick(100)
  assert.deepEqual(write, [{ cancel: false }])
})

test('only an explicit verified content capability releases its narrow write and receipt routes', t => {
  const { send, launch } = fixture(t)
  const path = '/api/local-core/projects/1/files/2/content'
  assert.deepEqual(send(path, 'PUT'), [])
  launch.coreContentProtocol = 1
  for (const method of ['GET', 'HEAD', 'PUT']) assert.deepEqual(send(path, method), [{ cancel: false }])
  assert.deepEqual(send(path + '/receipts/12345678-1234-1234-1234-123456789abc'), [{ cancel: false }])
  assert.deepEqual(send(path + '/receipts/12345678-1234-1234-1234-123456789abc', 'DELETE'), [{ cancel: false }])
  for (const [url, method] of [[path, 'DELETE'], [path + '/receipts/not-an-id', 'GET'],
    [path.replace('/1/', '/0/'), 'PUT'], [path + '/other', 'PUT'], ['/api/files/2/upload', 'POST']]) {
    assert.deepEqual(send(url, method), [])
  }
})

for (const change of ['launch', 'port', 'exit', 'signal', 'closing', 'deadline']) {
  test(`pending requests are cancelled on ${change} without replay into another backend`, t => {
    const { send, launch, state } = fixture(t)
    const request = send('/api/site')
    if (change === 'launch') state.launch = { ...launch, fullReady: true }
    if (change === 'port') state.port++
    if (change === 'exit') launch.process.exitCode = 0
    if (change === 'signal') launch.process.signalCode = 'SIGTERM'
    if (change === 'closing') state.closing = true
    if (change === 'deadline') launch.deadline = 1050
    t.mock.timers.tick(100)
    assert.deepEqual(request, [{ cancel: true }])
    launch.fullReady = true
    t.mock.timers.tick(100)
    assert.equal(request.length, 1)
  })
}

test('old/full backends pass normally and repeated window installation does not overwrite the listener', t => {
  const { session, send, launch, registrations } = fixture(t)
  installBackendRequestGate(session, { getState: () => { throw Error('must not replace') } })
  assert.equal(registrations(), 1)
  delete launch.coreReadPaths
  assert.deepEqual(send('/api/site'), [{ cancel: false }])
  launch.coreReadPaths = ['/api/projects/my']
  launch.fullReady = true
  assert.deepEqual(send('/api/site'), [{ cancel: false }])
})

test('only bounded literal path templates can advertise early reads', () => {
  for (const paths of [[], null, ['/api/.*'], ['/api/projects/:other'], ['/api/projects/:id?'], Array(33).fill('/api/site')]) {
    assert.equal(coreReadMatchers(paths), null)
  }
  const [match] = coreReadMatchers(['/api/projects/:id/files'])
  assert.ok(match.test('/api/projects/17/files'))
  assert.ok(!match.test('/api/projects/17/files/folder'))
  assert.ok(!match.test('/api/projects/foo/files'))
})

test('a disposed window callback cannot remove a later installation', () => {
  let listener
  const session = { webRequest: { onBeforeRequest(fn) { listener = fn }, onErrorOccurred() {}, onCompleted() {} } }
  const first = installBackendRequestGate(session, { getState: () => ({}) })
  first()
  const second = installBackendRequestGate(session, { getState: () => ({}) })
  const current = listener
  first()
  assert.equal(listener, current)
  second()
  assert.equal(listener, null)
})
