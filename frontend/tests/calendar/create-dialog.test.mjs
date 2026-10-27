// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarCreateProjectId } from '../../src/components/calendar/workspaceState.js'

test('single read-only project filter leaves the writable project selector available', () => {
  const projects = [
    { id: 7, name: 'Read only', myRole: 'READONLY' },
    { id: 8, name: 'Writable', myRole: 'ADMIN' },
  ]
  assert.equal(calendarCreateProjectId({ mode: 'create', filterProjectIds: ['7'], scopedProjectId: null, projects }), null)
  assert.equal(calendarCreateProjectId({ mode: 'create', filterProjectIds: ['8'], scopedProjectId: null, projects }), '8')
  assert.equal(calendarCreateProjectId({ mode: 'edit', filterProjectIds: ['7'], scopedProjectId: '7', projects }), '7')
})
