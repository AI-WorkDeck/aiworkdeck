// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C9 (CEO 11-28, small version): only the explicit 「刷新状态」 asks the library for the member's role afresh.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')

test('「刷新状态」 asks for a fresh role; the API forwards it; automatic checks do not', () => {
  const dialog = read('components/collab/CollabDialog.vue')
  const refresh = dialog.slice(dialog.indexOf('async onRefresh()'), dialog.indexOf('\n    },', dialog.indexOf('async onRefresh()')))
  assert.match(refresh, /checkCloud\(this\.projectId, \{ fresh: true \}\)/)
  const api = read('services/api.js')
  assert.match(api, /export function checkCloud\(projectId, opts = \{\}\)/)
  assert.match(api, /url: `\/api\/cloud\/projects\/\$\{projectId\}\/check\$\{opts\.fresh \? '\?fresh=1' : ''\}`/)
  const page = read('pages/project-overview/project-overview.vue')
  assert.doesNotMatch(page, /checkCloud\([^)]*fresh/, 'the page\'s automatic checks keep the cache')
})
