// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STARTUP_ENTRY_MODE_KEY,
  VIEW_MODE_STORAGE_KEY,
  normalizeViewMode,
  normalizeStartupEntryMode,
  resolveInitialViewMode,
  isScratchProject,
  hasNonWelcomeOpenTabs,
  shouldShowChatCanvas,
  buildCrossProjectContextItem,
  flattenProjectFileTree,
} from '../../src/pages/project-overview/chatMode.js'
import {
  normalizeContextItem,
  admitFileToContext,
} from '../../src/utils/chatContextLimits.js'
import {
  attachmentRecord,
  attachmentsFromHistory,
  fileListFromBubble,
} from '../../src/utils/chatAttachments.js'

test('storage keys and mode normalizers are stable', () => {
  assert.equal(STARTUP_ENTRY_MODE_KEY, 'awd_startup_entry_mode')
  assert.equal(VIEW_MODE_STORAGE_KEY, 'awd_last_view_mode')
  assert.equal(normalizeViewMode('chat'), 'chat')
  for (const value of ['ide', 'last', '', null, undefined]) assert.equal(normalizeViewMode(value), 'ide')
  assert.equal(normalizeStartupEntryMode('chat'), 'chat')
  assert.equal(normalizeStartupEntryMode('last'), 'last')
  for (const value of ['welcome', 'ide', '', null]) assert.equal(normalizeStartupEntryMode(value), 'welcome')
})

test('initial view mode follows query, startup preference, then welcome fallback', () => {
  assert.equal(resolveInitialViewMode({ queryMode: 'ide', startupEntryMode: 'chat' }), 'ide')
  assert.equal(resolveInitialViewMode({ queryMode: 'chat', startupEntryMode: 'welcome' }), 'chat')
  assert.equal(resolveInitialViewMode({ startupEntryMode: 'chat' }), 'chat')
  assert.equal(resolveInitialViewMode({ startupEntryMode: 'last', lastViewMode: 'chat' }), 'chat')
  assert.equal(resolveInitialViewMode({ startupEntryMode: 'last', lastViewMode: 'invalid' }), 'ide')
  assert.equal(resolveInitialViewMode({ startupEntryMode: 'welcome', lastViewMode: 'chat' }), 'ide')
})

test('scratch detection and welcome-only tab handling', () => {
  assert.equal(isScratchProject({ projectType: 'SCRATCH' }), true)
  assert.equal(isScratchProject({ projectType: 'BLANK' }), false)
  assert.equal(isScratchProject(null), false)
  assert.equal(hasNonWelcomeOpenTabs([{ id: 'welcome', tabType: 'welcome' }]), false)
  assert.equal(hasNonWelcomeOpenTabs([null, { id: 1, tabType: 'welcome' }, { id: 2 }]), true)
  assert.equal(hasNonWelcomeOpenTabs(null), false)
})

test('canvas requires chat mode, an explicit open request and a non-welcome tab', () => {
  const tabs = [{ id: 1, name: 'a.docx' }]
  assert.equal(shouldShowChatCanvas({ viewMode: 'chat', chatCanvasOpen: true, openTabs: tabs }), true)
  assert.equal(shouldShowChatCanvas({ viewMode: 'ide', chatCanvasOpen: true, openTabs: tabs }), false)
  assert.equal(shouldShowChatCanvas({ viewMode: 'chat', chatCanvasOpen: false, openTabs: tabs }), false)
  assert.equal(shouldShowChatCanvas({ viewMode: 'chat', chatCanvasOpen: true, openTabs: [{ tabType: 'welcome' }] }), false)
})

test('cross-project context item keeps source identity and read-only boundary', () => {
  const file = { id: 9, name: '协议.DOCX', isFolder: false, fileType: '', wpsFileId: 'wps-9' }
  const project = { id: 3, name: '并购项目' }
  assert.deepEqual(buildCrossProjectContextItem(file, project), {
    id: 9,
    name: '协议.DOCX',
    isDir: false,
    fileType: 'docx',
    projectId: 3,
    projectName: '并购项目',
    readOnly: true,
  })
  assert.equal(buildCrossProjectContextItem({ id: 2, name: 'notes', projectId: 4, projectName: '旧项目' }, null).projectName, '旧项目')
})

test('flattens nested file trees and omits folders and deleted files', () => {
  const nodes = [{ id: 1, name: '材料', isFolder: true, children: [
    { id: 2, name: '合同.docx', fileType: 'docx' },
    { id: 3, name: '旧稿.md', isDeleted: true },
    { id: 4, name: '附件', isFolder: true, children: [{ id: 5, name: '证据.pdf' }] },
  ] }]
  assert.deepEqual(flattenProjectFileTree(nodes).map((file) => [file.id, file.relativePath]), [
    [2, '材料/合同.docx'],
    [5, '材料/附件/证据.pdf'],
  ])
})

test('flattens parentId lists, including roots represented by zero and orphan parents', () => {
  const nodes = [
    { id: 1, name: '根目录', isFolder: true },
    { id: 2, parentId: 1, name: '子目录', isFolder: true },
    { id: 3, parentId: 2, name: '正文.docx' },
    { id: 4, parentId: 0, name: '说明.md' },
    { id: 5, parentId: 999, name: '孤儿.txt' },
  ]
  assert.deepEqual(flattenProjectFileTree(nodes).map((file) => file.relativePath), [
    '根目录/子目录/正文.docx',
    '说明.md',
    '孤儿.txt',
  ])
  assert.deepEqual(flattenProjectFileTree(null), [])
})

test('cross-project context items preserve project metadata through context limits and attachment records', () => {
  const crossItem = buildCrossProjectContextItem(
    { id: 10, name: '尽调报告.docx', isFolder: false, fileType: 'docx' },
    { id: 88, name: 'A轮融资项目' }
  )
  const normalized = normalizeContextItem(crossItem)
  assert.equal(normalized.projectId, 88)
  assert.equal(normalized.projectName, 'A轮融资项目')
  assert.equal(normalized.readOnly, true)

  const localSameId = normalizeContextItem({ id: 10, name: '本地同名ID.docx', fileType: 'docx' })
  const admitCross = admitFileToContext({ file: normalized, contextFiles: [localSameId], pastedImages: [] })
  assert.equal(admitCross.ok, true, 'same file id from a different project must not be rejected as duplicate')
  const admitDup = admitFileToContext({ file: normalized, contextFiles: [normalized], pastedImages: [] })
  assert.equal(admitDup.ok, false)
  assert.equal(admitDup.reason, 'duplicate')

  const record = attachmentRecord(normalized)
  assert.equal(record.projectId, 88)
  assert.equal(record.projectName, 'A轮融资项目')
  assert.equal(record.readOnly, true)

  const restored = attachmentsFromHistory([{ ...record, fileId: record.id }])
  assert.equal(restored[0].projectId, 88)
  assert.equal(restored[0].projectName, 'A轮融资项目')
  assert.equal(restored[0].readOnly, true)

  const bubbleFiles = fileListFromBubble({ contextFiles: restored })
  assert.equal(bubbleFiles[0].projectId, 88)
  assert.equal(bubbleFiles[0].projectName, 'A轮融资项目')
  assert.equal(bubbleFiles[0].readOnly, true)
})

test('workbench header mode switcher, welcome quick chat, and chat sidebar contracts are wired', () => {
  const overviewSrc = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const welcomeSrc = readFileSync(new URL('../../src/components/welcome/WelcomePane.vue', import.meta.url), 'utf8')
  const sidebarSrc = readFileSync(new URL('../../src/components/chat/ChatModeSidebar.vue', import.meta.url), 'utf8')

  assert.match(overviewSrc, /class="mode-switch-capsule"/)
  assert.match(overviewSrc, /<ChatModeSidebar[\s\S]*?v-if="isChatMode"/)
  assert.match(overviewSrc, /ensureScratchWorkspaceLoaded\(\)/)
  assert.match(overviewSrc, /handlePromoteScratchWorkspace\(\)/)
  assert.match(welcomeSrc, /class="welcome-quick-chat"/)
  assert.match(welcomeSrc, /submitQuickChat/)
  assert.match(sidebarSrc, /attach-cross-project-file/)
  assert.match(sidebarSrc, /promote-scratch/)
})
