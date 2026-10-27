// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { createCalendarWorkspaceState, patchCalendarWorkspaceState, upcomingTasks, yearMonths } from '../../src/components/calendar/workspaceState.js'
import { calendarTabMethods } from '../../src/pages/project-overview/calendarTab.js'

test('calendar workspace applies independent partial edits without dropping the other surface state', () => {
  const state = createCalendarWorkspaceState()
  const first = patchCalendarWorkspaceState(state, { projectIds: [7, '7', '8'], recentDays: 5 })
  const second = patchCalendarWorkspaceState(first, { viewType: 'year', date: '2028-02-29' })
  assert.deepEqual(second.projectIds, ['7', '8'])
  assert.equal(second.recentDays, 5)
  assert.equal(second.viewType, 'year')
  assert.equal(second.date, '2028-02-29')
  assert.equal(second.revision, 2)
  assert.equal(patchCalendarWorkspaceState(second, { recentDays: 5 }).revision, 2)
  assert.deepEqual(patchCalendarWorkspaceState(second, { date: '2027-02-29', viewType: 'javascript', includeDone: 'true', unknown: 'x' }), second)
  assert.deepEqual(patchCalendarWorkspaceState(second, null), second)
})

test('upcoming window includes today and ends before the fourth or sixth local day, including year boundaries', () => {
  const tasks = [
    { id: 1, dueDate: '2026-12-30', dueTime: '12:00', status: 'OPEN' },
    { id: 2, dueDate: '2026-12-29', status: 'OPEN' },
    { id: 3, dueDate: '2027-01-01', status: 'OPEN' },
    { id: 4, dueDate: '2027-01-02', status: 'OPEN' },
    { id: 5, dueDate: '2027-01-03', status: 'OPEN' },
    { id: 6, dueDate: '2027-01-04', status: 'OPEN' },
    { id: 7, dueDate: '2026-12-30', status: 'DONE' },
  ]
  assert.deepEqual(upcomingTasks(tasks, '2026-12-30', 3).map(task => task.id), [1, 3])
  assert.deepEqual(upcomingTasks(tasks, '2026-12-30', 5).map(task => task.id), [1, 3, 4, 5])
})

test('year calendar uses Monday-aligned actual dates and preserves leap-day event counts', () => {
  const months = yearMonths(2028, 'en-US', [{ dueDate: '2028-02-29' }, { dueDate: '2028-02-29' }, { dueDate: '2027-02-28' }])
  assert.equal(months.length, 12)
  const february = months[1]
  assert.equal(february.days[0], null)
  assert.equal(february.days.filter(Boolean).length, 29)
  assert.deepEqual(february.days.at(-1), { date: '2028-02-29', day: 29, count: 2 })
})

test('host shares one revisioned state, preserves project context and opens the workspace for sidebar actions', () => {
  const events = [], opened = [], ticks = []
  globalThis.uni = { $emit: (...args) => events.push(args) }
  const host = { hasProject: true, projectId: 7, openPluginTab: id => opened.push(id), $nextTick: callback => ticks.push(callback) }
  const run = params => calendarTabMethods.calendarWorkspace.call(host, params)
  assert.equal(run({}).currentProjectId, '7')
  const first = run({ patch: { projectIds: ['8'] }, open: true })
  assert.equal(first.revision, 1)
  const second = run({ patch: { viewType: 'timeGridWeek' }, focus: 32 })
  assert.deepEqual(second.projectIds, ['8'])
  assert.deepEqual(opened, ['calendar', 'calendar'])
  ticks.forEach(callback => callback())
  assert.equal(events.at(-1)[1].focus, '32')
  assert.equal(events.at(-1)[1].state.revision, 2)
  assert.equal(run({}).viewType, 'timeGridWeek')
})


test('actual reactive workbench state is detached before forwarding through the opaque iframe channel', () => {
  const events = []
  globalThis.uni = { $emit: (_name, payload) => events.push(structuredClone(payload)) }
  const host = reactive({ hasProject: true, projectId: 7, calendarWorkspaceState: createCalendarWorkspaceState(),
    openPluginTab() {}, $nextTick: callback => callback() })
  calendarTabMethods.calendarWorkspace.call(host, { patch: { projectIds: ['8'] } })
  const result = calendarTabMethods.calendarWorkspace.call(host, { patch: { recentDays: 5 } })
  assert.deepEqual(structuredClone(result).projectIds, ['8'])
  assert.equal(events.at(-1).state.recentDays, 5)
})
