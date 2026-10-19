// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRestartRecovery, claimRestartStartup } from '../../src/pages/project-overview/restartRecovery.js'

const task = { conversationId: 'original-chat', projectId: 7, activeFileId: 21, activeFileName: 'original.docx' }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const turn = () => new Promise(resolve => setImmediate(resolve))
function setup(overrides = {}) {
  const calls = []
  let account = 1
  const executor = {}
  const vm = {
    projectId: 7, projectInfoLoaded: true, restartPendingTasks: [task], $refs: {},
    currentConversationId: null, currentActiveTab: null, _libreRefs: {}, libreOfficeExecutor: null,
    showAiPanel: false,
    toggleAiPanel() { this.showAiPanel = true; calls.push('panel') },
    async loadHistoryChat(chat) { calls.push('history'); this.currentConversationId = chat.conversationId; return true },
    openFile(file) { calls.push('open'); this.currentActiveTab = file },
    openWelcomeTab() { calls.push('welcome'); this.currentActiveTab = null },
    isEditorOpenableFile() { return true },
    resolveLibreExecutorFileId(ex) { return ex === executor ? 21 : 99 },
    libreLoadFailureOf() { return null },
    getLibreExecutorMap() { return { 'left:21': executor } },
  }
  const deps = {
    pending: async () => [task], fileDetail: async () => ({ id: 21, projectId: 7, name: 'original.docx' }),
    identity: () => account, nextTick: async () => {}, autoEligible: true,
    navigate: async (url, live) => { if (live()) calls.push(url); return live() },
    chatTimeoutMs: 100, editorTimeoutMs: 100,
    ...overrides,
  }
  const recovery = createRestartRecovery(vm, deps)
  const mount = (resume = async (id, live) => { if (live()) calls.push(['resume', id]); return live() }) => {
    vm.$refs.chatInterface = { resumeAfterRestart: resume }
    recovery.notify()
  }
  const ready = (patch = {}) => {
    vm.libreOfficeExecutor = executor
    vm._libreRefs['left:21'] = { file: { id: 21 }, ready: true, ...patch }
    recovery.notify()
  }
  return { vm, calls, deps, recovery, mount, ready, account: () => { account++ } }
}

test('startup claims only one default desktop landing; explicit navigation wins', () => {
  assert.equal(claimRestartStartup({}, false), false)
  assert.equal(claimRestartStartup({ openFileId: 21 }, true), false)
  assert.equal(claimRestartStartup({ id: 7, conversationId: 'chosen' }, true), false)
  assert.equal(claimRestartStartup({}, true), true)
  assert.equal(claimRestartStartup({}, true), false)
  assert.equal(claimRestartStartup({ id: 7, restartConversation: 'original-chat' }, true), true)
  assert.equal(claimRestartStartup({ id: 7, restartConversation: 'original-chat', openFileId: 99 }, true), false)
})

test('default landing enters the original project and preserves all pending tasks', async () => {
  const other = { ...task, conversationId: 'other', projectId: 8 }
  const s = setup({ pending: async () => [task, other] })
  s.vm.projectId = null
  assert.equal(await s.recovery.start(), true)
  assert.deepEqual(s.calls, ['/pages/project-overview/project-overview?id=7&restartConversation=original-chat'])
  assert.equal(s.vm.restartPendingTasks.length, 2)
})

test('no resume before mounted chat, history, original file and matching editor readiness', async () => {
  const s = setup()
  const promise = s.recovery.start({ restartConversation: 'original-chat' })
  await turn()
  assert.deepEqual(s.calls, ['panel'])
  s.mount()
  await turn()
  assert.deepEqual(s.calls, ['panel', 'history', 'open'])
  s.vm.libreOfficeExecutor = {} // a different document becomes ready first
  s.recovery.notify()
  assert.equal(s.calls.some(Array.isArray), false)
  s.ready()
  assert.equal(await promise, true)
  assert.deepEqual(s.calls.at(-1), ['resume', 21])
  assert.deepEqual(s.vm.restartPendingTasks, [])
})

test('user navigation while pending lookup is in flight prevents startup takeover', async () => {
  const lookup = deferred()
  const s = setup({ pending: () => lookup.promise })
  s.vm.projectId = null
  const promise = s.recovery.start()
  s.recovery.cancel()
  lookup.resolve([task])
  assert.equal(await promise, false)
  assert.deepEqual(s.calls, [])
  assert.equal(s.vm.restartPendingTasks.length, 1)
})

test('cancel during document load preserves task and cannot be revived by late ready', async () => {
  const s = setup(); s.mount()
  const promise = s.recovery.recover(task)
  await turn()
  s.recovery.cancel()
  s.ready()
  assert.equal(await promise, false)
  assert.equal(s.calls.some(Array.isArray), false)
  assert.equal(s.vm.restartPendingTasks.length, 1)
})

test('missing, deleted, cross-project and unauthorized files never reach resume', async () => {
  for (const fileDetail of [async () => null, async () => ({ id: 21, isDeleted: true }),
    async () => ({ id: 21, projectId: 8 }), async () => { throw new Error('403') }]) {
    const s = setup({ fileDetail }); s.mount()
    assert.equal(await s.recovery.recover(task), false)
    assert.equal(s.vm.restartRecoveryFailed, true)
    assert.equal(s.calls.includes('open'), false)
    assert.equal(s.calls.some(Array.isArray), false)
  }
})

test('failed editor readiness is not treated as a writable blank document', async () => {
  const s = setup(); s.mount()
  const promise = s.recovery.recover(task)
  await turn()
  s.ready({ docLoadFailed: true })
  assert.equal(await promise, false)
  assert.equal(s.vm.restartRecoveryFailed, true)
  assert.equal(s.calls.some(Array.isArray), false)
})

test('conversation switch while history loads prevents opening the previous file', async () => {
  const history = deferred(); const s = setup(); s.mount()
  s.vm.loadHistoryChat = async () => { s.vm.currentConversationId = task.conversationId; return history.promise }
  const promise = s.recovery.recover(task)
  await turn()
  s.vm.currentConversationId = 'user-selected'
  history.resolve(true)
  assert.equal(await promise, false)
  assert.equal(s.calls.includes('open'), false)
})

test('account changes and disposal invalidate delayed recovery', async () => {
  for (const change of [s => s.account(), s => s.recovery.dispose()]) {
    const file = deferred(); const s = setup({ fileDetail: () => file.promise }); s.mount()
    const promise = s.recovery.recover(task)
    await turn(); change(s)
    file.resolve({ id: 21 })
    assert.equal(await promise, false)
    assert.equal(s.calls.includes('open'), false)
  }
})

test('no-document task clears both active panes instead of borrowing another document', async () => {
  const s = setup(); s.mount()
  s.vm.activeFileIdLeft = 99; s.vm.activeFileIdRight = 100
  s.vm.currentActiveTab = { id: 99 }
  assert.equal(await s.recovery.recover({ ...task, activeFileId: null }), true)
  assert.equal(s.vm.activeFileIdLeft, null)
  assert.equal(s.vm.activeFileIdRight, null)
  assert.equal(s.vm.currentActiveTab, null)
  assert.deepEqual(s.calls.at(-1), ['resume', null])
})

test('cancel during final asynchronous resume invalidates its continuation token', async () => {
  const gate = deferred(); const s = setup()
  s.mount(async (id, live) => { await gate.promise; if (live()) s.calls.push(['resume', id]); return live() })
  const promise = s.recovery.recover({ ...task, activeFileId: null })
  await turn(); s.recovery.cancel(); gate.resolve()
  assert.equal(await promise, false)
  assert.equal(s.calls.some(Array.isArray), false)
  assert.equal(s.vm.restartPendingTasks.length, 1)
})

test('multiple tasks do not switch document after the first resume', async () => {
  const s = setup({ pending: async () => [task, { ...task, conversationId: 'second' }] }); s.mount()
  const promise = s.recovery.start()
  await turn(); s.ready()
  assert.equal(await promise, true)
  assert.deepEqual(s.vm.restartPendingTasks.map(t => t.conversationId), ['second'])
  assert.equal(s.calls.filter(Array.isArray).length, 1)
})

test('page connects startup after snapshots/project load and real component/editor events', () => {
  const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  assert.match(source, /Promise\.resolve\(this\._restartProjectReady\)\.then\(\(\) => this\._restartRecovery\?\.start/)
  assert.match(source, /:onVnodeMounted="notifyRestartRecovery"/)
  assert.match(source, /librePoolMethods\.onLibreReady\.call\(this, executor, pane, fileId\)\s+this\.notifyRestartRecovery/)
  assert.match(source, /if \(!options\.restartRecovery\) this\.cancelRestartRecovery/)
  assert.match(source, /if \(!canNavigate\(\)\) return false/)
})

test('authentication failure does not navigate or trust previous pending data', async () => {
  const s = setup({ pending: async () => { throw new Error('401') } })
  assert.equal(await s.recovery.start(), false)
  assert.deepEqual(s.calls, [])
  assert.deepEqual(s.vm.restartPendingTasks, [])
})

test('chat mount deadline is a visible failure and never simulates readiness', async () => {
  const s = setup({ chatTimeoutMs: 1 })
  assert.equal(await s.recovery.recover(task), false)
  assert.equal(s.vm.restartRecoveryFailed, true)
  assert.equal(s.calls.includes('history'), false)
  assert.equal(s.vm.restartPendingTasks.length, 1)
})

test('navigation intent during pre-navigation save prevents relaunch', async () => {
  const save = deferred(); const navigations = []
  const s = setup({ navigate: async (url, canNavigate) => {
    await save.promise
    if (!canNavigate()) return false
    navigations.push(url); return true
  } })
  s.vm.projectId = null
  const promise = s.recovery.recover(task)
  s.recovery.cancel(); save.resolve()
  assert.equal(await promise, false)
  assert.deepEqual(navigations, [])
})


test('Office restoration fails closed when its editor engine is unavailable', async () => {
  const s = setup({ editorTimeoutMs: 1 }); s.mount()
  s.vm.useLibreEditor = () => false
  assert.equal(await s.recovery.recover(task), false)
  assert.equal(s.vm.restartRecoveryFailed, true)
  assert.equal(s.calls.some(Array.isArray), false)
})
