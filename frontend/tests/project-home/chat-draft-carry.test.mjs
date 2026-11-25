// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D11: the question typed into the temporary workspace survives opening a folder.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stashChatDraft, takeChatDraft, CHAT_DRAFT_CARRY_KEY, CHAT_DRAFT_CARRY_MAX_AGE_MS } from '../../src/utils/chatDraftCarry.js'

const mem = () => { const m = new Map(); return { m, get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), remove: (k) => m.delete(k) } }

test('a stashed draft is restored once, then gone', () => {
  const s = mem()
  stashChatDraft(s, 'What is the limitation period for a contract claim in China?', 1000)
  assert.equal(takeChatDraft(s, 2000), 'What is the limitation period for a contract claim in China?')
  assert.equal(takeChatDraft(s, 2001), '', 'restored into one chat box only')
})

test('blank drafts clear the stash; stale or malformed stashes are dropped', () => {
  const s = mem()
  stashChatDraft(s, 'x', 1000); stashChatDraft(s, '   ', 1001)
  assert.equal(s.m.has(CHAT_DRAFT_CARRY_KEY), false)
  stashChatDraft(s, 'old', 0)
  assert.equal(takeChatDraft(s, CHAT_DRAFT_CARRY_MAX_AGE_MS + 1), '')
  s.set(CHAT_DRAFT_CARRY_KEY, 'not-an-object')
  assert.equal(takeChatDraft(s, 1), '')
  assert.equal(s.m.has(CHAT_DRAFT_CARRY_KEY), false)
})

test('the chat stashes on leaving the temporary workspace and restores into an empty box', () => {
  const chat = fs.readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
  const page = fs.readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  assert.match(chat, /carryDraftOnLeave: \{ type: Boolean, default: false \}/)
  assert.match(chat, /if \(!props\.carryDraftOnLeave[^\n]*\) return\s*\n\s*stashChatDraft\(draftStorage/)
  assert.match(chat, /\(richInput\.value\.innerText \|\| ''\)\.trim\(\)\) return\s*\n\s*const carried = takeChatDraft\(draftStorage\)/, 'never overwrite what is already typed')
  assert.match(page, /:carry-draft-on-leave="isScratchWorkspace"/)
})
