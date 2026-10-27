<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <DdClientChecklist v-if="clientView" :request-id="requestId" :project-id="projectId" />
  <view v-else class="dd-workspace">
    <view class="dd-header">
      <view class="dd-heading">
        <input v-model="requestName" class="dd-title" :disabled="!editable || busy" :aria-label="$t('ddWorkflow.listName')" @confirm="saveName" />
        <button v-if="editable && requestName !== request.name" :disabled="busy" @tap="saveName">{{ $t('ddWorkflow.saveName') }}</button>
        <text v-if="request" class="badge">{{ $t(`ddWorkflow.requestStatus.${request.status || 'DRAFT'}`) }}</text>
        <text class="muted">{{ $t('ddWorkflow.confirmedCount', { count: counts.APPROVED, total: counts.ALL }) }}</text>
      </view>
      <view class="actions">
        <button :disabled="loading || busy" @tap="fetchData">{{ $t('ddWorkflow.refresh') }}</button>
        <button v-if="canReview" :disabled="busy" @tap="$emit('invite-client')">{{ $t('ddWorkflow.inviteClient') }}</button>
        <button v-if="editable && request?.status === 'DRAFT'" class="primary" :disabled="busy" @tap="publish">{{ $t('ddWorkflow.confirmPublish') }}</button>
        <button v-if="canReview && request?.status === 'PUBLISHED'" :disabled="busy" @tap="archive">{{ $t('ddWorkflow.archive') }}</button>
      </view>
    </view>
    <view v-if="error" class="feedback error" role="alert"><text>{{ error }}</text><button v-if="pendingJob" :disabled="busy" @tap="resumeJob">{{ $t('ddWorkflow.checkProgress') }}</button></view>
    <view v-if="notice" class="feedback notice" role="status">{{ notice }}</view>
    <view v-if="exampleBatch" class="feedback notice" role="status">{{ $t('ddWorkflow.exampleBatchProgress', { completed: exampleBatch.index, total: exampleBatch.items.length, name: exampleBatch.items[exampleBatch.index]?.title || '' }) }}</view>
    <view v-if="busy" class="feedback processing" role="status" aria-live="polite"><text>{{ busyLabel }}</text><text>{{ $t('ddWorkflow.elapsed', { seconds: elapsed }) }}</text></view>
    <view v-if="loading && !request" class="empty" role="status">{{ $t('ddWorkflow.loading') }}</view>
    <view v-else-if="!request" class="empty"><text>{{ $t(deleted ? 'ddWorkflow.deleted' : 'ddWorkflow.loadFailed') }}</text><button v-if="!deleted" @tap="fetchData">{{ $t('ddWorkflow.retry') }}</button></view>
    <template v-else>
      <view class="dd-toolbar">
        <view class="filters" :aria-label="$t('ddWorkflow.filterItems')">
          <button v-for="key in filterKeys" :key="key" :class="{ selected: filter === key }" :aria-pressed="filter === key" @tap="filter = key">{{ $t(`ddWorkflow.filters.${key}`) }} <text>{{ counts[key] }}</text></button>
        </view>
        <view class="actions">
          <button v-if="editable" :disabled="busy" @tap="addItem(null)">{{ $t('ddWorkflow.addItem') }}</button>
          <button v-if="editable" :disabled="busy || (!missingExamples.length && !exampleBatch)" @tap="generateMissingExamples">{{ $t(exampleBatch ? 'ddWorkflow.resumeExamples' : 'ddWorkflow.completeExamples') }}</button>
          <button v-if="canWrite" :disabled="busy || !hasMaterials" @tap="syncMaterials">{{ $t('ddWorkflow.importMaterials') }}</button>
          <button v-if="canWrite" :disabled="busy || !counts.APPROVED" @tap="createReport">{{ $t('ddWorkflow.draftReport') }}</button>
        </view>
      </view>
      <view v-if="request.status === 'DRAFT'" class="draft-hint">{{ $t('ddWorkflow.draftHint') }}<label v-if="canWrite"><checkbox :checked="aiReviewEnabled" :disabled="busy" @tap="aiReviewEnabled = !aiReviewEnabled" />{{ $t('ddWorkflow.aiReviewEnabled') }}</label></view>
      <view class="dd-body">
        <view class="item-list">
          <input v-model="search" class="search" :placeholder="$t('ddWorkflow.searchItems')" :aria-label="$t('ddWorkflow.searchItems')" />
          <view class="item-scroll">
            <button v-for="item in visibleItems" :key="item.id" class="item-row" :class="{ active: String(item.id) === String(selectedId) }" :aria-pressed="String(item.id) === String(selectedId)" :style="{ paddingLeft: `${12 + Math.min(item.depth, 4) * 12}px` }" @tap="selectItem(item)">
              <text class="item-title">{{ item.title || $t('ddWorkflow.untitledItem') }}</text>
              <text class="badge" :class="statusClass(item)">{{ $t(`ddWorkflow.itemStatus.${status(item)}`) }}</text>
            </button>
            <view v-if="!visibleItems.length" class="empty">{{ $t(items.length ? 'ddWorkflow.noMatchingItems' : 'ddWorkflow.noItems') }}</view>
          </view>
          <button v-if="editable && request.status === 'DRAFT'" class="delete-list" :disabled="busy" @tap="deleteRequest">{{ $t('ddWorkflow.deleteList') }}</button>
        </view>
        <view v-if="selected" class="item-detail">
          <view class="detail-heading"><text>{{ $t('ddWorkflow.requirements') }}</text><text class="badge" :class="statusClass(selected)">{{ $t(`ddWorkflow.itemStatus.${status(selected)}`) }}</text></view>
          <label class="field"><text>{{ $t('ddWorkflow.itemTitle') }}</text><input v-model="itemTitle" :disabled="!editable || busy" maxlength="500" /></label>
          <label class="field"><text>{{ $t('ddWorkflow.itemRequirements') }}</text><textarea v-model="itemDescription" :disabled="!editable || busy" :placeholder="$t('ddWorkflow.requirementsHint')" maxlength="1024" auto-height /></label>
          <view v-if="editable" class="actions item-edit-actions">
            <button class="primary" :disabled="busy || !itemDirty || !itemTitle.trim()" @tap="saveItem">{{ $t('ddWorkflow.saveRequirements') }}</button>
            <button :disabled="busy" @tap="addItem(selected.id)">{{ $t('ddWorkflow.addChild') }}</button>
            <button v-if="selected.parentId" :disabled="busy" @tap="outdent">{{ $t('ddWorkflow.outdent') }}</button>
            <button :disabled="busy" @tap="deleteItem">{{ $t('ddWorkflow.deleteItem') }}</button>
          </view>
          <view v-if="!selectedIsCategory" class="detail-section">
            <view class="detail-heading"><text>{{ $t('ddWorkflow.example') }}</text><button v-if="editable" :disabled="busy || itemDirty" @tap="generateExample">{{ $t(selected.exampleFileId ? 'ddWorkflow.regenerateExample' : 'ddWorkflow.generateExample') }}</button></view>
            <text class="muted explanatory">{{ $t('ddWorkflow.exampleHint') }}</text>
            <image v-if="selected.exampleFileId" class="example-image" :src="exampleUrl" mode="widthFix" @error="exampleError = true" />
            <text v-if="exampleError" class="error">{{ $t('ddWorkflow.exampleLoadFailed') }}</text>
          </view>
          <view v-if="selectedIsCategory" class="detail-section category-children">
            <view class="detail-heading">{{ $t('ddWorkflow.categoryItems') }}</view>
            <text class="muted explanatory">{{ $t('ddWorkflow.categoryHint') }}</text>
            <button v-for="child in selectedChildren" :key="child.id" @tap="selectItem(child)">{{ child.title || $t('ddWorkflow.untitledItem') }} <text class="badge">{{ $t(`ddWorkflow.itemStatus.${status(child)}`) }}</text></button>
          </view>
          <view v-else class="detail-section">
            <view class="detail-heading"><text>{{ $t('ddWorkflow.currentSubmission') }}</text><button v-if="submission" :disabled="historyLoading" @tap="loadHistory">{{ $t('ddWorkflow.history') }}</button></view>
            <template v-if="submission">
              <text v-if="submission.submittedAt" class="muted">{{ formatDate(submission.submittedAt) }}</text>
              <text v-if="submission.reason" class="explanatory">{{ submission.reason }}</text>
              <view class="file-list"><a v-for="file in submissionFiles(submission)" :key="file.fileId" :href="submissionUrl(submission, file)" target="_blank" rel="noopener" class="file-link">{{ file.name }}</a></view>
              <view class="ai-result" :class="{ 'is-ai_failed': submission.aiStatus === 'FAILED' }">
                <text class="section-title">{{ !request.aiReviewEnabled || !submission.aiConsent || submission.type !== 'FILES' ? $t('ddWorkflow.manualReview') : $t(`ddWorkflow.aiStatus.${submission.aiStatus || 'MANUAL_REQUIRED'}`) }}</text>
                <text v-if="aiResult?.summary" class="explanatory">{{ aiResult.summary }}</text>
                <text v-for="(reason, index) in aiReasons" :key="index" class="explanatory">{{ reason }}</text>
                <text class="muted explanatory">{{ $t('ddWorkflow.aiBoundary') }}</text>
                <button v-if="canReview && request.aiReviewEnabled && submission.aiConsent && submission.type === 'FILES' && ['FAILED', 'MANUAL_REQUIRED'].includes(submission.aiStatus)" :disabled="busy" @tap="retryVerification">{{ $t('ddWorkflow.retryVerification') }}</button>
              </view>
              <view v-if="submission.appealReason" class="appeal"><text class="section-title">{{ $t('ddWorkflow.appeal') }}</text><text class="explanatory">{{ submission.appealReason }}</text></view>
              <view v-if="submission.reviewReason" class="review-result"><text>{{ $t('ddWorkflow.reviewReason') }}</text><text class="explanatory">{{ submission.reviewReason }}</text></view>
            </template>
            <view v-else-if="selected.uploadedFileId"><a class="file-link" :href="legacyFileUrl" target="_blank" rel="noopener">{{ $t('ddWorkflow.viewOriginal') }}</a></view>
            <text v-else class="muted">{{ $t('ddWorkflow.noSubmission') }}</text>
            <view v-if="canReview && (submission || selected.uploadedFileId)" class="review-form">
              <textarea v-model="reviewReason" :disabled="busy" :placeholder="$t('ddWorkflow.reviewReasonHint')" :aria-label="$t('ddWorkflow.reviewReason')" maxlength="2000" auto-height />
              <view class="actions"><button class="primary" :disabled="busy" @tap="review('APPROVED')">{{ $t('ddWorkflow.approve') }}</button><button :disabled="busy || !reviewReason.trim()" @tap="review('REJECTED')">{{ $t('ddWorkflow.reject') }}</button><button v-if="['APPROVED', 'REJECTED'].includes(selected.status)" :disabled="busy" @tap="review('UPLOADED')">{{ $t('ddWorkflow.withdrawReview') }}</button></view>
            </view>
          </view>
          <view v-if="historyVisible" class="detail-section">
            <view class="detail-heading"><text>{{ $t('ddWorkflow.history') }}</text><button @tap="historyVisible = false">{{ $t('ddWorkflow.close') }}</button></view>
            <text v-if="historyLoading" role="status">{{ $t('ddWorkflow.loading') }}</text>
            <view v-for="version in history" :key="version.id" class="history-row"><text>{{ formatDate(version.submittedAt) }}</text><text v-if="String(version.id) === String(selected.currentSubmissionId)" class="badge">{{ $t('ddWorkflow.currentVersion') }}</text><text v-if="version.reason" class="explanatory">{{ version.reason }}</text><a v-for="file in submissionFiles(version)" :key="file.fileId" class="file-link" :href="submissionUrl(version, file)" target="_blank" rel="noopener">{{ file.name }}</a></view>
          </view>
          <view class="detail-section">
            <view class="detail-heading"><text>{{ $t('ddWorkflow.comments') }}</text><button :disabled="commentsLoading" @tap="loadComments">{{ $t('ddWorkflow.refresh') }}</button></view>
            <text v-if="commentsLoading" role="status" class="muted">{{ $t('ddWorkflow.loading') }}</text>
            <view v-for="comment in comments" :key="comment.id" class="comment"><text class="muted">{{ formatDate(comment.createdAt) }}</text><text class="explanatory">{{ comment.content }}</text></view>
            <text v-if="!commentsLoading && !comments.length" class="muted">{{ $t('ddWorkflow.noComments') }}</text>
            <view v-if="canReview" class="comment-input"><textarea v-model="commentText" :disabled="busy" :placeholder="$t('ddWorkflow.commentHint')" :aria-label="$t('ddWorkflow.commentHint')" maxlength="2000" auto-height /><button :disabled="busy || !commentText.trim()" @tap="sendComment">{{ $t('ddWorkflow.send') }}</button></view>
          </view>
        </view>
        <view v-else class="detail-empty empty">{{ $t(items.length ? 'ddWorkflow.selectItem' : 'ddWorkflow.noItemsHint') }}</view>
      </view>
    </template>
  </view>
</template>
<script>
import api, { getApiBaseUrl, ddUrl } from '@/services/api'
import { getSessionId } from '@/utils/auth'
import DdClientChecklist from '@/components/dd/DdClientChecklist.vue'
import { publishDdRequest, archiveDdRequest, generateDdExample, getDdJob, getDdMaterialJob, reviewDdSubmission, getDdSubmissionHistory, ddSubmissionFileUrl, ddExampleFileUrl, retryDdVerification, importDdMaterials, draftDdReport, getDdStartAttempt, finishDdStartAttempt } from '@/services/ddWorkflow'
import { ddSubmissionFor, ddWorkflowStatus, ddWorkflowCounts, ddMatchesFilter, ddPublishIssues, ddAiResult, ddSubmissionFiles, ddOrderedItems, ddIsCategory, waitForDdJob } from '@/utils/ddWorkflow'

export default {
  name: 'DdRequestEditor', components: { DdClientChecklist },
  props: { requestId: { type: [String, Number], required: true }, projectId: { type: [String, Number], required: true }, clientView: Boolean, focusItemId: { type: [String, Number], default: null }, canWrite: { type: Boolean, default: true } },
  emits: ['changed', 'deleted', 'invite-client', 'reload-files', 'open-file'],
  data: () => ({ request: null, requestName: '', items: [], submissions: {}, selectedId: null, itemTitle: '', itemDescription: '', filter: 'ALL', search: '', loading: false, busy: false, busyLabel: '', error: '', notice: '', elapsed: 0, fetchSeq: 0, deleted: false, aiReviewEnabled: true, reviewReason: '', comments: [], commentText: '', commentsLoading: false, history: [], historyVisible: false, historyLoading: false, exampleError: false, pendingJob: null, exampleBatch: null }),
  computed: {
    editable() { return !this.clientView && this.canWrite && this.request?.status === 'DRAFT' },
    canReview() { return !this.clientView && this.canWrite && !!this.request && !['ARCHIVED', 'COMPLETED'].includes(this.request.status) },
    selected() { return this.items.find(item => String(item.id) === String(this.selectedId)) || null },
    missingExamples() { return this.items.filter(item => !this.items.some(child => String(child.parentId) === String(item.id)) && !item.exampleFileId) },
    selectedIsCategory() { return ddIsCategory(this.selected, this.items, this.submissions) },
    selectedChildren() { return this.items.filter(item => String(item.parentId) === String(this.selectedId)).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) },
    submission() { return this.selected ? ddSubmissionFor(this.selected, this.submissions) : null },
    counts() { return ddWorkflowCounts(this.items, this.submissions) },
    filterKeys() { return ['ALL', 'PENDING', 'REVIEW', 'APPEALED', 'CHANGES', 'APPROVED'] },
    visibleItems() { return ddOrderedItems(this.items).filter(item => (ddIsCategory(item, this.items, this.submissions) ? this.filter === 'ALL' : ddMatchesFilter(item, ddSubmissionFor(item, this.submissions), this.filter)) && (!this.search.trim() || `${item.title} ${item.description}`.toLowerCase().includes(this.search.trim().toLowerCase()))) },
    itemDirty() { return !!this.selected && (this.itemTitle !== (this.selected.title || '') || this.itemDescription !== (this.selected.description || '')) },
    hasMaterials() { return this.items.some(item => item.currentSubmissionId || item.uploadedFileId) },
    exampleUrl() { return this.selected ? `${ddExampleFileUrl(this.selected.id, this.projectId)}&v=${encodeURIComponent(this.selected.exampleFileId || '')}` : '' },
    legacyFileUrl() { return this.selected ? `${getApiBaseUrl()}${ddUrl(`/api/dd/items/${this.selected.id}/file?token=${encodeURIComponent(getSessionId() || '')}`, this.projectId)}` : '' },
    aiResult() { return ddAiResult(this.submission) },
    aiReasons() {
      const reasons = this.aiResult?.checks || this.aiResult?.issues || this.aiResult?.reasons || []
      return (Array.isArray(reasons) ? reasons : [reasons]).map(reason => typeof reason === 'string' ? reason : [reason.requirement, reason.reason || reason.message || reason.description].filter(Boolean).join('：')).filter(Boolean)
    }
  },
  mounted() { this._disposed = false; if (!this.clientView) this.fetchData() },
  beforeUnmount() { this._disposed = true; this.fetchSeq++; this._abort?.abort(); clearInterval(this._clock); clearTimeout(this._refreshTimer) },
  watch: { focusItemId(id) { const item = this.items.find(item => String(item.id) === String(id)); if (item) this.selectItem(item) }, requestId() { this.reset() }, projectId() { this.reset() } },
  methods: {
    status(item) { return ddIsCategory(item, this.items, this.submissions) ? 'CATEGORY' : ddWorkflowStatus(item, ddSubmissionFor(item, this.submissions)) },
    statusClass(item) { return `is-${this.status(item).toLowerCase()}` },
    submissionFiles: ddSubmissionFiles,
    submissionUrl(version, file) { return ddSubmissionFileUrl(this.selected.id, version.id, file.fileId, this.projectId) },
    formatDate(value) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString() },
    reset() { this._abort?.abort(); this.fetchSeq++; this.request = null; this.items = []; this.selectedId = null; this.pendingJob = null; this.exampleBatch = null; this.deleted = false; this.error = ''; if (!this.clientView) this.fetchData() },
    async fetchData() {
      if (this._disposed) return false
      const seq = ++this.fetchSeq
      this.loading = true; clearTimeout(this._refreshTimer); if (!this.busy) this.error = ''
      try {
        const response = await api.getDdRequestDetails(this.requestId, this.projectId)
        if (seq !== this.fetchSeq) return false
        const data = response.data || response
        this.request = data.request; this.items = data.items || []; this.submissions = data.submissionsByItem || {}
        this.requestName = this.request.name
        this.aiReviewEnabled = this.request.aiReviewEnabled !== false
        const item = this.items.find(item => String(item.id) === String(this.selectedId || this.focusItemId)) || this.items[0]
        if (item && (!this.selectedId || String(item.id) !== String(this.selectedId))) this.setSelection(item)
        else if (!item) this.selectedId = null
        this.$emit('changed', this.request)
        if (this.items.some(item => this.status(item) === 'CHECKING')) this._refreshTimer = setTimeout(() => { if (!this.busy && !this.itemDirty) this.fetchData() }, 4000)
        return true
      } catch (e) { if (seq === this.fetchSeq) this.error = e.message || this.$t('ddWorkflow.loadFailed'); return false }
      finally { if (seq === this.fetchSeq) this.loading = false }
    },
    setSelection(item) { this.selectedId = item.id; this.itemTitle = item.title || ''; this.itemDescription = item.description || ''; this.reviewReason = ''; this.historyVisible = false; this.history = []; this.exampleError = false; this.comments = []; this.commentText = ''; this.loadComments() },
    async selectItem(item) { if (this.busy || String(item.id) === String(this.selectedId)) return; if (this.itemDirty && !await this.saveItem()) return; this.setSelection(item) },
    async run(label, operation) {
      if (this.busy) return false
      this.busy = true; this.busyLabel = this.$t(`ddWorkflow.${label}`); this.error = ''; this.notice = ''; this.elapsed = 0
      this._clock = setInterval(() => this.elapsed++, 1000)
      try { await operation(); return true }
      catch (e) { if (e.name !== 'AbortError' && !this._disposed) this.error = e.name === 'TimeoutError' ? this.$t('ddWorkflow.jobStillRunning') : e.message || this.$t('ddWorkflow.operationFailed'); return false }
      finally { this.busy = false; clearInterval(this._clock) }
    },
    async saveName() {
      if (!this.editable || this.busy || this.requestName === this.request.name) return true
      if (!this.requestName.trim()) { this.requestName = this.request.name; return }
      return this.run('saving', async () => { await api.updateDdRequest(this.requestId, this.requestName.trim(), this.projectId); this.request.name = this.requestName.trim(); this.$emit('changed', this.request) })
    },
    async saveItem() {
      if (!this.itemDirty) return true
      if (!this.editable || !this.itemTitle.trim()) { this.error = this.$t('ddWorkflow.titleRequired'); return false }
      return this.run('saving', async () => { await api.updateDdItemInfo(this.selected.id, this.itemTitle.trim(), this.itemDescription, this.projectId); this.selected.title = this.itemTitle.trim(); this.itemTitle = this.selected.title; this.selected.description = this.itemDescription; await this.fetchData() })
    },
    async addItem(parentId) {
      if (!this.editable || this.busy || (this.itemDirty && !await this.saveItem())) return
      await this.run('saving', async () => { const result = await api.addDdItem(this.requestId, parentId, this.projectId); await this.fetchData(); const added = result.data || result; const item = this.items.find(item => String(item.id) === String(added.id)); if (item) this.setSelection(item) })
    },
    async outdent() { if (!this.editable || !this.selected?.parentId) return; await this.run('saving', async () => { const parent = this.items.find(item => String(item.id) === String(this.selected.parentId)); await api.moveDdItem(this.selected.id, parent?.parentId || null, this.projectId); await this.fetchData() }) },
    confirm(title, content) { return new Promise(resolve => uni.showModal({ title: this.$t(`ddWorkflow.${title}`), content: this.$t(`ddWorkflow.${content}`), success: result => resolve(!!result.confirm), fail: () => resolve(false) })) },
    async deleteItem() { if (!this.editable || !await this.confirm('deleteItem', 'deleteItemConfirm')) return; await this.run('saving', async () => { await api.deleteDdItem(this.selected.id, this.projectId); this.selectedId = null; await this.fetchData() }) },
    async deleteRequest() { if (!this.editable || !await this.confirm('deleteList', 'deleteListConfirm')) return; await this.run('saving', async () => { await api.deleteDdRequest(this.requestId, this.projectId); this.deleted = true; this.request = null; this.items = []; this.fetchSeq++; this.$emit('deleted', this.requestId) }) },
    async publish() {
      if (!this.editable || this.busy || (this.itemDirty && !await this.saveItem())) return
      if (!await this.saveName()) return
      const issues = ddPublishIssues(this.requestName, this.items)
      if (issues.length) { this.error = this.$t(`ddWorkflow.publishIssues.${issues[0]}`); return }
      if (!await this.confirm('confirmPublish', 'publishConfirm')) return
      await this.run('publishing', async () => { await publishDdRequest(this.requestId, { aiReviewEnabled: this.aiReviewEnabled }, this.projectId); await this.fetchData(); this.notice = this.$t('ddWorkflow.publishedNotice') })
    },
    async archive() { if (!this.canReview || !await this.confirm('archive', 'archiveConfirm')) return; await this.run('saving', async () => { await archiveDdRequest(this.requestId, this.projectId); await this.fetchData() }) },
    async performJob(job, kind, itemId, attempt) {
      if (this._disposed) throw Object.assign(new Error('Observation stopped'), { name: 'AbortError' })
      this.pendingJob = { job, kind, itemId, attempt }
      this._abort?.abort(); this._abort = new AbortController()
      try {
        const result = await waitForDdJob(job, id => kind === 'materials' || kind === 'report' ? getDdMaterialJob(this.projectId, id) : getDdJob(id, this.projectId), { signal: this._abort.signal, onUpdate: current => { this.pendingJob.job = current } })
        if (kind === 'materials') { this.$emit('reload-files', (result.files || []).map(file => file.id)); this.notice = this.$t('ddWorkflow.materialsImported') }
        else if (kind === 'report') { this.$emit('reload-files', []); if (result.report) this.$emit('open-file', result.report); this.notice = this.$t('ddWorkflow.reportReady') }
        else {
          if (!await this.fetchData()) throw new Error(this.error || this.$t('ddWorkflow.loadFailed'))
          if (['example', 'example-batch'].includes(kind) && !this.items.find(item => String(item.id) === String(itemId))?.exampleFileId) throw new Error(this.$t('ddWorkflow.exampleNotReady'))
        }
        finishDdStartAttempt(attempt)
        this.pendingJob = null
        return result
      } catch (e) { if (['FAILED', 'CANCELED', 'CANCELLED'].includes(this.pendingJob?.job?.status)) { finishDdStartAttempt(attempt); this.pendingJob = null }; throw e }
    },
    async resumeJob() { if (!this.pendingJob || this.busy) return; if (this.pendingJob.kind === 'example-batch') return this.generateMissingExamples(); const { job, kind, itemId, attempt } = this.pendingJob; await this.run('processing', () => this.performJob(job, kind, itemId, attempt)) },
    async generateMissingExamples() {
      if (!this.editable || this.busy || (this.itemDirty && !await this.saveItem())) return
      if (this.pendingJob && this.pendingJob.kind !== 'example-batch') return this.resumeJob()
      if (!this.exampleBatch) this.exampleBatch = { items: this.missingExamples.map(item => ({ id: item.id, title: item.title })), index: 0 }
      if (!this.exampleBatch.items.length) { this.exampleBatch = null; return }
      await this.run('generatingExample', async () => {
        // One in-flight job: completion, not elapsed time, advances the queue.
        while (this.exampleBatch.index < this.exampleBatch.items.length) {
          if (this._disposed) return
          const item = this.exampleBatch.items[this.exampleBatch.index]
          const current = this.items.find(candidate => String(candidate.id) === String(item.id))
          if (!current || current.exampleFileId) {
            if (String(this.pendingJob?.itemId) === String(item.id)) this.pendingJob = null
            this.exampleBatch.index++; continue
          }
          try {
            const job = this.pendingJob?.job || await generateDdExample(item.id, this.projectId)
            await this.performJob(job, 'example-batch', item.id)
            this.exampleBatch.index++
          } catch (e) {
            if (e.name !== 'AbortError') e.message = `${item.title}：${e.message}`
            throw e
          }
        }
        this.notice = this.$t('ddWorkflow.examplesReady', { count: this.exampleBatch.items.length })
        this.exampleBatch = null
      })
    },
    async generateExample() { if (this.pendingJob) return this.resumeJob(); if (!this.editable || this.itemDirty) return; const id = this.selected.id; await this.run('generatingExample', async () => this.performJob(await generateDdExample(id, this.projectId), 'example', id)) },
    async retryVerification() { if (this.pendingJob) return this.resumeJob(); if (!this.canReview || !this.submission) return; const id = this.selected.id; await this.run('verifying', async () => this.performJob(await retryDdVerification(id, this.submission.id, this.projectId), 'verify', id)) },
    async review(status) {
      if (!this.canReview || !this.selected || (status === 'REJECTED' && !this.reviewReason.trim())) return
      const item = this.selected, submission = this.submission
      await this.run('saving', async () => {
        await reviewDdSubmission(item.id, { status, reason: this.reviewReason.trim(), ...(submission ? { submissionId: submission.id, revision: item.revision } : {}) }, this.projectId)
        this.reviewReason = ''; await this.fetchData()
      })
    },
    async startMaterialJob(kind) {
      if (this.pendingJob) return this.resumeJob()
      if (!this.canWrite || this.busy) return
      const projectId = this.projectId, requestId = this.requestId
      await this.run(kind === 'report' ? 'generatingReport' : 'importingMaterials', async () => {
        const attempt = await getDdStartAttempt(kind.toUpperCase(), projectId, { requestId })
        if (this._disposed || projectId !== this.projectId || requestId !== this.requestId) return
        const job = kind === 'report' ? await draftDdReport(projectId, requestId, attempt.key) : await importDdMaterials(projectId, requestId, undefined, attempt.key)
        await this.performJob(job, kind, undefined, attempt)
      })
    },
    async syncMaterials() { return this.startMaterialJob('materials') },
    async createReport() { return this.startMaterialJob('report') },
    async loadHistory() {
      if (!this.selected || this.historyLoading) return
      const id = this.selected.id
      this.historyVisible = true; this.historyLoading = true
      try { const history = await getDdSubmissionHistory(id, this.projectId); if (String(id) === String(this.selectedId)) this.history = history || [] }
      catch (e) { this.error = e.message || this.$t('ddWorkflow.loadFailed') }
      finally { this.historyLoading = false }
    },
    async loadComments() {
      if (!this.selectedId) return
      const id = this.selectedId; this.commentsLoading = true
      try { const comments = await api.getDdItemComments(id, this.projectId); if (String(id) === String(this.selectedId)) this.comments = comments.data || comments || [] }
      catch (e) { if (String(id) === String(this.selectedId)) this.error = e.message || this.$t('ddWorkflow.loadFailed') }
      finally { if (String(id) === String(this.selectedId)) this.commentsLoading = false }
    },
    async sendComment() { if (!this.canReview || !this.commentText.trim()) return; await this.run('saving', async () => { await api.addDdItemComment(this.selected.id, this.commentText.trim(), this.projectId); this.commentText = ''; await this.loadComments() }) }
  }
}
</script>
<style lang="scss" scoped>
.dd-workspace { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--awd-text); background: var(--awd-surface); font-size: var(--awd-panel-fs); }
.dd-workspace button { margin: 0; padding: 0 12px; min-height: 32px; line-height: 1.4; font: inherit; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); color: var(--awd-text); background: var(--awd-surface); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background var(--awd-motion-fast), border-color var(--awd-motion-fast); }
.dd-workspace button::after { border: 0; display: none; }
.dd-workspace button:disabled, .dd-workspace button[disabled] { opacity: .48; cursor: not-allowed; background: var(--awd-surface); color: var(--awd-text-3); }
.dd-workspace button:hover:not(:disabled) { background: var(--awd-surface-2); }
.dd-workspace button.primary { background: var(--awd-accent); border-color: var(--awd-accent); color: var(--awd-text-on-accent); font-weight: 500; }
.dd-workspace button.primary:hover:not(:disabled) { background: var(--awd-accent-hover); border-color: var(--awd-accent-hover); }
.dd-workspace button.primary:disabled, .dd-workspace button.primary[disabled] { background: var(--awd-accent); border-color: var(--awd-accent); color: var(--awd-text-on-accent); opacity: .48; }
.dd-workspace :focus-visible { outline: 2px solid var(--awd-accent-text); outline-offset: 2px; }
.dd-workspace input, .dd-workspace textarea { box-sizing: border-box; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); color: var(--awd-text); background: var(--awd-surface); font: inherit; width: 100%; }
.dd-workspace input { height: var(--awd-control-height); padding: 0 10px; line-height: var(--awd-control-height); }
.dd-workspace textarea { padding: 8px 10px; min-height: 80px; line-height: 1.7; }
.dd-workspace :deep(.uni-input-placeholder), .dd-workspace :deep(.uni-textarea-placeholder) { color: var(--awd-text-3); }
.dd-header { padding: 16px 20px; border-bottom: 1px solid var(--awd-border); display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.dd-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-width: 0; }
.dd-workspace .dd-title { font-size: var(--awd-font-size-title); font-weight: 600; width: min(380px, 100%); border-color: transparent; padding: 0 4px; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.muted { color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); line-height: 1.7; }
.badge { display: inline-block; align-self: flex-start; padding: 3px 7px; border-radius: var(--awd-radius-sm); background: var(--awd-surface-3); color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); line-height: 1.4; white-space: nowrap; }
.is-approved, .is-ai_passed { background: var(--awd-accent-soft); color: var(--awd-accent-text); }
.is-rejected, .is-ai_failed { background: var(--awd-danger-soft); color: var(--awd-danger-text); }
.is-appealed, .is-manual_required { background: var(--awd-warning-soft); color: var(--awd-warning-text); }
.feedback { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 10px 20px 0; padding: 10px 12px; border-radius: var(--awd-radius-sm); line-height: 1.6; }
.error { background: var(--awd-danger-soft); color: var(--awd-danger-text); }
.notice, .processing { background: var(--awd-accent-soft); color: var(--awd-accent-text); }
.dd-toolbar { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 12px 20px; border-bottom: 1px solid var(--awd-border-subtle); }
.filters { display: flex; flex-wrap: wrap; gap: 4px; }
.dd-workspace .filters button { border-color: transparent; background: transparent; }
.dd-workspace .filters button.selected { background: var(--awd-accent-soft); color: var(--awd-accent-text); }
.filters text { margin-left: 4px; }
.draft-hint { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 10px 20px; color: var(--awd-text-2); background: var(--awd-bg); line-height: 1.7; font-size: var(--awd-panel-fs-meta); }
.draft-hint label { display: flex; gap: 4px; align-items: center; }
.dd-body { display: flex; flex: 1; min-height: 0; }
.item-list { flex: 0 0 260px; width: 260px; min-height: 0; display: flex; flex-direction: column; padding: 12px 8px 8px; border-right: 1px solid var(--awd-border); }
.dd-workspace .search { margin: 0 4px 10px; width: calc(100% - 8px); }
.item-scroll { overflow: auto; min-height: 0; flex: 1; }
.dd-workspace .item-row { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; width: 100%; padding-top: 11px; padding-bottom: 11px; text-align: left; border-color: transparent; border-radius: var(--awd-radius-sm); }
.dd-workspace .item-row:nth-child(even) { background: var(--awd-bg); }
.dd-workspace .item-row.active { background: var(--awd-accent-soft); border-color: var(--awd-border); }
.item-title { line-height: 1.6; overflow-wrap: anywhere; }
.dd-workspace .delete-list { color: var(--awd-text-2); border: 0; background: transparent; margin-top: 10px; }
.item-detail { flex: 1; min-width: 0; overflow: auto; padding: 20px 24px 36px; }
.detail-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-weight: 600; margin-bottom: 14px; }
.detail-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--awd-border-subtle); }
.field { display: block; margin-bottom: 12px; }
.field > text { display: block; color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); margin-bottom: 6px; }
.example-image { display: block; width: min(100%, 520px); margin-top: 14px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); }
.explanatory { display: block; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; margin-top: 6px; }
.file-list { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 10px; }
.file-link { display: block; color: var(--awd-accent-text); line-height: 1.7; overflow-wrap: anywhere; text-decoration: underline; text-underline-offset: 3px; }
.ai-result, .appeal, .review-result { margin-top: 14px; padding: 12px; border-radius: var(--awd-radius-sm); background: var(--awd-bg); }
.ai-result button { margin-top: 10px; }
.appeal { background: var(--awd-warning-soft); }
.section-title { font-weight: 600; }
.review-form { margin-top: 16px; }
.review-form .actions { margin-top: 8px; }
.category-children button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; margin-top: 8px; text-align: left; }
.history-row, .comment { padding: 12px 0; border-bottom: 1px solid var(--awd-border-subtle); line-height: 1.7; }
.history-row .badge { margin-left: 8px; }
.comment-input { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; margin-top: 14px; }
.empty { padding: 28px 16px; color: var(--awd-text-2); line-height: 1.8; text-align: center; }
.detail-empty { flex: 1; align-self: center; }
@media (max-width: 800px) { .dd-header, .dd-toolbar { padding: 12px; } .dd-body { flex-direction: column; overflow: auto; } .item-list { width: auto; flex: 0 0 auto; max-height: 260px; border-right: 0; border-bottom: 1px solid var(--awd-border); } .item-detail { flex: 0 0 auto; overflow: visible; padding: 18px 14px; } }
</style>
