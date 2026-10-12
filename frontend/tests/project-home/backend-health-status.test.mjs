// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/BackendHealthStatus.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default {', 'return {')
function makeVm(backend) {
  const options = new Function('host', body)({ backend })
  const vm = { ...options.data(), $t: key => key }
  for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
  for (const [name, get] of Object.entries(options.computed)) Object.defineProperty(vm, name, { get: () => get.call(vm) })
  return { vm, mount: () => options.mounted.call(vm), destroy: () => options.beforeUnmount.call(vm) }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const health = (state, extra = {}) => ({ state, ok: state === 'healthy', owned: true, updatedAt: 100, ...extra })

test('旧壳无 health API：不伪装离线，不订阅或重启', async () => {
  const { vm, mount, destroy } = makeVm({ restart: () => assert.fail('must not restart') })
  await mount()
  assert.equal(vm.supported, false)
  await vm.restart()
  destroy()
})

test('先到事件优先于迟到 getHealth，销毁后所有回调无效并取消订阅', async () => {
  const gate = deferred(); let handler, disposed = 0
  const { vm, mount, destroy } = makeVm({ getHealth: () => gate.promise, onHealthChanged: fn => { handler = fn; return () => disposed++ } })
  const pending = mount()
  handler(health('restarting', { updatedAt: 200 }))
  gate.resolve(health('healthy'))
  await pending
  assert.equal(vm.health.state, 'restarting')
  destroy()
  handler(health('healthy', { updatedAt: 300 }))
  assert.equal(vm.health.state, 'restarting')
  assert.equal(disposed, 1)
})

test('恢复只改变健康提示，不发保存/重载；手动重启仅限 owned failed 且防重复', async () => {
  const gate = deferred(); let handler, calls = 0
  const { vm, mount, destroy } = makeVm({ getHealth: async () => health('failed'), onHealthChanged: fn => { handler = fn; return () => {} }, restart: () => { calls++; return gate.promise } })
  await mount()
  assert.equal(vm.canRestart, true)
  const pending = vm.restart()
  await vm.restart()
  assert.equal(calls, 1)
  assert.equal(vm.restartPending, true)
  handler(health('restarting', { updatedAt: 200 }))
  gate.resolve({ ok: true }); await pending
  assert.equal(vm.health.state, 'restarting', 'RPC成功不伪装服务已恢复')
  handler(health('healthy', { updatedAt: 300 }))
  assert.equal(vm.recovered, true)
  assert.equal(vm.message, 'workbench.backendHealth.recovered')
  handler(health('failed', { owned: false, updatedAt: 400 }))
  assert.equal(vm.canRestart, false)
  await vm.restart(); assert.equal(calls, 1)
  destroy()
})

test('读取失败不捏造健康状态，重启失败显示可操作反馈，旧事件不能倒退新快照', async () => {
  let handler
  const { vm, mount, destroy } = makeVm({ getHealth: async () => { throw new Error('ipc') }, onHealthChanged: fn => { handler = fn; return () => {} }, restart: async () => { throw new Error('denied') } })
  await mount()
  assert.equal(vm.message, 'workbench.backendHealth.unavailable')
  handler(health('failed', { updatedAt: 300 }))
  await vm.restart()
  assert.equal(vm.restartFailed, true)
  assert.equal(vm.restartPending, false)
  handler(health('healthy', { updatedAt: 200 }))
  assert.equal(vm.health.state, 'failed')
  destroy()
})

test('销毁时初始读取仍在途：迟到结果不更新已卸载组件', async () => {
  const gate = deferred(); let unsubscribed = 0
  const { vm, mount, destroy } = makeVm({ getHealth: () => gate.promise, onHealthChanged: () => () => unsubscribed++ })
  const pending = mount(); destroy()
  gate.resolve(health('healthy')); await pending
  assert.equal(vm.health, null)
  assert.equal(unsubscribed, 1)
})

test('恢复提示八秒后收回，周期健康事件不能让短提示永远常驻', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { vm, mount, destroy } = makeVm({ getHealth: async () => health('failed'), onHealthChanged: () => () => {} })
  await mount(); vm.applyHealth(health('healthy', { updatedAt: 200 }))
  t.mock.timers.tick(4000)
  vm.applyHealth(health('healthy', { updatedAt: 300 }))
  t.mock.timers.tick(4000)
  assert.equal(vm.recovered, false)
  assert.equal(vm.message, 'workbench.backendHealth.healthy')
  destroy()
})

for (const [state, reason, key] of [
  ['failed', 'external-backend', 'externalUnavailable'],
  ['failed', 'startup-failed', 'startupFailed'],
  ['degraded', 'external-health-unverified', 'externalUnverified'],
]) {
  test(`非本壳服务 ${reason}：说明下一步而非泛称恢复失败，禁止重启`, async () => {
    const { vm, mount, destroy } = makeVm({ getHealth: async () => health(state, { owned: false, reason }), onHealthChanged: () => () => {}, restart: () => assert.fail('external service must not restart') })
    await mount()
    assert.equal(vm.message, 'workbench.backendHealth.' + key)
    assert.equal(vm.canRestart, false)
    await vm.restart()
    destroy()
  })
}

test('手动重启不称自动恢复，未知reason不把内部错误原文展示给用户', async () => {
  const { vm, mount, destroy } = makeVm({ getHealth: async () => health('restarting', { reason: 'manual' }), onHealthChanged: () => () => {} })
  await mount()
  assert.equal(vm.message, 'workbench.backendHealth.manualRestarting')
  vm.applyHealth(health('failed', { reason: '/private/path/internal failure', updatedAt: 200 }))
  assert.equal(vm.message, 'workbench.backendHealth.failed')
  destroy()
})
