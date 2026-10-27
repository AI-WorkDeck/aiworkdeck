// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from 'vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'

const source = parseSfc(readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')).descriptor.script.content
const options = parseJs(source, { sourceType: 'module' }).program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration
const methods = options.properties.find(node => node.key?.name === 'methods').value
const actualMethod = methods.properties.filter(node => node.key?.name === 'handleLitigationOpenFile')
  .map(node => source.slice(node.start, node.end)).join(',\n')

function fixture() {
  let resolve, reject, sessionId = 'session-one', accountGeneration = 1, active = true
  const details = new Promise((done, fail) => { resolve = done; reject = fail })
  const calls = { requests: [], opened: [], toasts: [] }
  const actual = new Function('getFileDetail', 'getSessionId', 'getCloudAccountGeneration', 'uni',
    `return ({${actualMethod}})`)(
    (projectId, fileId) => { calls.requests.push({ projectId, fileId }); return details },
    () => sessionId, () => accountGeneration, { showToast: options => calls.toasts.push(options) })
  const vm = { ...actual, projectId: '12', $t: key => key,
    isActiveOverviewInstance: () => active,
    openFile: file => calls.opened.push(file),
  }
  return { vm, calls, resolve, reject,
    switchSession: () => { sessionId = 'session-two' },
    switchAccount: () => { accountGeneration++ },
    leavePage: () => { active = false },
  }
}

test('the real litigation open method preserves normal file opening in the current project', async () => {
  const f = fixture()
  const pending = f.vm.handleLitigationOpenFile({ fileId: 71 })
  const file = { id: 71, projectId: 12, name: 'synthetic.drawio' }
  assert.deepEqual(f.calls.requests, [{ projectId: 12, fileId: 71 }])
  f.resolve(file)
  await pending
  assert.deepEqual(f.calls.opened, [file])
  assert.deepEqual(f.calls.toasts, [])
})

for (const change of ['project', 'session', 'account', 'page']) {
  test(`a file detail response arriving after the ${change} changes cannot open a diagram`, async () => {
    const f = fixture()
    const pending = f.vm.handleLitigationOpenFile({ fileId: 71 })
    if (change === 'project') f.vm.projectId = 13
    else if (change === 'session') f.switchSession()
    else if (change === 'account') f.switchAccount()
    else f.leavePage()
    f.resolve({ id: 71, projectId: 12, name: 'old-project.drawio' })
    await pending
    assert.deepEqual(f.calls.opened, [])
    assert.deepEqual(f.calls.toasts, [], 'the old request must not display a toast in the new context')
  })
}

test('a current detail failure keeps the manual-open toast and rejects for the generation controller', async () => {
  const f = fixture(), failure = new Error('synthetic detail failure')
  const pending = f.vm.handleLitigationOpenFile({ fileId: 71 })
  const rejection = assert.rejects(pending, error => error === failure)
  f.reject(failure)
  await rejection
  assert.deepEqual(f.calls.opened, [])
  assert.deepEqual(f.calls.toasts, [{ title: 'workbench.openFailed', icon: 'none' }])
})

test('an absent file detail is reported as an open failure instead of a successful delivery', async () => {
  const f = fixture()
  const pending = f.vm.handleLitigationOpenFile({ fileId: 71 })
  const rejection = assert.rejects(pending, /workbench.openFailed/)
  f.resolve(null)
  await rejection
  assert.deepEqual(f.calls.opened, [])
  assert.equal(f.calls.toasts.length, 1)
})

test('an editor-open failure reaches the generation controller after the existing toast', async () => {
  const f = fixture(), failure = new Error('synthetic editor failure')
  f.vm.openFile = () => { throw failure }
  const pending = f.vm.handleLitigationOpenFile({ fileId: 71 })
  const rejection = assert.rejects(pending, error => error === failure)
  f.resolve({ id: 71, projectId: 12 })
  await rejection
  assert.equal(f.calls.toasts.length, 1)
})

test('a rejected detail request from a departed project does not show an outdated failure toast', async () => {
  const f = fixture()
  const pending = f.vm.handleLitigationOpenFile({ fileId: 71 })
  f.vm.projectId = 13
  f.reject(new Error('synthetic old request failure'))
  await pending
  assert.deepEqual(f.calls.opened, [])
  assert.deepEqual(f.calls.toasts, [])
})
