// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accountRequiredError, isCreditsRequired, isAccountRequired, createAccountGate } from '../../src/utils/requireAccountCore.js'
const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
const source = api.slice(api.indexOf('function request(options)'), api.indexOf('// 查询公司基础信息'))
  .replaceAll("import('@/utils/requireAccount.js')", 'loadAccountUi()')
function harness({ desktop = true, session = null, recover = async () => false } = {}) {
  const calls = [], pending = []
  let generation = 0
  const deps = {
    uni: { request: options => { pending.push(options); return {} }, showToast: () => calls.push('toast'), reLaunch: () => calls.push('navigate') },
    getApiBaseUrl: () => 'http://127.0.0.1:19999', getAuthHeaders: () => session ? { 'X-Session-Id': session } : ({}), getSessionId: () => session, t: key => key,
    accountRequiredError, isCreditsRequired, isAccountRequired, isDesktopHost: () => desktop,
    getCloudAccountGeneration: () => generation, clearSession: () => { calls.push('clear'); session = null }, isOnLoginPage: () => false,
    getAccountStatus: async () => { calls.push('verify-account'); return { connected: true } },
    loadAccountUi: async () => ({ handleWorkspaceSessionFailure: async () => { calls.push('workspace-recovery'); return recover() }, handleAccountExpired: options => calls.push(['expired', options.prompt]), requireAccountFor4011: async () => { calls.push('login'); return false } }),
    console: { log() {}, warn() {}, error() {} },
  }
  const request = new Function(...Object.keys(deps), source + '\nreturn request')(...Object.values(deps))
  const reply = (body, statusCode = 200) => pending.shift().success({ statusCode, data: body })
  return { request, reply, calls, login: () => { generation++ }, changeSession: value => { session = value } }
}
test('stale local session is cleared and the rejected operation retries once without invalidating the cloud account', async () => {
  const h = harness({ session: 'synthetic-old-session' })
  const p = h.request({ url: '/api/projects/open-local' })
  await h.reply({ code: 4010, message: 'Expired' })
  await h.reply({ code: 0, data: { id: 7 } })
  assert.equal((await p).data.id, 7)
  assert.deepEqual(h.calls, ['clear'])
})
test('unrecoverable local session gets a persistent recovery dialog instead of a false cloud logout', async () => {
  const h = harness({ session: 'synthetic-old-session' })
  const p = h.request({ url: '/api/projects/open-local' })
  await h.reply({ code: 4010 })
  await h.reply({ code: 4010 })
  await assert.rejects(p, e => e.code === 4010)
  assert.deepEqual(h.calls, ['clear', 'workspace-recovery'])
})
test('confirmed expiry in account status is handled before returning a disconnected status', async () => {
  const h = harness()
  const p = h.request({ url: '/api/account/status' })
  await h.reply({ code: 0, data: { connected: false, authExpired: true } })
  assert.equal((await p).data.connected, false)
  assert.deepEqual(h.calls, [['expired', true]])
})
test('background unauthorized verifies the account without treating a provider rejection as cloud expiry', async () => {
  const h = harness()
  const p = h.request({ url: '/api/account/profile', accountPrompt: false })
  await h.reply({ code: 1, kind: 'UNAUTHORIZED', message: 'Revoked' })
  await assert.rejects(p)
  assert.deepEqual(h.calls, ['verify-account'])
})
test('wrong password, network error, and forbidden role do not invalidate the current account', async () => {
  for (const [body, options] of [
    [{ code: 1, kind: 'UNAUTHORIZED' }, { accountPrompt: false, accountAuthAttempt: true }],
    [{ code: 1, kind: 'NETWORK' }, {}],
    [{ code: 1, kind: 'REJECTED', reason: 'forbidden' }, {}],
  ]) {
    const h = harness(); const p = h.request({ url: '/api/account/login', ...options })
    await h.reply(body); await assert.rejects(p); assert.deepEqual(h.calls, [])
  }
})
test('a delayed expiry from before a successful login cannot clear or prompt the new session', async () => {
  const h = harness(); const p = h.request({ url: '/api/projects/open-local' })
  h.login(); await h.reply({ code: 4010, message: 'Old request' }); await assert.rejects(p)
  assert.deepEqual(h.calls, [])
})
test('browser session expiry retains its existing login-page flow', async () => {
  const h = harness({ desktop: false }); const p = h.request({ url: '/api/projects' })
  await h.reply({ code: 4010 }); await assert.rejects(p)
  assert.deepEqual(h.calls, ['clear', 'navigate'])
})


test('actual account coordinator deduplicates expiry, preserves the warning after cancel, and restores on login', async () => {
  const events = [], dialogs = [], handlers = new Map()
  let resolveRecovery, recoveryDialogs = 0
  const uiSource = readFileSync(new URL('../../src/utils/requireAccount.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export \{.*$/gm, '').replace(/export (async function|function|const)/g, '$1')
  const deps = {
    createApp: (_component, props) => { dialogs.push(props); return { use() {}, mount() {}, unmount() {} } },
    AccountLoginDialog: {}, RechargeDialog: {}, i18n: { global: { t: key => key } },
    showDialog: () => { recoveryDialogs++; return new Promise(resolve => { resolveRecovery = resolve }) }, createAccountGate, reasonFromBackend: value => value,
    getAccountStatus: async () => ({ connected: true }), getCloudAccountGeneration: () => 0, isDesktopHost: () => true,
    setGlobalOverlay() {}, refreshEntitlements: async () => {},
    document: { body: { appendChild() {} }, getElementById: () => null, createElement: () => ({}) },
    uni: { $on: (name, fn) => handlers.set(name, fn), $emit: (name, value) => { events.push([name, value]); handlers.get(name)?.(value) } },
  }
  const ui = new Function(...Object.keys(deps), uiSource + '\nreturn { handleAccountExpired, requireAccount, requireAccountFor4011, handleWorkspaceSessionFailure, isAccountSessionExpired, broadcastAccountChanged }')(...Object.values(deps))
  ui.handleAccountExpired(); ui.handleAccountExpired()
  assert.equal(dialogs.length, 1)
  assert.equal(dialogs[0].reason, 'expired')
  assert.equal(events.filter(([name]) => name === 'awd:account-changed').length, 1)
  dialogs[0].onCancel()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(ui.isAccountSessionExpired(), true)
  ui.handleAccountExpired()
  assert.equal(dialogs.length, 1, 'background status must not repeatedly prompt')
  const retry = ui.requireAccount({ reason: 'account' })
  assert.equal(dialogs.length, 2, 'manual recovery bypasses cached connected:true')
  dialogs[1].onSuccess({ connected: true })
  assert.equal(await retry, true)
  assert.equal(ui.isAccountSessionExpired(), false)
  assert.equal(await ui.requireAccountFor4011({ kind: 'UNAUTHORIZED' }), false)
  assert.equal(dialogs.length, 2, 'a provider rejection with a valid account must not open login')
  const firstRecovery = ui.handleWorkspaceSessionFailure()
  assert.equal(ui.handleWorkspaceSessionFailure(), firstRecovery)
  resolveRecovery({ confirm: true })
  assert.equal(await firstRecovery, true)
  const secondRecovery = ui.handleWorkspaceSessionFailure()
  resolveRecovery({ confirm: false })
  assert.equal(await secondRecovery, false)
  assert.equal(await ui.handleWorkspaceSessionFailure(), false)
  assert.equal(recoveryDialogs, 2, 'cancelled automatic recovery has cooldown; explicit retry does not')
})


test('HTTP 401 uses workspace recovery, whereas ordinary 403 does not affect authentication', async () => {
  for (const status of [401, 403]) {
    const h = harness(); const p = h.request({ url: '/api/projects/open-local' })
    await h.reply({ message: 'Rejected' }, status)
    await assert.rejects(p, e => e.status === status)
    assert.deepEqual(h.calls, status === 401 ? ['workspace-recovery'] : [])
  }
})
test('a new local session installed while an old request is pending cannot be cleared or retried', async () => {
  const h = harness({ session: 'synthetic-old-session' }); const p = h.request({ url: '/api/projects/open-local' })
  h.changeSession('synthetic-new-session'); await h.reply({ code: 4010 }); await assert.rejects(p)
  assert.deepEqual(h.calls, [])
})
test('an external service session rejection cannot clear or retry the local session', async () => {
  const h = harness({ session: 'synthetic-session' }); const p = h.request({ url: 'https://synthetic.invalid/api/test' })
  await h.reply({ code: 4010 }); await assert.rejects(p)
  assert.deepEqual(h.calls, [])
})


test('an anonymous request cannot prompt recovery after a new local identity signs in', async () => {
  const h = harness(); const p = h.request({ url: '/api/projects/open-local' })
  h.changeSession('synthetic-new-session'); await h.reply({ code: 4010 }); await assert.rejects(p)
  assert.deepEqual(h.calls, [])
})


test('session is rechecked after loading the recovery UI and after confirming retry', async () => {
  const h = harness(); const p = h.request({ url: '/api/projects/open-local' })
  const responding = h.reply({ code: 4010 })
  h.changeSession('signed-in-during-import')
  await responding; await assert.rejects(p)
  assert.deepEqual(h.calls, [])

  let confirm
  const duringDialog = harness({ recover: () => new Promise(resolve => { confirm = resolve }) })
  const op = duringDialog.request({ url: '/api/projects/open-local' })
  const response = duringDialog.reply({ code: 4010 })
  await new Promise(resolve => setTimeout(resolve, 0))
  duringDialog.changeSession('signed-in-during-dialog')
  confirm(true)
  await response; await assert.rejects(op)
  assert.deepEqual(duringDialog.calls, ['workspace-recovery'])
})
