// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tabSnapshotMethods } from '../../src/pages/project-overview/tabSnapshot.js'
import { workbenchStorageKey } from '../../src/pages/project-overview/noProjectShell.js'

const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
const source = api.slice(api.indexOf('export async function getProjectFilesByIds('), api.indexOf('// 创建文件夹'))
const makeLookup = request => new Function('request', source.replace('export ', '') + '; return getProjectFilesByIds')(request)

test('restoring file metadata reads bounded batches, never the whole project tree', async () => {
  const calls = []
  const lookup = makeLookup(async ({ url, method }) => {
    assert.equal(method, 'GET')
    const parsed = new URL(url, 'http://test')
    assert.equal(parsed.pathname, '/api/projects/7/files')
    assert.equal(parsed.searchParams.get('tree'), 'true', 'older servers must still return nested files')
    const ids = parsed.searchParams.get('ids').split(',')
    calls.push(ids)
    return ids.map(id => ({ id: Number(id), name: 'current.docx' }))
  })
  const ids = Array.from({ length: 403 }, (_, i) => String(i + 1))
  const files = await lookup(7, ids)
  assert.deepEqual(calls.map(ids => ids.length), [200, 200, 3])
  assert.deepEqual(files.map(file => String(file.id)), ids)
})

test('empty snapshots do not fetch and a failed batch cannot produce a partial existence index', async () => {
  let calls = 0
  const lookup = makeLookup(async () => {
    if (++calls === 2) throw new Error('offline')
    return [{ id: 1 }]
  })
  assert.deepEqual(await lookup(7, []), [])
  assert.equal(calls, 0)
  await assert.rejects(lookup(7, Array.from({ length: 201 }, (_, i) => String(i + 1))), /offline/)
})

test('workbench uses only requested file metadata and excludes directory entries', async () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const body = page.match(/async fetchTabSnapshotFileIndex\(ids\) \{([\s\S]*?)\n    \},/)[1]
  const calls = []
  const method = new Function('getProjectFilesByIds', `return async function(ids) { ${body} }`)(async (projectId, ids) => {
    calls.push({ projectId, ids })
    return [{ id: 1, name: 'renamed.docx' }, { id: 2, isFolder: true }]
  })
  const index = await method.call({ projectId: 7 }, ['1', '2', '3'])
  assert.deepEqual(calls, [{ projectId: 7, ids: ['1', '2', '3'] }])
  assert.deepEqual([...index.keys()], ['1'])
  assert.equal(index.get('1').name, 'renamed.docx')
})


test('older servers ignoring ids still restore nested file metadata', async () => {
  const nested = { id: 8, parentId: 2, name: 'nested.docx' }
  const lookup = makeLookup(async ({ url }) => {
    const tree = new URL(url, 'http://test').searchParams.get('tree') === 'true'
    return tree ? [{ id: 2, isFolder: true }, nested] : [{ id: 2, isFolder: true }]
  })
  const files = await lookup(7, ['8'])
  assert.deepEqual(files.find(file => file.id === 8), nested)
})

test('real workbench onLoad binds its compiled uni storage before snapshot reads and writes', async () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const start = page.indexOf('  onLoad(query) {')
  const end = page.indexOf('  onShow() {', start)
  assert.ok(start >= 0 && end > start)
  const stored = new Map(), lookups = []
  const storage = { getStorageSync: key => stored.get(key), setStorageSync: (key, value) => stored.set(key, structuredClone(value)) }
  // H5 rewrites named API references to imports, but leaves bare uni as an empty
  // facade. Model that distinction while executing the actual host lifecycle.
  const compiledOnLoad = page.slice(start, end)
    .replace(/\buni\.getStorageSync\b/g, 'compiledStorage.getStorageSync')
    .replace(/\buni\.setStorageSync\b/g, 'compiledStorage.setStorageSync')
  const dependencies = { uni: { $on() {} }, compiledStorage: storage, loadSiteLinks() {}, syncRecentToMenuFetching() {}, loadShowWelcomeOnStartup: () => false,
    getCurrentUser: () => null, loadSidebarCollapsed: () => false, workbenchStorageKey,
    isPaneAllowedWithoutProject: () => true, NO_PROJECT_DEFAULT_PANE: 'projects', migrateLeftPaneKey: value => value,
    window: { addEventListener() {} },
  }
  const onLoad = new Function(...Object.keys(dependencies), `return ({${compiledOnLoad}}).onLoad`)(...Object.values(dependencies))
  const nested = { id: 8, parentId: 2, name: 'nested.txt', fileType: 'txt' }
  const host = () => {
    const vm = { ...tabSnapshotMethods, projectId: null, hasProject: true, hasNamedProject: true,
      leftFiles: [], rightFiles: [], activeFileIdLeft: null, activeFileIdRight: null, splitMode: false, focusedPane: 'left',
      initRestartRecovery() {}, loadLicenseMode() {}, loadWalletBalance() {}, loadProjectInfo() {}, toggleAiPanel() {},
      loadRealUserInfo() {}, loadPanelDocks() {}, loadRailOrder() {}, initThemeSwitch() {}, normalizeDockSelections() {},
      bindClipboardListener() {}, loadDynamicPlugins() {}, loadEnabledSkills() {}, maybeRegisterOpenWorkbench() {},
      scheduleTabSnapshotSave() {},
      async fetchTabSnapshotFileIndex(ids) { lookups.push(ids); return new Map([['8', nested]]) },
      restoreTabSnapshot() { this.restoring = tabSnapshotMethods.restoreTabSnapshot.call(this); return this.restoring },
    }
    return vm
  }
  const previousUni = globalThis.uni
  globalThis.uni = {}
  try {
    const first = host()
    onLoad.call(first, { id: '7' })
    await first.restoring
    first.leftFiles.push(nested)
    first.activeFileIdLeft = nested.id
    first.writeTabSnapshot()
    assert.deepEqual(stored.get('project_7_tabs')?.left.map(file => file.id), [8], 'production lifecycle must make snapshot writes reach real storage')

    const reopened = host()
    onLoad.call(reopened, { id: '7' })
    await reopened.restoring
    assert.deepEqual(lookups, [['8']])
    assert.equal(reopened.leftFiles[0]?.id, 8)
    assert.equal(reopened.activeFileIdLeft, 8)
  } finally {
    if (previousUni === undefined) delete globalThis.uni
    else globalThis.uni = previousUni
  }
})
