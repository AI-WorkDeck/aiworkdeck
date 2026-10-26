// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createVersionExitGuard } from '../../src/utils/versionExitGuard.js'
import { versionEntryState } from '../../src/utils/versionEntryState.js'
import zh from '../../src/locales/zh-CN/version.js'
import { flushDirtyEditors } from '../../src/pages/project-overview/flushDirtyEditors.js'

const t = (key, params = {}) => (zh[key.replace('version.', '')] || key).replace(/\{(\w+)\}/g, (_, k) => params[k])
const state = (overrides = {}) => ({ enabled: true, working: true, changedCount: 3, ...overrides })
const entry = (status, rest = {}) => versionEntryState(t, { status, ...rest })
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const parent = read('../../src/pages/project-overview/project-overview.vue')
function parentMethod(name, dependencies = {}) {
  const start = parent.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
  assert.ok(start > 0, name)
  const end = parent.indexOf('\n    },', start)
  return vm.runInNewContext(`({${parent.slice(start, end + 7).trim().replace(/,$/, '')}}).${name}`,
    { console: { warn() {} }, ...dependencies })
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('数字只计待提交文件；自动记录、结束工作及关闭记录各自更新', () => {
  assert.equal(entry(state()).badge, '3')
  assert.match(entry(state()).title, /3 个文件待提交/)
  assert.equal(entry(state({ changedCount: 140 })).badge, '99+')
  const recorded = entry(state({ changedCount: 0 }))
  assert.equal(recorded.badge, '·')
  assert.match(recorded.title, /已自动记录/)
  assert.equal(entry(state({ changedCount: 0, working: false })).badge, '')
  assert.equal(entry(state({ enabled: false })).badge, '')
  assert.equal(entry(state({ changedCount: 0, onDraft: { id: 4 } })).badge, '', '主线工作段不是当前稿的待提交状态')
})

test('云端版本数不加到文件角标；上传、取回及断网另有标识和说明', () => {
  const status = state({ working: false, changedCount: 0 })
  assert.equal(entry(status, { cloud: { linked: true, pendingUpload: true } }).badge, '↑')
  assert.equal(entry(status, { cloud: { linked: true, remoteAhead: true, remoteAheadCount: 18 } }).badge, '↓')
  assert.equal(entry(status, { cloud: { linked: true, remoteAhead: true, pendingUpload: true } }).badge, '↕')
  const mixed = entry(state(), { cloud: { linked: true, pendingUpload: true } })
  assert.equal(mixed.badge, '3')
  assert.match(mixed.title, /待上传/)
  assert.equal(entry(status, { cloud: { linked: false, pendingUpload: true } }).badge, '')
  assert.equal(entry(status, { cloud: { linked: true, offline: true } }).attention, true)
  assert.equal(entry(status, { unavailable: true }).badge, '!')
  assert.equal(entry(status, { conflict: true }).badge, '!')
  assert.doesNotMatch(entry(status, { cloud: null }).title, /已同步|稿一致/)
})

test('点击角标清除单文件过滤并展开项目面板，已打开时不误收起', () => {
  const open = parentMethod('openProjectVersionPanel')
  for (const [pane, collapsed, toggles] of [['files', false, 1], ['version', true, 1], ['version', false, 0]]) {
    const calls = []
    const host = { leftPaneKey: pane, sidebarCollapsed: collapsed, versionFileFilter: { fileId: 5 },
      toggleLeftPane(key) { calls.push(key) }, checkAdoptConflict() { calls.push('refresh') } }
    open.call(host)
    assert.equal(host.versionFileFilter, null)
    assert.equal(calls.filter(x => x === 'version').length, toggles)
  }
})

test('全局状态拒绝迟到响应、跨项目响应和销毁后的响应', async () => {
  for (const change of ['newer', 'project', 'disposed']) {
    const old = deferred()
    let call = 0
    const refresh = parentMethod('checkAdoptConflict', { getVersionStatus: () => ++call === 1 ? old.promise : Promise.resolve({ data: state({ changedCount: 1 }) }) })
    const host = { projectId: 8, projectInfoLoaded: true, hasNamedProject: true, versionWorkStatus: state() }
    const pending = refresh.call(host)
    if (change === 'newer') await refresh.call(host)
    if (change === 'project') host.projectId = 9
    if (change === 'disposed') host._versionStatusDisposed = true
    old.resolve({ data: state({ changedCount: 77 }) })
    await pending
    assert.equal(host.versionWorkStatus.changedCount, change === 'newer' ? 1 : 3)
  }
})

test('保存后的刷新会更新角标；失败保留已知数但标未知；无项目与客户不查询', async () => {
  let fail = false, calls = 0
  const refresh = parentMethod('checkAdoptConflict', { getVersionStatus: async () => {
    calls++; if (fail) throw new Error('offline'); return { data: state({ changedCount: 4 }) }
  } })
  const host = { projectId: 8, projectInfoLoaded: true, hasNamedProject: true, versionWorkStatus: state() }
  await refresh.call(host)
  assert.equal(host.versionWorkStatus.changedCount, 4)
  assert.equal(host.versionStatusError, false)
  fail = true
  await refresh.call(host)
  assert.equal(host.versionWorkStatus.changedCount, 4)
  assert.equal(host.versionStatusError, true)
  for (const patch of [{ isClientView: true }, { hasNamedProject: false }, { _versionStatusDisposed: true }]) await refresh.call({ ...host, ...patch })
  assert.equal(calls, 2)
})

test('提交前保存全部打开的编辑器，未保存成功时阻止提交', async () => {
  const prepare = parentMethod('prepareVersionCommit', { flushDirtyEditors, uni: { showToast() {} } })
  const editor = { file: { id: 4 }, ready: true, dirty: true, async flushSave() { return false } }
  const host = { _libreRefs: { a: editor }, _plainTextRefs: {}, $t: t }
  assert.equal(await prepare.call(host), false)
  editor.flushSave = async () => { editor.dirty = false; return true }
  assert.equal(await prepare.call(host), true)
})

test('提交按钮等保存完成后只提交一次；保存拒绝不关闭弹窗或发结束事件', async () => {
  const source = read('../../src/components/version/WorkSessionBar.vue').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'globalThis.component =')
  const calls = []
  const context = { endWorkSession: async () => { calls.push('commit'); return { data: {} } }, uni: { showToast() {} } }
  vm.runInNewContext(source, context)
  const save = deferred()
  const host = { naming: true, busy: false, beforeCommit: () => save.promise, $t: t, $emit: name => calls.push(name) }
  const end = context.component.methods.end
  const pending = end.call(host)
  await end.call(host)
  assert.deepEqual(calls, [])
  save.resolve(false)
  await pending
  assert.equal(host.naming, true)
  assert.equal(host.busy, false)
  assert.deepEqual(calls, [])
  host.beforeCommit = async () => true
  await end.call(host)
  assert.deepEqual(calls, ['commit', 'ended'])
  assert.equal(host.naming, false)
})


test('项目退出进度阻止底层键盘输入并持有原生浮层，失败与成功都释放', async () => {
  for (const fail of [false, true]) {
    const receipt = deferred(), overlays = new Set(), listeners = new Set(), stages = []
    let committed = false, enteredCommit = false
    const confirm = parentMethod('confirmVersionBeforeLeaving', {
      createVersionExitGuard,
      getVersionStatus: async () => ({ data: state({ working: !committed, changedCount: committed ? 0 : 2 }) }),
      showSheet: async () => ({ tapIndex: 0 }),
      endWorkSession: async () => { enteredCommit = true; await receipt.promise; if (fail) throw new Error('offline'); committed = true; return { data: {} } },
      setGlobalOverlay: (active, key) => active ? overlays.add(key) : overlays.delete(key),
      window: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
      uni: { showLoading: ({ title }) => stages.push(title), hideLoading() {}, showToast() {} },
    })
    const host = { projectId: 8, project: { name: '示例' }, hasNamedProject: true, $t: t, collabRefreshToken: 0,
      prepareVersionCommit: async () => true, onVersionPanelStatusChanged: async () => {} }
    const pending = confirm.call(host)
    while (!enteredCommit) await Promise.resolve()
    assert.equal(overlays.size, 1)
    assert.equal(listeners.size, 1)
    let blocked = false
    listeners.values().next().value({ preventDefault() { blocked = true }, stopImmediatePropagation() {} })
    assert.equal(blocked, true)
    assert.ok(stages.some(s => s.includes('2/3')))
    receipt.resolve()
    assert.equal(await pending, !fail)
    assert.equal(overlays.size, 0)
    assert.equal(listeners.size, 0)
    assert.equal(host._versionExitPromise, null)
  }
})
