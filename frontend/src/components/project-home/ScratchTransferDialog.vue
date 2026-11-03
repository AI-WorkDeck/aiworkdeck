<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="scratch-copy-mask" @keydown.esc="!busy && $emit('close')">
    <section role="dialog" aria-modal="true" :aria-label="$t('workbench.scratchCopyTitle')">
      <h3>{{ $t('workbench.scratchCopyTitle') }}</h3>
      <p>{{ $t('workbench.scratchCopyHint') }}</p>
      <label>{{ $t('calendar.selectProject') }}
        <select v-model="target" :disabled="busy">
          <option value="">{{ $t('calendar.selectProject') }}</option>
          <option v-for="project in projects" :key="project.id" :value="String(project.id)">{{ project.name }}</option>
        </select>
      </label>
      <div v-if="loading">{{ $t('common.loading') }}</div>
      <div class="choices">
        <label v-for="file in files" :key="'f'+file.id"><input v-model="fileIds" type="checkbox" :value="file.id" :disabled="busy">{{ file.relativePath || file.name }}</label>
        <label v-for="conversation in conversations" :key="'c'+conversation.id"><input v-model="conversationIds" type="checkbox" :value="conversation.id" :disabled="busy">{{ conversation.title }}</label>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <button :disabled="busy" @click="$emit('close')">{{ $t('common.cancel') }}</button>
        <button :disabled="loading || busy || !target || (!fileIds.length && !conversationIds.length)" @click="copy">{{ busy ? $t('common.saving') : $t('common.confirm') }}</button>
      </footer>
    </section>
  </div>
</template>
<script>
import { getMyProjects, copyScratchToProject } from '@/services/api.js'
export default {
  props: { sourceProjectId: { required: true }, files: { type: Array, default: () => [] }, conversations: { type: Array, default: () => [] }, beforeCopy: { type: Function, required: true } },
  emits: ['close', 'copied'],
  data: () => ({ projects: [], target: '', fileIds: [], conversationIds: [], loading: true, busy: false, error: '' }),
  async mounted() {
    try {
      const result = await getMyProjects()
      this.projects = (Array.isArray(result) ? result : result?.data || []).filter(p => p.myRole === 'OWNER' && String(p.id) !== String(this.sourceProjectId) && !['SCRATCH', 'LOOSE_FILES'].includes(p.projectType))
    } catch (e) { this.error = e.message || this.$t('common.failed') }
    finally { this.loading = false }
  },
  methods: {
    async copy() {
      if (this.busy) return
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
.scratch-copy-mask { position: fixed; inset: 0; z-index: 9999; background: var(--awd-overlay); display: flex; align-items: center; justify-content: center; }
section { width: min(520px, 90vw); max-height: 85vh; overflow: auto; padding: 24px; background: var(--awd-surface); color: var(--awd-text); border-radius: 12px; }
p { font-size: 13px; line-height: 1.6; }
label { display: flex; align-items: center; gap: 8px; padding-block: 6px; }
select { flex: 1; min-width: 0; }
.choices { max-height: 35vh; overflow: auto; margin-block: 16px; }
footer { display: flex; justify-content: flex-end; gap: 12px; }
button { padding: 8px 16px; }
</style>
