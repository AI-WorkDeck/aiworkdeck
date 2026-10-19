<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="archive-contents">
    <div class="archive-entry-list" role="listbox" :aria-label="$t('files.archiveContents')" @keydown="onKeyDown">
      <div v-for="(entry, index) in entries" :key="entry.path + index" class="archive-entry-row"
        :class="{ selected: selected?.path === entry.path }" role="option" :aria-selected="selected?.path === entry.path"
        :tabindex="selected?.path === entry.path || (!selected && index === 0) ? 0 : -1"
        :draggable="!entry.dir" @click="selectEntry(entry)" @mousedown="primeEntry(entry)"
        @dragstart="onDragStart($event, entry)" @dragend="finishDrag">
        <svg class="entry-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path v-for="(d, i) in (entry.dir ? ICONS.folder : ICONS.doc)" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" /></svg>
        <span class="entry-path" :title="entry.path">{{ entry.path }}</span>
        <span v-if="!entry.dir" class="entry-size">{{ formatSize(entry.size) }}</span>
      </div>
    </div>
    <div class="archive-entry-preview" :aria-label="$t('files.archivePreview')">
      <div v-if="!selected || selected.dir" class="archive-entry-message">{{ $t('files.archiveSelectEntry') }}</div>
      <div v-else-if="loading" class="archive-entry-message" role="status">{{ $t('files.archivePreparing') }}</div>
      <div v-else-if="error" class="archive-entry-message error" role="alert">{{ error }}<button @click="selectEntry(selected, true)">{{ $t('files.archiveRetry') }}</button></div>
      <template v-else>
        <div class="archive-drag-hint" role="status">{{ dragError || $t(localPath ? 'files.archiveDragReady' : 'files.archiveDragHint') }}<button v-if="dragError" @click="selectEntry(selected, true)">{{ $t('files.archiveRetry') }}</button></div>
        <div v-if="nestedArchive" class="archive-entry-message">{{ $t('files.archiveNestedHint') }}</div>
        <EntryPreview v-else-if="previewUrl" :key="previewUrl" :file="previewFile" :source-url="previewUrl" :show-edit-btn="false" />
      </template>
    </div>
  </div>
</template>

<script>
import { defineAsyncComponent } from 'vue'
import { ICONS } from '@/config/icons.js'
import { getArchiveEntryUrl } from '@/services/api.js'
import { getAuthHeaders } from '@/utils/auth.js'
import { host } from '@/services/host.js'
import { beginArchiveEntryDrag, endArchiveEntryDrag } from '@/utils/archiveEntryDrag.js'
import { installExternalDragCleanup } from '@/utils/fileLocalDrag.js'
import { applyDragImage } from '@/utils/dragImage.js'

export default {
  name: 'ArchiveEntriesPane',
  // Resolve after FilePreview has initialized; the nested preview is always a single non-archive entry.
  components: { EntryPreview: defineAsyncComponent(() => import('./FilePreview.vue')) },
  props: { file: { type: Object, required: true }, entries: { type: Array, default: () => [] } },
  data() {
    return { selected: null, loading: false, error: '', dragError: '', previewUrl: '', localPath: '' }
  },
  computed: {
    ICONS() { return ICONS },
    previewFile() {
      const name = this.selected?.name || this.selected?.path.split('/').pop() || ''
      return { name, fileType: name.includes('.') ? name.split('.').pop().toLowerCase() : '', fileSize: this.selected?.size }
    },
    nestedArchive() { return ['zip', 'rar', '7z'].includes(this.previewFile.fileType) }
  },
  beforeUnmount() {
    this._disposed = true
    this._request?.abort()
    this.finishDrag()
    this.releasePreview()
  },
  methods: {
    formatSize(bytes) {
      return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.ceil(bytes / 1024)} KB`
    },
    releasePreview() {
      if (this.previewUrl) URL.revokeObjectURL(this.previewUrl)
      this.previewUrl = ''
      this.localPath = ''
    },
    primeEntry(entry) {
      if (this.selected?.path !== entry.path) this.selectEntry(entry)
    },
    async selectEntry(entry, retry = false) {
      if (!retry && this.selected?.path === entry.path) return
      this._request?.abort()
      const controller = new AbortController()
      this._request = controller
      this.selected = entry
      this.releasePreview()
      this.error = ''
      this.dragError = ''
      this.loading = !entry.dir
      if (entry.dir) return
      const current = () => !this._disposed && this._request === controller && !controller.signal.aborted
      try {
        // Holding an arrow key should read only the final selection, not decompress every crossed row.
        await new Promise(resolve => {
          const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve() }
          const timer = setTimeout(finish, 120)
          controller.signal.addEventListener('abort', finish, { once: true })
        })
        if (!current()) return
        const response = await fetch(getArchiveEntryUrl(this.file.projectId, this.file.id, entry.path), {
          headers: getAuthHeaders(), signal: controller.signal
        })
        if (!response.ok || (response.headers.get('content-type')?.includes('application/json') && !response.headers.get('content-disposition'))) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.message || this.$t('files.archiveReadFailed'))
        }
        const bytes = await response.arrayBuffer()
        if (!current()) return
        this.previewUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get('content-type') || 'application/octet-stream' }))
        this.loading = false
        if (host.fs?.cacheArchiveEntry) {
          const result = await host.fs.cacheArchiveEntry({ name: entry.name || entry.path.split('/').pop(), bytes })
          if (current()) {
            if (result?.path) this.localPath = result.path
            else this.dragError = this.$t('files.archiveDragFailed')
          }
        }
      } catch (error) {
        if (!current()) return
        // A temp-file failure does not discard an already usable preview.
        if (!this.previewUrl) this.error = error.message || this.$t('files.archiveReadFailed')
        else this.dragError = this.$t('files.archiveDragFailed')
      } finally {
        if (current()) this.loading = false
      }
    },
    onKeyDown(event) {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !this.entries.length) return
      event.preventDefault()
      const index = this.entries.findIndex(entry => entry.path === this.selected?.path)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? this.entries.length - 1
        : Math.max(0, Math.min(this.entries.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      this.selectEntry(this.entries[next])
      event.currentTarget.children[next]?.focus()
    },
    onDragStart(event, entry) {
      if (entry.dir) { event.preventDefault(); return }
      this.finishDrag()
      const payload = { projectId: this.file.projectId, fileId: this.file.id, path: entry.path }
      this._dragEntry = payload
      beginArchiveEntryDrag(event.dataTransfer, payload)
      applyDragImage(event)
      uni.$emit('archive-drag-start')
      this._cleanupDrag = installExternalDragCleanup(() => this.finishDrag())
      if (this.selected?.path === entry.path && this.localPath) {
        try {
          Promise.resolve(host.fs.startDrag(this.localPath)).then(result => {
            if (result?.ok === false) throw new Error('native drag failed')
          }).catch(() => {
            uni.showToast({ title: this.$t('files.archiveDragFailed'), icon: 'none' })
          })
        } catch (_) {
          uni.showToast({ title: this.$t('files.archiveDragFailed'), icon: 'none' })
        }
      } else {
        this.primeEntry(entry)
        uni.showToast({ title: this.dragError || this.$t('files.archivePrepareDrag'), icon: 'none' })
      }
    },
    finishDrag() {
      const payload = this._dragEntry
      this._dragEntry = null
      const cleanup = this._cleanupDrag
      this._cleanupDrag = null
      if (cleanup) cleanup()
      if (payload) {
        endArchiveEntryDrag(payload)
        uni.$emit('archive-drag-end')
      }
    }
  }
}
</script>

<style scoped>
.archive-contents { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.archive-entry-list { width: 42%; min-width: 200px; overflow: auto; border-right: 1px solid var(--awd-border); }
.archive-entry-row { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--awd-border); cursor: default; user-select: none; font-size: 13px; }
.archive-entry-row.selected { background: var(--awd-accent-soft); }
.archive-entry-row:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: -2px; }
.entry-icon { width: 16px; height: 16px; flex: none; }
.entry-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry-size { color: var(--awd-text-2); font-size: 11px; white-space: nowrap; }
.archive-entry-preview { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.archive-entry-preview :deep(.file-preview) { flex: 1; min-height: 0; }
.archive-entry-message { margin: auto; padding: 24px; color: var(--awd-text-2); text-align: center; }
.archive-entry-message button { display: block; margin: 12px auto; }
.archive-drag-hint { padding: 8px 12px; font-size: 12px; color: var(--awd-text-2); border-bottom: 1px solid var(--awd-border); }
.error { color: var(--awd-danger-text); }
@media (max-width: 700px) { .archive-entry-list { width: 38%; min-width: 150px; } .entry-size { display: none; } }
</style>
