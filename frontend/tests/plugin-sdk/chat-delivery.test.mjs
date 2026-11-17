// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from 'vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'

const script = path => parseSfc(readFileSync(new URL(path, import.meta.url), 'utf8')).descriptor.script.content
const pluginSource = script('../../src/components/PluginPane.vue')
const plugin = new Function(pluginSource.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return'))()
function host(sendChatPrompt, projectId = 7) {
  return {
    ...plugin.data(), projectId, businessActions: sendChatPrompt ? { sendChatPrompt } : {},
    $t: key => key, $emit() {}, staleContext: () => ({ ok: false, error: { code: 'stale_context' } }),
  }
}
const send = vm => plugin.methods.handleCall.call(vm, 'chat.send', { prompt: 'Prepare a synthetic briefing' })

test('chat.send reports no_project before emitting or submitting outside a project', async () => {
  let calls = 0
  const result = await send(host(() => { calls++; return 'conversation' }, null))
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'no_project')
  assert.equal(result.error.message, 'welcome.aiNeedsProject')
  assert.equal(calls, 0)
})

test('chat.send rejects missing, busy and rejected receivers instead of claiming success', async () => {
  assert.equal((await send(host())).error.code, 'unavailable')
  for (const receiver of [async () => null, async () => false, async () => undefined,
    async () => { throw new Error('synthetic failure') }]) {
    assert.equal((await send(host(receiver))).error.code, 'send_failed')
  }
})

test('chat.send awaits the receiver and acknowledges one accepted message', async () => {
  let finish, request
  const pending = new Promise(resolve => { finish = resolve })
  const vm = host(payload => { request = payload; return pending })
  let settled = false
  const result = send(vm).then(value => { settled = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(request.prompt, 'Prepare a synthetic briefing')
  assert.equal(request.projectId, 7)
  assert.equal(request.isCurrent(), true)
  finish('conversation-1')
  assert.deepEqual(await result, { ok: true, result: {} })
  vm.sessionGeneration++
  assert.equal(request.isCurrent(), false)
})

const chatSource = script('../../src/components/ChatInterface.vue')
const chatOptions = parseJs(chatSource, { sourceType: 'module' }).program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration
const setup = chatOptions.properties.find(node => node.key?.name === 'setup')
const external = setup.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : []).find(node => node.id?.name === 'sendExternalPrompt').init
function chat(sendMessage, streaming = false) {
  const conversation = { value: 'existing-conversation' }
  const factory = new Function('isStreaming', 'uni', 't', 'activeDocChip', 'props', 'sendMessage', 'currentModelId', 'currentSkillIds', 'scrollToBottom', 'currentConversationId', `return (${chatSource.slice(external.start, external.end)})`)
  return { conversation, send: factory({ value: streaming }, { showToast() {} }, key => key, { value: null }, { projectId: 7 }, sendMessage, { value: 'test-model' }, () => [], () => {}, conversation) }
}

test('external prompt returns no conversation for a rejected submission or busy chat', async () => {
  for (const receipt of [null, undefined, { status: 'rejected' }, { status: 'accepted' }]) {
    assert.equal(await chat(async () => receipt).send('Synthetic prompt'), null)
  }
  let called = false
  assert.equal(await chat(() => { called = true }, true).send('Synthetic prompt'), null)
  assert.equal(called, false)
})

test('external prompt returns the submitted conversation, not one selected while awaiting acceptance', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const vm = chat(() => pending)
  const result = vm.send('Synthetic prompt')
  vm.conversation.value = 'newly-selected-conversation'
  finish({ status: 'accepted', messageId: 'message-1' })
  assert.equal(await result, 'existing-conversation')
})

const workbenchSource = script('../../src/pages/project-overview/project-overview.vue')
const workbenchOptions = parseJs(workbenchSource, { sourceType: 'module' }).program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration
const methods = workbenchOptions.properties.find(node => node.key?.name === 'methods').value
const computed = workbenchOptions.properties.find(node => node.key?.name === 'computed').value
const members = [
  ...methods.properties.filter(node => node.key?.name === 'onPluginChatPrompt'),
  ...computed.properties.filter(node => node.key?.name === 'pluginBusinessActions'),
]
const workbench = new Function(`return ({${members.map(node => workbenchSource.slice(node.start, node.end)).join(',\n')}})`)()

test('the real bridge, workbench action and chat receiver agree on acceptance', async () => {
  for (const receipt of [null, { status: 'accepted', messageId: 'message-1' }]) {
    const receiver = chat(async () => receipt)
    const vm = {
      ...workbench, projectId: 7, isActiveOverviewInstance: () => true,
      resolveChatInterface: async () => ({ sendExternalPrompt: receiver.send }),
    }
    const pane = host()
    pane.businessActions = vm.pluginBusinessActions()
    const result = await send(pane)
    assert.equal(result.ok, !!receipt)
    if (!receipt) assert.equal(result.error.code, 'send_failed')
  }
})

test('an invalidated plugin cannot submit after the chat panel becomes ready', async () => {
  let ready, submitted = false
  const waiting = new Promise(resolve => { ready = resolve })
  const vm = {
    ...workbench, projectId: 7, isActiveOverviewInstance: () => true,
    resolveChatInterface: () => waiting,
  }
  const pane = host()
  pane.businessActions = vm.pluginBusinessActions()
  const result = send(pane)
  pane.sessionGeneration++
  ready({ sendExternalPrompt: async () => { submitted = true; return 'conversation' } })
  assert.equal((await result).error.code, 'stale_context')
  assert.equal(submitted, false)
})
