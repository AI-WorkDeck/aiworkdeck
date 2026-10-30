// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { runMacCommand } from '../installer/build-installers.mjs'

function harness(results) {
  const calls = [], waits = [], output = []
  return {
    calls, waits, output,
    options: {
      execute(command, argv, options) {
        calls.push({ command, argv, options })
        return results[Math.min(calls.length - 1, results.length - 1)]
      },
      wait: ms => waits.push(ms),
      report: text => output.push(text),
    },
  }
}

for (const operation of ['create', 'detach']) {
  test(`hdiutil ${operation}: busy then success preserves diagnostics and retries identical arguments`, () => {
    const h = harness([{ status: 16, stderr: 'hdiutil: Resource busy\n' }, { status: 0, stdout: 'completed\n' }])
    const args = [operation, '/tmp/own-image']
    runMacCommand('hdiutil', args, h.options)
    assert.equal(h.calls.length, 2)
    assert.deepEqual(h.calls.map(call => call.argv), [args, args])
    assert.deepEqual(h.waits, [2000])
    assert.match(h.output.join(''), /Resource busy.*retry 1\/3.*completed/s)
    assert.equal(h.calls[0].options.timeout, 120000)
  })
}

for (const code of [-1001, -1005]) {
  test(`stapler: network ${code} retries ticket retrieval`, () => {
    const h = harness([{ status: 68, stderr: `Error Domain=NSURLErrorDomain Code=${code}; Error 68.\n` }, { status: 0 }])
    runMacCommand('xcrun', ['stapler', 'staple', '/tmp/own.dmg'], h.options)
    assert.equal(h.calls.length, 2)
    assert.deepEqual(h.waits, [2000])
  })
}

test('persistent busy remains a failure after the bounded attempts', () => {
  const h = harness([{ status: 16, stderr: 'Resource busy\n' }])
  assert.throws(() => runMacCommand('hdiutil', ['detach', '/tmp/own'], h.options), /status 16, attempt 4/)
  assert.equal(h.calls.length, 4)
  assert.deepEqual(h.waits, [2000, 5000, 10000])
  assert.equal(h.output.filter(text => text === 'Resource busy\n').length, 4)
})

test('invalid ticket, permission failure, notary rejection and validation failure are not retried', () => {
  for (const [command, args, detail] of [
    ['xcrun', ['stapler', 'staple'], 'The staple and validate action failed! Error 68.'],
    ['hdiutil', ['create'], 'Permission denied'],
    ['xcrun', ['notarytool', 'submit'], 'Invalid; NSURLErrorDomain Code=-1005'],
    ['xcrun', ['stapler', 'validate'], 'NSURLErrorDomain Code=-1005'],
  ]) {
    const h = harness([{ status: 68, stderr: detail }])
    assert.throws(() => runMacCommand(command, args, h.options), /attempt 1/)
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.waits, [])
  }
})

test('command launch errors and process timeouts remain errors', () => {
  const error = Object.assign(new Error('spawn failed'), { code: 'ETIMEDOUT' })
  const h = harness([{ status: null, error, stderr: 'Resource busy' }])
  assert.throws(() => runMacCommand('hdiutil', ['create'], h.options), observed => observed === error)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.waits, [])
})
