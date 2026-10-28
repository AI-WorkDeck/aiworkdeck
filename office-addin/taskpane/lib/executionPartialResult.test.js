// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const receipt = { slideNumber: 2, shapeId: 'table', outcomeUnknown: true, retryable: false }
function extract(file, name) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = source.indexOf(`export async function ${name}(`)
  const end = source.indexOf('\n}', start) + 2
  return source.slice(start, end).replace('export ', '')
}
for (const family of ['office', 'wps']) test(`${family}: execution and host bridge preserve partial failure receipt`, async () => {
  const name = family === 'office' ? 'executeOfficeCommand' : 'executeWpsCommand'
  const command = 'ppt_table_set_style'
  const handler = async () => { throw Object.assign(new Error('host failed after write'), { partialResult: receipt }) }
  const realm = vm.createContext({ console: { warn() {} }, t: key => key,
    officeAvailable: () => true, wpsAvailable: () => true, detectHost: () => 'powerpoint', detectWpsHost: () => 'powerpoint',
    requiredHostOf: () => 'powerpoint', COMMAND_HOSTS: { [command]: 'powerpoint' }, HOST_LABELS: {},
    HANDLERS: { [command]: handler }, HOST_HANDLERS: {}, ANY_HOST_COMMANDS: new Set(),
    describeExecutionError: async e => e.message, forcedTrackingDepth: 0,
    hostFamily: () => family, FILE_OPERATION_COMMANDS: [] })
  vm.runInContext(extract(family === 'office' ? './officeExecutor.js' : './wpsExecutor.js', name), realm)
  vm.runInContext(extract('./hostBridge.js', 'executeCommand'), realm)
  const result = await realm.executeCommand(command, {})
  assert.equal(result.ok, false); assert.equal(result.error, 'host failed after write')
  assert.deepEqual(result.partialResult, receipt)
})
test('both local and remote pane reply payloads carry partial receipts on failure', () => {
  const source = readFileSync(new URL('./chatSession.js', import.meta.url), 'utf8')
  const expressions = [...source.matchAll(/data: (result\.ok \? result\.data : \(result\.partialResult \|\| null\))/g)]
  assert.equal(expressions.length, 2)
  for (const [, expression] of expressions) {
    const payload = vm.runInNewContext(expression, { result: { ok: false, partialResult: receipt } })
    assert.deepEqual(payload, receipt)
  }
})
