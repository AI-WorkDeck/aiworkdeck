// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Build-time replacement for the host's authenticated API module. This bundle
// contains no session headers, API base URL, HTTP proxy, or desktop preload API.
import { request } from './bridge.js'
export const searchProjectContent = (_projectId, payload, options) => request('search', 'query', payload, options)
export const getProjectTags = () => request('search', 'tags', {})
export const getSensitiveOptions = () => request('sensitive', 'options', {})
export const previewSensitiveFile = payload => request('sensitive', 'preview', payload, { timeoutMs: 300000 })
export const desensitizeFile = payload => request('sensitive', 'redact', payload, { timeoutMs: 300000 })
export const restoreSensitiveFile = payload => request('sensitive', 'restore', payload, { timeoutMs: 300000 })
export const getLitigationVisualStatus = () => request('litigation', 'status', {})
export const getLitigationDiagrams = () => request('litigation', 'list', {})
export const getLitigationKickoffPrompt = (_projectId, payload) => request('litigation', 'kickoff', payload)
export const restyleLitigationDiagram = (_projectId, folderId, mode, confirmOverwrite) => request('litigation', 'restyle', { folderId, mode, confirmOverwrite })
export const packStatus = () => request('litigation', 'packStatus', {})
export const packInstall = () => request('litigation', 'packInstall', {})
