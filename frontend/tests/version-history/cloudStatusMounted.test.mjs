// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Vue mounting/rendering/events with an in-memory host. The transport and
// unrelated children are synthetic; this is not Electron/native visual QA.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { createCloudConnectivity } from '../../src/utils/cloudConnectivity.js'
import { remoteAheadText } from '../../src/utils/collabWording.js'

const read = path => fs.readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')
const panelSource = read('components/version/VersionPanel.vue')
const parentSource = read('pages/project-overview/project-overview.vue')
const apiSource = read('services/api.js')
function options(source, dependencies) {
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?\s*/gm, '')
    .replace('export default', 'return')
  return new Function(...Object.keys(dependencies), script)(...Object.values(dependencies))
}
function render(template) {
  return new Function('Vue', compile(template, {
    mode: 'function', prefixIdentifiers: true, isCustomElement: tag => ['view', 'text'].includes(tag),
  }).code)(Vue)
}
function parentMethod(name, dependencies = {}) {
  const start = parentSource.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
  if (start < 0) return undefined // Allows the release baseline to exercise its original wiring.
  const end = parentSource.indexOf('\n    },', start)
  return new Function(...Object.keys(dependencies), `return ({${parentSource.slice(start, end + 7)}}).${name}`)(...Object.values(dependencies))
}
function element(type, text = '') { return { type, text, props: {}, children: [], parent: null } }
const renderer = Vue.createRenderer({
  createElement: element,
  createText: text => element('#text', text),
  createComment: text => element('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.children = []; node.text = text },
  patchProp: (node, key, old, value) => { node.props[key] = value },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  insert(node, parent, anchor = null) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = null
  },
})
function descendants(node) { return [node, ...node.children.flatMap(descendants)] }
const text = node => [node.text, ...node.children.map(text)].join(' ')
async function settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); await Vue.nextTick() } }

function mountScenario() {
  const calls = [], counts = { timelineMounts: 0 }
  let serverCloud = { linked: true, remoteAhead: false }, versionCalls = 0
  const observe = createCloudConnectivity()
  const request = async ({ url }) => {
    calls.push(url)
    return { code: 0, data: url.endsWith('/update') ? { status: 'OFFLINE' } : serverCloud }
  }
  const api = Object.fromEntries(['getCloudStatus', 'checkCloud', 'updateFromCloud'].map(name => {
    const start = apiSource.indexOf(`export function ${name}(`)
    return [name, new Function('request', 'observeCloudConnectivity', `return (${apiSource.slice(start + 7, apiSource.indexOf('\n}', start) + 2)})`)(request, observe)]
  }))
  const Empty = { render: () => null }
  const cloud = options(read('components/version/CloudSyncBar.vue'), { remoteAheadText })
  cloud.render = render(read('components/version/CloudSyncBar.vue').match(/<template>([\s\S]*?)<\/template>\s*<script>/)[1])
  const panel = options(panelSource, {
    ...api,
    getVersionStatus: async () => { versionCalls++; return { data: { enabled: true, working: false } } },
    listDrafts: async () => ({ data: { drafts: [] } }),
    listCloudConnections: async () => ({ data: { connections: [] } }),
    getOfficialCloud: async () => ({ data: { available: true } }),
    shouldAcceptResponse: (sent, current) => sent === current,
    WorkSessionBar: { emits: ['ended'], setup(props, { emit }) { return () => Vue.h('button', { onClick: () => emit('ended', []) }, 'finish synthetic work') } },
    VersionTimeline: { mounted() { counts.timelineMounts++ }, render: () => null },
    DraftList: Empty, AdoptConflictDialog: Empty, CloudSyncBar: cloud,
  })
  panel.render = render(panelSource.match(/<template>([\s\S]*?)<\/template>\s*<script>/)[1])
  // The real parent tag owns the prop and event wiring; only remove its surrounding
  // v-else-if (the rest of the production workbench is irrelevant to this fixture).
  const tag = parentSource.match(/<VersionPanel\s+[\s\S]*?\/>/)[0].replace('v-else-if=', 'v-if=')
  const parent = {
    components: { VersionPanel: panel },
    data: () => ({ leftPaneKey: 'version', projectId: 5, projectInfoLoaded: true, hasNamedProject: true,
      versionFileFilter: null, documentMergeState: null, collabRefreshToken: 0, collabCloud: { ...serverCloud } }),
    methods: {
      fetchCollabState: parentMethod('fetchCollabState', { ...api, getSessionId: () => 'synthetic', getCloudAccountGeneration: () => 0, console }),
      onVersionPanelStatusChanged: parentMethod('onVersionPanelStatusChanged'),
      checkAdoptConflict() {}, onVersionReloadFiles() {}, refreshLibreProvenance() {},
      onVersionCompareFile() {}, openCollab() {}, openCommitHistoryTab() {}, onOpenMergeReview() {}, onRetryMerge() {},
    },
    render: render(tag),
  }
  parent.methods = Object.fromEntries(Object.entries(parent.methods).filter(([, method]) => typeof method === 'function'))
  const root = element('root'), app = renderer.createApp(parent)
  app.config.globalProperties.$t = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`
  const owner = app.mount(root)
  return { app, root, owner, calls, counts, api, versionCalls: () => versionCalls,
    server: value => { serverCloud = value },
    cloudText: () => descendants(root).filter(n => n.props.class === 'cloud-text').map(text).join(' '),
    dotClass: () => descendants(root).find(n => String(n.props.class).includes('cloud-dot'))?.props.class,
  }
}

test('mounted Vue panel reacts to the real parent cloud prop without reloading local history', async t => {
  const fixture = mountScenario(); t.after(() => fixture.app.unmount())
  await settle()
  assert.match(fixture.cloudText(), /inSyncWithTeam/)
  const mounts = fixture.counts.timelineMounts, versions = fixture.versionCalls()
  fixture.calls.length = 0
  fixture.server({ linked: true, remoteAhead: true, remoteAheadCount: 3, remoteAheadAuthors: ['QA-B'] })
  await fixture.owner.fetchCollabState({ online: true }); await settle()
  assert.match(fixture.dotClass(), /cloud-dot-blue/)
  assert.doesNotMatch(fixture.cloudText(), /inSyncWithTeam/)
  assert.equal(fixture.counts.timelineMounts, mounts, 'polling must not remount timeline')
  assert.equal(fixture.versionCalls(), versions, 'prop changes must not reload local version state')
  assert.deepEqual(fixture.calls, ['/api/cloud/projects/5/check'])
})

test('mounted child action propagates OFFLINE through the real API, parent event and rendered cloud bar', async t => {
  const fixture = mountScenario(); t.after(() => fixture.app.unmount())
  await settle()
  await fixture.api.updateFromCloud(5)
  fixture.calls.length = 0
  const versions = fixture.versionCalls()
  descendants(fixture.root).find(n => n.type === 'button').props.onClick()
  await settle()
  assert.match(fixture.cloudText(), /libraryUnreachable/)
  assert.match(fixture.dotClass(), /cloud-dot-yellow/)
  assert.equal(fixture.versionCalls(), versions + 1, 'one action causes one panel refresh')
  assert.deepEqual(fixture.calls, ['/api/cloud/projects/5/status'], 'one cached read, no recursive cloud fetch')
  // A fresh verified check, not a cached status read, permits green again.
  await fixture.owner.fetchCollabState({ online: true }); await settle()
  assert.match(fixture.cloudText(), /inSyncWithTeam/)
})
