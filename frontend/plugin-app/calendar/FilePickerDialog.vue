<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view v-if="visible" class="picker-overlay" @tap.self="close">
    <view class="picker-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <view class="picker-heading">{{ title }}</view>
      <input v-model="query" class="picker-search" :placeholder="$t('common.search')" :aria-label="$t('common.search')" />
      <scroll-view scroll-y class="picker-files">
        <text v-if="error" role="alert">{{ error }}</text>
        <text v-else-if="loading">{{ $t('common.loading') }}</text>
        <button v-for="file in visibleFiles" :key="file.id" class="picker-file" @click="choose(file)">{{ file.name }}<text class="picker-directory">{{ directory(file) }}</text></button>
        <text v-if="!loading && !error && !visibleFiles.length">{{ $t('common.noData') }}</text>
      </scroll-view>
      <button class="picker-cancel" @click="close">{{ $t('calendar.cancel') }}</button>
    </view>
  </view>
</template>
<script>
import { perform } from './api.js'
import { excludeSystemFolders, dirLabelOf } from '@/utils/aiContextFiles.js'
export default {
  props: { visible: Boolean, projectId: [Number, String], title: String },
  emits: ['update:visible', 'confirm'],
  data: () => ({ files: [], query: '', loading: false, error: '' }),
  computed: {
    visibleFiles() { const query = this.query.trim().toLowerCase(); return excludeSystemFolders(this.files).filter(file => !file.isFolder && !file.isDir && file.fileType !== 'folder' && (!query || String(file.name).toLowerCase().includes(query))) },
  },
  watch: {
    visible: { immediate: true, handler(value) { if (value) this.load(); else this.controller?.abort() } },
    projectId() { if (this.visible) this.load() },
  },
  beforeUnmount() { this.controller?.abort() },
  methods: {
    async load() {
      this.controller?.abort()
      const controller = new AbortController(); this.controller = controller
      this.files = []; this.error = ''; this.query = ''; this.loading = true
      try { const files = await perform('files', { projectId: this.projectId }, { signal: controller.signal }); if (!controller.signal.aborted) this.files = files }
      catch (error) { if (!controller.signal.aborted) this.error = error.message }
      finally { if (!controller.signal.aborted) this.loading = false }
    },
    directory(file) { return dirLabelOf(file, new Map(this.files.map(item => [item.id, item]))) },
    close() { this.$emit('update:visible', false) },
    choose(file) { this.$emit('confirm', file); this.close() },
  },
}
</script>
<style scoped>
.picker-overlay { position: fixed; inset: 0; z-index: 10000; background: var(--awd-overlay, #0006); display: flex; align-items: center; justify-content: center; }
.picker-dialog { width: min(560px, 90vw); max-height: 80vh; background: var(--awd-surface); color: var(--awd-text); border: 1px solid var(--awd-border); border-radius: 8px; padding: 16px; font-size: 13px; }
.picker-heading { font-weight: 600; margin-bottom: 12px; }
.picker-search { border: 1px solid var(--awd-border); min-height: 32px; padding: 0 8px; }
.picker-files { height: 40vh; margin: 12px 0; }
.picker-file { display: block; width: 100%; text-align: left; font-size: 13px; line-height: 32px; color: var(--awd-text); background: var(--awd-surface); }
.picker-directory { color: var(--awd-text-2); margin-left: 8px; }
.picker-cancel { min-height: 32px; font-size: 13px; }
button:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 2px; }
</style>
