<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="scratch-copy-mask" @keydown="onKeydown">
    <section ref="panel" class="scratch-copy-dialog" role="dialog" aria-modal="true" :aria-label="$t('workbench.scratchCopyTitle')" tabindex="-1" :aria-busy="busy">
      <header class="scratch-copy-header">
        <h3>{{ $t('workbench.scratchCopyTitle') }}</h3>
        <component :is="'button'" type="button" class="scratch-copy-close" :aria-label="$t('common.close')" :disabled="busy" @click="$emit('close')">×</component>
      </header>
      <p class="scratch-copy-hint">{{ $t('workbench.scratchCopyHint') }}</p>
      <div class="scratch-copy-target">
        <div class="scratch-copy-label">{{ $t('calendar.selectProject') }}</div>
        <AwdSelect ref="projectSelect" :range="projectLabels" :value="targetIndex" :disabled="loading || busy || !projects.length" :aria-label="$t('calendar.selectProject')" searchable :search-label="$t('common.search')" :search-placeholder="$t('common.search')" :empty-text="$t('common.noData')" @change="selectProject" />
        <p v-if="!loading && !projects.length && !error" class="scratch-copy-empty" role="status">{{ $t('workbench.scratchCopyNoProjects') }}</p>
      </div>
      <div class="scratch-copy-selection">
        <div>
          <div class="scratch-copy-label">{{ $t('workbench.scratchCopyChoose') }}</div>
          <div class="scratch-copy-count" aria-live="polite">{{ $t('workbench.scratchCopySelected', { count: fileIds.length + conversationIds.length }) }}</div>
        </div>
        <component :is="'button'" type="button" class="scratch-copy-select-all" :disabled="busy || !files.length && !conversations.length" @click="toggleAll">{{ allSelected ? $t('common.clear') : $t('workbench.selectAll') }}</component>
      </div>
      <div v-if="loading" class="scratch-copy-empty" role="status">{{ $t('common.loading') }}</div>
      <div class="scratch-copy-choices">
        <template v-for="group in choiceGroups" :key="group.key">
          <div v-if="group.items.length" class="scratch-copy-group">{{ group.label }} <span>{{ group.items.length }}</span></div>
          <component :is="'label'" v-for="item in group.items" :key="group.key + item.id" class="scratch-copy-choice" :class="{ 'is-selected': group.selected.includes(item.id), 'is-disabled': busy }">
            <!-- uni-input does not support checkbox. Keep a real input and explicit checked/change binding. -->
            <component :is="'input'" type="checkbox" class="scratch-copy-checkbox" :checked="group.selected.includes(item.id)" :disabled="busy" @change="toggleChoice(group.key, item.id, $event.target.checked)" />
            <svg class="scratch-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path v-if="group.key === 'files'" d="M14 3H5v18h14V8zm0 0v5h5"/><path v-else d="M4 4h16v13H9l-5 4z"/></svg>
            <span class="scratch-copy-name" :class="{ 'is-file': group.key === 'files' }" :title="item.relativePath || item.title || item.name">{{ item.relativePath || item.title || item.name }}</span>
          </component>
        </template>
        <div v-if="!files.length && !conversations.length" class="scratch-copy-empty">{{ $t('common.noData') }}</div>
      </div>
      <p v-if="error" class="scratch-copy-error" role="alert">{{ error }}</p>
      <footer class="scratch-copy-actions">
        <component :is="'button'" type="button" class="scratch-copy-button" :disabled="busy" @click="$emit('close')">{{ $t('common.cancel') }}</component>
        <component :is="'button'" type="button" class="scratch-copy-button scratch-copy-submit" :disabled="!canCopy" @click="copy">{{ busy ? $t('common.saving') : $t('common.confirm') }}</component>
      </footer>
    </section>
  </div>
</template>
<script>
import AwdSelect from '@/components/AwdSelect.vue'
import { getMyProjects, copyScratchToProject } from '@/services/api.js'
export default {
  components: { AwdSelect },
  props: { sourceProjectId: { required: true }, files: { type: Array, default: () => [] }, conversations: { type: Array, default: () => [] }, beforeCopy: { type: Function, required: true } },
  emits: ['close', 'copied'],
  data: () => ({ projects: [], target: '', fileIds: [], conversationIds: [], loading: true, busy: false, error: '' }),
  computed: {
    projectLabels() { return [this.$t('calendar.selectProject'), ...this.projects.map(project => project.name)] },
    targetIndex() { return this.projects.findIndex(project => String(project.id) === this.target) + 1 },
    canCopy() { return !this.loading && !this.busy && this.targetIndex > 0 && this.fileIds.length + this.conversationIds.length > 0 },
    allSelected() { return this.files.length + this.conversations.length > 0 && this.fileIds.length === this.files.length && this.conversationIds.length === this.conversations.length },
    choiceGroups() { return [{ key: 'files', label: this.$t('workbench.scratchCopyFiles'), items: this.files, selected: this.fileIds }, { key: 'conversations', label: this.$t('workbench.scratchCopyConversations'), items: this.conversations, selected: this.conversationIds }] },
  },
  async mounted() {
    this._previousFocus = document.activeElement
    this.$refs.panel?.focus()
    try {
      const result = await getMyProjects()
      this.projects = (Array.isArray(result) ? result : result?.data || []).filter(p => p.myRole === 'OWNER' && String(p.id) !== String(this.sourceProjectId) && !['SCRATCH', 'LOOSE_FILES'].includes(p.projectType))
    } catch (e) { this.error = e.message || this.$t('common.failed') }
    finally { this.loading = false }
  },
  beforeUnmount() { this._previousFocus?.focus?.() },
  methods: {
    selectProject(index) { if (!this.busy) this.target = index > 0 ? String(this.projects[index - 1]?.id || '') : '' },
    toggleChoice(group, id, selected) {
      if (this.busy) return
      const key = group === 'files' ? 'fileIds' : 'conversationIds'
      this[key] = selected ? [...new Set([...this[key], id])] : this[key].filter(value => value !== id)
    },
    toggleAll() {
      if (this.busy) return
      const clear = this.allSelected
      this.fileIds = clear ? [] : this.files.map(file => file.id)
      this.conversationIds = clear ? [] : this.conversations.map(conversation => conversation.id)
    },
    onKeydown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (this.$refs.projectSelect?.open) this.$refs.projectSelect.close()
        else if (!this.busy) this.$emit('close')
      }
      if (event.key !== 'Tab') return
      const elements = [...this.$refs.panel.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
        .filter(element => element.getAttribute('aria-disabled') !== 'true' && element.getClientRects().length)
      if (!elements.length) { event.preventDefault(); return }
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === this.$refs.panel)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    },
    async copy() {
      if (!this.canCopy) return
      this.busy = true; this.error = ''
      try {
        await this.beforeCopy()
        const result = await copyScratchToProject({ sourceProjectId: Number(this.sourceProjectId), targetProjectId: Number(this.target), selectedFileIds: this.fileIds, conversationIds: this.conversationIds })
        this.$emit('copied', result?.data || result)
      } catch (e) { this.error = e.message || this.$t('common.failed') }
      finally { this.busy = false }
    }
  }
}
</script>
<style scoped>
.scratch-copy-mask { position: fixed; inset: 0; z-index: 9999; background: var(--awd-overlay); display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; -webkit-app-region: no-drag; }
.scratch-copy-dialog { display: flex; flex-direction: column; width: min(560px, 100%); max-height: min(720px, 90vh); min-height: 0; padding: 24px; box-sizing: border-box; background: var(--awd-surface); color: var(--awd-text); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-dialog); box-shadow: var(--awd-shadow-md); font-size: var(--awd-font-size-body); line-height: var(--awd-line-height-ui); outline: none; }
.scratch-copy-header { display: flex; align-items: center; justify-content: space-between; gap: var(--awd-space-3); }
.scratch-copy-header h3 { margin: 0; font-size: 18px; line-height: 1.4; font-weight: 600; }
.scratch-copy-close { flex: none; border: 0; background: transparent; color: var(--awd-text-2); font: inherit; font-size: 24px; line-height: 28px; width: 28px; height: 28px; padding: 0; cursor: pointer; }
.scratch-copy-hint { margin: 8px 0 20px; color: var(--awd-text-2); line-height: 1.6; }
.scratch-copy-label { font-weight: 600; }
.scratch-copy-target .scratch-copy-label { margin-bottom: var(--awd-space-2); }
.scratch-copy-selection { display: flex; justify-content: space-between; align-items: center; gap: var(--awd-space-3); margin: 22px 0 10px; }
.scratch-copy-count { margin-top: 4px; color: var(--awd-text-2); font-size: var(--awd-font-size-body); }
.scratch-copy-select-all { border: 0; background: transparent; padding: 6px 0; color: var(--awd-accent-text); font: inherit; cursor: pointer; white-space: nowrap; }
.scratch-copy-choices { min-height: 0; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-md); }
.scratch-copy-group { display: flex; gap: var(--awd-space-2); padding: 9px 12px; color: var(--awd-text-2); font-size: var(--awd-font-size-body); background: var(--awd-bg); font-weight: 600; }
.scratch-copy-choice { display: flex; align-items: center; gap: 10px; padding: 11px 12px; cursor: pointer; min-width: 0; }
.scratch-copy-choice:hover { background: var(--awd-bg); }
.scratch-copy-choice.is-selected { background: var(--awd-accent-soft); }
.scratch-copy-checkbox { appearance: none; -webkit-appearance: none; flex: 0 0 16px; width: 16px; height: 16px; margin: 0; border: 1px solid var(--awd-border-strong, var(--awd-border)); border-radius: 4px; background: var(--awd-surface); cursor: pointer; }
.scratch-copy-checkbox:checked { background: var(--awd-accent); border-color: var(--awd-accent); }
.scratch-copy-checkbox:checked::after { content: ''; display: block; width: 4px; height: 8px; margin: 1px 0 0 5px; border: solid var(--awd-text-on-accent); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.scratch-copy-icon { width: 18px; height: 18px; flex: none; color: var(--awd-text-2); }
.scratch-copy-name { min-width: 0; overflow-wrap: anywhere; line-height: 1.5; }
.scratch-copy-name.is-file { direction: ltr; unicode-bidi: isolate; }
.scratch-copy-empty { padding: 12px; margin: 0; color: var(--awd-text-2); line-height: 1.6; }
.scratch-copy-error { color: var(--awd-danger); font-size: var(--awd-font-size-body); margin: 12px 0 0; overflow-wrap: anywhere; }
.scratch-copy-actions { display: flex; flex: none; justify-content: flex-end; gap: var(--awd-space-2); padding-top: 20px; }
.scratch-copy-button { min-width: 76px; min-height: var(--awd-control-height); padding: 7px 18px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-md); background: var(--awd-surface); color: var(--awd-text); font: inherit; line-height: 1.4; cursor: pointer; }
.scratch-copy-submit { background: var(--awd-accent); border-color: var(--awd-accent); color: var(--awd-text-on-accent); }
.scratch-copy-button:disabled, .scratch-copy-close:disabled, .scratch-copy-select-all:disabled, .scratch-copy-choice.is-disabled { opacity: .5; cursor: not-allowed; }
.scratch-copy-button:focus-visible, .scratch-copy-close:focus-visible, .scratch-copy-select-all:focus-visible, .scratch-copy-checkbox:focus-visible { outline: var(--awd-focus-width) solid var(--awd-accent-text); outline-offset: var(--awd-focus-offset); }
@media (max-width: 600px) { .scratch-copy-mask { padding: 12px; } .scratch-copy-dialog { padding: 18px; max-height: 94vh; } }
</style>
