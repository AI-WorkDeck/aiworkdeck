<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="dd-import">
    <text class="hint">{{ $t('ddWorkflow.importHint') }}</text>
    <input v-model="name" :disabled="busy" :aria-label="$t('ddWorkflow.listName')" :placeholder="$t('ddWorkflow.listName')" maxlength="120" />
    <textarea v-model="content" :disabled="busy || !!file" :aria-label="$t('ddWorkflow.pasteList')" :placeholder="$t('ddWorkflow.pasteList')" maxlength="100000" />
    <button :disabled="busy" @tap="chooseFile">{{ file ? file.name : $t('ddWorkflow.chooseListFile') }}</button>
    <button v-if="file && !busy" @tap="file = null">{{ $t('ddWorkflow.removeFile') }}</button>
    <text class="hint">{{ $t('ddWorkflow.importAiNotice') }}</text>
    <view v-if="busy" role="status" aria-live="polite" class="status">{{ progress != null && !job ? $t('ddWorkflow.transferring', { percent: progress }) : $t('ddWorkflow.importProcessing') }}<text>{{ $t('ddWorkflow.elapsed', { seconds: elapsed }) }}</text></view>
    <view v-if="error" role="alert" class="error">{{ error }}</view>
    <view class="actions">
      <button v-if="!busy" @tap="$emit('cancel')">{{ $t('ddWorkflow.cancel') }}</button>
      <button :disabled="busy || (!content.trim() && !file)" @tap="start">{{ $t(job ? 'ddWorkflow.checkProgress' : 'ddWorkflow.startImport') }}</button>
    </view>
  </view>
</template>
<script>
import api from '@/services/api'
import { importDdChecklist, getDdJob, getDdStartAttempt, finishDdStartAttempt } from '@/services/ddWorkflow'
import { waitForDdJob } from '@/utils/ddWorkflow'
export default {
  name: 'DdImportForm',
  props: { projectId: { type: [String, Number], required: true } },
  emits: ['imported', 'cancel'],
  data: () => ({ name: '', content: '', file: null, busy: false, error: '', progress: null, job: null, attempt: null, elapsed: 0 }),
  beforeUnmount() { this._disposed = true; this._abort?.abort(); clearInterval(this._clock) },
  methods: {
    chooseFile() {
      uni.chooseFile({ count: 1, extension: ['docx', 'pdf', 'txt', 'md', 'xlsx', 'csv'], success: result => {
        this.file = result.tempFiles[0]; this.job = null; this.error = ''
        if (!this.name) this.name = (this.file.name || '').replace(/\.[^.]+$/, '')
      } })
    },
    async start() {
      if (this.busy) return
      this.busy = true; this.error = ''; this.elapsed = 0
      this._abort = new AbortController()
      this._clock = setInterval(() => this.elapsed++, 1000)
      try {
        const projectId = this.projectId
        const input = { file: this.file, content: this.file ? '' : this.content, name: this.name }
        const attempt = await getDdStartAttempt('IMPORT', projectId, input)
        if (this._disposed || projectId !== this.projectId) return
        if (this.attempt?.key !== attempt.key) this.job = null
        this.attempt = attempt
        if (!this.job) this.job = await importDdChecklist(projectId, { ...input, idempotencyKey: attempt.key, onProgress: p => { this.progress = p.percent } })
        const result = await waitForDdJob(this.job, id => getDdJob(id, this.projectId), { signal: this._abort.signal, onUpdate: job => { this.job = job } })
        const details = await api.getDdRequestDetails(result.requestId, this.projectId)
        if (!this._abort.signal.aborted) { finishDdStartAttempt(this.attempt); this.attempt = null; this.job = null; this.$emit('imported', details.request || details.data?.request) }
      } catch (e) {
        if (e.name !== 'AbortError') {
          this.error = e.name === 'TimeoutError' ? this.$t('ddWorkflow.jobStillRunning') : e.message || this.$t('ddWorkflow.operationFailed')
          if (['FAILED', 'CANCELED', 'CANCELLED'].includes(this.job?.status)) { finishDdStartAttempt(this.attempt); this.attempt = null; this.job = null }
        }
      } finally { clearInterval(this._clock); this.busy = false }
    }
  }
}
</script>
<style scoped lang="scss">
.dd-import { padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.dd-import input, .dd-import textarea { border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); width: 100%; box-sizing: border-box; background: var(--awd-surface); color: var(--awd-text); font: inherit; }
.dd-import input { height: var(--awd-control-height); padding: 0 8px; line-height: var(--awd-control-height); }
.dd-import textarea { padding: 8px; height: 160px; line-height: 1.6; }
.dd-import :deep(.uni-input-placeholder), .dd-import :deep(.uni-textarea-placeholder) { color: var(--awd-text-3); }
.dd-import button { margin: 0; padding: 0 10px; min-height: 30px; border-radius: var(--awd-radius-sm); font: inherit; line-height: 1.4; background: var(--awd-surface); color: var(--awd-text); border: 1px solid var(--awd-border); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.dd-import button::after { border: 0; display: none; }
.dd-import button:disabled, .dd-import button[disabled] { opacity: .48; cursor: not-allowed; background: var(--awd-surface); color: var(--awd-text-3); }
.dd-import :focus-visible { outline: 2px solid var(--awd-accent-text); outline-offset: 2px; }
.hint, .status { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); line-height: 1.7; }
.status { color: var(--awd-accent-text); background: var(--awd-accent-soft); padding: 8px; border-radius: var(--awd-radius-sm); }
.status text { display: block; }
.error { color: var(--awd-danger-text); line-height: 1.7; }
.actions { display: flex; gap: 6px; justify-content: flex-end; }
</style>
