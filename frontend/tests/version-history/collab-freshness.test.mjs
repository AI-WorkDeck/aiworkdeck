// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C5 (lane C S2): for up to 2 minutes after a colleague submitted, the chip still said
// 「和大家的稿一致」 because the networked check runs every 120 s. The chip may only say 一致 within
// 15 s of an online check; it re-checks on window focus, on opening a file, and on the first click
// into a document.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { collabAgeText, COLLAB_FRESH_MS } from '../../src/utils/collabWording.js'

const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
function body(name) {
  const start = page.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
  assert.ok(start >= 0, name)
  const end = page.indexOf('\n    },', start)
  return page.slice(start, end + 7).trim().replace(/,$/, '')
}
const fn = (name, deps = {}) => vm.runInNewContext(`({${body(name)}}).${name}`, deps)
const t = (k, p) => k + (p ? JSON.stringify(p) : '')

function chip(o) {
  const v = { documentMergeState: {}, adoptConflictPending: false, versionWorkStatus: {}, collabCloud: { linked: true },
    collabChecking: false, collabCheckedAt: 0, collabNow: 100000, $t: t, ...o }
  Object.defineProperty(v, 'collabFresh', { get: () => fn('collabFresh', { COLLAB_FRESH_MS }).call(v) })
  return fn('collabStateText', { remoteAheadText: () => 'ahead', collabAgeText }).call(v)
}

test('C5: 一致 only within 15 s of an online check; otherwise checking / not checked / as-of age', () => {
  assert.equal(COLLAB_FRESH_MS, 15000)
  assert.equal(chip({ collabCheckedAt: 100000 - 5000 }), 'workbench.collabInSync')
  assert.equal(chip({ collabCheckedAt: 100000 - 90000 }), 'workbench.collabInSyncAsOf{"age":"workbench.collabAgeMinutes{\\"n\\":1}"}')
  assert.equal(chip({ collabCheckedAt: 100000 - 90000, collabChecking: true }), 'workbench.collabChecking')
  assert.equal(chip({ collabCheckedAt: 0 }), 'workbench.collabNotChecked')
  assert.equal(chip({ collabCheckedAt: 100000 - 90000, collabCloud: { linked: true, remoteAhead: true } }), 'ahead', 'a known newer draft is still said')
})

test('C5: recheck goes online only when stale, linked, active and not already checking', () => {
  const recheck = fn('recheckCollabIfStale', { Date: { now: () => 100000 } })
  const run = (o) => { let online = 0; const v = { _collabDisposed: false, isActiveOverviewInstance: () => true, collabCloud: { linked: true }, collabLinked: true,
    collabChecking: false, collabCheckedAt: 0, collabNow: 0, fetchCollabState: (a) => { if (a && a.online) online++ }, ...o }
    Object.defineProperty(v, 'collabFresh', { get: () => !!v.collabCheckedAt && v.collabNow - v.collabCheckedAt <= 15000 })
    recheck.call(v); return online }
  assert.equal(run({ collabCheckedAt: 100000 - 60000 }), 1, 'stale → check now')
  assert.equal(run({ collabCheckedAt: 100000 - 3000 }), 0, 'fresh → no network')
  assert.equal(run({ collabCheckedAt: 1, collabChecking: true }), 0, 'already checking')
  assert.equal(run({ collabCheckedAt: 1, collabCloud: { linked: false }, collabLinked: false }), 0, 'not in the case library')
  assert.equal(run({ collabCheckedAt: 1, isActiveOverviewInstance: () => false }), 0, 'background page instance')
})

test('C5: triggers are wired — focus, file switch, first click into a document', () => {
  assert.match(page, /window\.addEventListener\('focus', this\._collabOnFocus\)/)
  assert.match(page, /uni\.\$on\('awd:doc-interaction', this\._collabOnDocInteraction\)/)
  assert.match(page, /activeFileIdLeft\(\) \{[^}]*this\.recheckCollabIfStale\(\) \}/)
  assert.match(page, /activeFileIdRight\(\) \{[^}]*this\.recheckCollabIfStale\(\) \}/)
  const editor = readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
  assert.match(editor, /uni\.\$emit\('awd:doc-interaction', \{ fileId: this\.file && this\.file\.id \}\)/)
  assert.match(page, /if \(online\) \{ this\.collabCheckedAt = Date\.now\(\)/)
})

test('C5: age text', () => {
  assert.equal(collabAgeText(t, 4000), 'workbench.collabAgeSeconds{"n":4}')
  assert.equal(collabAgeText(t, 125000), 'workbench.collabAgeMinutes{"n":2}')
  assert.equal(collabAgeText(t, 2 * 3600000), 'workbench.collabAgeHours{"n":2}')
})
