// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D8: a signed-out desktop user's redlines were authored "Local user" (the local-mode
// placeholder display name). The engine cannot re-sign existing redlines, so the editor
// asks for a name when a writable Word document opens, before the first tracked edit.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { isPlaceholderAuthor, needsAuthorPrompt, REDLINE_AUTHOR_KEY, MAX_REDLINE_AUTHOR_CHARS } from '../../src/utils/editorAuthor.js'

test('the local-mode placeholder is not a name; real names are', () => {
  for (const n of ['Local user', '本机用户', ' Local user ']) assert.equal(isPlaceholderAuthor(n), true, n)
  for (const n of ['A. Chen', '陈律师', '', null]) assert.equal(isPlaceholderAuthor(n), false, String(n))
})

test('ask only when the signer would be the placeholder (or nobody) and nothing was set or dismissed', () => {
  assert.equal(needsAuthorPrompt({ override: '', resolvedName: 'Local user', dismissed: false }), true)
  assert.equal(needsAuthorPrompt({ override: '', resolvedName: '', dismissed: false }), true)
  assert.equal(needsAuthorPrompt({ override: '', resolvedName: 'A. Chen', dismissed: false }), false, 'signed-in display name is used')
  assert.equal(needsAuthorPrompt({ override: 'Chen & Partners', resolvedName: 'Local user', dismissed: false }), false, 'asked once, remembered')
  assert.equal(needsAuthorPrompt({ override: '', resolvedName: 'Local user', dismissed: true }), false, '"Not now" holds for this launch')
})

const source = fs.readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
function member(name) {
  const start = source.indexOf(`    ${name}(`)
  assert.ok(start > 0, name)
  let depth = 0, i = source.indexOf('{', start)
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break }
  return source.slice(start, i + 1)
}

test('saving the name stores it, hides the bar and re-signs every open editor', () => {
  const stored = new Map(), events = []
  let refreshed = 0
  const ctx = { uni: { setStorageSync: (k, v) => stored.set(k, v), $emit: (e) => events.push(e) }, REDLINE_AUTHOR_KEY, MAX_REDLINE_AUTHOR_CHARS,
    authorNames: () => ({ refresh() { refreshed++ } }) }
  const save = vm.runInNewContext(`({ ${member('saveAuthorPrompt')} })`, ctx).saveAuthorPrompt
  const ed = { authorPromptInput: '  Chen & Partners ', authorPromptNeeded: true, authorPromptError: '', $t: (k) => k }
  save.call(ed)
  assert.equal(stored.get(REDLINE_AUTHOR_KEY), 'Chen & Partners')
  assert.equal(ed.authorPromptNeeded, false)
  assert.equal(refreshed, 1)
  assert.deepEqual(events, ['awd:identity-updated'])
  const empty = { authorPromptInput: '  ', authorPromptNeeded: true, authorPromptError: '', $t: (k) => k }
  save.call(empty)
  assert.equal(empty.authorPromptError, 'editor.authorPrompt.empty')
  assert.equal(empty.authorPromptNeeded, true, 'an empty name is not accepted')
})

test('the bar shows only on a ready, writable Word document', () => {
  const visible = vm.runInNewContext(`({ ${member('authorPromptVisible')} })`, {}).authorPromptVisible
  const base = { authorPromptNeeded: true, ready: true, file: { id: 1 }, docKind: 'writer', canWrite: true, loadingOverlayVisible: false }
  assert.equal(visible.call(base), true)
  for (const [k, v] of [['docKind', 'calc'], ['canWrite', false], ['ready', false], ['loadingOverlayVisible', true], ['authorPromptNeeded', false]])
    assert.equal(visible.call({ ...base, [k]: v }), false, k)
  assert.match(source, /this\.authorPromptNeeded = needsAuthorPrompt\(\{ override: readAuthorOverride\(\), resolvedName: name, dismissed: authorPromptDismissed \}\)/)
})
