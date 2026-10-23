// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
function harness() {
  const events = new Map(), posted = []
  const uni = { $on(name, callback) { events.set(name, callback) }, $off(name) { events.delete(name) } }
  const window = { addEventListener() {}, removeEventListener() {} }
  const options = new Function('uni', 'window', 'host', 'APP_THEME_EVENT', 'ACCOUNT_CHANGED_EVENT', 'subscribeTaskChanges', 'endPluginImDrag', body)(uni, window, {}, 'theme', 'account', () => () => {}, () => {})
  const instance = { ...options.data(), projectId: 7, pluginId: 'litigation-visual', permissions: ['file_read'], isWebPlugin: true, $refs: { pluginFrame: { contentWindow: { postMessage: value => posted.push(value) } } } }
  for (const [key, fn] of Object.entries(options.methods)) instance[key] = fn.bind(instance)
  instance.initializeAuthorization = () => {}
  instance.verifyAuthorization = async () => true
  options.created.call(instance); options.mounted.call(instance)
  return { instance, events, posted, destroy: () => options.beforeUnmount.call(instance) }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 550))
test('drawio saves refresh the subscribed gallery only for this project; unmount removes listener', async t => {
  const h = harness(); t.after(h.destroy)
  await h.instance.handleCall('events.subscribe', { events: ['files.changed'] })
  h.events.get('awd:litviz-restyled')?.({ projectId: 7, folderId: 12, kind: 'save' })
  await flush()
  assert.deepEqual(h.posted, [{ awd: 1, type: 'event', event: 'files.changed', data: {} }])
  h.posted.length = 0
  h.events.get('awd:litviz-restyled')?.({ projectId: 8, kind: 'save' })
  h.events.get('awd:litviz-restyled')?.({ projectId: 7, failed: true })
  await flush(); assert.equal(h.posted.length, 0)
  h.destroy(); assert.equal(h.events.has('awd:litviz-restyled'), false)
})
test('first sidebar command waits for iframe subscription and is delivered once', async t => {
  const h = harness(); t.after(h.destroy)
  const command = { pluginId: 'litigation-visual', command: 'focus', id: 12 }
  h.events.get('awd:plugin-sidebar-command')(command)
  assert.equal(h.posted.length, 0)
  await h.instance.handleCall('events.subscribe', { events: ['sidebar.command'] })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(h.posted.map(message => message.data), [command])
  await h.instance.handleCall('events.subscribe', { events: ['sidebar.command'] })
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(h.posted.length, 1)
})
test('queued file events do not escape revoked or replaced frames', async t => {
  const h = harness(); t.after(h.destroy)
  await h.instance.handleCall('events.subscribe', { events: ['files.changed'] })
  h.events.get('awd:litviz-restyled')?.({ projectId: 7, kind: 'save' })
  h.instance.verifyAuthorization = async () => false
  await flush(); assert.equal(h.posted.length, 0)
})
test('host recording stop reaches speech subscribers without meeting data and is removed on unmount', async t => {
  const h = harness(); t.after(h.destroy)
  const source = h.events.get('awd:meeting-recording-stopped')
  await h.instance.handleCall('events.subscribe', { events: ['speech.stopped'] })
  source?.({ id: 9, title: 'private meeting' })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.posted.length, 0)
  h.instance.permissions.push('speech')
  await h.instance.handleCall('events.subscribe', { events: ['speech.stopped'] })
  source?.({ id: 9, title: 'private meeting' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(h.posted, [{ awd: 1, type: 'event', event: 'speech.stopped', data: {} }])
  h.destroy(); assert.equal(h.events.has('awd:meeting-recording-stopped'), false)
})
