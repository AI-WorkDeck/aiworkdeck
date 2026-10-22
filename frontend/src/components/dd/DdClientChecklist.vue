<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="checklist" :aria-busy="loading">
    <header class="checklist-header"><div><h2>{{ request?.name || $t('ddWorkflow.client.checklistTitle') }}</h2><p>{{ $t('ddWorkflow.client.progressSummary', { completed: progress, total: actionableItems.length, pending: needsWork }) }}</p></div><button class="quiet" :disabled="loading" @click="load">{{ $t('ddWorkflow.refresh') }}</button></header>
    <p v-if="error" class="message error" role="alert">{{ error }}</p><p v-if="notice" class="message" role="status">{{ notice }}</p>
    <p v-if="request && request.status !== 'PUBLISHED'" class="message">{{ $t(request.status === 'COMPLETED' ? 'ddWorkflow.client.completedChecklist' : 'ddWorkflow.client.archivedChecklist') }}</p>
    <div class="filter-bar"><button v-for="f in filters" :key="f.id" :class="{ active: filter === f.id }" @click="filter = f.id">{{ $t(f.labelKey) }}</button><input v-model="query" :aria-label="$t('ddWorkflow.client.searchItems')" :placeholder="$t('ddWorkflow.client.searchPlaceholder')" /></div>
    <p v-if="loading && !items.length" class="empty">{{ $t('ddWorkflow.client.loadingChecklist') }}</p>
    <p v-else-if="!visibleItems.length" class="empty">{{ $t(filter === 'todo' ? 'ddWorkflow.client.nothingToPrepare' : 'ddWorkflow.client.noMatchingItems') }}</p>
    <article v-for="item in visibleItems" :key="item.id" class="item" :class="{ expanded: selectedId === item.id }">
      <button class="item-heading" :aria-expanded="selectedId === item.id" @click="selectItem(item)"><span class="item-title"><small v-if="item.level">{{ parentTitle(item) }}</small>{{ item.title }}</span><span class="status" :class="statusClass(item)">{{ statusLabel(item) }}</span><span aria-hidden="true">{{ selectedId === item.id ? '−' : '+' }}</span></button>
      <div v-if="selectedId === item.id" class="item-body">
        <p v-if="item.description" class="requirement">{{ item.description }}</p>
        <button v-if="item.exampleFileId && !isCategory(item)" class="link" @click="download(`/items/${item.id}/example/file`, $t('ddWorkflow.client.exampleFilename', { name: item.title }))">{{ $t('ddWorkflow.client.viewExample') }}</button>
        <div v-if="current(item)" class="feedback">
          <strong>{{ statusLabel(item) }}</strong>
          <p v-if="current(item).reviewReason || rejectReasons[item.id]">{{ current(item).reviewReason || rejectReasons[item.id] }}</p>
          <p v-if="aiSummary(item)">{{ aiSummary(item) }}</p>
          <ul v-if="aiReasons(item).length"><li v-for="(reason, index) in aiReasons(item)" :key="index">{{ reason }}</li></ul>
          <p v-if="pendingAppeal(current(item))">{{ $t('ddWorkflow.client.appealPending') }}</p>
          <p v-if="current(item).type === 'EXPLANATION'">{{ $t('ddWorkflow.client.explanationPrefix') }}{{ current(item).explanationReason || current(item).reason || current(item).explanation }}</p>
        </div>
        <div v-if="historyLoading" class="empty">{{ $t('ddWorkflow.client.loadingFiles') }}</div>
        <div v-for="(submission, index) in history" :key="submission.id" class="submission"><p class="submission-caption">{{ $t(index === 0 ? 'ddWorkflow.client.latestSubmission' : 'ddWorkflow.client.previousVersion') }} · {{ formatDate(submission.submittedAt) }}</p><button v-for="file in submission.files || []" :key="file.fileId" class="file-link" @click="download(`/items/${item.id}/submissions/${submission.id}/files/${file.fileId}`, file.name)"><span>{{ file.name }}</span><small>{{ $t('ddWorkflow.client.download') }}</small></button><p v-if="submission.type === 'EXPLANATION'">{{ submission.explanationReason || submission.reason || submission.explanation }}</p></div>
        <div v-if="canSubmit(item)" class="submission-form">
          <p class="form-label">{{ $t('ddWorkflow.client.submitDocuments') }}</p>
          <div class="drop-zone" @dragover.prevent @drop.prevent="addFiles($event.dataTransfer.files)"><span>{{ $t('ddWorkflow.client.dropFiles') }}</span><div class="upload-buttons"><button @click="pick(false)">{{ $t('ddWorkflow.client.chooseFiles') }}</button><button class="quiet camera" @click="pick(true)">{{ $t('ddWorkflow.client.takePhoto') }}</button></div><small>{{ $t('ddWorkflow.client.fileTypesHint') }}</small></div>
          <ul v-if="pendingFiles.length" class="pending-files"><li v-for="(file, index) in pendingFiles" :key="index"><span>{{ file.name }}</span><button class="link" :disabled="busy" @click="removeFile(index)">{{ $t('ddWorkflow.client.removeFile') }}</button></li></ul>
          <checkbox-group @change="changeAiConsent($event.detail.value.includes('ai'))"><label class="consent"><checkbox value="ai" :checked="aiConsent" :disabled="busy" /><span>{{ $t('ddWorkflow.client.aiConsent') }}</span></label></checkbox-group>
          <button v-if="pendingFiles.length" :disabled="busy" @click="upload(item)">{{ busy ? uploadProgress === 100 ? $t('ddWorkflow.client.savingUpload') : uploadProgress === null ? $t('ddWorkflow.client.submitting') : $t('ddWorkflow.client.uploadingPercent', { percent: uploadProgress }) : $t('ddWorkflow.client.submitFiles', { count: pendingFiles.length }) }}</button>
          <progress v-if="uploadProgress !== null" :percent="uploadProgress" :show-info="false" stroke-width="4" :aria-label="$t('ddWorkflow.client.uploadProgress')" /><div class="alternative-actions"><button class="link" :disabled="busy" @click="formMode = formMode === 'explanation' ? '' : 'explanation'">{{ $t('ddWorkflow.client.explainUnavailable') }}</button><button v-if="canAppeal(item)" class="link" :disabled="busy" @click="formMode = formMode === 'appeal' ? '' : 'appeal'">{{ $t('ddWorkflow.client.requestReview') }}</button></div>
          <div v-if="formMode" class="reason-form"><select v-if="formMode === 'explanation'" v-model="explanationType" :aria-label="$t('ddWorkflow.client.explanationType')"><option value="UNAVAILABLE">{{ $t('ddWorkflow.client.unavailable') }}</option><option value="NOT_APPLICABLE">{{ $t('ddWorkflow.client.notApplicable') }}</option></select><label :for="`dd-reason-${item.id}`">{{ $t(formMode === 'appeal' ? 'ddWorkflow.client.appealReason' : 'ddWorkflow.client.explanationReason') }}</label><textarea :id="`dd-reason-${item.id}`" v-model="reason" rows="3" maxlength="2000" /><button :disabled="busy || !reason.trim()" @click="submitReason(item)">{{ $t(busy ? 'ddWorkflow.client.submitting' : formMode === 'appeal' ? 'ddWorkflow.client.submitAppeal' : 'ddWorkflow.client.submitExplanation') }}</button></div>
        </div>
      </div>
    </article>
  </section>
</template>
<script>
import { ddClientRead, ddClientWrite, ddClientUpload, ddClientDownload } from '@/services/ddClient.js'
export default {
  name: 'DdClientChecklist',
  props: { requestId: { type: [String, Number], required: true }, projectId: { type: [String, Number], required: true }, connectionId: { type: String, default: '' } },
  data: () => ({ request: null, items: [], submissions: {}, rejectReasons: {}, selectedId: null, history: [], loading: false, historyLoading: false, error: '', notice: '', filter: 'all', query: '', pendingFiles: [], aiConsent: false, busy: false, uploadProgress: null, formMode: '', explanationType: 'UNAVAILABLE', reason: '', uploadKey: '', reasonKey: '', reasonFingerprint: '', drafts: {}, generation: 0, historyGeneration: 0, poll: null, filters: [{ id: 'all', labelKey: 'ddWorkflow.client.filters.all' }, { id: 'todo', labelKey: 'ddWorkflow.client.filters.todo' }, { id: 'review', labelKey: 'ddWorkflow.client.filters.review' }, { id: 'done', labelKey: 'ddWorkflow.client.filters.done' }] }),
  computed: {
    scope() { return { connectionId: this.connectionId, requestId: this.requestId, projectId: this.projectId } },
    actionableItems() { return this.items.filter(i => !this.isCategory(i)) },
    progress() { return this.actionableItems.filter(i => this.statusClass(i) === 'done').length },
    needsWork() { return this.actionableItems.filter(i => this.statusClass(i) === 'todo').length },
    visibleItems() { return this.items.filter(i => (this.filter === 'all' || this.statusClass(i) === this.filter) && `${i.title} ${i.description || ''}`.includes(this.query)) },
  },
  watch: { requestId() { this.reset() }, connectionId() { this.reset() } },
  mounted() { this.load(); this.poll = setInterval(() => { if (!this.busy && this.items.some(i => ['QUEUED', 'RUNNING'].includes(this.current(i)?.aiStatus))) this.load(true) }, 5000) },
  beforeUnmount() { this.generation++; this.historyGeneration++; clearInterval(this.poll) },
  methods: {
    reset() { this.generation++; this.historyGeneration++; this.items = []; this.submissions = {}; this.history = []; this.selectedId = null; this.pendingFiles = []; this.drafts = {}; this.aiConsent = false; this.uploadKey = ''; this.reasonKey = ''; this.reasonFingerprint = ''; this.reason = ''; this.formMode = ''; this.load() },
    pendingAppeal(s) { return !!s?.appealedAt && s.reviewStatus === 'UPLOADED' && (!s.reviewedAt || new Date(s.appealedAt) > new Date(s.reviewedAt)) },
    isCategory(item) { return !this.current(item) && !item.currentSubmissionId && !item.uploadedFileId && this.items.some(child => String(child.parentId) === String(item.id)) },
    current(item) { return this.submissions[item.id] || null },
    statusClass(item) { if (this.isCategory(item)) return 'group'; const s = this.current(item); if ((s?.reviewStatus || item.status) === 'APPROVED') return 'done'; if (!s && item.status === 'PENDING') return 'todo'; if ((s?.reviewStatus || item.status) === 'REJECTED' || s?.aiStatus === 'FAILED') return 'todo'; if (s?.aiStatus === 'PASSED') return 'done'; return 'review' },
    statusLabel(item) {
      if (this.isCategory(item)) return this.$t('ddWorkflow.client.status.category')
      const s = this.current(item); const review = s?.reviewStatus || item.status
      if (review === 'APPROVED') return this.$t('ddWorkflow.client.status.approved')
      if (review === 'REJECTED') return this.$t('ddWorkflow.client.status.needsChanges')
      if (this.pendingAppeal(s)) return this.$t('ddWorkflow.client.status.appealPending')
      if (['QUEUED', 'RUNNING'].includes(s?.aiStatus)) return this.$t('ddWorkflow.client.status.checking')
      if (s?.aiStatus === 'PASSED') return this.$t('ddWorkflow.client.status.passed')
      if (s?.aiStatus === 'FAILED') return this.$t('ddWorkflow.client.status.needsChanges')
      if (s?.aiStatus === 'MANUAL_REQUIRED' || s?.type === 'EXPLANATION') return this.$t('ddWorkflow.client.status.manual')
      return review === 'UPLOADED' ? this.$t('ddWorkflow.client.status.uploaded') : this.$t('ddWorkflow.client.status.pending')
    },
    aiResult(item) { try { return JSON.parse(this.current(item)?.aiResultJson || '{}') } catch { return {} } },
    aiSummary(item) { const result = this.aiResult(item); return result.summary || result.message || '' },
    aiReasons(item) { const result = this.aiResult(item); return (Array.isArray(result.checks) ? result.checks.filter(c => c.status !== 'PASS') : Array.isArray(result.reasons) ? result.reasons : []).map(r => typeof r === 'string' ? r : [r.requirement, r.reason || r.message].filter(Boolean).join(this.$t('ddWorkflow.client.reasonSeparator'))).filter(Boolean) },
    parentTitle(item) { return this.items.find(i => i.id === item.parentId)?.title || '' },
    canSubmit(item) { return !this.isCategory(item) && this.request?.status === 'PUBLISHED' && (this.current(item)?.reviewStatus || item.status) !== 'APPROVED' },
    canAppeal(item) { const s = this.current(item); return this.canSubmit(item) && !!s && (s.reviewStatus === 'REJECTED' || ['FAILED', 'MANUAL_REQUIRED'].includes(s.aiStatus)) && !this.pendingAppeal(s) },
    async load(quiet = false) {
      const generation = ++this.generation; if (!quiet) { this.loading = true; this.error = '' }
      try { const data = await ddClientRead(this.scope, `/requests/${this.requestId}`); if (generation !== this.generation) return; this.request = data.request; this.items = data.items || []; this.submissions = data.submissionsByItem || {}; this.rejectReasons = data.rejectReasons || {}; if (this.selectedId == null && this.items.length) this.selectItem(this.items.find(i => this.statusClass(i) === 'todo') || this.items[0]) }
      catch (e) { if (generation === this.generation) this.error = e.message }
      finally { if (generation === this.generation) this.loading = false }
    },
    async selectItem(item) {
      if (this.busy) return
      if (this.selectedId === item.id) { this.saveDraft(); this.selectedId = null; this.historyGeneration++; return }
      if (this.selectedId != null) this.saveDraft()
      this.selectedId = item.id; this.history = []
      const draft = this.drafts[item.id] || {}
      this.pendingFiles = draft.files || []; this.uploadKey = draft.uploadKey || ''; this.formMode = draft.formMode || ''; this.reason = draft.reason || ''; this.reasonKey = draft.reasonKey || ''; this.reasonFingerprint = draft.reasonFingerprint || ''; this.notice = ''; this.error = ''
      this.aiConsent = draft.aiConsent === true; this.explanationType = draft.explanationType || 'UNAVAILABLE'
      if (!this.isCategory(item)) await this.loadHistory(item.id)
    },
    saveDraft() { this.drafts[this.selectedId] = { files: this.pendingFiles, uploadKey: this.uploadKey, aiConsent: this.aiConsent, explanationType: this.explanationType, formMode: this.formMode, reason: this.reason, reasonKey: this.reasonKey, reasonFingerprint: this.reasonFingerprint } },
    changeAiConsent(value) { if (this.busy || this.aiConsent === value) return; this.aiConsent = value; this.uploadKey = crypto.randomUUID() },
    async loadHistory(itemId) {
      const generation = ++this.historyGeneration; this.historyLoading = true
      try { const rows = await ddClientRead(this.scope, `/items/${itemId}/submissions`); if (generation === this.historyGeneration && this.selectedId === itemId) this.history = rows }
      catch (e) { if (generation === this.historyGeneration) this.error = e.message }
      finally { if (generation === this.historyGeneration) this.historyLoading = false }
    },
    pick(camera) {
      if (this.busy) return
      const input = document.createElement('input')
      input.type = 'file'; input.multiple = !camera
      input.accept = camera ? 'image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.heic,.webp,.tif,.tiff'
      if (camera) input.setAttribute('capture', 'environment')
      const itemId = this.selectedId
      input.onchange = () => { if (this.selectedId === itemId) this.addFiles(input.files) }
      input.click()
    },
    addFiles(files) { if (this.busy) return; this.pendingFiles = [...this.pendingFiles, ...Array.from(files || [])]; this.uploadKey = crypto.randomUUID() },
    removeFile(index) { this.pendingFiles.splice(index, 1); this.uploadKey = crypto.randomUUID() },
    async upload(item) {
      if (this.busy || !this.pendingFiles.length || !this.canSubmit(item)) return
      this.busy = true; this.uploadProgress = 0; this.error = ''; this.notice = ''
      try { await ddClientUpload(this.scope, item.id, this.pendingFiles, this.uploadKey || (this.uploadKey = crypto.randomUUID()), this.aiConsent, progress => { this.uploadProgress = progress }); this.pendingFiles = []; this.uploadKey = ''; delete this.drafts[item.id]; this.notice = this.$t('ddWorkflow.client.submittedNotice'); await this.load(); await this.loadHistory(item.id) }
      catch (e) { this.error = e.message } finally { this.busy = false; this.uploadProgress = null }
    },
    async submitReason(item) {
      if (this.busy || !this.reason.trim() || !this.canSubmit(item) || (this.formMode === 'appeal' && !this.canAppeal(item))) return
      this.busy = true; this.error = ''; this.notice = ''
      try { const appeal = this.formMode === 'appeal'; const fingerprint = `${item.id}:${this.explanationType}:${this.reason.trim()}`; if (this.reasonFingerprint !== fingerprint) { this.reasonKey = crypto.randomUUID(); this.reasonFingerprint = fingerprint }; const payload = appeal ? { submissionId: this.current(item)?.id, reason: this.reason.trim() } : { type: this.explanationType, reason: this.reason.trim(), idempotencyKey: this.reasonKey }; await ddClientWrite(this.scope, `/items/${item.id}/${appeal ? 'appeal' : 'explanation'}`, payload); this.formMode = ''; this.reason = ''; this.reasonKey = ''; this.reasonFingerprint = ''; delete this.drafts[item.id]; this.notice = this.$t('ddWorkflow.client.reasonSubmittedNotice'); await this.load(); await this.loadHistory(item.id) }
      catch (e) { this.error = e.message } finally { this.busy = false }
    },
    async download(path, name) { this.error = ''; try { await ddClientDownload(this.scope, path, name) } catch (e) { this.error = e.message } },
    formatDate(value) { return value ? String(value).replace('T', ' ').slice(0, 16) : '' },
  },
}
</script>
<style scoped>
.checklist{min-width:0;overflow:auto;padding:24px;color:var(--awd-text);font-size:var(--awd-font-size-reading,14px)}.checklist-header{display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:20px}h2{font-size:18px;font-weight:600;margin:0 0 8px}p{margin:0;color:var(--awd-text-2);line-height:1.7}button,input,select,textarea{font:inherit}button{margin:0;line-height:1.5;border:1px solid transparent;background:var(--awd-accent);color:var(--awd-text-on-accent);border-radius:var(--awd-radius-sm,6px);padding:9px 14px;cursor:pointer}button::after{border:0}button:disabled{opacity:.5;cursor:default}.quiet{background:var(--awd-surface);color:var(--awd-text);border-color:var(--awd-border)}.filter-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:16px}.filter-bar button{background:transparent;color:var(--awd-text-2);padding:7px 10px}.filter-bar button.active{background:var(--awd-accent-soft,var(--awd-surface-2));color:var(--awd-accent-text)}.filter-bar input{margin-left:auto;width:180px}.filter-bar input,textarea,select{background:var(--awd-surface);color:var(--awd-text);border:1px solid var(--awd-border);border-radius:var(--awd-radius-sm,6px);padding:9px;box-sizing:border-box}.item{border:1px solid var(--awd-border);border-radius:var(--awd-radius-dialog,8px);background:var(--awd-surface);margin-bottom:10px}.item-heading{display:flex;align-items:center;width:100%;gap:12px;text-align:left;background:none;color:var(--awd-text);padding:16px}.item-title{flex:1;line-height:1.6;font-weight:500}.item-title small{display:block;color:var(--awd-text-3);font-size:11px;font-weight:400}.status{font-size:12px;white-space:nowrap;color:var(--awd-text-2)}.status.done{color:var(--awd-success-text,var(--awd-accent-text))}.status.todo{color:var(--awd-warning-text,var(--awd-text-2))}.item-body{border-top:1px solid var(--awd-border);padding:18px;display:flex;flex-direction:column;gap:14px}.requirement{white-space:pre-wrap}.link{background:transparent;color:var(--awd-accent-text);padding:0;text-align:left;border:0;align-self:flex-start}.feedback{border-left:3px solid var(--awd-border);padding:10px 14px;background:var(--awd-bg);line-height:1.7}.feedback strong{font-size:13px}.feedback ul{margin:8px 0 0;padding-left:20px;color:var(--awd-text-2)}.submission-caption{font-size:12px;margin-bottom:6px;color:var(--awd-text-3)}.file-link{display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;background:var(--awd-bg);color:var(--awd-text);margin:4px 0}.file-link span{overflow-wrap:anywhere}.file-link small{color:var(--awd-accent-text);white-space:nowrap}.submission-form{display:flex;flex-direction:column;gap:12px}.form-label{font-weight:500;color:var(--awd-text)}.drop-zone{padding:20px;border:1px dashed var(--awd-border);border-radius:var(--awd-radius-sm,6px);display:flex;align-items:center;flex-direction:column;gap:12px;text-align:center}.drop-zone small{color:var(--awd-text-3);line-height:1.6}.upload-buttons{display:flex;gap:8px}.consent{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.7;color:var(--awd-text-2)}.consent input{margin-top:4px;flex-shrink:0}.pending-files{list-style:none;padding:0;margin:0}.pending-files li{display:flex;justify-content:space-between;gap:12px;padding:6px 0}.pending-files span{overflow-wrap:anywhere}.alternative-actions{display:flex;gap:20px;font-size:13px}.reason-form{display:flex;flex-direction:column;gap:10px}.reason-form textarea{resize:vertical;width:100%}.reason-form button,.submission-form>button{align-self:flex-start}.hidden-input{display:none}.empty{padding:32px 0;color:var(--awd-text-3)}.message{margin-bottom:14px;padding:12px;background:var(--awd-surface-2,var(--awd-surface));border-radius:var(--awd-radius-sm,6px)}.error{color:var(--awd-danger-text)}
@media(max-width:700px){.checklist{padding:16px;overflow:visible}.filter-bar input{width:100%;margin-left:0}.item-heading{padding:14px;gap:8px}.item-body{padding:14px}.status{font-size:11px}.consent{font-size:12px}.upload-buttons button{min-height:44px}}
</style>
