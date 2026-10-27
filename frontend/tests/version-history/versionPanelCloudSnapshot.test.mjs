// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const panel = fs.readFileSync(new URL('../../src/components/version/VersionPanel.vue', import.meta.url), 'utf8')
const parent = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
function loadPanel(calls) {
  const script = panel.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*/g, '')
    .replace('export default', 'globalThis.component =')
  const ctx = {
    WorkSessionBar: {}, VersionTimeline: {}, DraftList: {}, AdoptConflictDialog: {}, CloudSyncBar: {},
    shouldAcceptResponse: (sent, current) => sent === current,
    getCloudStatus: async () => { calls.push('status'); return { data: { linked: true, remoteAhead: false } } },
    checkCloud: async () => { calls.push('check'); return { data: { linked: true, remoteAhead: false } } },
    getVersionStatus: async () => ({ data: { enabled: true, working: false } }),
    listDrafts: async () => ({ data: { drafts: [] } }),
    listCloudConnections: async () => ({ data: { connections: [] } }),
    getOfficialCloud: async () => ({ data: { available: true } }), console,
  }
  vm.runInNewContext(script, ctx)
  return ctx.component
}
function renderedCloud(component, state) {
  const binding = panel.match(/<CloudSyncBar\s+[^>]*:cloud="([^"]+)"/)[1]
  return component.computed[binding] ? component.computed[binding].call(state) : state[binding]
}

test('mounted panel shows the same newly polled three remote versions as the parent without refresh', () => {
  const component = loadPanel([])
  const versionPanelTag = parent.match(/<VersionPanel\s+[\s\S]*?\/>/)[0]
  assert.match(versionPanelTag, /:cloud-snapshot="collabCloud"/)
  const stale = { linked: true, remoteAhead: false }
  const state = { cloud: stale, cloudSnapshot: stale, timelineKey: 7 }
  const remote = { linked: true, remoteAhead: true, remoteAheadCount: 3, remoteAheadAuthors: ['QA-B'] }
  state.cloudSnapshot = remote
  assert.equal(renderedCloud(component, state), remote)
  state.cloudSnapshot = { ...remote, offline: true }
  assert.equal(renderedCloud(component, state).offline, true, 'preserve revoked/offline observation from API facade')
  state.cloud = stale
  assert.equal(renderedCloud(component, state), state.cloudSnapshot, 'cached response cannot overwrite parent status')
})

test('parent-owned null stays unknown and never falls back to old local synchronized data', () => {
  const component = loadPanel([])
  const state = { cloudSnapshot: null, cloud: { linked: true, remoteAhead: false } }
  assert.equal(renderedCloud(component, state), null)
  state.cloudSnapshot = { linked: false }
  assert.equal(renderedCloud(component, state).linked, false)
})

test('mounted and action refresh skip duplicate cloud requests when parent owns the snapshot', async () => {
  const calls = [], component = loadPanel(calls)
  const state = { cloudSnapshot: null, projectId: 4, refreshSeq: 0, async refresh() { this.refreshSeq++ } }
  await component.mounted.call(state)
  await component.methods.fetchCloudState.call(state)
  assert.deepEqual(calls, [])
  assert.equal(state.hasConnection, true, 'library availability still loads')
})

test('standalone panel retains its own snapshot and existing connectivity check', async () => {
  const calls = [], component = loadPanel(calls)
  const state = { cloudSnapshot: undefined, projectId: 4, refreshSeq: 0, async refresh() { this.refreshSeq++ } }
  await component.mounted.call(state)
  await component.methods.fetchCloudState.call(state)
  assert.deepEqual(calls, ['check', 'status'])
  assert.equal(renderedCloud(component, state), state.cloud)
  assert.equal(state.cloud.linked, true)
})


function parentMethod(name, dependencies = {}) {
  const start = parent.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
  assert.ok(start >= 0, `parent method ${name} exists`)
  const end = parent.indexOf('\n    },', start)
  const source = parent.slice(start, end + 7).trim().replace(/,$/, '')
  return vm.runInNewContext(`({${source}}).${name}`, { getSessionId: () => 'synthetic-session', getCloudAccountGeneration: () => 0, ...dependencies })
}

test('real panel action event chain immediately rereads the parent cloud snapshot, without polling or refresh recursion', async () => {
  for (const action of ['onReload', 'onVersionLanded', 'refresh']) {
    const apiCalls = [], pending = [], component = loadPanel(apiCalls)
    const server = { linked: true, pendingUpload: true, remoteAhead: false }
    const owner = {
      projectInfoLoaded: true, hasNamedProject: true, projectId: 4,
      collabCloud: { linked: true, pendingUpload: false, remoteAhead: true }, collabRefreshToken: 9,
      checkAdoptConflict: async () => apiCalls.push('work-status'),
    }
    owner.fetchCollabState = parentMethod('fetchCollabState', {
      getCloudStatus: async id => { assert.equal(id, 4); apiCalls.push('parent-cloud'); return { data: server } }, console,
    }).bind(owner)
    owner.onVersionPanelStatusChanged = parentMethod('onVersionPanelStatusChanged').bind(owner)
    const tag = parent.match(/<VersionPanel\s+[\s\S]*?\/>/)[0]
    const handler = tag.match(/@status-changed="([^"]+)"/)[1]
    const state = { ...component.data(), projectId: 4, cloudSnapshot: owner.collabCloud,
      $emit: event => { if (event === 'status-changed') pending.push(owner[handler]()) },
    }
    for (const [name, method] of Object.entries(component.methods)) state[name] = method.bind(state)
    const refresh = state.refresh
    let refreshCount = 0
    state.refresh = () => { refreshCount++; const result = refresh(); pending.push(result); return result }
    await state[action]([])
    await Promise.all(pending)
    state.cloudSnapshot = owner.collabCloud
    assert.equal(renderedCloud(component, state), server, action)
    assert.deepEqual(apiCalls, ['work-status', 'parent-cloud'], action)
    assert.equal(refreshCount, 1, 'event callback must not refresh the panel again')
    assert.equal(owner.collabRefreshToken, 9, 'must not schedule a token-triggered second refresh')
  }
})

test('existing upload/pull changed handler updates the shared snapshot immediately and schedules one panel refresh', async () => {
  const calls = [], server = { linked: true, pendingUpload: false, remoteAhead: false }
  const owner = { projectId: 4, projectInfoLoaded: true, hasNamedProject: true,
    collabCloud: { linked: true, remoteAhead: true }, collabLinked: true, collabRefreshToken: 9,
    checkAdoptConflict() { calls.push('work-status') }, startCollabPolling() { calls.push('ensure-poll') },
  }
  owner.fetchCollabState = parentMethod('fetchCollabState', {
    getCloudStatus: async () => { calls.push('parent-cloud'); return { data: server } }, console,
  }).bind(owner)
  const fetch = owner.fetchCollabState
  let pending
  owner.fetchCollabState = () => (pending = fetch())
  parentMethod('onCollabChanged').call(owner)
  await pending
  assert.equal(owner.collabCloud, server)
  assert.equal(owner.collabRefreshToken, 10)
  assert.equal(calls.filter(value => value === 'parent-cloud').length, 1)
})

test('late parent snapshots cannot replace newer results, another project, account, or disposed page', async () => {
  for (const change of ['newer-response', 'project', 'account', 'unload']) {
    let resolveOld, session = 'synthetic-A'
    const owner = { projectId: 4, projectInfoLoaded: true, hasNamedProject: true, collabCloud: null }
    const fresh = { linked: true, remoteAhead: true, remoteAheadCount: 3 }
    const fetch = parentMethod('fetchCollabState', {
      getSessionId: () => session,
      getCloudStatus: () => new Promise(resolve => { resolveOld = resolve }),
      checkCloud: async () => ({ data: fresh }), console,
    }).bind(owner)
    const pending = fetch()
    if (change === 'newer-response') await fetch({ online: true })
    if (change === 'project') owner.projectId = 6
    if (change === 'account') session = 'synthetic-B'
    if (change === 'unload') parentMethod('stopCollabPolling', { clearInterval() {} }).call(owner)
    resolveOld({ data: { linked: true, remoteAhead: false } })
    await pending
    assert.equal(owner.collabCloud, change === 'newer-response' ? fresh : null, change)
  }
})

test('desktop account generation and actual account-changed callback discard stale parent state with unchanged local session', async () => {
  let generation = 0, resolveOld, refreshes = 0
  const owner = { projectId: 5, projectInfoLoaded: true, hasNamedProject: true,
    collabCloud: { linked: true, offline: true }, refreshAccountState() { refreshes++ } }
  owner.stopCollabPolling = parentMethod('stopCollabPolling', { clearInterval() {} }).bind(owner)
  owner.onCollabAccountChanged = parentMethod('onCollabAccountChanged').bind(owner)
  owner.fetchCollabState = async () => {}
  owner.startCollabPolling = () => {}
  const fetch = parentMethod('fetchCollabState', {
    getSessionId: () => 'same-local-session', getCloudAccountGeneration: () => generation,
    getCloudStatus: () => new Promise(resolve => { resolveOld = resolve }), console,
  }).bind(owner)
  const pending = fetch()
  generation++ // Successful API account mutation; local session is deliberately unchanged.
  resolveOld({ data: { linked: true, remoteAhead: true } })
  await pending
  assert.equal(owner.collabCloud.offline, true, 'old account reply is not installed')
  const start = parent.indexOf('    this._onAccountChanged = () =>')
  const end = parent.indexOf('\n    uni.$on(ACCOUNT_CHANGED_EVENT', start)
  new Function(parent.slice(start, end)).call(owner)
  await owner._onAccountChanged()
  assert.equal(owner.collabCloud, null, 'existing account event clears visible old identity state')
  assert.equal(refreshes, 1, 'existing account refresh still runs')
})

test('slow online observation is reprojected after a newer cached read, without recursive fetches', async () => {
  const { createCloudConnectivity } = await import('../../src/utils/cloudConnectivity.js')
  for (const offline of [true, false]) {
    let resolveCheck
    const calls = [], observe = createCloudConnectivity()
    const cached = { code: 0, data: { linked: true, remoteAhead: false } }
    if (!offline) await observe(5, 'update', async () => ({ data: { status: 'OFFLINE' } }))
    const owner = { projectId: 5, projectInfoLoaded: true, hasNamedProject: true, collabCloud: null }
    owner.fetchCollabState = parentMethod('fetchCollabState', {
      checkCloud: id => observe(id, 'check', () => { calls.push('online'); return new Promise(resolve => { resolveCheck = resolve }) }),
      getCloudStatus: id => observe(id, 'status', async () => { calls.push('cached'); return cached }), console,
    }).bind(owner)
    const online = owner.fetchCollabState({ online: true })
    await owner.fetchCollabState()
    assert.equal(!!owner.collabCloud.offline, !offline)
    resolveCheck({ data: { ...cached.data, offline } })
    await online
    assert.equal(!!owner.collabCloud.offline, offline, 'completed observation must reach the visible owner immediately')
    assert.deepEqual(calls, ['online', 'cached', 'cached'], 'one local reproject, no second network check')
  }
})

test('late online reply after page disposal cannot start a projection request', async () => {
  let resolveCheck, cachedCalls = 0
  const owner = { projectId: 5, projectInfoLoaded: true, hasNamedProject: true, collabCloud: null }
  owner.fetchCollabState = parentMethod('fetchCollabState', {
    checkCloud: () => new Promise(resolve => { resolveCheck = resolve }),
    getCloudStatus: async () => { cachedCalls++; return { data: { linked: true } } }, console,
  }).bind(owner)
  const pending = owner.fetchCollabState({ online: true })
  parentMethod('stopCollabPolling', { clearInterval() {} }).call(owner)
  resolveCheck({ data: { linked: true, offline: true } })
  await pending
  assert.equal(cachedCalls, 0)
  assert.equal(owner.collabCloud, null)
})

test('account change reprobes the current project and rearms polling only while its lifecycle is still live', async () => {
  for (const dispose of [false, true]) {
    let resolveCheck, starts = 0
    const owner = { projectId: 5, projectInfoLoaded: true, hasNamedProject: true,
      collabCloud: { linked: true, offline: true },
      get collabLinked() { return !!this.collabCloud?.linked },
      startCollabPolling() { starts++ },
    }
    owner.stopCollabPolling = parentMethod('stopCollabPolling', { clearInterval() {} }).bind(owner)
    owner.fetchCollabState = parentMethod('fetchCollabState', {
      checkCloud: async id => { assert.equal(id, 5); return new Promise(resolve => { resolveCheck = resolve }) }, console,
    }).bind(owner)
    const pending = parentMethod('onCollabAccountChanged').call(owner)
    assert.equal(owner.collabCloud, null)
    if (dispose) owner.stopCollabPolling()
    resolveCheck({ data: { linked: true, remoteAhead: true } })
    await pending
    assert.equal(starts, dispose ? 0 : 1, 'disposed page cannot restart its timer')
    assert.equal(owner.collabCloud?.remoteAhead, dispose ? undefined : true)
  }
})

test('late onCollabChanged and loadProjectInfo continuations cannot restart polling or check after unload', async () => {
  for (const action of ['onCollabChanged', 'loadProjectInfo']) {
    let resolveCached, timers = 0, online = 0, members = 0
    const owner = { projectId: 5, projectInfoLoaded: true, hasNamedProject: true, collabCloud: { linked: true },
      collabRefreshToken: 0, get collabLinked() { return !!this.collabCloud?.linked },
      checkAdoptConflict() {}, loadProjectMembers() { members++ },
      ensureStagingFolder: async () => {}, loadStagingFiles() {}, isActiveOverviewInstance: () => true,
    }
    owner.stopCollabPolling = parentMethod('stopCollabPolling', { clearInterval() {} }).bind(owner)
    owner.startCollabPolling = parentMethod('startCollabPolling', { setInterval() { timers++; return 1 } }).bind(owner)
    owner.fetchCollabState = parentMethod('fetchCollabState', {
      getCloudStatus: () => new Promise(resolve => { resolveCached = resolve }),
      checkCloud: async () => { online++; return { data: { linked: true } } }, console,
    }).bind(owner)
    await parentMethod(action, {
      getProject: async () => ({ id: 5, name: 'synthetic' }),
      recordProjectVisit() {}, syncRecentToMenuFetching() {}, loadProjectTasks: async () => {}, console,
    }).call(owner)
    assert.equal(typeof resolveCached, 'function')
    owner.stopCollabPolling({ dispose: true })
    resolveCached({ data: { linked: true } })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    assert.equal(timers, 0, action)
    assert.equal(online, 0, action)
    assert.equal(members, 0, action)
    // Entry guards also protect later queued callbacks, not just these two chains.
    owner.startCollabPolling()
    await owner.fetchCollabState({ online: true })
    assert.equal(timers + online, 0)
  }
})

test('unknown cloud after account-change failure retries on the normal timer and disposal cancels it', async () => {
  for (const dispose of [false, true]) {
    let tick, attempts = 0, cleared = 0
    const owner = { projectId: 5, projectInfoLoaded: true, hasNamedProject: true, collabCloud: { linked: true },
      get collabLinked() { return !!this.collabCloud?.linked }, isActiveOverviewInstance: () => true,
    }
    owner.stopCollabPolling = parentMethod('stopCollabPolling', { clearInterval() { cleared++ } }).bind(owner)
    owner.startCollabPolling = parentMethod('startCollabPolling', { setInterval(callback, delay) {
      assert.equal(delay, 120000); tick = callback; return 1
    } }).bind(owner)
    owner.fetchCollabState = parentMethod('fetchCollabState', {
      checkCloud: async () => { if (++attempts === 1) throw new Error('synthetic unavailable'); return { data: { linked: true, remoteAhead: true } } },
      console: { warn() {} },
    }).bind(owner)
    await parentMethod('onCollabAccountChanged').call(owner)
    assert.equal(owner.collabCloud, null, 'failed probe cannot reinstall old account green snapshot')
    assert.equal(typeof tick, 'function', 'unknown state retains a bounded-frequency recovery source')
    if (dispose) owner.stopCollabPolling({ dispose: true })
    tick() // Also model a callback already queued before clearInterval.
    for (let i = 0; i < 5; i++) await Promise.resolve()
    assert.equal(attempts, dispose ? 1 : 2)
    assert.equal(owner.collabCloud?.remoteAhead, dispose ? undefined : true)
    if (dispose) assert.equal(cleared, 1)
    else {
      owner.collabCloud = { linked: false }
      tick()
      assert.equal(attempts, 2, 'explicitly unlinked projects do not poll')
    }
  }
})

test('hiding an overview does not permanently dispose collaboration; active return resumes its existing timer', async () => {
  let tick, checks = 0, active = true
  const owner = { collabCloud: { linked: true }, collabLinked: true,
    isActiveOverviewInstance: () => active, fetchCollabState() { checks++ },
    releaseMenuOnHide() {}, stopActivityTracking() {}, isDesktopApp: false,
  }
  parentMethod('startCollabPolling', { setInterval(callback) { tick = callback; return 1 } }).call(owner)
  const start = parent.indexOf('  onHide() {'), end = parent.indexOf('\n  onUnload()', start)
  const hook = new Function(`return ({${parent.slice(start, end)}}).onHide`)()
  hook.call(owner)
  active = false; tick(); assert.equal(checks, 0)
  active = true; tick(); assert.equal(checks, 1)
  assert.notEqual(owner._collabDisposed, true)
})

test('account change during initial local project load does not cancel local initialization or cloud startup', async () => {
  for (const change of ['account', 'project', 'dispose']) {
    let resolveProject, online = 0, timers = 0, members = 0
    const owner = { projectId: 5, projectInfoLoaded: false, hasNamedProject: true, collabCloud: null,
      get collabLinked() { return !!this.collabCloud?.linked },
      checkAdoptConflict() {}, loadProjectMembers() { members++ },
      ensureStagingFolder: async () => {}, loadStagingFiles() {},
    }
    owner.stopCollabPolling = parentMethod('stopCollabPolling', { clearInterval() {} }).bind(owner)
    owner.startCollabPolling = parentMethod('startCollabPolling', { setInterval() { timers++; return 1 } }).bind(owner)
    owner.fetchCollabState = parentMethod('fetchCollabState', {
      getCloudStatus: async () => ({ data: { linked: true } }),
      checkCloud: async () => { online++; return { data: { linked: true } } }, console,
    }).bind(owner)
    const pending = parentMethod('loadProjectInfo', {
      getProject: id => { assert.equal(id, 5); return new Promise(resolve => { resolveProject = resolve }) },
      recordProjectVisit() {}, syncRecentToMenuFetching() {}, loadProjectTasks: async () => {}, console,
    }).call(owner)
    if (change === 'account') await parentMethod('onCollabAccountChanged').call(owner)
    if (change === 'project') owner.projectId = 6
    if (change === 'dispose') owner.stopCollabPolling({ dispose: true })
    assert.equal(online + timers, 0, 'no cloud startup before local project info is ready')
    resolveProject({ id: 5, name: 'synthetic' })
    await pending
    for (let i = 0; i < 8; i++) await Promise.resolve()
    assert.equal(owner.projectInfoLoaded, change === 'account', change)
    assert.equal(owner.project?.id, change === 'account' ? 5 : undefined, change)
    assert.equal(online, change === 'account' ? 1 : 0, change)
    assert.equal(timers, change === 'account' ? 1 : 0, change)
    assert.equal(members, change === 'account' ? 1 : 0, change)
  }
})
