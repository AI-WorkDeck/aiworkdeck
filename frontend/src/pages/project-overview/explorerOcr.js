// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Explorer right-click「识别文字（OCR）」host side (tutorial-series#155): FileTree emits
// `ocr-files {action, items}`; this mixin runs the queue (utils/explorerOcr.js), shows progress with
// cancel, asks the existing cloud-OCR notice once per batch, then copies / refreshes / opens side by side.
import { recognizeProjectFileText, cancelProjectFileOcr, promptFeatureNotConfigured } from '@/services/api.js'
import { showDialog } from '@/utils/dialog.js'
import {
  runOcrBatch, summarizeOcrBatch, joinCopiedTexts, sideBySidePlan, openOcrSideBySide, ocrOutputName,
} from '@/utils/explorerOcr.js'

const OUTPUTS = { copy: { output: 'text' }, txt: { output: 'txt', ext: '.txt' }, docx: { output: 'docx', ext: '.docx' } }

export default {
  data() {
    return { explorerOcr: { running: false, index: 0, total: 0, name: '', cancelling: false, jobId: '' } }
  },
  methods: {
    async onExplorerOcr({ action, items } = {}) {
      const spec = OUTPUTS[action]
      if (!spec || !Array.isArray(items) || !items.length || !this.projectId) return
      if (this.explorerOcr.running) {
        uni.showToast({ title: this.$t('workbenchOps.ocrBatchBusy'), icon: 'none' })
        return
      }
      const projectId = this.projectId
      const jobId = `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      Object.assign(this.explorerOcr, { running: true, index: 0, total: items.length, name: '', cancelling: false, jobId })
      const suffix = this.$t('fileTree.ocrOutputSuffix')
      let batch
      try {
        batch = await runOcrBatch({
          items,
          nameFor: item => spec.ext ? ocrOutputName(item.name, spec.ext, suffix) : undefined,
          recognize: async (item, { consentVersion, name }) => {
            const res = await recognizeProjectFileText(projectId, item.id, { jobId, output: spec.output, name, consentVersion })
            return res && res.data
          },
          requestConsent: async ({ notice }) => {
            const result = await showDialog({
              title: this.$t('workbenchOps.ocrConsentTitle'),
              content: `${notice || ''}\n\n${this.$t('workbenchOps.ocrConsentHint')}`,
              checkLabel: this.$t('workbenchOps.ocrConsentCheck'),
              confirmText: this.$t('workbenchOps.ocrConsentConfirm'),
            })
            return !!result.confirm
          },
          onProgress: ({ index, item }) => { this.explorerOcr.index = index; this.explorerOcr.name = item.name },
          isCancelled: () => this.explorerOcr.cancelling,
          isFatal: e => !!(e && e.featureNotConfigured),
        })
      } finally {
        this.explorerOcr.running = false
      }
      if (String(this.projectId) !== String(projectId)) return
      if (batch.fatal) promptFeatureNotConfigured(batch.fatal)
      await this.finishExplorerOcr(action, batch)
    },

    async cancelExplorerOcr() {
      if (!this.explorerOcr.running || this.explorerOcr.cancelling) return
      this.explorerOcr.cancelling = true
      // Stops the in-flight file before its next page upload; files not started are skipped locally.
      try { await cancelProjectFileOcr(this.projectId, this.explorerOcr.jobId) } catch (e) { /* local cancel still applies */ }
    },

    async finishExplorerOcr(action, batch) {
      const summary = summarizeOcrBatch(batch)
      const lines = []
      if (action === 'copy') {
        const text = joinCopiedTexts(batch.results)
        if (text) {
          await this.insertClipboardAndCopy(text, { saveToHistory: true })
          lines.push(this.$t('workbenchOps.ocrCopied', { count: summary.done.length }))
        } else if (summary.done.length) {
          lines.push(this.$t('workbenchOps.noTextRecognized'))
        }
      } else if (summary.done.length) {
        const tree = this.$refs.fileTree
        if (tree && tree.loadFiles) await tree.loadFiles()
        lines.push(this.$t('workbenchOps.ocrSaved', { names: summary.done.map(r => r.file && r.file.name).filter(Boolean).join('、') }))
      }
      if (action === 'docx') {
        const plan = sideBySidePlan(batch)
        if (plan.first) {
          await openOcrSideBySide(this, plan.first.source, plan.first.output)
          if (plan.others.length) lines.push(this.$t('workbenchOps.ocrOthersNotOpened', { names: plan.others.join('、') }))
        }
      }
      for (const f of summary.failed) {
        const why = f.reason === 'localOnly' ? this.$t('workbenchOps.ocrLocalOnly') : (f.error || this.$t('workbenchOps.recognizeFailed'))
        lines.push(this.$t('workbenchOps.ocrFailedItem', { name: f.name, reason: why }))
      }
      if (summary.skipped.length) lines.push(this.$t('workbenchOps.ocrSkipped', { count: summary.skipped.length }))
      if (batch.cancelled) lines.push(this.$t('workbenchOps.ocrCancelled', { count: summary.notRun.length }))
      if (!summary.failed.length && !summary.skipped.length && !batch.cancelled && batch.results.length === 1) {
        if (lines.length) uni.showToast({ title: lines[0], icon: 'none' })
        return
      }
      if (!lines.length) return
      await showDialog({
        title: this.$t('workbenchOps.ocrSummaryTitle', { done: summary.done.length, total: batch.results.length }),
        content: lines.join('\n'),
        showCancel: false,
      })
    },
  },
}
