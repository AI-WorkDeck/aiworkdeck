// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/DesktopUpdateIndicator.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
function fixture({ desktop = true, status = async () => ({ phase: 'idle' }), check, restart } = {}) {
  let event, cancel
  let unsubscribed = 0, restarts = 0, checks = 0
  const api = {
    status,
    onEvent(fn) { event = fn; return () => unsubscribed++ },
    check: async () => { checks++; return check ? check() : { phase: 'ready', available: { version: '0.69.0' } } },
    restart: async () => { restarts++; return restart ? restart() : { ok: true } },
  }
  const document = { addEventListener() {}, removeEventListener() {} }
  const component = new Function('host', 'isDesktopHost', 'document', 'setGlobalOverlay', script)({ update: api, lifecycle: { onQuitCancelled(fn) { cancel = fn; return () => unsubscribed++ } } }, () => desktop, document, () => {})
  const vm = { ...component.data(), $t: (key, params) => `${key}${params ? JSON.stringify(params) : ''}`, $el: { contains: () => false }, $refs: {} }
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  for (const [name, getter] of Object.entries(component.computed)) Object.defineProperty(vm, name, { get: getter.bind(vm) })
  component.mounted.call(vm)
  return { vm, emit(state) { event({ state }) }, cancel() { cancel() }, unmount() { component.beforeUnmount.call(vm) }, counts: () => ({ unsubscribed, restarts, checks }) }
}

test('background updates stay visible through checking, download, preparation and ready; only ready restarts', async () => {
  const f = fixture()
  await Promise.resolve()
  assert.equal(f.vm.visible, false)
  f.emit({ phase: 'checking' })
  assert.equal(f.vm.visible, true)
  assert.equal(f.vm.percent, null)
  await f.vm.activate()
  assert.equal(f.vm.expanded, true)
  assert.equal(f.counts().restarts, 0)
  f.emit({ phase: 'downloading', progress: { received: 47, total: 100 } })
  assert.equal(f.vm.percent, 47)
  assert.equal(f.vm.label, '47%')
  f.emit({ phase: 'preparing', progress: null })
  assert.equal(f.vm.visible, true)
  assert.equal(f.vm.ready, false)
  assert.equal(f.vm.percent, null)
  assert.equal(f.vm.statusLabel, 'shell.updatePreparing')
  f.emit({ phase: 'ready', available: { version: '0.69.0' } })
  assert.equal(f.vm.ready, true)
  await f.vm.activate()
  await f.vm.activate()
  assert.equal(f.counts().restarts, 1, 'prevent duplicate quit requests')
  f.cancel()
  assert.equal(f.vm.restarting, false, 'cancelled save/quit must allow retry')
  await f.vm.activate()
  assert.equal(f.counts().restarts, 2)
})

test('unknown or invalid sizes never invent a percentage', () => {
  const f = fixture()
  for (const total of [0, undefined, NaN, Infinity, -1]) {
    f.emit({ phase: 'downloading', progress: { received: 10, total } })
    assert.equal(f.vm.percent, null)
  }
  f.emit({ phase: 'downloading', progress: { received: 120, total: 100 } })
  assert.equal(f.vm.percent, 100)
  assert.equal(f.vm.ready, false)
})

test('slow initial snapshot cannot roll back a newer download event', async () => {
  let resolve
  const f = fixture({ status: () => new Promise(r => { resolve = r }) })
  f.emit({ phase: 'downloading', progress: { received: 70, total: 100 } })
  resolve({ phase: 'idle' })
  await Promise.resolve()
  assert.equal(f.vm.percent, 70)
})

test('errors remain actionable, retry does not restart until explicitly clicked', async () => {
  const f = fixture()
  f.emit({ phase: 'error', error: 'network failed' })
  assert.equal(f.vm.visible, true)
  await f.vm.activate()
  assert.equal(f.vm.expanded, true)
  assert.equal(f.vm.errorText, 'network failed')
  await f.vm.retry()
  assert.equal(f.vm.ready, true)
  assert.equal(f.counts().checks, 1)
  assert.equal(f.counts().restarts, 0)
})

test('retry IPC rejection stays visible and can be retried', async () => {
  const f = fixture({ check: async () => { throw new Error('offline') } })
  f.emit({ phase: 'error', error: 'previous failure' })
  await f.vm.retry()
  assert.equal(f.vm.busy, false)
  assert.equal(f.vm.failed, true)
  assert.equal(f.vm.errorText, 'offline')
})

test('restart failure releases busy state; unmount releases listeners and ignores late status', async () => {
  let resolve
  const f = fixture({ restart: async () => ({ ok: false, message: 'save failed' }), status: () => new Promise(r => { resolve = r }) })
  f.emit({ phase: 'ready', available: { version: '0.69.0' } })
  await f.vm.activate()
  assert.equal(f.vm.restarting, false)
  assert.equal(f.vm.errorText, 'save failed')
  assert.equal(f.vm.expanded, true)
  f.unmount()
  resolve({ phase: 'idle' })
  await Promise.resolve()
  assert.equal(f.vm.ready, true)
  assert.equal(f.counts().unsubscribed, 2)
})

test('web host does not expose desktop update control', () => {
  const f = fixture({ desktop: false })
  f.vm.update = { phase: 'error' }
  assert.equal(f.vm.visible, false)
})


test('ready snapshot on workbench remount stays silent until the user activates it', async () => {
  const f = fixture({ status: async () => ({ phase: 'ready', available: { version: '0.69.0' } }) })
  await Promise.resolve()
  assert.equal(f.vm.ready, true)
  assert.equal(f.vm.expanded, false)
  assert.equal(f.counts().restarts, 0)
})

test('keyboard activation prevents defaults and ignores auto-repeat', async () => {
  const f = fixture()
  f.emit({ phase: 'ready', available: { version: '0.69.0' } })
  let prevented = 0
  f.vm.onActionKey({ key: 'Enter', repeat: false, preventDefault() { prevented++ }, stopPropagation() {} }, 'activate')
  f.vm.onActionKey({ key: 'Enter', repeat: true, preventDefault() { prevented++ }, stopPropagation() {} }, 'activate')
  await Promise.resolve()
  assert.equal(f.counts().restarts, 1)
  assert.equal(prevented, 2)
})
