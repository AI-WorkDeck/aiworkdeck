// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// B4: the lawyer chooses at invite time whether the client may read earlier project-chat messages. The default is
// "only after joining", the choice reaches both invite endpoints, and the dialog reports what the server applied.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dialog = readFileSync(new URL('../../src/components/InviteMemberDialog.vue', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')

test('the history choice defaults to "only after joining" and is reset with the form', () => {
  assert.match(dialog, /clientShareHistory: false,/)
  assert.match(dialog, /this\.clientShareHistory = false/)
  assert.match(dialog, /role="radiogroup"/)
})

test('both invite endpoints carry the choice as a strict boolean', () => {
  assert.match(dialog, /inviteCloudClient\(this\.projectId, this\.clientName, this\.clientShareHistory\)/)
  assert.match(dialog, /inviteClient\(this\.projectId, this\.clientName, this\.clientShareHistory\)/)
  for (const name of ['inviteCloudClient', 'inviteClient']) {
    const fn = api.slice(api.indexOf(`export function ${name}(`), api.indexOf('}', api.indexOf(`export function ${name}(`) + 200) + 1)
    assert.match(fn, /shareHistory = false/, name)
    assert.match(fn, /shareHistory: shareHistory === true/, name)
  }
})

test('the result line follows the server echo, and an old server that does not echo is reported', () => {
  const start = dialog.indexOf('clientHistoryResult() {')
  const body = dialog.slice(dialog.indexOf('{', start) + 1, dialog.indexOf('\n    },', start))
  const result = (echo, chosen) => new Function(body).call({ clientHistoryEcho: echo, clientShareHistory: chosen, $t: key => key })
  assert.equal(result(true, true), 'version.clientChatHistoryResultAll')
  assert.equal(result(false, true), 'version.clientChatHistoryResultAfter')
  assert.equal(result(null, false), 'version.clientChatHistoryResultAfter')
  assert.equal(result(null, true), 'version.clientChatHistoryNotApplied')
})
