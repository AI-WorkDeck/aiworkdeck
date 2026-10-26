<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="chat-mode-sidebar" :class="{ collapsed }">
    <template v-if="collapsed">
      <view class="chat-sidebar-strip-action" :title="$t('workbench.chatMode.expandSidebar')" @click="$emit('toggle-collapse')">
        <svg class="chat-sidebar-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path v-for="(d, gi) in ICONS.panelLeft" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </view>
      <view class="chat-sidebar-strip-action" :title="$t('workbench.chatMode.newChat')" @click="$emit('new-chat')">
        <svg class="chat-sidebar-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path v-for="(d, gi) in ICONS.plus" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </view>
      <view class="chat-sidebar-strip-action" :title="$t('workbench.chatMode.newDocument')" @click="$emit('create-doc', 'docx')">
        <svg class="chat-sidebar-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path v-for="(d, gi) in ICONS.filePlus" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </view>
    </template>
    <template v-else>
      <view class="chat-sidebar-header">
        <view class="chat-sidebar-new-btn" @click="$emit('new-chat')">
          <svg class="chat-sidebar-icon-sm" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path v-for="(d, gi) in ICONS.plus" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <text>{{ $t('workbench.chatMode.newChat') }}</text>
        </view>
        <view class="chat-sidebar-collapse" :title="$t('workbench.chatMode.collapseSidebar')" @click="$emit('toggle-collapse')">
          <svg class="chat-sidebar-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path v-for="(d, gi) in ICONS.panelLeft" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </view>
      </view>

      <scroll-view scroll-y class="chat-sidebar-scroll">
        <view class="chat-sidebar-section">
          <view class="chat-sidebar-section-header">
            <text class="chat-sidebar-section-title">{{ $t('workbench.chatMode.recentConversations') }}</text>
          </view>
          <input v-model="conversationQuery" class="chat-sidebar-search" :placeholder="$t('workbench.chatMode.searchConversations')" />
          <view
            v-for="conv in filteredConversations"
            :key="conv.id || conv.conversationId"
            class="chat-sidebar-row conversation-row"
            :class="{ active: String(conv.id || conv.conversationId) === String(currentConversationId || '') }"
            @click="$emit('select-conversation', conv.id || conv.conversationId)"
          >
            <svg class="chat-sidebar-row-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path v-for="(d, gi) in ICONS.chat" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <text class="chat-sidebar-row-name">{{ conv.title || $t('workbench.chatMode.newChat') }}</text>
            <view class="chat-sidebar-row-delete" :title="$t('workbench.chatMode.deleteConversation')" @click.stop="$emit('delete-conversation', conv.id || conv.conversationId)">
              <svg class="chat-sidebar-icon-sm" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path v-for="(d, gi) in ICONS.close" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </view>
          </view>
          <text v-if="!filteredConversations.length" class="chat-sidebar-empty">{{ $t('workbench.chatMode.noConversations') }}</text>
        </view>

        <view class="chat-sidebar-section">
          <view class="chat-sidebar-section-header">
            <text class="chat-sidebar-section-title">{{ $t('workbench.chatMode.workspaceFiles') }}</text>
            <view class="chat-sidebar-doc-actions">
              <view class="chat-sidebar-section-action" @click="$emit('create-doc', 'docx')">
                <svg class="chat-sidebar-icon-sm" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path v-for="(d, gi) in ICONS.plus" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <text>Word</text>
              </view>
              <view class="chat-sidebar-section-action" @click="$emit('create-doc', 'md')">
                <svg class="chat-sidebar-icon-sm" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path v-for="(d, gi) in ICONS.plus" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <text>MD</text>
              </view>
            </view>
          </view>
          <view
            v-for="file in regularWorkspaceFiles"
            :key="file.id"
            class="chat-sidebar-row"
            :class="{ active: String(activeFileId) === String(file.id) }"
            @click="$emit('open-file', file)"
          >
            <svg class="chat-sidebar-row-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path v-for="(d, gi) in (file.fileType === 'md' ? ICONS.docText : ICONS.doc)" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <text class="chat-sidebar-row-name" :title="file.relativePath || file.name">{{ file.name }}</text>
          </view>
          <text v-if="!regularWorkspaceFiles.length" class="chat-sidebar-empty">{{ $t('workbench.chatMode.noWorkspaceFiles') }}</text>
        </view>

        <view class="chat-sidebar-section cross-project-section">
          <view class="chat-sidebar-section-header">
            <text class="chat-sidebar-section-title">{{ $t('workbench.chatMode.crossProject') }}</text>
          </view>
          <input v-model="crossSearchQuery" class="chat-sidebar-search" :placeholder="$t('workbench.chatMode.crossProjectSearch')" />
          <text v-if="projectsError" class="chat-sidebar-empty chat-sidebar-error" @click="loadProjects">{{ $t('workbench.chatMode.retry') }}</text>
          <view v-for="proj in filteredProjects" :key="proj.id" class="cross-project-group">
            <view class="chat-sidebar-row project-row" @click="toggleProject(proj)">
              <svg class="cross-project-chevron" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path v-for="(d, gi) in (expandedProjectIds[proj.id] ? ICONS.chevronDown : ICONS.chevronRight)" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg class="chat-sidebar-row-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path v-for="(d, gi) in ICONS.folder" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <text class="chat-sidebar-row-name">{{ proj.name }}</text>
            </view>
            <template v-if="expandedProjectIds[proj.id]">
              <text v-if="loadingProjectIds[proj.id]" class="chat-sidebar-empty">{{ $t('workbench.chatMode.loading') }}</text>
              <template v-else>
                <view
                  v-for="file in filesForProject(proj)"
                  :key="file.id"
                  class="chat-sidebar-row cross-file-row"
                  @click="$emit('open-file', { ...file, projectId: proj.id, projectName: proj.name, tabType: 'cross-project-preview', readOnly: true })"
                >
                  <svg class="chat-sidebar-row-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path v-for="(d, gi) in ICONS.doc" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <text class="chat-sidebar-row-name" :title="file.relativePath">{{ file.name }}</text>
                  <view class="cross-project-attach" @click.stop="$emit('attach-cross-project-file', { file, project: proj })">
                    <text>{{ $t('workbench.chatMode.attach') }}</text>
                  </view>
                </view>
                <text v-if="!filesForProject(proj).length" class="chat-sidebar-empty">{{ $t('workbench.chatMode.noMatchingFiles') }}</text>
              </template>
            </template>
          </view>
          <text v-if="!projectsLoading && !filteredProjects.length && !projectsError" class="chat-sidebar-empty">{{ $t('workbench.chatMode.noMatchingProjects') }}</text>
        </view>
      </scroll-view>
    </template>
  </view>
</template>

<script>
import { getMyProjects, getProjectFiles } from '@/services/api'
import { flattenProjectFileTree } from '@/pages/project-overview/chatMode'
import { ICONS } from '@/config/icons.js'

export default {
  name: 'ChatModeSidebar',
  props: {
    collapsed: { type: Boolean, default: false },
    project: { type: Object, default: null },
    isScratch: { type: Boolean, default: false },
    conversations: { type: Array, default: () => [] },
    currentConversationId: { type: String, default: '' },
    workspaceFiles: { type: Array, default: () => [] },
    activeFileId: { type: [Number, String], default: null },
  },
  emits: [
    'toggle-collapse',
    'new-chat',
    'select-conversation',
    'delete-conversation',
    'create-doc',
    'open-file',
    'attach-cross-project-file',
    'promote-scratch',
    'switch-to-ide',
  ],
  data() {
    return {
      conversationQuery: '',
      crossSearchQuery: '',
      projects: [],
      projectsLoading: false,
      projectsError: false,
      expandedProjectIds: {},
      loadingProjectIds: {},
      projectFilesMap: {},
    }
  },
  computed: {
    ICONS() {
      return ICONS
    },
    filteredConversations() {
      const query = this.conversationQuery.trim().toLowerCase()
      if (!query) return this.conversations
      return this.conversations.filter((conv) => String(conv.title || conv.lastMessage || '').toLowerCase().includes(query))
    },
    regularWorkspaceFiles() {
      return this.workspaceFiles.filter((file) => file && !file.isFolder && !file.isDeleted)
    },
    filteredProjects() {
      const query = this.crossSearchQuery.trim().toLowerCase()
      const available = this.projects.filter((proj) => String(proj.id) !== String(this.project?.id ?? '') && proj.projectType !== 'SCRATCH')
      if (!query) return available
      return available.filter((proj) => String(proj.name || '').toLowerCase().includes(query)
        || flattenProjectFileTree(this.projectFilesMap[proj.id] || []).some((file) => `${file.relativePath} ${file.name}`.toLowerCase().includes(query)))
    },
  },
  mounted() {
    this.loadProjects()
  },
  methods: {
    async loadProjects() {
      this.projectsLoading = true
      this.projectsError = false
      try {
        const res = await getMyProjects()
        this.projects = Array.isArray(res) ? res : (res?.data || [])
      } catch (error) {
        this.projectsError = true
      } finally {
        this.projectsLoading = false
      }
    },
    filesForProject(proj) {
      const files = this.projectFilesMap[proj.id] || []
      const query = this.crossSearchQuery.trim().toLowerCase()
      if (!query || String(proj.name || '').toLowerCase().includes(query)) return files
      return files.filter((file) => `${file.relativePath} ${file.name}`.toLowerCase().includes(query))
    },
    async toggleProject(proj) {
      const id = proj.id
      this.expandedProjectIds = { ...this.expandedProjectIds, [id]: !this.expandedProjectIds[id] }
      if (!this.expandedProjectIds[id] || this.projectFilesMap[id]) return
      this.loadingProjectIds = { ...this.loadingProjectIds, [id]: true }
      try {
        const res = await getProjectFiles(id, null, true)
        const nodes = Array.isArray(res) ? res : (res?.data || [])
        this.projectFilesMap = { ...this.projectFilesMap, [id]: flattenProjectFileTree(nodes) }
      } catch (error) {
        this.expandedProjectIds = { ...this.expandedProjectIds, [id]: false }
        uni.showToast({ title: this.$t('workbench.chatMode.loadFilesFailed'), icon: 'none' })
      } finally {
        this.loadingProjectIds = { ...this.loadingProjectIds, [id]: false }
      }
    },
  },
}
</script>

<style scoped>
.chat-mode-sidebar { width: 248px; flex: 0 0 248px; min-height: 0; display: flex; flex-direction: column; background: var(--awd-bg); border-right: 1px solid var(--awd-border-subtle); color: var(--awd-text); }
.chat-mode-sidebar.collapsed { width: 40px; flex-basis: 40px; align-items: center; padding-top: 8px; box-sizing: border-box; }
.chat-sidebar-icon { width: 16px; height: 16px; flex-shrink: 0; }
.chat-sidebar-icon-sm { width: 13px; height: 13px; flex-shrink: 0; }
.chat-sidebar-strip-action { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; margin-bottom: 6px; border-radius: var(--awd-radius-sm); color: var(--awd-text-2); cursor: pointer; }
.chat-sidebar-strip-action:hover, .chat-sidebar-collapse:hover, .chat-sidebar-section-action:hover { color: var(--awd-text); background: var(--awd-surface-2); }
.chat-sidebar-header { min-height: 44px; padding: 8px 10px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--awd-border-subtle); }
.chat-sidebar-new-btn { flex: 1; height: 28px; padding: 0 10px; display: flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-sm); background: var(--awd-surface); color: var(--awd-text); font-size: var(--awd-panel-fs); font-weight: 500; cursor: pointer; transition: background-color 0.15s ease, border-color 0.15s ease; }
.chat-sidebar-new-btn:hover { background: var(--awd-surface-2); border-color: var(--awd-border); }
.chat-sidebar-collapse { width: 28px; height: 28px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: var(--awd-radius-sm); color: var(--awd-text-3); cursor: pointer; }
.chat-sidebar-scroll { flex: 1; min-height: 0; }
.chat-sidebar-section { padding: 12px 10px; border-bottom: 1px solid var(--awd-border-subtle); }
.chat-sidebar-section-header { min-height: 24px; display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px; color: var(--awd-text-2); font-size: var(--awd-panel-fs-sec); font-weight: 600; }
.chat-sidebar-section-action { display: flex; align-items: center; gap: 3px; height: 22px; padding: 0 6px; border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-sm); background: var(--awd-surface); color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); font-weight: 400; white-space: nowrap; cursor: pointer; }
.chat-sidebar-doc-actions { display: flex; gap: 4px; }
.chat-sidebar-search { width: 100%; height: 28px; margin-bottom: 8px; padding: 0 8px; box-sizing: border-box; display: flex; align-items: center; border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-sm); background: var(--awd-surface); color: var(--awd-text); font-size: var(--awd-panel-fs-meta); }
.chat-sidebar-search :deep(.uni-input-wrapper), .chat-sidebar-search :deep(.uni-input-input), .chat-sidebar-search :deep(input) { width: 100%; height: 100%; border: none !important; outline: none !important; box-shadow: none !important; background: transparent !important; padding: 0 !important; margin: 0 !important; color: var(--awd-text); font-size: var(--awd-panel-fs-meta); line-height: 26px; }
.chat-sidebar-search :deep(.uni-input-placeholder) { color: var(--awd-text-3); line-height: 26px; }
.chat-sidebar-row { min-height: 28px; display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: var(--awd-radius-sm); color: var(--awd-text-2); font-size: var(--awd-panel-fs); cursor: pointer; }
.chat-sidebar-row:hover, .chat-sidebar-row.active { background: var(--awd-surface-2); color: var(--awd-text); }
.chat-sidebar-row.active { box-shadow: inset 2px 0 0 var(--awd-accent); }
.chat-sidebar-row-icon { width: 15px; height: 15px; flex-shrink: 0; color: var(--awd-text-3); }
.chat-sidebar-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-sidebar-row-delete { display: none; width: 20px; height: 20px; align-items: center; justify-content: center; border-radius: var(--awd-radius-sm); color: var(--awd-text-3); }
.chat-sidebar-row-delete:hover { color: var(--awd-danger); background: var(--awd-surface); }
.conversation-row:hover .chat-sidebar-row-delete { display: flex; }
.chat-sidebar-empty { display: block; padding: 6px 4px; color: var(--awd-text-3); font-size: var(--awd-panel-fs-meta); line-height: 1.5; }
.chat-sidebar-error { color: var(--awd-danger); cursor: pointer; }
.cross-project-section { border-bottom: none; }
.cross-project-chevron { width: 13px; height: 13px; flex-shrink: 0; color: var(--awd-text-3); }
.cross-file-row { padding-left: 20px; }
.cross-project-attach { flex-shrink: 0; padding: 1px 6px; border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-sm); color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); }
.cross-project-attach:hover { color: var(--awd-accent-text); border-color: var(--awd-accent); background: var(--awd-accent-soft); }
</style>
