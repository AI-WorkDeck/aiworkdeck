// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C6 (lane C S2): on a colleague's machine the header said 「负责人：<the colleague>」 for a case
// they pulled from the team library. The lead is the OWNER in the (cloud-authoritative) member list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeMembers } from '../../src/utils/mergeMembers.js'

const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const start = page.indexOf('    projectLeadName() {')
const end = page.indexOf('\n    },', start)
const projectLeadName = new Function('return {' + page.slice(start, end + 6) + '}')().projectLeadName

test('C6: header names the case owner, not the local user who pulled it', () => {
  assert.match(page, /\$t\('workbench\.managerLabel', \{ name: projectLeadName \|\| \$t\('workbench\.me'\) \}\)/)
  // colleague's machine: locally the clone made them OWNER; the team library says the partner owns it
  const local = [{ id: 1, username: 'lu', displayName: '陆知微', role: 'OWNER', accountId: 'acc-lu' }]
  const cloud = [{ id: 7, username: 'shen', displayName: '沈律师', role: 'OWNER', accountId: 'acc-shen' },
    { id: 8, username: 'lu', displayName: '陆知微', role: 'MEMBER', accountId: 'acc-lu' }]
  const vm = { projectMembers: mergeMembers(local, cloud), project: {}, userDisplayName: '陆知微' }
  assert.equal(projectLeadName.call(vm), '沈律师')
  assert.equal(projectLeadName.call({ projectMembers: local, project: {}, userDisplayName: '陆知微' }), '陆知微', 'own case: the owner is me')
  assert.equal(projectLeadName.call({ projectMembers: [], project: {}, userDisplayName: '' }), '', 'falls back to the 「我」 label in the template')
})
