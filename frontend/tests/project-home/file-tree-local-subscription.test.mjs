// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { createRenderer, h, nextTick, reactive } = createRequire(import.meta.url)('vue')
const tree = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')

function allowed(state) {
  const method = page.match(/    canWatchLocalProjectFiles\(\) \{([\s\S]*?)\n    \},/)
  assert.ok(method, 'workbench must decide eligibility from loaded project metadata')
  return new Function(method[1]).call(state)
}

function mountTree(t, { enabled, desktop = true, projectState } = {}) {
  const calls = [], names = []
  let refreshes = 0
  const stubs = {
    ICONS: {}, host: {}, isDesktopHost: () => desktop,
    loadProjectTasks: async () => {},
    subscribeLocalProjectFileChanges: (projectId, onChange) => {
      const call = { projectId, onChange, stopped: false }
      calls.push(call)
      return () => { call.stopped = true }
    },
  }
  const script = tree.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]\s*$/gm, (_, binding) => {
      for (const name of binding.replace(/[{}]/g, '').split(',')) names.push(name.trim().split(/\s+as\s+/).at(-1))
      return ''
    }).replace('export default {', 'return {')
  const options = new Function(...names, script)(...names.map(name => stubs[name] ?? (() => {})))
  const component = { ...options, render: () => null, methods: { ...options.methods,
    loadFiles: async () => { refreshes++ }, refreshProjectTags() {}, clearChecked() {},
  } }
  const previousUni = globalThis.uni
  globalThis.uni = { $on() {}, $off() {} }
  const state = reactive(projectState || { projectId: 1, ...(enabled === undefined ? {} : { watchLocalFiles: enabled }) })
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ render: () => h(component, projectState
    ? { projectId: state.projectId, watchLocalFiles: allowed(state) } : state) })
  app.mount({})
  t.after(() => { app.unmount(); globalThis.uni = previousUni })
  return { calls, state, refreshes: () => refreshes, unmount: () => app.unmount() }
}

test('managed projects and file pickers do not subscribe by default', t => {
  const x = mountTree(t)
  assert.equal(x.calls.length, 0)
})

test('local metadata arriving after mount starts a subscription; disabling stops it', async t => {
  const x = mountTree(t, { enabled: false })
  assert.equal(x.calls.length, 0)
  x.state.watchLocalFiles = true
  await nextTick()
  assert.equal(x.calls.length, 1)
  const before = x.refreshes()
  x.calls[0].onChange()
  assert.equal(x.refreshes(), before + 1)
  x.state.watchLocalFiles = false
  await nextTick()
  assert.equal(x.calls[0].stopped, true)
  const stopped = x.refreshes()
  x.calls[0].onChange()
  assert.equal(x.refreshes(), stopped, 'queued event cannot refresh a disabled subscription')
})

test('local project switching stops the old subscription and unmount stops the new one', async t => {
  const x = mountTree(t, { enabled: true })
  assert.deepEqual(x.calls.map(c => c.projectId), [1])
  x.state.projectId = 2
  await nextTick()
  assert.deepEqual(x.calls.map(c => c.projectId), [1, 2])
  assert.equal(x.calls[0].stopped, true)
  const before = x.refreshes()
  x.calls[0].onChange()
  assert.equal(x.refreshes(), before)
  x.unmount()
  assert.equal(x.calls[1].stopped, true)
  x.calls[1].onChange()
  assert.equal(x.refreshes(), before)
})

test('web clients do not subscribe even with local metadata', t => {
  const x = mountTree(t, { enabled: true, desktop: false })
  assert.equal(x.calls.length, 0)
})

test('switching from local to managed ignores old metadata and never opens a new stream', async t => {
  const x = mountTree(t, { projectState: {
    projectId: 1, project: { id: 1, localRoot: '/synthetic/folder' }, projectInfoLoaded: true, isClientView: false,
  } })
  assert.deepEqual(x.calls.map(c => c.projectId), [1])
  x.state.projectId = 2
  await nextTick()
  assert.equal(x.calls[0].stopped, true)
  assert.equal(x.calls.length, 1, 'old local metadata must not enable the next project')
  x.state.project = { id: 2, localRoot: null }
  await nextTick()
  assert.equal(x.calls.length, 1, 'managed project metadata must keep the stream disabled')
})

test('workbench enables only loaded matching local projects, including legacy local folders', () => {
  assert.ok(/<FileTree\b[\s\S]*?:watch-local-files="canWatchLocalProjectFiles"/.test(page), 'workbench must pass eligibility to FileTree')
  const state = { projectId: 1, project: { id: 1, localRoot: '/synthetic/folder' }, projectInfoLoaded: true, isClientView: false }
  assert.equal(allowed(state), true)
  for (const change of [
    { projectInfoLoaded: false }, { project: {} }, { project: { id: 1, localRoot: null } },
    { project: { id: 1, localRoot: '  ' } }, { projectId: 2 }, { isClientView: true },
  ]) assert.equal(allowed({ ...state, ...change }), false)
  assert.equal(allowed({ ...state, projectId: '1' }), true, 'string route ids match numeric project metadata')
})
