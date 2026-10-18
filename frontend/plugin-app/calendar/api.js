// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { request } from '../adapters/bridge.js'
export const perform = (operation, params = {}, options) => request('calendar', operation, params, options)
export const subscribeChanges = callback => window.awd.events.on('calendar.changed', callback)
export const getTaskProjectOptions = () => perform('projects')
export const getCalendarTasks = (from, to) => perform('list', { from, to })
export const getCalendarSummary = () => perform('summary')
export const getProjectTasks = (projectId, options = {}) => perform('projectTasks', { projectId, ...options })
export const getProjectFiles = projectId => perform('files', { projectId })
export const getProjectMembers = projectId => perform('members', { projectId })
export const createTask = data => perform('create', { data })
export const updateTask = (id, data) => perform('update', { id, data })
export const deleteTask = id => perform('delete', { id })
