<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="chat-mode-sidebar" :class="{ collapsed }">
    <template v-if="collapsed">
      <view class="chat-sidebar-strip-action" :title="$t('workbench.chatMode.expandSidebar')" @click="$emit('toggle-collapse')">»</view>
      <view class="chat-sidebar-strip-action" :title="$t('workbench.chatMode.newChat')" @click="$emit('new-chat')">＋</view>
      <view class="chat-sidebar-strip-action" :title="$t('workbench.chatMode.newDocument')" @click="$emit('create-doc', 'docx')">▤</view>
    </template>
    <template v-else>
      <view class="chat-sidebar-header">
        <view class="chat-sidebar-heading" @click="$emit('switch-to-ide')">
          <text class="chat-sidebar-title">{{ isScratch ? $t('workbench.chatMode.scratchTitle') : (project?.name || $t('workbench.chatMode.chatTitle')) }}</text>
          <text v-if="isScratch" class="chat-sidebar-scratch-badge">{{ $t('workbench.chatMode.scratchBadge') }}</text>
        </view>
        <view class="chat-sidebar-collapse" :title="$t('workbench.chatMode.collapseSidebar')" @click="$emit('toggle-collapse')">«</view>
      </view>
      <view v-if="isScratch" class="chat-sidebar-promote" @click="$emit('promote-scratch')">{{ $t('workbench.chatMode.promoteAction') }}</view>

      <scroll-view scroll-y class="chat-sidebar-scroll">
        <view class="chat-sidebar-section">
          <view class="chat-sidebar-section-header">
            <text>{{ $t('workbench.chatMode.recentConversations') }}</text>
            <view class="chat-sidebar-section-action" @click="$emit('new-chat')">＋ {{ $t('workbench.chatMode.newChat') }}</view>
          </view>
          <input v-model="conversationQuery" class="chat-sidebar-search" :placeholder="$t('workbench.chatMode.searchConversations')" />
          <view v-for="conv in filteredConversations" :key="conv.id || conv.conversationId" class="chat-sidebar-row conversation-row" :class="{ active: String(conv.id || conv.conversationId) === String(currentConversationId || '') }" @click="$emit('select-conversation', conv.id || conv.conversationId)">
            <text class="chat-sidebar-row-name">{{ conv.title || $t('workbench.chatMode.newChat') }}</text>
            <text class="chat-sidebar-row-delete" :title="$t('workbench.chatMode.deleteConversation')" @click.stop="$emit('delete-conversation', conv.id || conv.conversationId)">×</text>
          </view>
          <text v-if="!filteredConversations.length" class="chat-sidebar-empty">{{ $t('workbench.chatMode.noConversations') }}</text>
        </view>

        <view class="chat-sidebar-section">
          <view class="chat-sidebar-section-header">
            <text>{{ $t('workbench.chatMode.workspaceFiles') }}</text>
            <view class="chat-sidebar-doc-actions">
              <view class="chat-sidebar-section-action" @click="$emit('create-doc', 'docx')">＋ Word</view>
              <view class="chat-sidebar-section-action" @click="$emit('create-doc', 'md')">＋ MD</view>
            </view>
          </view>
          <view v-for="file in regularWorkspaceFiles" :key="file.id" class="chat-sidebar-row" :class="{ active: String(activeFileId) === String(file.id) }" @click="$emit('open-file', file)">
            <text class="chat-sidebar-file-icon">{{ file.fileType === 'md' ? 'MD' : 'W' }}</text>
            <text class="chat-sidebar-row-name" :title="file.relativePath || file.name">{{ file.name }}</text>
          </view>
          <text v-if="!regularWorkspaceFiles.length" class="chat-sidebar-empty">{{ $t('workbench.chatMode.noWorkspaceFiles') }}</text>
        </view>

        <view class="chat-sidebar-section cross-project-section">
          <view class="chat-sidebar-section-header"><text>{{ $t('workbench.chatMode.crossProject') }}</text></view>
          <input v-model="crossSearchQuery" class="chat-sidebar-search" :placeholder="$t('workbench.chatMode.crossProjectSearch')" />
          <text v-if="projectsError" class="chat-sidebar-empty chat-sidebar-error" @click="loadProjects">{{ $t('workbench.chatMode.retry') }}</text>
          <view v-for="proj in filteredProjects" :key="proj.id" class="cross-project-group">
            <view class="chat-sidebar-row project-row" @click="toggleProject(proj)">
              <text class="cross-project-chevron">{{ expandedProjectIds[proj.id] ? '▾' : '▸' }}</text>
              <text class="chat-sidebar-row-name">{{ proj.name }}</text>
            </view>
            <template v-if="expandedProjectIds[proj.id]">
              <text v-if="loadingProjectIds[proj.id]" class="chat-sidebar-empty">{{ $t('workbench.chatMode.loading') }}</text>
              <template v-else>
                <view v-for="file in filesForProject(proj)" :key="file.id" class="chat-sidebar-row cross-file-row" @click="$emit('open-file', { ...file, projectId: proj.id, projectName: proj.name, tabType: 'cross-project-preview', readOnly: true })">
                  <text class="chat-sidebar-row-name" :title="file.relativePath">{{ file.name }}</text>
                  <view class="cross-project-attach" @click.stop="$emit('attach-cross-project-file', { file, project: proj })">＋ {{ $t('workbench.chatMode.attach') }}</view>
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
.chat-sidebar-strip-action { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 6px; border-radius: var(--awd-radius-sm); color: var(--awd-text-2); cursor: pointer; }
.chat-sidebar-strip-action:hover, .chat-sidebar-collapse:hover, .chat-sidebar-section-action:hover { color: var(--awd-accent-text); background: var(--awd-accent-soft); }
.chat-sidebar-header { min-height: 42px; padding: 6px 10px; box-sizing: border-box; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--awd-border-subtle); }
.chat-sidebar-heading { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.chat-sidebar-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--awd-font-size-body); font-weight: 600; }
.chat-sidebar-scratch-badge { flex-shrink: 0; padding: 1px 5px; border-radius: 999px; background: var(--awd-accent-soft); color: var(--awd-accent-text); font-size: var(--awd-panel-fs-meta); }
.chat-sidebar-collapse { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: var(--awd-radius-sm); color: var(--awd-text-3); cursor: pointer; }
.chat-sidebar-promote { margin: 8px 10px 0; padding: 6px 8px; border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-sm); color: var(--awd-accent-text); font-size: var(--awd-panel-fs-meta); text-align: center; cursor: pointer; }
.chat-sidebar-scroll { flex: 1; min-height: 0; }
.chat-sidebar-section { padding: 10px 8px; border-bottom: 1px solid var(--awd-border-subtle); }
.chat-sidebar-section-header { min-height: 24px; display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 5px; color: var(--awd-text-2); font-size: var(--awd-panel-fs-sec); font-weight: 600; }
.chat-sidebar-section-action { padding: 2px 4px; border-radius: var(--awd-radius-sm); color: var(--awd-accent-text); font-size: var(--awd-panel-fs-meta); font-weight: 400; white-space: nowrap; cursor: pointer; }
.chat-sidebar-doc-actions { display: flex; gap: 2px; }
.chat-sidebar-search { width: 100%; height: 28px; margin-bottom: 6px; padding: 0 7px; box-sizing: border-box; border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-sm); background: var(--awd-surface); color: var(--awd-text); font-size: var(--awd-panel-fs-meta); }
.chat-sidebar-row { min-height: 28px; display: flex; align-items: center; gap: 5px; padding: 3px 5px; border-radius: var(--awd-radius-sm); color: var(--awd-text-2); font-size: var(--awd-panel-fs); cursor: pointer; }
.chat-sidebar-row:hover, .chat-sidebar-row.active { background: var(--awd-surface-2); color: var(--awd-text); }
.chat-sidebar-row.active { box-shadow: inset 2px 0 0 var(--awd-accent); }
.chat-sidebar-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-sidebar-row-delete { display: none; width: 18px; text-align: center; color: var(--awd-text-3); }
.conversation-row:hover .chat-sidebar-row-delete { display: block; }
.chat-sidebar-file-icon { width: 20px; flex-shrink: 0; color: var(--awd-text-3); font-size: var(--awd-panel-fs-meta); text-align: center; }
.chat-sidebar-empty { display: block; padding: 6px 5px; color: var(--awd-text-3); font-size: var(--awd-panel-fs-meta); line-height: 1.5; }
.chat-sidebar-error { color: var(--awd-danger); cursor: pointer; }
.cross-project-section { border-bottom: none; }
.cross-project-chevron { width: 12px; color: var(--awd-text-3); }
.cross-file-row { padding-left: 18px; }
.cross-project-attach { flex-shrink: 0; padding: 1px 5px; border: 1px solid var(--awd-border-subtle); border-radius: 999px; color: var(--awd-accent-text); font-size: var(--awd-panel-fs-meta); }
</style>
