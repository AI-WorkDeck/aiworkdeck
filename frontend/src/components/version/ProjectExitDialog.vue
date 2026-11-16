<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="project-exit-mask">
    <section ref="panel" role="dialog" aria-modal="true" tabindex="-1" :aria-label="$t('version.exitProjectsTitle')">
      <h3>{{ $t('version.exitProjectsTitle') }}</h3>
      <p>{{ $t('version.exitProjectsHint') }}</p>
      <p v-if="loading">{{ $t('version.exitProjectsChecking') }}</p>
      <p v-if="hasUncertain" role="alert">{{ $t('version.exitCommitUnconfirmed') }}</p>
      <p v-else-if="listFailed || commitFailed" role="alert">{{ $t('version.exitCheckFailed') }}</p>
      <div class="project-exit-list">
        <component :is="'label'" class="project-exit-row" v-for="row in visibleRows" :key="row.id">
          <component :is="'input'" type="checkbox" :checked="row.selected" :disabled="busy || row.state !== 'ready'"
            @change="row.selected = $event.target.checked" />
          <span class="project-exit-name">{{ row.name || $t('version.exitUnconfirmedProject') }}</span>
          <component :is="'button'" v-if="['failed', 'uncertain'].includes(row.state) || row.error" type="button" class="project-exit-count project-exit-retry"
            :class="{ 'project-exit-error': row.error }" :disabled="busy || loading" @click.prevent="row.error ? retryCommit(row) : retry()">{{ rowText(row) }}</component>
          <span v-else class="project-exit-count">{{ rowText(row) }}</span>
        </component>
      </div>
      <p v-if="!loading && !listFailed && !visibleRows.length">{{ $t('version.noActiveSession') }}</p>
      <footer>
        <component :is="'button'" class="project-exit-button" type="button" :disabled="busy" @click="$emit('close', false)">{{ $t('common.cancel') }}</component>
        <component :is="'button'" class="project-exit-button" v-if="listFailed || rows.some(row => ['failed', 'conflict', 'uncertain'].includes(row.state))" type="button" :disabled="busy || loading" @click="retry">{{ $t('common.retry') }}</component>
        <component :is="'button'" class="project-exit-button" type="button" :disabled="busy || hasUncertain" @click="$emit('close', true)">{{ $t('version.exitSkip') }}</component>
        <component :is="'button'" class="project-exit-button" type="button" :disabled="loading || busy || hasUncertain || !hasSelection" @click="submit">{{ $t('version.exitProjectsCommit') }}</component>
      </footer>
    </section>
  </div>
</template>
<script>
import { getMyProjects, getVersionExitProjects, getVersionExitStatus, endWorkSession } from '@/services/api.js'
import { inspectExitProject, commitExitProjects, pendingExitProjects, settleExitCommit, selectExitProjectRows } from '@/utils/projectExitState.js'
export default {
  props: { isCurrent: { type: Function, required: true } },
  emits: ['close'],
  data: () => ({ rows: pendingExitProjects(), loading: true, busy: false, listFailed: false, commitFailed: false }),
  computed: {
    visibleRows() { return this.rows.filter(row => row.state !== 'empty') },
    hasUncertain() { return this.rows.some(row => row.state === 'uncertain') },
    hasSelection() { return this.rows.some(row => row.selected && row.state === 'ready') },
  },
  mounted() {
    this.$refs.panel.focus()
    this._keyHandler = event => {
      if (!['Escape', 'Tab'].includes(event.key)) return
      event.stopImmediatePropagation()
      if (event.key === 'Escape') { event.preventDefault(); if (!this.busy) this.$emit('close', false); return }
      const buttons = [...this.$refs.panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')]
      const index = buttons.indexOf(document.activeElement)
      event.preventDefault()
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
    }
    window.addEventListener('keydown', this._keyHandler, true)
    this.load()
  },
  beforeUnmount() { this._disposed = true; window.removeEventListener('keydown', this._keyHandler, true) },
  methods: {
    readStatus: async id => (await getVersionExitStatus(id))?.data,
    rowText(row) {
      if (row.error) return `${row.error} — ${this.$t('common.retry')}`
      if (row.state === 'checking') return this.$t('version.exitProjectsChecking')
      if (row.state === 'committing') return this.$t('version.committingChanges')
      if (row.state === 'committed') return this.$t('version.exitProjectsCommitted')
      if (row.state === 'uncertain') return this.$t('version.entryUnavailable')
      if (row.state === 'failed') return this.$t('version.entryUnavailable')
      if (row.state === 'conflict') return this.$t('version.exitConflict')
      return this.$t('version.pendingFileCount', { count: row.count }, row.count)
    },
    async load() {
      this.loading = true; this.listFailed = false
      try {
        const [response, changedResponse] = await Promise.all([getMyProjects(), getVersionExitProjects()])
        if (this._disposed) return
        const projects = Array.isArray(response) ? response : response?.data
        if (!Array.isArray(projects) || !Array.isArray(changedResponse?.projectIds)) throw new Error('invalid projects')
        this.rows = selectExitProjectRows(projects, changedResponse.projectIds, pendingExitProjects())
        // Bound the scan concurrency: never flood the local version locks.
        let index = 0
        await Promise.all(Array.from({ length: 3 }, async () => {
          while (!this._disposed && index < this.rows.length) await inspectExitProject(this.rows[index++], this.readStatus)
        }))
        // Nested folders share one backend lock; recheck parallel-scan failures one at a time.
        for (const row of this.rows.filter(row => row.state === 'failed')) {
          if (this._disposed) break
          await inspectExitProject(row, this.readStatus)
        }
      } catch { this.listFailed = true }
      finally {
        this.loading = false
        if (!this._disposed && !this.listFailed && !this.visibleRows.length && this.isCurrent()) this.$emit('close', true)
      }
    },
    async retry() {
      if (this.listFailed) return this.load()
      this.loading = true; this.busy = true; this.commitFailed = false
      for (const row of this.rows.filter(row => ['failed', 'conflict', 'uncertain'].includes(row.state))) {
        if (this._disposed) break
        if (row.state === 'uncertain') {
          if (!await settleExitCommit(row, this.commit, this.readStatus)) this.commitFailed = true
        }
        else await inspectExitProject(row, this.readStatus)
      }
      this.loading = false; this.busy = false
    },
    async retryCommit(row) {
      if (this.busy || this.loading) return
      const retrySubmission = row.errorKind === 'commit'
      if (row.state === 'failed') {
        this.loading = true
        await inspectExitProject(row, this.readStatus)
        this.loading = false
        if (this._disposed || !this.isCurrent()) return
      }
      if (retrySubmission && row.state === 'ready') {
        row.selected = true
        await this.submit()
      }
    },
    commit: async (id, requestId) => (await endWorkSession(id, '', requestId))?.data,
    async submit() {
      if (this.busy || this.loading || this.hasUncertain || !this.hasSelection) return
      this.busy = true; this.commitFailed = false
      const ok = await commitExitProjects(this.rows, this.commit, this.readStatus, this.isCurrent)
      this.busy = false
      if (ok) this.$emit('close', true)
      else this.commitFailed = true
    },
  },
}
</script>
<style scoped>
.project-exit-mask { position: fixed; inset: 0; z-index: 10050; background: var(--awd-overlay); display: flex; align-items: center; justify-content: center; }
section { box-sizing: border-box; width: min(640px, 90vw); max-height: 85vh; overflow: auto; padding: 24px; background: var(--awd-surface); color: var(--awd-text); border-radius: 12px; }
h3 { margin-block: 0 12px; }
p { font-size: 13px; line-height: 1.6; }
.project-exit-list { max-height: 45vh; overflow: auto; }
.project-exit-row { display: flex; align-items: center; gap: 10px; padding-block: 10px; border-bottom: 1px solid var(--awd-border); }
.project-exit-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.project-exit-count { max-width: 40%; font-size: 12px; }
.project-exit-retry { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-size: 12px; text-align: end; text-decoration: underline; cursor: pointer; }
.project-exit-retry:disabled { opacity: .5; cursor: default; }
.project-exit-error { color: var(--awd-danger-text); overflow-wrap: anywhere; }
footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.project-exit-button { padding: 8px 12px; border: 1px solid var(--awd-border); border-radius: 6px; background: var(--awd-surface); color: var(--awd-text); cursor: pointer; }
.project-exit-button:disabled { opacity: .5; cursor: default; }
</style>
