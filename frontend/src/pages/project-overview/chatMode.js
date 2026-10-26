// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export const STARTUP_ENTRY_MODE_KEY = 'awd_startup_entry_mode'
export const VIEW_MODE_STORAGE_KEY = 'awd_last_view_mode'

export function normalizeViewMode(mode) {
  return mode === 'chat' ? 'chat' : 'ide'
}

export function normalizeStartupEntryMode(mode) {
  return mode === 'chat' || mode === 'last' ? mode : 'welcome'
}

export function resolveInitialViewMode({ queryMode, startupEntryMode, lastViewMode } = {}) {
  if (queryMode === 'chat' || queryMode === 'ide') return queryMode
  const startup = normalizeStartupEntryMode(startupEntryMode)
  if (startup === 'chat') return 'chat'
  if (startup === 'last') return normalizeViewMode(lastViewMode)
  return 'ide'
}

export function isScratchProject(project) {
  return Boolean(project && project.projectType === 'SCRATCH')
}

export function hasNonWelcomeOpenTabs(openTabs) {
  return Array.isArray(openTabs) && openTabs.some((tab) => tab && tab.tabType !== 'welcome')
}

export function shouldShowChatCanvas({ viewMode, chatCanvasOpen, openTabs } = {}) {
  return Boolean(viewMode === 'chat' && chatCanvasOpen && hasNonWelcomeOpenTabs(openTabs))
}

export function buildCrossProjectContextItem(file, project) {
  return {
    id: file.id,
    name: file.name,
    isDir: Boolean(file.isFolder),
    fileType: file.fileType || (file.name && file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : ''),
    projectId: project ? project.id : file.projectId,
    projectName: project ? project.name : (file.projectName || ''),
    readOnly: true,
  }
}

export function flattenProjectFileTree(nodes, parentPath = '') {
  if (!Array.isArray(nodes)) return []
  const byId = new Map()
  const hasNestedChildren = nodes.some((node) => Array.isArray(node?.children))
  if (!hasNestedChildren) {
    nodes.forEach((node) => {
      if (node && node.id != null) byId.set(String(node.id), node)
    })
  }
  const result = []
  const visited = new Set()
  const walk = (node, basePath) => {
    if (!node || visited.has(node)) return
    visited.add(node)
    const relativePath = [basePath, node.name || ''].filter(Boolean).join('/')
    if (!node.isFolder && !node.isDeleted) result.push({ ...node, relativePath })
    let children = Array.isArray(node.children) ? node.children : []
    if (!children.length && !hasNestedChildren && node.id != null) {
      children = nodes.filter((candidate) => candidate && String(candidate.parentId ?? '') === String(node.id))
    }
    children.forEach((child) => walk(child, relativePath))
  }
  const roots = hasNestedChildren ? nodes : nodes.filter((node) => {
    if (!node || node.parentId == null || node.parentId === 0 || node.parentId === '0') return true
    return !byId.has(String(node.parentId))
  })
  roots.forEach((node) => walk(node, parentPath))
  nodes.forEach((node) => walk(node, parentPath))
  return result
}
