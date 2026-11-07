// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { countsByFile, forFile, previewText, isStale, totalEdits, STALE_CODE, applyPendingRevision } from '../../src/utils/pendingRevision.js'

const rows = [
  { id: 1, fileId: 3, status: 'PENDING', edits: [{ find: 'a', replace: 'b' }, { find: 'c', replace: 'd' }] },
  { id: 2, fileId: 3, status: 'STALE', edits: [{ find: 'x', replace: '' }] },
  { id: 3, fileId: 9, status: 'PENDING', edits: [] },
]

test('counts proposals per file, stale included', () => {
  assert.deepEqual(countsByFile(rows), { 3: 2, 9: 1 })
  assert.deepEqual(countsByFile(null), {})
})

test('forFile filters by id regardless of string/number', () => {
  assert.equal(forFile(rows, '3').length, 2)
  assert.equal(forFile(rows, 7).length, 0)
})

test('preview truncates and collapses whitespace', () => {
  assert.equal(previewText('a\n  b'), 'a b')
  assert.equal(previewText('x'.repeat(100), 10), 'xxxxxxxxxx…')
  assert.equal(previewText(null), '')
})

test('stale detection and edit totals', () => {
  assert.equal(isStale(rows[1]), true)
  assert.equal(isStale(rows[0]), false)
  assert.equal(totalEdits(rows[0]), 2)
  assert.equal(STALE_CODE, 4090)
})

test('every revision.* key used by the bar exists in zh-CN and en-US, with accept/reject wired', async () => {
  const bar = fs.readFileSync(new URL('../../src/components/PendingRevisionBar.vue', import.meta.url), 'utf8')
  const keys = [...bar.matchAll(/revision\.(\w+)/g)].map((m) => m[1])
  assert.ok(keys.length >= 8)
  for (const loc of ['zh-CN', 'en-US']) {
    const mod = (await import(`../../src/locales/${loc}/revision.js`)).default
    for (const k of new Set(keys)) assert.ok(mod[k], `${loc} missing revision.${k}`)
  }
  assert.match(bar, /@tap="onAccept\(r\)"/)
  assert.match(bar, /@tap="onReject\(r\)"/)
})

test('file tree badge and editor bar are mounted', () => {
  const tree = fs.readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
  const editor = fs.readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
  assert.match(tree, /pendingRevisionCounts\[item\.id\]/)
  assert.match(editor, /<PendingRevisionBar/)
})

function accept({ edits, results, claim, matches, appliedCount } = {}) {
  const calls = []
  const applied = []
  const progressLog = []
  const res = results || {}
  return {
    calls, applied, progressLog,
    run: () => applyPendingRevision({
      id: 5,
      claim: claim || (async () => ({ ok: true, appliedCount: appliedCount || 0, edits: edits || [{ find: 'a', replace: 'b' }, { find: 'c', replace: '' }] })),
      execute: async (action, params) => {
        calls.push([action, params])
        if (action === 'find_text_locations') return { success: true, count: matches ? (matches[params.keyword] ?? 1) : 1 }
        const idx = calls.filter(([a]) => a === 'find_replace').length - 1
        if (action === 'find_replace' && res[idx]) return res[idx]
        return { success: true, total: 1 }
      },
      progress: async (id, n) => { progressLog.push(n) },
      markApplied: async (id) => { applied.push(id) },
    }),
  }
}

test('accept: track changes on, then each edit as agent find_replace, applied call last', async () => {
  const t = accept()
  const r = await t.run()
  assert.equal(r.ok, true)
  assert.equal(r.applied, 2)
  assert.deepEqual(t.calls.map(([a]) => a), ['find_text_locations', 'find_text_locations', 'clear_anchors', 'set_track_changes', 'find_replace', 'find_replace'])
  assert.deepEqual(t.progressLog, [1, 2])
  assert.equal(t.calls[3][1].on, true)
  assert.deepEqual(t.calls[4][1], { findText: 'a', replaceText: 'b', replaceAll: false, __agent: true })
  assert.equal(t.calls[5][1].replaceText, '')
  assert.deepEqual(t.applied, [5])
})

test('accept: partial failure keeps the proposal (no applied call)', async () => {
  const t = accept({ results: { 1: { success: false, message: 'not found' } } })
  const r = await t.run()
  assert.equal(r.ok, false)
  assert.equal(r.applied, 1)
  assert.equal(r.failedIndex, 1)
  assert.deepEqual(t.progressLog, [1])
  assert.equal(r.message, 'not found')
  assert.deepEqual(t.applied, [])
})

test('accept: zero matches counts as failure', async () => {
  const t = accept({ results: { 0: { success: true, total: 0 } } })
  const r = await t.run()
  assert.equal(r.ok, false)
  assert.deepEqual(t.applied, [])
})

test('accept: stale claim touches nothing in the editor', async () => {
  const t = accept({ claim: async () => ({ ok: false, stale: true, message: 'stale' }) })
  const r = await t.run()
  assert.equal(r.ok, false)
  assert.equal(r.stale, true)
  assert.equal(t.calls.length, 0)
  assert.deepEqual(t.applied, [])
})

test('preflight: a zero-match edit applies nothing and names the edit', async () => {
  const t = accept({ matches: { c: 0 } })
  const r = await t.run()
  assert.equal(r.ok, false)
  assert.equal(r.mismatch, true)
  assert.equal(r.mismatchIndex, 1)
  assert.equal(t.calls.some(([a]) => a === 'find_replace' || a === 'set_track_changes'), false)
  assert.deepEqual(t.progressLog, [])
  assert.deepEqual(t.applied, [])
})

test('resume: starts at appliedCount, preflights and applies only the remainder', async () => {
  const t = accept({ appliedCount: 1, matches: { a: 0 } }) // 第一条已套用，原文自然已不存在
  const r = await t.run()
  assert.equal(r.ok, true)
  assert.equal(r.applied, 2)
  const replaced = t.calls.filter(([a]) => a === 'find_replace').map(([, p]) => p.findText)
  assert.deepEqual(replaced, ['c'])
  assert.deepEqual(t.progressLog, [2])
  assert.deepEqual(t.applied, [5])
})

test('accept: track changes unavailable aborts before any edit', async () => {
  const calls = []
  const r = await applyPendingRevision({
    id: 1, claim: async () => ({ ok: true, edits: [{ find: 'a', replace: 'b' }] }),
    execute: async (a) => { calls.push(a); return a === 'find_text_locations' ? { success: true, count: 1 } : { success: false, message: 'no' } },
    markApplied: async () => { calls.push('applied') },
  })
  assert.equal(r.ok, false)
  assert.deepEqual(calls, ['find_text_locations', 'clear_anchors', 'set_track_changes'])
})

test('refresh only polls when the MCP server is enabled', () => {
  const store = fs.readFileSync(new URL('../../src/utils/pendingRevisionStore.js', import.meta.url), 'utf8')
  assert.match(store, /POLL_MS = 60000/)
  assert.match(store, /if \(await isMcpServerEnabled\(\)\) loadPendingRevisions/)
  assert.match(store, /addEventListener\('focus'/)
  assert.match(store, /res\.enabled === true/)
  assert.doesNotMatch(store, /conversationId/)
})

test('stale claim arrives as a rejected request (err.code 4090) and is mapped to the STALE state', () => {
  const store = fs.readFileSync(new URL('../../src/utils/pendingRevisionStore.js', import.meta.url), 'utf8')
  assert.match(store, /e\.code === STALE_CODE\) \{ rev\.status = 'STALE'/)
  const editor = fs.readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(editor.slice(editor.indexOf('<script>')), /PendingRevisionBar/)
})
