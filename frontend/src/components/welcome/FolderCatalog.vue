<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="folder-catalog">
    <input v-model="query" class="folder-search" :placeholder="$t('projects.searchPlaceholder')" :aria-label="$t('projects.searchPlaceholder')" />
    <text v-if="!filteredProjects.length" class="folder-empty">{{ $t('projects.noMatch') }}</text>
    <view v-for="project in filteredProjects" :key="project.id" class="folder-row">
      <input v-if="renamingId === project.id" v-model="renameValue" class="folder-rename" :focus="true" @confirm="confirmRename" @blur="cancelRename" />
      <button v-else class="folder-name" @tap="$emit('open-project', project)">{{ project.name }}</button>
      <template v-if="!client">
        <button class="folder-action" :disabled="busy" @tap="startRename(project)">{{ $t('projects.rename') }}</button>
        <button class="folder-action" :disabled="busy" @tap="remove(project)">{{ $t('projects.delete') }}</button>
      </template>
    </view>
  </view>
</template>
<script>
import { renameProject } from '@/services/api.js'
export default {
  name: 'FolderCatalog',
  props: { projects: { type: Array, default: () => [] }, client: Boolean, removeProject: { type: Function, required: true } },
  emits: ['open-project', 'renamed', 'deleted'],
  data() { return { query: '', renamingId: null, renameValue: '', busy: false } },
  computed: {
    filteredProjects() { const query = this.query.trim().toLocaleLowerCase(); return this.projects.filter(p => String(p.name || '').toLocaleLowerCase().includes(query)) },
  },
  methods: {
    startRename(project) { if (this.client || this.busy) return; this.renamingId = project.id; this.renameValue = project.name },
    cancelRename() { this.renamingId = null; this.renameValue = '' },
    async confirmRename(event) {
      if (this.client || this.busy || this.renamingId == null) return
      const id = this.renamingId
      const name = String(event?.detail?.value ?? this.renameValue).trim()
      if (!name) { uni.showToast({ title: this.$t('projects.projectNameEmpty'), icon: 'none' }); return }
      this.busy = true
      try {
        await renameProject(id, name)
        this.$emit('renamed', { id, name })
        if (this.renamingId === id) this.cancelRename()
        uni.showToast({ title: this.$t('projects.renameSuccess'), icon: 'success' })
      } catch (e) { uni.showToast({ title: this.$t('projects.renameFailed'), icon: 'none' }) }
      finally { this.busy = false }
    },
    remove(project) {
      if (this.client || this.busy) return
      uni.showModal({
        title: this.$t('projects.deleteConfirmTitle'), content: this.$t('projects.deleteConfirmContent'),
        cancelText: this.$t('projects.cancel'), confirmText: this.$t('projects.confirm'),
        success: async result => {
          if (!result.confirm || this.busy) return
          this.busy = true
          try {
            const removed = await this.removeProject(project.id)
            if (removed === false) return
            this.$emit('deleted', project.id)
            uni.showToast({ title: this.$t('projects.deleteSuccess'), icon: 'success' })
          } catch (e) { uni.showToast({ title: e.message || this.$t('projects.deleteFailedRetry'), icon: 'none' }) }
          finally { this.busy = false }
        },
      })
    },
  },
}
</script>
<style scoped>
.folder-catalog { min-width: 0; }
.folder-empty { display: block; padding: 12px 0; color: var(--awd-text-3); font-size: var(--awd-panel-fs); }
.folder-search,.folder-rename { box-sizing: border-box; width: 100%; min-height: 32px; padding: 4px 8px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); color: var(--awd-text); background: var(--awd-surface); }
.folder-row { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--awd-border-subtle); }
.folder-name,.folder-action { margin: 0; border: 0; background: transparent; color: var(--awd-accent-text); font-size: var(--awd-panel-fs); cursor: pointer; padding: 6px 0; }
.folder-name::after,.folder-action::after { border: 0; }
.folder-name { flex: 1; min-width: 0; text-align: start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-action { flex-shrink: 0; color: var(--awd-text-2); }
.folder-rename { flex: 1; min-width: 0; }
</style>
