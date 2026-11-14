// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createI18n } from 'vue-i18n'
import zh from '../../src/locales/zh-CN/ddWorkflow.js'

const t = createI18n({ legacy: true, locale: 'zh-CN', messages: { 'zh-CN': { ddWorkflow: zh } } }).global.t
const source = readFileSync(new URL('../../src/components/dd/ClientPortalChat.vue', import.meta.url), 'utf8')

function fixture(chat) {
  const body = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^import .*$/gm, '').replace('export default', 'return')
  const options = new Function('portalChat', body)(chat)
  const vm = { ...options.data(), $t: t, $refs: {}, $nextTick: fn => fn(), connectionId: 'portal-1', projectId: 42 }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  vm.mount = () => options.mounted.call(vm)
  vm.unmount = () => options.beforeUnmount.call(vm)
  return vm
}
const refusal = (message, status = 200) => Object.assign(new Error(message), { status })

function server(overrides = {}) {
  const calls = []
  const rows = [{ id: 5, senderId: 1, senderName: '合成律师', text: '你好', createdAt: '2026-11-13T08:00:00Z' }]
  const chat = async (connectionId, action, params = {}) => {
    calls.push({ connectionId, action, params })
    if (overrides[action]) return overrides[action](params)
    if (action === 'self') return { id: 9 }
    if (action === 'projectGroup') return { id: 'group-1', title: '合成项目 · 项目群' }
    if (action === 'messages') return params.afterId ? { messages: [] } : { messages: rows, hasMore: false }
    if (action === 'send') return { id: 6, senderId: 9, text: params.text }
    return {}
  }
  return { chat, calls }
}

test('opens only the project group of the code, then polls with afterId', async () => {
  const s = server(); const vm = fixture(s.chat)
  await vm.mount(); vm.unmount()
  assert.deepEqual(s.calls.find(c => c.action === 'projectGroup').params, { projectId: 42 })
  assert.equal(vm.conversationId, 'group-1')
  assert.deepEqual(vm.messages.map(m => m.id), [5])
  await vm.poll()
  assert.deepEqual(s.calls.at(-1).params, { conversationId: 'group-1', afterId: 5, limit: 50 })
  assert.ok(s.calls.every(c => c.connectionId === 'portal-1'))
})

test('sends with a fresh clientMessageId and shows the message once', async () => {
  const s = server(); const vm = fixture(s.chat)
  await vm.mount(); vm.unmount()
  vm.draft = '  请问进度  '
  await vm.send()
  const sent = s.calls.find(c => c.action === 'send').params
  assert.equal(sent.text, '请问进度'); assert.equal(sent.conversationId, 'group-1'); assert.match(sent.clientMessageId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(vm.messages.map(m => m.id), [5, 6]); assert.equal(vm.draft, '')
})

test('an expired or revoked code stops chat; 429, 5xx and network failures keep polling', async () => {
  const s = server(); const vm = fixture(s.chat)
  await vm.mount(); vm.unmount()
  vm.stop(refusal('发送太快，请 5 秒后再发', 429))
  assert.equal(vm.stopped, false); assert.match(vm.error, /发送太快/)
  vm.stop(refusal('网关错误', 502)); assert.equal(vm.stopped, false)
  vm.stop(new Error('Failed to fetch')); assert.equal(vm.stopped, false)
  vm.stop(refusal('访问码已失效或已过期，请联系律师'))
  assert.equal(vm.stopped, true); assert.match(vm.error, /访问码已失效/)
  const before = s.calls.length
  await vm.poll(); vm.draft = 'x'; await vm.send()
  assert.equal(s.calls.length, before, 'nothing more is sent once the server refused the code')
})

test('a refusal on open leaves the composer disabled with the reason', async () => {
  const s = server({ projectGroup: () => { throw refusal('访问码已失效或已过期，请联系律师') } })
  const vm = fixture(s.chat)
  await vm.mount()
  assert.equal(vm.stopped, true); assert.equal(vm.conversationId, ''); assert.equal(vm.loading, false)
  assert.match(vm.error, /访问码已失效/)
})

test('files over 8 MB are refused before any upload', async () => {
  const s = server(); const vm = fixture(s.chat)
  await vm.mount(); vm.unmount()
  await vm.upload({ size: 8 * 1024 * 1024 + 1, name: 'big.pdf' })
  assert.equal(vm.error, t('ddWorkflow.client.chat.fileTooLarge'))
  assert.equal(s.calls.some(c => c.action === 'upload'), false)
})
