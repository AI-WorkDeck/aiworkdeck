// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import { renderToString } from '@vue/server-renderer'
import * as mergeModule from '../../src/composables/useDocumentMerge.js'
const { documentMergePresentation, useDocumentMerge } = mergeModule

const source = readFileSync(new URL('../../src/components/version/VersionPanel.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const body = script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'return')
const silent = { render: () => null }
const dialog = { props: ['documentMerges'], render() { return Vue.h('dialog', JSON.stringify(this.documentMerges)) } }
const options = new Function('documentMergePresentation', 'WorkSessionBar', 'VersionTimeline', 'DraftList', 'AdoptConflictDialog', 'CloudSyncBar', body)(documentMergePresentation, silent, silent, silent, dialog, silent)
const template = source.slice(source.indexOf('<template>') + 10, source.lastIndexOf('</template>'))
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true, isCustomElement: (tag) => ['view', 'text'].includes(tag) }).code)(Vue)
const row = (over = {}) => ({ path: '付款表.xlsx', kind: 'XLSX', decision: 'AUTO', state: 'PENDING', ...over })
const conflict = (rows = [row()], over = {}) => ({ mainlineTip: 'main', cloudTip: 'other', draftTip: 'other', sessionTip: 'other', conflictingPaths: rows.map(r => r.path), documentMerges: rows, ...over })
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function rendered(conflictValue, state, ctx = 'cloud') {
  const field = ctx === 'cloud' ? 'cloudConflict' : ctx === 'adopt' ? 'adoptConflict' : 'sessionEndConflict'
  const app = Vue.createSSRApp({ ...options, render, props: undefined,
    data: () => ({ ...options.data(), projectId: 7, documentMergeState: state, fileFilter: null, loading: false, enabled: true, [field]: conflictValue }),
    methods: { ...options.methods, $t: key => key },
  })
  return renderToString(app)
}
function harness(over = {}) {
  let opened = 0
  const deps = { projectId: 7, isDesktop: true, openOverview: () => opened++,
    api: { postMergeResolveStructured: async () => {}, resolveCloudMerge: async () => ({ data: {} }), resolveAdopt: async () => ({ data: {} }), resolveSessionEnd: async () => ({ data: {} }) }, ...over }
  return { deps, merge: useDocumentMerge(deps), opened: () => opened }
}

for (const ctx of ['cloud', 'adopt', 'session-end']) test(`${ctx}: AUTO has no dialog before processing, during merge/finalize or after stale status`, async () => {
  const mergeGate = deferred(), finalGate = deferred(), merging = deferred(), finalizing = deferred()
  const { deps, merge, opened } = harness()
  deps.api.postMergeResolveStructured = async () => { merging.resolve(); await mergeGate.promise }
  for (const name of ['resolveCloudMerge', 'resolveAdopt', 'resolveSessionEnd']) deps.api[name] = async () => { finalizing.resolve(); await finalGate.promise; return { data: {} } }
  const c = conflict([row(), row({ path: '演示.pptx', kind: 'PPTX' })])
  assert.doesNotMatch(await rendered(c, merge.state, ctx), /<dialog\b/)
  const work = merge.onConflictStatus(c, ctx)
  await merging.promise
  assert.equal(merge.state.running, true)
  assert.doesNotMatch(await rendered(c, merge.state, ctx), /<dialog\b/)
  mergeGate.resolve(); await finalizing.promise
  assert.equal(merge.state.running, true)
  assert.doesNotMatch(await rendered(c, merge.state, ctx), /<dialog\b/)
  finalGate.resolve(); await work
  await merge.onConflictStatus(c, ctx)
  assert.equal(merge.state.running, false)
  assert.equal(opened(), 0)
  assert.doesNotMatch(await rendered(c, merge.state, ctx), /<dialog\b/)
})

for (const scenario of ['manual', 'whole', 'missing-engine', 'not-desktop', 'auto-failure', 'format-only', 'finalize-failure']) test(`${scenario}: actual panel retains the manual exit and frontend row metadata`, async () => {
  const { deps, merge, opened } = harness()
  let r = row()
  if (scenario === 'manual') r.decision = 'MANUAL'
  if (scenario === 'whole') { r.kind = 'WHOLE'; r.decision = 'WHOLE' }
  if (['missing-engine', 'not-desktop', 'format-only'].includes(scenario)) r.kind = 'DOCX'
  if (scenario === 'not-desktop') deps.isDesktop = false
  if (scenario === 'missing-engine') deps.getExecutorForHiddenInstance = async () => null
  if (scenario === 'auto-failure') deps.api.postMergeResolveStructured = async () => { throw new Error('merge failed') }
  if (scenario === 'finalize-failure') deps.api.resolveCloudMerge = async () => { throw new Error('finalize failed') }
  if (scenario === 'format-only') {
    deps.getExecutorForHiddenInstance = async () => ({ run() {} })
    deps.releaseHiddenInstance = () => {}
    deps.fetchMergeInputs = async () => ({})
    deps.buildMergeDraft = async () => ({ success: true, formatOnly: [{}] })
  }
  const c = conflict([r])
  await merge.onConflictStatus(c, 'cloud')
  assert.equal(opened(), 1)
  const html = await rendered(c, merge.state)
  assert.match(html, /<dialog\b/)
  if (scenario === 'auto-failure' || scenario === 'missing-engine') assert.match(html, /failed.*true/)
  if (scenario === 'format-only') assert.match(html, /formatOnlyCount.*1/)
})

test('new conflict cannot inherit a previous failure or suppress manual rows with the same path', async () => {
  const { deps, merge } = harness()
  const first = conflict()
  deps.api.postMergeResolveStructured = async () => { throw new Error('first failed') }
  await merge.onConflictStatus(first, 'cloud')
  const next = conflict([row()], { mainlineTip: 'next-main', cloudTip: 'next-other' })
  assert.doesNotMatch(await rendered(next, merge.state), /<dialog\b/)
  const manual = conflict([row({ decision: 'MANUAL' })], { cloudTip: 'manual-other' })
  assert.match(await rendered(manual, merge.state), /<dialog\b/)
  deps.api.postMergeResolveStructured = async () => {}
  await merge.onConflictStatus(next, 'cloud')
  assert.equal(merge.state.rows[0].failed, false)
  assert.doesNotMatch(await rendered(next, merge.state), /<dialog\b/)
})

for (const changed of ['main', 'context']) test(`same other tip with changed ${changed} processes the new conflict`, async () => {
  const { deps, merge } = harness()
  let writes = 0
  deps.api.postMergeResolveStructured = async () => { writes++ }
  const first = conflict()
  await merge.onConflictStatus(first, 'cloud')
  const next = conflict(undefined, changed === 'main' ? { mainlineTip: 'next-main' } : {})
  const ctx = changed === 'context' ? 'adopt' : 'cloud'
  await merge.onConflictStatus(next, ctx)
  assert.equal(writes, 2)
  assert.equal(merge.state.rows[0].state, 'MERGED')
  assert.doesNotMatch(await rendered(next, merge.state, ctx), /<dialog\b/)
})

test('late completed conflict after a clear status does not reopen or write again', async () => {
  const { deps, merge, opened } = harness()
  let writes = 0
  deps.api.postMergeResolveStructured = async () => { writes++ }
  const c = conflict()
  await merge.onConflictStatus(c, 'cloud')
  await merge.onConflictStatus(null)
  await merge.onConflictStatus(c, 'cloud')
  assert.equal(writes, 1)
  assert.equal(opened(), 0)
  assert.equal(merge.state.running, false)
  assert.doesNotMatch(await rendered(c, merge.state), /<dialog\b/)
})


test('an older merge finishing cannot hide the next manual conflict while its status is queued', async () => {
  const gate = deferred(), started = deferred()
  const { deps, merge } = harness()
  deps.api.postMergeResolveStructured = async () => { started.resolve(); await gate.promise }
  const old = conflict()
  const work = merge.onConflictStatus(old, 'cloud')
  await started.promise
  const next = conflict([row({ decision: 'MANUAL' })], { mainlineTip: 'next-main' })
  const queued = merge.onConflictStatus(next, 'cloud')
  assert.match(await rendered(next, merge.state), /<dialog\b/)
  gate.resolve(); await work
  assert.match(await rendered(next, merge.state), /<dialog\b/)
  await queued
  assert.equal(merge.state.rows[0].decision, 'MANUAL')
  assert.match(await rendered(next, merge.state), /<dialog\b/)
})

test('a cleared failed conflict can run again instead of leaving an AUTO row with no worker', async () => {
  const { deps, merge } = harness()
  const c = conflict()
  deps.api.postMergeResolveStructured = async () => { throw new Error('failed') }
  await merge.onConflictStatus(c, 'cloud')
  await merge.onConflictStatus(null)
  deps.api.postMergeResolveStructured = async () => {}
  await merge.onConflictStatus(c, 'cloud')
  assert.equal(merge.state.rows[0].state, 'MERGED')
  assert.doesNotMatch(await rendered(c, merge.state), /<dialog\b/)
})
