// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { addDaysKey, localDateKey, isDone, compareDue } from './taskUtils.js'
import { writableProjects } from '../../utils/personalCollections.js'

export const CALENDAR_VIEWS = ['timeGridDay', 'timeGridWeek', 'dayGridMonth', 'year', 'listMonth']
export function createCalendarWorkspaceState() {
  return { revision: 0, projectIds: [], types: [], includeDone: true, recentDays: 3,
    date: localDateKey(), viewType: 'dayGridMonth', fileId: '', fileName: '' }
}

// This is presentation state only. Data reads and writes retain their existing ACL checks.
export function patchCalendarWorkspaceState(current, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current
  const next = { ...current }
  if (Array.isArray(patch.projectIds)) next.projectIds = [...new Set(patch.projectIds.map(String).filter(id => /^[1-9]\d*$/.test(id)))].slice(0, 500)
  if (Array.isArray(patch.types)) next.types = [...new Set(patch.types.filter(type => ['DEADLINE', 'HEARING', 'MEETING', 'TODO', 'OTHER'].includes(type)))]
  if (typeof patch.includeDone === 'boolean') next.includeDone = patch.includeDone
  if ([3, 5].includes(patch.recentDays)) next.recentDays = patch.recentDays
  if (CALENDAR_VIEWS.includes(patch.viewType)) next.viewType = patch.viewType
  if (/^\d{4}-\d{2}-\d{2}$/.test(patch.date || '')) {
    const date = new Date(patch.date + 'T12:00:00')
    if (Number.isFinite(date.getTime()) && localDateKey(date) === patch.date) next.date = patch.date
  }
  if (patch.fileId === '' || /^[1-9]\d*$/.test(String(patch.fileId))) {
    next.fileId = String(patch.fileId)
    next.fileName = next.fileId ? String(patch.fileName || '').slice(0, 300) : ''
  }
  if (JSON.stringify(next) !== JSON.stringify(current)) next.revision = (current.revision || 0) + 1
  return next
}

export function upcomingTasks(tasks, today, days) {
  const end = addDaysKey(today, days === 5 ? 5 : 3)
  return tasks.filter(task => !isDone(task) && task.dueDate >= today && task.dueDate < end).slice().sort(compareDue)
}

export function calendarCreateProjectId({ mode, filterProjectIds, scopedProjectId, projects }) {
  if (mode !== 'create') return scopedProjectId
  const candidate = filterProjectIds.length === 1 ? filterProjectIds[0] : scopedProjectId
  if (candidate === null || candidate === '') return candidate
  const project = (Array.isArray(projects) ? projects : []).find(item => String(item?.id) === String(candidate))
  return project && writableProjects([project]).length ? candidate : null
}

export function yearMonths(year, locale, tasks = []) {
  const counts = new Map()
  for (const task of tasks) if (task.dueDate) counts.set(task.dueDate, (counts.get(task.dueDate) || 0) + 1)
  return Array.from({ length: 12 }, (_, month) => {
    const first = new Date(year, month, 1)
    const offset = (first.getDay() + 6) % 7
    const total = new Date(year, month + 1, 0).getDate()
    return { month, label: first.toLocaleDateString(locale, { month: 'long' }),
      days: Array.from({ length: offset + total }, (_, index) => {
        const day = index - offset + 1
        if (day < 1) return null
        const date = localDateKey(new Date(year, month, day))
        return { date, day, count: counts.get(date) || 0 }
      }) }
  })
}
