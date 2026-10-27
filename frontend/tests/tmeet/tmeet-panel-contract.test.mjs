// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/tmeet/TencentMeetingPanel.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"]/g, '').replace('export default', 'return')
function panel(api = {}) {
  const names = ['AwdSwitch', 'AwdSelect', 'getTmeetAuthStatus', 'loginTmeet', 'logoutTmeet', 'getTmeetSyncConfig', 'updateTmeetSyncConfig', 'syncTmeetMeetings', 'getTmeetMeetings', 'exportTmeetToDoc', 'getTmeetMinutesPrompt', 'getTmeetTodosPrompt', 'uni']
  const component = new Function(...names, script)(...names.map(n => api[n] || (n === 'uni' ? { showToast() {} } : async () => ({ data: {} }))))
  const events = []
  const vm = { ...component.data(), $t: key => key, $emit: (...args) => events.push(args), projectId: 1 }
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  return { vm, events }
}

test('login and prompt requests use the real controller routes and verbs', async () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  const requests = []
  for (const name of ['loginTmeet', 'getTmeetMinutesPrompt', 'getTmeetTodosPrompt']) {
    const fn = api.match(new RegExp(`export function ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n\\}`))
    await new Function('request', fn[1], fn[2])(options => requests.push(options), 7)
  }
  assert.deepEqual(requests.map(r => [r.url, r.method]), [
    ['/api/tmeet/auth/login-start', 'POST'],
    ['/api/tmeet/meetings/7/minutes-prompt', 'POST'],
    ['/api/tmeet/meetings/7/todos-prompt', 'POST']
  ])
})

test('backend loggedIn and userName render as connected', async () => {
  const { vm } = panel({ getTmeetAuthStatus: async () => ({ data: { cliAvailable: true, loggedIn: true, userName: 'QA' } }) })
  await vm.fetchAuthStatus()
  assert.equal(vm.authStatus.authorized, true)
  assert.equal(vm.authStatus.accountName, 'QA')
})

test('missing CLI is a visible setup state and does not launch a failing login', async () => {
  let calls = 0
  const { vm } = panel({ getTmeetAuthStatus: async () => ({ data: { cliAvailable: false, loggedIn: false } }), loginTmeet: async () => { calls++ } })
  await vm.fetchAuthStatus()
  assert.equal(vm.authStatus.cliAvailable, false)
  await vm.onLogin()
  assert.equal(calls, 0)
  assert.ok(source.includes('tmeet.installRequired'))
})

test('minutes sends prompt text, never a response object or fabricated fallback', async () => {
  const { vm, events } = panel({ getTmeetMinutesPrompt: async () => ({ data: { prompt: 'QA minutes' } }) })
  await vm.onGenerateMinutes({ id: 7 })
  assert.equal(events[0][1].prompt, 'QA minutes')
  const failed = panel({ getTmeetMinutesPrompt: async () => { throw new Error('unavailable') } })
  await failed.vm.onGenerateMinutes({ id: 7 })
  assert.equal(failed.events.length, 0)
})

test('already connected login response refreshes status without opening authorization', async () => {
  const { vm } = panel({ loginTmeet: async () => ({ data: { loggedIn: true } }), getTmeetAuthStatus: async () => ({ data: { cliAvailable: true, loggedIn: true, userName: 'QA' } }) })
  vm.authStatus.cliAvailable = true
  await vm.onLogin()
  assert.equal(vm.authStatus.authorized, true)
  assert.equal(vm.authorizing, false)
})

test('sync preserves project association in request parameters expected by controller', async () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  const fn = api.match(/export function syncTmeetMeetings\(([^)]*)\) \{([\s\S]*?)\n\}/)
  const run = new Function('request', fn[1], fn[2])
  const requests = []
  await run(options => requests.push(options), { projectId: 42, force: true })
  await run(options => requests.push(options), {})
  assert.equal(requests[0].url, '/api/tmeet/sync?projectId=42&force=true')
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[1].url, '/api/tmeet/sync')
})

test('failed logout preserves connection instead of reporting disconnection', async () => {
  const messages = []
  const { vm } = panel({ logoutTmeet: async () => ({ data: false }), uni: { showToast: value => messages.push(value.title) } })
  vm.authStatus.authorized = true
  await vm.onLogout()
  assert.equal(vm.authStatus.authorized, true)
  assert.deepEqual(messages, ['tmeet.disconnectFailed'])
})
