<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <scroll-view class="cr" scroll-y>
    <view v-if="error" class="cr-error" role="alert">{{ error }}</view>
    <text v-if="loading" class="cr-note">{{ $t('contractReview.loading') }}</text>
    <text v-if="!canWrite" class="cr-note">{{ $t('contractReview.readOnly') }}</text>
    <view class="cr-section">
      <view class="cr-heading">
        <text>{{ $t('contractReview.standards') }}</text>
        <button v-if="canWrite" class="cr-button" :disabled="busy || dirty || loading" @tap="newStandard">{{ $t('contractReview.new') }}</button>
      </view>
      <text v-if="!standards.length && !loading" class="cr-note">{{ $t('contractReview.noStandards') }}</text>
      <button v-for="standard in standards" :key="standard.id" class="cr-choice"
        :class="{ selected: draft && draft.id === standard.id }" :disabled="busy || dirty"
        @tap="selectStandard(standard)">
        <text>{{ standard.name }}</text>
        <text class="cr-note">{{ $t('contractReview.version', { version: standard.version }) }} · {{ $t(standard.confirmedVersion === standard.version ? 'contractReview.confirmed' : 'contractReview.unconfirmed') }}</text>
      </button>
      <template v-if="draft">
        <text class="cr-label">{{ $t('contractReview.name') }}</text>
        <input v-model="draft.name" class="cr-input" :disabled="!canWrite || busy" maxlength="120" :placeholder="$t('contractReview.namePlaceholder')" />
        <text class="cr-label">{{ $t('contractReview.position') }}</text>
        <input v-model="draft.position" class="cr-input" :disabled="!canWrite || busy" maxlength="300" :placeholder="$t('contractReview.positionPlaceholder')" />
        <text class="cr-label">{{ $t('contractReview.jurisdiction') }}</text>
        <input v-model="draft.jurisdiction" class="cr-input" :disabled="!canWrite || busy" maxlength="300" :placeholder="$t('contractReview.jurisdictionPlaceholder')" />
        <view v-for="(rule, index) in draft.rules" :key="rule.id" class="cr-rule">
          <view class="cr-heading">
            <text>{{ $t('contractReview.ruleNumber', { number: index + 1 }) }}</text>
            <button v-if="canWrite" class="cr-button" :disabled="busy" @tap="removeRule(index)">{{ $t('contractReview.remove') }}</button>
          </view>
          <input v-model="rule.title" class="cr-input" :disabled="!canWrite || busy" maxlength="120" :placeholder="$t('contractReview.ruleTitle')" />
          <textarea v-model="rule.instruction" class="cr-input cr-textarea" :disabled="!canWrite || busy" maxlength="2000" auto-height :placeholder="$t('contractReview.ruleInstruction')" />
        </view>
        <button v-if="canWrite" class="cr-button" :disabled="busy || draft.rules.length >= 20" @tap="addRule">{{ $t('contractReview.addRule') }}</button>
        <text class="cr-note" :class="{ 'cr-warning': dirty }">{{ $t(dirty ? 'contractReview.unsaved' : confirmed ? 'contractReview.confirmedHint' : 'contractReview.confirmHint') }}</text>
        <view v-if="canWrite" class="cr-actions">
          <button class="cr-button" :disabled="busy || !dirty || !validDraft" @tap="save">{{ $t('contractReview.save') }}</button>
          <button class="cr-button" :disabled="busy || dirty || confirmed || !draft.id" @tap="confirm">{{ $t('contractReview.confirm') }}</button>
          <button v-if="dirty" class="cr-button" :disabled="busy" @tap="discard">{{ $t('contractReview.discard') }}</button>
        </view>
      </template>
    </view>
    <view class="cr-section">
      <button class="cr-button cr-primary" :disabled="!canRun" @tap="startReview">{{ $t(running ? 'contractReview.running' : 'contractReview.run') }}</button>
      <text class="cr-note">{{ $t('contractReview.runHint') }}</text>
      <text v-if="!docFileId" class="cr-note">{{ $t('contractReview.noDocument') }}</text>
      <text v-else-if="!isDocx" class="cr-note">{{ $t('contractReview.docxOnly') }}</text>
    </view>
    <view class="cr-section">
      <view class="cr-heading"><text>{{ $t('contractReview.results') }}</text>
        <button class="cr-button" :disabled="busy || loading || !docFileId" @tap="refresh">{{ $t('contractReview.refresh') }}</button>
      </view>
      <text v-if="!run && !loading" class="cr-note">{{ $t('contractReview.noResults') }}</text>
      <template v-if="run">
        <text class="cr-label">{{ run.standard.name }} · {{ $t('contractReview.version', { version: run.standard.version }) }}</text>
        <text class="cr-note">{{ run.standard.position }} · {{ run.standard.jurisdiction }}</text>
        <text class="cr-note">{{ $t('contractReview.reviewedAt', { time: run.finishedAt || run.startedAt }) }}</text>
        <text class="cr-label" :class="{ 'cr-warning': run.status !== 'DONE' }">{{ $t('contractReview.runStatus.' + run.status) }}</text>
        <text v-if="run.error" class="cr-error">{{ run.error }}</text>
        <text v-if="run.stale" class="cr-warning">{{ $t('contractReview.stale') }}</text>
        <text class="cr-note">{{ $t('contractReview.snapshotHint') }}</text>
        <view v-for="item in resultRows" :key="item.rule.id" class="cr-rule">
          <view class="cr-heading"><text>{{ item.rule.title }}</text><text class="cr-status" :class="{ 'cr-warning': item.result.status !== 'PASS' }">{{ $t('contractReview.resultStatus.' + item.result.status) }}</text></view>
          <text class="cr-note">{{ item.rule.instruction }}</text>
          <button v-if="item.result.quote" class="cr-quote" :disabled="run.stale" @tap="locateResult(item.result)">{{ item.result.quote }}<text class="cr-note">{{ $t('contractReview.locate') }}</text></button>
          <text v-else class="cr-note">{{ $t('contractReview.noQuote') }}</text>
          <text class="cr-label">{{ $t('contractReview.reason') }}</text>
          <text class="cr-copy">{{ item.result.reason || $t('contractReview.notReviewed') }}</text>
          <template v-if="item.result.suggestion"><text class="cr-label">{{ $t('contractReview.suggestion') }}</text><text class="cr-copy">{{ item.result.suggestion }}</text></template>
        </view>
      </template>
    </view>
  </scroll-view>
</template>

<script>
import { listReviewStandards, saveReviewStandard, confirmReviewStandard, getContractReview, runContractReview } from '@/services/contractReview.js'

function copy(value) { return JSON.parse(JSON.stringify(value)) }
function content(draft) {
  if (!draft) return ''
  return JSON.stringify({ name: draft.name, position: draft.position, jurisdiction: draft.jurisdiction, rules: draft.rules })
}
function newRule() { return { id: crypto.randomUUID(), title: '', instruction: '' } }

export default {
  name: 'ContractReviewPane',
  emits: ['locate'],
  props: {
    projectId: { type: [Number, String], default: null },
    docFileId: { type: [Number, String], default: null },
    docName: { type: String, default: '' },
    canWrite: { type: Boolean, default: true },
    prepareDocument: { type: Function, default: null },
  },
  data() {
    return { standards: [], draft: null, original: '', run: null, error: '', loading: false, busy: false, running: false, generation: 0 }
  },
  computed: {
    dirty() { return !!this.draft && content(this.draft) !== this.original },
    confirmed() { return !!this.draft?.id && !this.dirty && this.draft.confirmedVersion === this.draft.version },
    validDraft() {
      return !!this.draft && !!this.draft.name.trim() && !!this.draft.position.trim() && !!this.draft.jurisdiction.trim()
        && this.draft.rules.length > 0 && this.draft.rules.length <= 20
        && this.draft.rules.every((rule) => rule.title.trim() && rule.instruction.trim())
    },
    isDocx() { return /\.docx$/i.test(this.docName) },
    canRun() { return !!this.projectId && !!this.docFileId && this.isDocx && this.canWrite && this.confirmed && !this.busy && !this.loading },
    resultRows() {
      if (!this.run) return []
      const results = new Map((this.run.results || []).map((result) => [result.ruleId, result]))
      return this.run.standard.rules.map((rule) => ({ rule, result: results.get(rule.id) || { status: 'UNREVIEWED' } }))
    },
  },
  watch: {
    projectId() { this.reset(true) },
    docFileId() { this.reset(false) },
  },
  mounted() { this._disposed = false; this.reset(true) },
  beforeUnmount() { this._disposed = true; this.generation++ },
  methods: {
    current(generation, pid, did) { return !this._disposed && generation === this.generation && pid === this.projectId && did === this.docFileId },
    reset(projectChanged) {
      this.generation++
      this.run = null; this.error = ''; this.busy = false; this.running = false
      if (projectChanged) { this.standards = []; this.draft = null; this.original = '' }
      this._loading = this.refresh()
      return this._loading
    },
    async refresh() {
      if (this.busy) return
      if (!this.projectId) { this.loading = false; return }
      const generation = this.generation, pid = this.projectId, did = this.docFileId
      this.loading = true
      try {
        const [standards, run] = await Promise.all([listReviewStandards(pid), did ? getContractReview(pid, did) : Promise.resolve(null)])
        if (!this.current(generation, pid, did)) return
        this.standards = standards || []
        this.run = run
        if (!this.dirty) {
          const selected = this.standards.find((standard) => standard.id === this.draft?.id) || this.standards[0]
          if (selected) this.setDraft(selected)
        }
        this.error = ''
      } catch (error) {
        if (this.current(generation, pid, did)) this.error = error.message || this.$t('contractReview.loadFailed')
      } finally {
        if (this.current(generation, pid, did)) this.loading = false
      }
    },
    locateResult(result) { if (this.run && !this.run.stale && result.quote) this.$emit('locate', result.quote) },
    setDraft(standard) { this.draft = copy(standard); this.original = content(standard) },
    selectStandard(standard) { if (!this.busy && !this.dirty) this.setDraft(standard) },
    newStandard() {
      if (!this.projectId || !this.canWrite || this.busy || this.dirty || this.loading) return
      this.draft = { name: '', position: '', jurisdiction: '', rules: [newRule()], version: null, confirmedVersion: null }
      this.original = ''
    },
    addRule() { if (this.canWrite && !this.busy && this.draft && this.draft.rules.length < 20) this.draft.rules.push(newRule()) },
    removeRule(index) { if (this.canWrite && !this.busy) this.draft.rules.splice(index, 1) },
    async discard() {
      if (this.busy) return
      this.draft = null; this.original = ''
      await this.refresh()
    },
    async persist(confirming) {
      if (!this.projectId || !this.canWrite || this.busy || this.loading || !this.draft) return
      if (confirming ? this.dirty || this.confirmed || !this.draft.id : !this.dirty || !this.validDraft) return
      const generation = this.generation, pid = this.projectId, did = this.docFileId
      const draft = copy(this.draft)
      this.busy = true; this.error = ''
      try {
        const saved = confirming ? await confirmReviewStandard(pid, draft.id, draft.version)
          : await saveReviewStandard(pid, { id: draft.id, expectedVersion: draft.version, name: draft.name,
            position: draft.position, jurisdiction: draft.jurisdiction, rules: draft.rules })
        if (!this.current(generation, pid, did)) return
        this.standards = [saved, ...this.standards.filter((item) => item.id !== saved.id)]
        this.setDraft(saved)
      } catch (error) {
        if (this.current(generation, pid, did)) this.error = error.message || this.$t('contractReview.saveFailed')
      } finally {
        if (this.current(generation, pid, did)) this.busy = false
      }
    },
    save() { return this.persist(false) },
    confirm() { return this.persist(true) },
    async startReview() {
      if (!this.canRun) return
      const generation = this.generation, pid = this.projectId, did = this.docFileId
      const standardId = this.draft.id, version = this.draft.version
      this.busy = true; this.running = true; this.error = ''
      try {
        const saved = this.prepareDocument && await this.prepareDocument(did)
        if (!this.current(generation, pid, did) || !this.canWrite) return
        if (!saved) { this.error = this.$t('contractReview.saveRequired'); return }
        const run = await runContractReview(pid, { docFileId: did, standardId, version })
        if (this.current(generation, pid, did)) this.run = run
      } catch (error) {
        if (this.current(generation, pid, did)) this.error = error.message || this.$t('contractReview.runFailed')
      } finally {
        if (this.current(generation, pid, did)) { this.busy = false; this.running = false }
      }
    },
  },
}
</script>

<style lang="scss" scoped>
.cr { flex: 1; min-height: 0; color: var(--awd-text); font-size: var(--awd-panel-fs); }
.cr-section { padding: var(--awd-panel-pad-x, 10px); border-bottom: 1px solid var(--awd-panel-border, var(--awd-border)); }
.cr-heading, .cr-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cr-heading { justify-content: space-between; font-weight: 600; margin-bottom: 6px; }
.cr-label, .cr-note, .cr-copy { display: block; line-height: 1.6; overflow-wrap: anywhere; }
.cr-label { margin-top: 8px; font-weight: 600; }
.cr-note { color: var(--awd-text-3); font-size: var(--awd-panel-fs-meta); margin: 4px 0; }
.cr-copy { white-space: pre-wrap; }
.cr-input { box-sizing: border-box; width: 100%; padding: 6px; height: 32px; color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); font-size: var(--awd-panel-fs); }
.cr-textarea { min-height: 64px; margin-top: 6px; }
.cr-rule { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--awd-border); }
.cr-button, .cr-choice, .cr-quote { padding: 4px 8px; margin: 0; font-size: var(--awd-panel-fs-meta); line-height: 1.6; color: var(--awd-text-2); background: var(--awd-surface-2); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); }
.cr-button::after, .cr-choice::after, .cr-quote::after { border: none; }
.cr-button[disabled], .cr-choice[disabled] { opacity: .55; }
.cr-choice { width: 100%; margin: 4px 0; text-align: left; overflow-wrap: anywhere; }
.cr-choice.selected, .cr-primary { background: var(--awd-accent-soft); color: var(--awd-accent-text); border-color: var(--awd-mint); }
.cr-quote { width: 100%; margin-top: 8px; text-align: left; background: var(--awd-bg); white-space: pre-wrap; overflow-wrap: anywhere; }
.cr-status { font-size: var(--awd-panel-fs-meta); color: var(--awd-accent-text); }
.cr-warning { color: var(--awd-warning-text); font-size: var(--awd-panel-fs-meta); line-height: 1.6; }
.cr-error { padding: 8px; background: var(--awd-danger-soft); color: var(--awd-danger-text); overflow-wrap: anywhere; }
</style>
