// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 0.91.0 gate (lane C, c1cb22412): a read-only or removed member with pending local commits saw
// 「有改动还没交稿」. Membership outranks pending changes on the page chip, as in the 协作 dialog.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const dialog = readFileSync(new URL('../../src/components/collab/CollabDialog.vue', import.meta.url), 'utf8')

function body(source, name) {
  const start = source.indexOf(`    ${name}() {`)
  assert.ok(start > 0, name)
  return source.slice(start, source.indexOf('\n    },\n', start))
}

test('page chip: removed, then read-only, come before pending changes', () => {
  const chip = body(page, 'collabStateText')
  const removed = chip.indexOf("c.removed")
  const readOnly = chip.indexOf("c.myRole === 'READ_ONLY'")
  const pending = chip.indexOf('c.pendingUpload || this.versionUnsaved')
  assert.ok(removed > 0 && readOnly > removed && pending > readOnly, 'removed < read-only < pending')
  assert.match(chip, /version\.readOnlyMemberState/)
})

test('协作 dialog keeps the same order and hides 交稿 for read-only or removed members', () => {
  const state = body(dialog, 'stateText')
  assert.ok(state.indexOf('cloud.removed') < state.indexOf("myRole === 'READ_ONLY'"))
  assert.ok(state.indexOf("myRole === 'READ_ONLY'") < state.indexOf('cloud.pendingUpload'))
  assert.match(dialog, /v-if="!cloud \|\| \(!cloud\.removed && cloud\.myRole !== 'READ_ONLY'\)"/)
})
