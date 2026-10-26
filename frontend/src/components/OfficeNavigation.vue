<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="office-nav" :class="kind" :aria-label="$t('editor.navigation.' + (kind === 'calc' ? 'sheets' : 'slides'))">
    <view v-if="kind === 'impress'" class="office-nav-heading">
      <text>{{ $t('editor.navigation.slides') }}</text><text class="office-nav-count">{{ items.length || '—' }}</text>
    </view>
    <view ref="list" class="office-nav-list" role="tablist" :aria-orientation="kind === 'calc' ? 'horizontal' : 'vertical'" @scroll="loadVisibleThumbnails">
      <button v-for="(item, index) in items" :key="item.id" type="button" role="tab"
              class="office-nav-item" :class="{ selected: item.id === activeId }"
              :aria-selected="item.id === activeId" :tabindex="item.id === activeId ? 0 : -1"
              :title="item.name" :aria-label="kind === 'impress' ? $t('editor.navigation.slideLabel', { n: index + 1, name: item.name }) : item.name"
              @click="activate(item)" @keydown="onKey($event, index)">
        <template v-if="kind === 'impress'">
          <text class="office-nav-number">{{ index + 1 }}</text>
          <view class="office-nav-preview" :style="{ aspectRatio: (item.width || 4) + ' / ' + (item.height || 3) }">
            <img v-if="thumbnails[item.id]" :src="thumbnails[item.id]" alt="" draggable="false" />
            <text v-else class="office-nav-placeholder">{{ thumbnailErrors[item.id] ? $t('editor.navigation.previewFailed') : '…' }}</text>
          </view>
        </template>
        <text v-else class="office-nav-sheet-name">{{ item.name }}</text>
      </button>
    </view>
    <button v-if="kind === 'calc' && writable" type="button" class="office-nav-add" :title="$t('editor.toolbar.calcSheetAdd')" :aria-label="$t('editor.toolbar.calcSheetAdd')" @click="$emit('add-sheet')">+</button>
    <view v-if="loading || error" class="office-nav-status" role="status">
      <text>{{ error || $t('editor.navigation.loading') }}</text>
      <button v-if="error" type="button" class="office-nav-retry" @click="refresh">{{ $t('editor.retryLoad') }}</button>
    </view>
  </view>
</template>

<script>
// ElyOffice's slide strip and sheet tabs inform the layout and interactions;
// rendering and document access use this host's Vue/LOWA contracts.
export default {
  name: 'OfficeNavigation',
  props: {
    executor: Object, kind: String, refreshKey: Number, contentKey: Number,
    active: { type: Boolean, default: true }, writable: Boolean,
  },
  emits: ['navigate', 'add-sheet'],
  data() {
    return { items: [], activeId: null, documentSeq: null, thumbnails: {}, thumbnailErrors: {}, loading: true, error: '' }
  },
  watch: {
    executor() {
      this._readSeq++
      this._activationSeq = (this._activationSeq || 0) + 1
      this._switching = false
      this.clearThumbnails()
      this.items = []
      this.documentSeq = null
      this.activeId = null
      this.loading = true
      this.scheduleRefresh()
    },
    refreshKey() { this.scheduleRefresh() },
    contentKey() { this.invalidateThumbnails(); this.scheduleRefresh() },
    active(value) { if (value) this.scheduleRefresh() },
  },
  mounted() {
    this._generation = 0
    this._rendered = {}
    this._readSeq = 0
    this._disposed = false
    this.refresh()
    window.addEventListener('resize', this.loadVisibleThumbnails)
  },
  beforeUnmount() {
    this._disposed = true
    this._readSeq++
    clearTimeout(this._refreshTimer)
    this.clearThumbnails()
    window.removeEventListener('resize', this.loadVisibleThumbnails)
  },
  methods: {
    element(ref) { return ref?.$el || ref },
    scheduleRefresh() {
      clearTimeout(this._refreshTimer)
      if (this.active) this._refreshTimer = setTimeout(() => this.refresh(), 120)
    },
    invalidateThumbnails() {
      this._generation++
      this.thumbnailErrors = {}
    },
    clearThumbnails() {
      this.invalidateThumbnails()
      this._rendered = {}
      Object.values(this.thumbnails).forEach(url => URL.revokeObjectURL(url))
      this.thumbnails = {}
      this.thumbnailErrors = {}
    },
    async refresh() {
      if (!this.executor || !this.active || this._disposed) return
      const readSeq = ++this._readSeq
      try {
        const result = await this.executor.executeCommand('office_get_navigation', {})
        if (readSeq !== this._readSeq || this._disposed) return
        if (!result?.success || result.kind !== this.kind) throw new Error(this.$t('editor.navigation.loadFailed'))
        if (this.documentSeq !== result.documentSeq || JSON.stringify(this.items) !== JSON.stringify(result.items)) this.clearThumbnails()
        const selectedChanged = this.activeId !== result.activeId
        this.items = result.items
        this.activeId = result.activeId
        this.documentSeq = result.documentSeq
        this.error = ''
        await this.$nextTick()
        if (selectedChanged) this.scrollSelected()
        this.loadVisibleThumbnails()
      } catch (e) {
        if (readSeq === this._readSeq && !this._disposed) this.error = this.$t('editor.navigation.loadFailed')
      } finally {
        if (readSeq === this._readSeq) this.loading = false
      }
    },
    scrollSelected() {
      const list = this.element(this.$refs.list)
      const selected = list?.querySelector('.selected')
      if (!selected) return
      // Scroll this strip only: scrollIntoView can move the whole workbench.
      if (this.kind === 'calc') {
        if (selected.offsetLeft < list.scrollLeft) list.scrollLeft = selected.offsetLeft
        else if (selected.offsetLeft + selected.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = selected.offsetLeft + selected.offsetWidth - list.clientWidth
      } else {
        if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop
        else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight
      }
    },
    async activate(item) {
      if (this._switching || this._disposed) return false
      if (this.thumbnailErrors[item.id]) delete this.thumbnailErrors[item.id]
      this._switching = true
      const activationSeq = this._activationSeq = (this._activationSeq || 0) + 1
      const executor = this.executor
      const documentSeq = this.documentSeq
      try {
        const result = await this.executor.executeCommand('office_activate_item', { id: item.id, documentSeq: this.documentSeq })
        if (this._disposed || executor !== this.executor || documentSeq !== this.documentSeq) return false
        if (!result?.success) throw new Error('navigation failed')
        await this.refresh()
        if (this._disposed || executor !== this.executor || documentSeq !== this.documentSeq) return false
        this.$emit('navigate')
        return true
      } catch (e) {
        if (!this._disposed && executor === this.executor && documentSeq === this.documentSeq) this.error = this.$t('editor.navigation.switchFailed')
        return false
      } finally { if (activationSeq === this._activationSeq) this._switching = false }
    },
    async onKey(event, index) {
      const previous = this.kind === 'calc' ? 'ArrowLeft' : 'ArrowUp'
      const next = this.kind === 'calc' ? 'ArrowRight' : 'ArrowDown'
      let target
      if (event.key === previous) target = Math.max(0, index - 1)
      else if (event.key === next) target = Math.min(this.items.length - 1, index + 1)
      else if (event.key === 'Home') target = 0
      else if (event.key === 'End') target = this.items.length - 1
      else return
      event.preventDefault()
      const executor = this.executor
      if (!await this.activate(this.items[target]) || executor !== this.executor || this._disposed) return
      this.element(this.$refs.list)?.querySelectorAll('.office-nav-item')[target]?.focus()
    },
    async loadVisibleThumbnails() {
      if (this.kind !== 'impress' || !this.active || this._disposed) return
      if (this._drawing) { this._drawAgain = true; return }
      const list = this.element(this.$refs.list)
      if (!list?.clientHeight) return
      this._drawing = true
      this._drawAgain = false
      const rows = list.querySelectorAll('.office-nav-item')
      const generation = this._generation
      try {
        // Render only visible rows and one viewport ahead, one image at a time.
        // Navigation changes and edits cancel the old batch between native calls.
        for (let index = 0; index < this.items.length; index++) {
          if (this._disposed || !this.active || generation !== this._generation) break
          const row = rows[index]
          const item = this.items[index]
          if (!row || row.offsetTop + row.offsetHeight < list.scrollTop - list.clientHeight || row.offsetTop > list.scrollTop + list.clientHeight * 2) continue
          if (this._rendered[item.id] === generation || this.thumbnailErrors[item.id]) continue
          try {
            const result = await this.executor.executeCommand('slide_get_thumbnail', { slideNumber: item.id, width: 320, documentSeq: this.documentSeq })
            if (this._disposed || generation !== this._generation) break
            if (!result?.success || result.documentSeq !== this.documentSeq || !result.bytes?.length) throw new Error('thumbnail unavailable')
            if (this.thumbnails[item.id]) URL.revokeObjectURL(this.thumbnails[item.id])
            this._rendered[item.id] = generation
            this.thumbnails[item.id] = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'image/png' }))
          } catch (e) {
            if (generation === this._generation && !this._disposed) this.thumbnailErrors[item.id] = true
          }
        }
      } finally {
        this._drawing = false
        if ((generation !== this._generation || this._drawAgain) && !this._disposed) this.loadVisibleThumbnails()
      }
    },
  },
}
</script>

<style scoped>
.office-nav { color: var(--awd-text); background: var(--awd-surface); flex-shrink: 0; min-width: 0; }
.office-nav.impress { display: flex; flex-direction: column; flex-basis: clamp(112px, 20%, 196px); min-height: 0; border-right: 1px solid var(--awd-border); }
.office-nav-heading { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); }
.office-nav-count, .office-nav-number { font-variant-numeric: tabular-nums; color: var(--awd-text-3); }
.office-nav-list { position: relative; min-height: 0; min-width: 0; scrollbar-width: thin; }
.impress .office-nav-list { flex: 1; overflow-y: auto; padding: 0 10px 12px 6px; }
.office-nav-item { box-sizing: border-box; margin: 0; padding: 0; background: transparent; border: 0; border-radius: 0; font: inherit; color: inherit; cursor: pointer; line-height: 1.4; text-align: left; }
.office-nav-item::after, .office-nav-add::after, .office-nav-retry::after { border: 0; }
.impress .office-nav-item { display: flex; align-items: flex-start; gap: 7px; width: 100%; padding: 4px 0; margin-bottom: 8px; }
.office-nav-number { flex: 0 0 18px; text-align: right; padding-top: 4px; font-size: var(--awd-panel-fs-meta); }
.office-nav-preview { position: relative; flex: 1; min-width: 0; overflow: hidden; background: var(--awd-bg); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); }
.office-nav-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
.office-nav-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--awd-text-3); font-size: var(--awd-panel-fs-meta); }
.office-nav-item:hover .office-nav-preview { border-color: var(--awd-text-3); }
.selected .office-nav-preview { border-color: var(--awd-mint); box-shadow: 0 0 0 1px var(--awd-mint); }
.selected .office-nav-number { color: var(--awd-accent-text); font-weight: 600; }
.office-nav.calc { display: flex; align-items: center; height: 36px; border-top: 1px solid var(--awd-border); padding: 0 8px; gap: 6px; }
.calc .office-nav-list { display: flex; align-items: stretch; align-self: stretch; flex: 1; overflow-x: auto; }
.calc .office-nav-item { display: flex; align-items: center; flex: 0 0 auto; padding: 0 14px; border-bottom: 2px solid transparent; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); white-space: nowrap; }
.calc .office-nav-item:hover { background: var(--awd-surface-2); }
.calc .office-nav-item.selected { color: var(--awd-accent-text); background: var(--awd-accent-soft); border-bottom-color: var(--awd-mint); font-weight: 600; }
.office-nav-sheet-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.office-nav-add { display: flex; align-items: center; justify-content: center; flex: 0 0 26px; width: 26px; height: 26px; padding: 0; margin: 0; border: 0; border-radius: var(--awd-radius-sm); background: transparent; color: var(--awd-text-2); font-size: var(--awd-panel-fs); line-height: 1; cursor: pointer; }
.office-nav-add:hover { background: var(--awd-accent-soft); color: var(--awd-accent-text); }
.office-nav-item:focus-visible, .office-nav-add:focus-visible, .office-nav-retry:focus-visible { outline: 2px solid var(--awd-mint); outline-offset: -2px; }
.office-nav-status { padding: 8px; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); }
.calc .office-nav-status { padding: 0; max-width: 220px; }
.office-nav-retry { border: 0; padding: 2px 4px; background: transparent; color: var(--awd-accent-text); font-size: inherit; cursor: pointer; }
</style>
