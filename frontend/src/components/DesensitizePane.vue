<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <scroll-view scroll-y class="desensitize-pane">
    <view class="section">
      <view class="section-title">{{ $t(operation === 'restore' ? 'panels.deRestoreDocument' : 'panels.deSectionFileSelect') }}</view>
      <view class="path-display" :class="{ empty: !filePath }" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @tap="triggerFileSelect" @keydown="onActionKey($event, triggerFileSelect, processing)">{{ fileName || $t('panels.deFilePlaceholder') }}</view>
      <view class="actions-row file-actions">
        <button class="mini-btn" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, importFromActiveTab, processing)" @tap="importFromActiveTab">{{ $t('panels.deImportCurrent') }}</button>
        <button class="mini-btn" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, triggerFileSelect, processing)" @tap="triggerFileSelect">{{ $t('panels.deBrowse') }}</button>
      </view>
      <text class="help-text">{{ $t('panels.deFormats') }}</text>
    </view>
    <view class="section">
      <view class="section-title">{{ $t('panels.deOperationTitle') }}</view>
      <view class="actions-row operation-tabs" role="group" :aria-label="$t('panels.deOperationTitle')">
        <button class="mini-btn" :class="{ active: operation === 'redact' }" :aria-pressed="operation === 'redact'" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, () => chooseOperation('redact'), processing)" @tap="chooseOperation('redact')">{{ $t('panels.deRedactTab') }}</button>
        <button class="mini-btn" :class="{ active: operation === 'restore' }" :aria-pressed="operation === 'restore'" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, () => chooseOperation('restore'), processing)" @tap="chooseOperation('restore')">{{ $t('panels.deRestoreTab') }}</button>
      </view>
    </view>

    <view v-if="error" class="section error-text" role="alert">{{ error }}</view>
    <view v-if="processing" class="section processing-text" role="status">{{ $t('panels.deProcessing') }}</view>

    <template v-if="operation === 'redact'">
      <view class="section">
        <button class="settings-toggle custom-words-toggle" :aria-expanded="customWordsOpen" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, toggleCustomWords, processing)" @tap="toggleCustomWords">
          <text>{{ $t('panels.deCustomWordsTitle') }}</text>
          <text class="settings-summary">{{ customWordsOpen ? '−' : '+' }}</text>
        </button>
        <view v-show="customWordsOpen" class="custom-words-content">
          <textarea v-model="customTerms" :disabled="processing" class="text-input custom-words-input" :maxlength="100000" :placeholder="$t('panels.deCustomPlaceholder')" />
          <text class="help-text">{{ $t('panels.deCustomWordsHint') }}</text>
        </view>
      </view>
      <view class="section settings-section">
        <button class="settings-toggle" :aria-expanded="settingsOpen" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, toggleSettings, processing)" @tap="toggleSettings">
          <text>{{ $t('panels.deStrategiesTitle') }}</text>
          <text class="settings-summary">{{ $t('panels.deSelectedStrategies', { count: selectedStrategies.length }) }} {{ settingsOpen ? '−' : '+' }}</text>
        </button>
        <view v-show="settingsOpen" class="settings-content">
        <view class="strategies-list">
          <label v-for="s in availableStrategies" :key="s.value" class="strategy-item" role="checkbox" :aria-checked="selectedStrategies.includes(s.value)"
            :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @tap="toggleStrategy(s.value)" @keydown="onActionKey($event, () => toggleStrategy(s.value), processing)">
            <view class="checkbox" :class="{ checked: selectedStrategies.includes(s.value) }"><text v-if="selectedStrategies.includes(s.value)" class="check-mark">✓</text></view>
            <text class="strategy-label">{{ s.label }}</text>
          </label>
        </view>
        <view class="section-title">{{ $t('panels.deExcludedTerms') }}</view>
        <textarea v-model="excludedTerms" :disabled="processing" class="text-input" :maxlength="100000" :placeholder="$t('panels.deExcludedPlaceholder')" />
        </view>
      </view>
      <view class="section">
        <view class="section-title">{{ $t('panels.deModeTitle') }}</view>
        <view v-if="!isPdf" class="actions-row mode-options">
          <button class="mini-btn" :class="{ active: mode === 'TOKEN' }" :aria-pressed="mode === 'TOKEN'" :title="$t('panels.deTokenNotice')" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, () => setMode('TOKEN'), processing)" @tap="setMode('TOKEN')">{{ $t('panels.deTokenMode') }}</button>
          <button class="mini-btn" :class="{ active: mode === 'MASK' }" :aria-pressed="mode === 'MASK'" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, () => setMode('MASK'), processing)" @tap="setMode('MASK')">{{ $t('panels.deMaskMode') }}</button>
        </view>
        <text v-if="isPdf || effectiveMode === 'MASK' || preview" class="help-text">{{ $t(isPdf ? 'panels.dePdfNotice' : effectiveMode === 'TOKEN' ? 'panels.deTokenNotice' : 'panels.deMaskNotice') }}</text>
      </view>
      <view class="section">
        <button class="workdeck-btn full-width" :class="{ 'workdeck-btn-primary': !preview }" :disabled="previewDisabled" role="button" :tabindex="previewDisabled ? -1 : 0" :aria-disabled="previewDisabled || null" @keydown="onActionKey($event, handlePreview, previewDisabled)" @tap="handlePreview">{{ $t('panels.dePreview') }}</button>
        <view v-if="preview" class="preview-text">{{ preview.text }}</view>
        <template v-if="preview">
        <text class="help-text">{{ $t('panels.deReviewNotice') }}</text>
        <template v-if="effectiveMode === 'TOKEN'">
          <view class="section-title">{{ $t('panels.dePassword') }}</view>
          <input v-model="password" :disabled="processing" class="text-input password-input" password :maxlength="1024" :placeholder="$t('panels.dePasswordHint')" />
        </template>
        <button class="workdeck-btn workdeck-btn-primary full-width" :loading="processing" :disabled="generateDisabled" role="button" :tabindex="generateDisabled ? -1 : 0" :aria-disabled="generateDisabled || null" @keydown="onActionKey($event, handleGenerate, generateDisabled)" @tap="handleGenerate">{{ $t('panels.deGenerate') }}</button>
        </template>
      </view>
    </template>

    <view v-else class="section">
      <text v-if="!isPdf" class="help-text">{{ $t('panels.deRestoreNotice') }}</text>
      <text v-if="recoveryKit && !loadingKit" class="help-text" role="status">{{ $t('panels.deCurrentKit') }}</text>
      <view class="section-title">{{ $t('panels.dePassword') }}</view>
      <input v-model="password" :disabled="processing" class="text-input password-input" password :maxlength="1024" :placeholder="$t('panels.dePasswordHint')" />
      <text v-if="restoreRequirement" class="help-text" role="status">{{ restoreRequirement }}</text>
      <button v-if="fileId && !isPdf && !loadingKit && !recoveryKit && error" class="workdeck-btn full-width" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, loadRecovery, processing)" @tap="loadRecovery">{{ $t('common.retry') }}</button>
      <button v-if="fileId && !isPdf && !loadingKit && !recoveryKit && !error" class="workdeck-btn full-width" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, selectOriginalForRedaction, processing)" @tap="selectOriginalForRedaction">{{ $t('panels.deSelectOriginal') }}</button>
      <button class="workdeck-btn workdeck-btn-primary full-width" :loading="processing" :disabled="restoreDisabled" role="button" :tabindex="restoreDisabled ? -1 : 0" :aria-disabled="restoreDisabled || null" @keydown="onActionKey($event, handleRestore, restoreDisabled)" @tap="handleRestore">{{ $t('panels.deRestoreGenerate') }}</button>
    </view>

    <view v-if="preview || result" class="section">
      <text class="help-text">{{ $t('panels.deMatchCount', { count: totalMatches }) }}</text>
      <!-- 校验不过的号码不改正文（假号打码就是改坏正文），但必须让律师看见，
           他才知道要不要把这几处补进上面的敏感词（dev-board C2）。 -->
      <text v-if="totalSuspects" class="help-text suspect-text">{{ $t('panels.deSuspectCount', { count: totalSuspects }) }}</text>
      <!-- 逐条列出原值（全程本机），给「仍然遮蔽」：写进补充敏感词后自动重新预览；校验位闸门不放开（dev-board#1713 #96） -->
      <view v-if="suspectItems.length" class="suspect-list">
        <view v-for="item in suspectItems" :key="item.value" class="suspect-item">
          <view class="suspect-info">
            <text class="suspect-value">{{ item.value }}</text>
            <text class="suspect-type">{{ strategyLabel(item.type) }}</text>
          </view>
          <button class="mini-btn suspect-mask" :disabled="processing" :aria-label="$t('panels.deMaskAnywayLabel', { value: item.value })"
            role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, () => maskSuspect(item.value), processing)"
            @tap="maskSuspect(item.value)">{{ $t('panels.deMaskAnyway') }}</button>
        </view>
      </view>
      <text v-for="(warning, i) in (result?.warnings || preview?.warnings || [])" :key="i" class="help-text">{{ warning }}</text>
    </view>
    <view v-if="result?.file && operation === 'redact'" class="section">
      <text v-if="isPdf || effectiveMode === 'MASK' || preview" class="help-text">{{ $t(isPdf ? 'panels.dePdfResult' : 'panels.deResultEditing') }}</text>
      <button v-if="exportedKit" class="workdeck-btn full-width" :disabled="processing" role="button" :tabindex="processing ? -1 : 0" :aria-disabled="processing || null" @keydown="onActionKey($event, restoreLastResult, processing)" @tap="restoreLastResult">{{ $t('panels.deRestoreResult') }}</button>
      <text class="help-text">{{ $t('panels.deAiWorkflowNotice') }}</text>
    </view>
    <view v-if="exportedKit" class="section">
      <text class="help-text">{{ $t('panels.deSaveKitNotice') }}</text>
    </view>
  </scroll-view>
</template>

<script>
import { desensitizeFile, getSensitiveOptions, previewSensitiveFile, restoreSensitiveFile, getSensitiveRecovery } from '@/services/api.js'

export default {
  name: 'DesensitizePane',
  emits: ['request-file-select', 'request-active-file', 'open-file'],
  props: {
    projectId: { type: [String, Number], required: true },
    prepareFile: { type: Function, required: true },
  },
  data() {
    return {
      operation: 'redact', mode: 'TOKEN', filePath: '', fileName: '', fileId: null,
      availableStrategies: [], selectedStrategies: [], customTerms: '', excludedTerms: '',
      password: '', recoveryKit: '', exportedKit: '', processing: false,
      loadingKit: false, kitLoadSequence: 0, preview: null, result: null, error: '', lastRedaction: null, settingsOpen: false, customWordsOpen: false,
    }
  },
  computed: {
    restoreRequirement() {
      if (!this.fileId) return this.$t('panels.deSelectValidFile')
      if (this.isPdf) return this.$t('panels.dePdfNotice')
      if (this.loadingKit) return this.$t('panels.deProcessing')
      if (!this.recoveryKit) return this.error ? '' : this.$t('panels.deRecoveryMissing')
      if (!this.password.trim()) return this.$t('panels.dePasswordHint')
      return ''
    },
    isPdf() { return this.fileName.toLowerCase().endsWith('.pdf') },
    effectiveMode() { return this.isPdf ? 'MASK' : this.mode },
    requestSignature() {
      return JSON.stringify([this.fileId, this.selectedStrategies, this.customTerms, this.excludedTerms, this.effectiveMode])
    },
    totalMatches() { return Object.values(this.result?.counts || this.preview?.counts || {}).reduce((a, b) => a + b, 0) },
    previewDisabled() { return this.processing || !this.fileId || (!this.selectedStrategies.length && !this.customTerms.trim()) },
    generateDisabled() { return this.processing || !this.preview || (this.effectiveMode === 'TOKEN' && !this.password.trim()) },
    restoreDisabled() { return this.processing || this.loadingKit || !this.recoveryKit || !!this.restoreRequirement },
    suspectItems() { return this.operation === 'redact' && !this.result && Array.isArray(this.preview?.suspectItems) ? this.preview.suspectItems : [] },
    totalSuspects() { return Object.values(this.result?.suspects || this.preview?.suspects || {}).reduce((a, b) => a + b, 0) },
  },
  watch: {
    requestSignature() { this.preview = null; this.result = null; this.error = '' },
    operation() { this.result = null; this.error = '' },
    projectId() {
      this.kitLoadSequence++; this.loadingKit = false
      this.fileId = null; this.filePath = ''; this.fileName = ''; this.password = ''
      this.recoveryKit = ''; this.exportedKit = ''
      this.preview = null; this.result = null
      this.customTerms = ''; this.excludedTerms = ''; this.lastRedaction = null
    },
  },
  mounted() { this.fetchOptions() },
  methods: {
    // Uni H5 的 <button> 渲染成 <uni-button>，没有原生按钮的键盘语义；Enter/Space 要显式接通（dev-board#1713 #97）。
    onActionKey(event, action, disabled = false) {
      if (!['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      if (!disabled && !event.repeat) action.call(this)
    },
    setMode(mode) { if (!this.processing) this.mode = mode },
    toggleCustomWords() { if (!this.processing) this.customWordsOpen = !this.customWordsOpen },
    toggleSettings() { if (!this.processing) this.settingsOpen = !this.settingsOpen },
    strategyLabel(value) {
      const label = this.availableStrategies.find(s => s.value === value)?.label || value
      return String(label).replace(/\s*\(.*\)\s*$/, '')
    },
    // 「仍然遮蔽」：把这条原值写进补充敏感词，再按新词表重新预览。
    async maskSuspect(value) {
      if (this.processing || !value) return
      const terms = this.customTerms.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      if (!terms.includes(value)) this.customTerms = [...terms, value].join('\n')
      this.customWordsOpen = true
      await this.$nextTick()
      await this.handlePreview()
    },
    async fetchOptions() {
      try {
        const res = await getSensitiveOptions()
        this.availableStrategies = Array.isArray(res) ? res : res?.data || []
        this.selectedStrategies = this.availableStrategies.filter(s => ['COMPANY', 'CHINESE_NAME', 'PHONE', 'ID_CARD',
          'UNIFIED_SOCIAL_CREDIT', 'LAWYER_LICENSE', 'EMAIL', 'BANK_CARD', 'ADDRESS'].includes(s.value)).map(s => s.value)
      } catch (e) { this.error = this.$t('panels.deFetchStrategiesFailed') }
    },
    chooseOperation(operation) {
      if (this.processing || this.operation === operation) return
      this.operation = operation
      this.preview = null; this.result = null; this.error = ''; this.password = ''
      if (operation === 'restore') this.loadRecovery()
      else { this.kitLoadSequence++; this.loadingKit = false }
    },
    restoreLastResult() {
      if (this.processing || !this.lastRedaction?.kit) return
      this.chooseOperation('restore')
      this.selectFile(this.lastRedaction.file)
      this.kitLoadSequence++; this.loadingKit = false
      this.recoveryKit = this.lastRedaction.kit
    },
    toggleStrategy(value) {
      if (this.processing) return
      this.selectedStrategies = this.selectedStrategies.includes(value)
        ? this.selectedStrategies.filter(s => s !== value) : [...this.selectedStrategies, value]
    },
    selectFile(file) {
      if (this.processing) return
      if (!file?.id || !(file.filePath || file.path)) {
        this.error = this.$t('panels.deSelectValidFile'); return
      }
      this.preview = null; this.result = null; this.error = ''
      this.filePath = file.filePath || file.path; this.fileName = file.name; this.fileId = file.id
      this.recoveryKit = ''
      if (this.operation === 'restore') this.loadRecovery()
    },
    // 「浏览」自己没有文件树，要工作台把项目文件选择器打开。工作台必须**同步**
    // 回执一次（第二个参数），否则这一步就是断的：真机上表现为点了「浏览」毫无
    // 反应、连提示都没有（dev-board B6）。断了就说出来，不许静默。
    triggerFileSelect() {
      if (this.processing) return
      this.error = ''
      let opened = false
      this.$emit('request-file-select', file => { if (file) this.selectFile(file) }, () => { opened = true })
      if (!opened) this.error = this.$t('panels.deBrowseUnavailable')
    },
    importFromActiveTab() {
      if (!this.processing) this.$emit('request-active-file', file => this.selectFile(file))
    },
    payload() {
      const lines = value => value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      return { fileId: this.fileId, strategies: this.selectedStrategies, mode: this.effectiveMode,
        customTerms: lines(this.customTerms), excludedTerms: lines(this.excludedTerms) }
    },
    async handlePreview() {
      if (this.processing || !this.fileId) return
      this.processing = true; this.error = ''; this.result = null
      try {
        await this.prepareFile(this.fileId)
        this.preview = await previewSensitiveFile(this.payload())
      }
      catch (e) { this.error = e.message; this.preview = null }
      finally { this.processing = false }
    },
    async handleGenerate() {
      if (this.processing || !this.preview || !this.fileId) return
      this.processing = true; this.error = ''
      try {
        const changed = await this.prepareFile(this.fileId)
        if (changed) {
          this.preview = null
          throw new Error(this.$t('panels.dePreviewChanged'))
        }
        const source = { id: this.fileId, name: this.fileName, filePath: this.filePath }
        const res = await desensitizeFile({ ...this.payload(), password: this.password })
        this.result = res
        this.exportedKit = res.recoveryKit || ''; this.preview = null
        this.lastRedaction = res.recoveryKit ? { source, file: res.file, kit: res.recoveryKit } : null
        this.password = ''
        if (res.file?.id) this.$emit('open-file', res.file)
      } catch (e) { this.error = e.message }
      finally { this.processing = false }
    },
    async loadRecovery() {
      const sequence = ++this.kitLoadSequence
      const projectId = this.projectId, fileId = this.fileId
      this.recoveryKit = ''; this.error = ''
      if (!fileId || this.isPdf) { this.loadingKit = false; return }
      if (String(this.lastRedaction?.file?.id) === String(fileId)) {
        this.recoveryKit = this.lastRedaction.kit
        this.loadingKit = false
        return
      }
      this.loadingKit = true
      try {
        const result = await getSensitiveRecovery({ fileId })
        if (sequence !== this.kitLoadSequence || projectId !== this.projectId || fileId !== this.fileId) return
        this.recoveryKit = result.recoveryKit || ''; this.error = ''
      } catch (e) {
        if (sequence === this.kitLoadSequence && projectId === this.projectId) this.error = e.message
      } finally {
        if (sequence === this.kitLoadSequence) this.loadingKit = false
      }
    },
    selectOriginalForRedaction() {
      if (this.processing) return
      this.chooseOperation('redact')
      this.fileId = null; this.filePath = ''; this.fileName = ''
      this.recoveryKit = ''; this.exportedKit = ''; this.lastRedaction = null
      this.triggerFileSelect()
    },
    async handleRestore() {
      if (this.processing || !this.fileId || !this.recoveryKit) return
      this.processing = true; this.error = ''; this.result = null
      try {
        await this.prepareFile(this.fileId)
        const res = await restoreSensitiveFile({ fileId: this.fileId, recoveryKit: this.recoveryKit, password: this.password })
        this.result = res; this.password = ''
        if (res.file?.id) this.$emit('open-file', res.file)
      } catch (e) { this.error = e.message }
      finally { this.processing = false }
    },
  },
}
</script>

<style scoped>
.desensitize-pane {
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: var(--awd-bg);
  color: var(--awd-panel-text);
  container-type: inline-size;
}
.section { padding: 0 var(--awd-panel-pad-x) var(--awd-panel-gap-lg); }
.section-title {
  display: flex;
  align-items: center;
  min-height: var(--awd-panel-sec-h);
  font-size: var(--awd-panel-fs-sec);
  font-weight: 600;
  color: var(--awd-panel-text-2);
}
.path-display {
  display: flex;
  align-items: center;
  min-height: var(--awd-control-height);
  box-sizing: border-box;
  padding: var(--awd-space-2);
  background: var(--awd-surface);
  border: 1px dashed var(--awd-border-strong);
  border-radius: var(--awd-panel-radius);
  font-size: var(--awd-font-size-body);
  overflow-wrap: anywhere;
  cursor: pointer;
}
.path-display.empty { color: var(--awd-text-3); justify-content: center; }
.actions-row { display: flex; gap: var(--awd-panel-gap); }
.file-actions { margin-top: var(--awd-panel-gap); }
.mini-btn, .workdeck-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: var(--awd-control-height);
  height: auto;
  box-sizing: border-box;
  margin: 0;
  padding: var(--awd-space-1) var(--awd-space-2);
  line-height: var(--awd-line-height-ui);
  border: 1px solid var(--awd-panel-border);
  border-radius: var(--awd-panel-radius);
  background: var(--awd-surface);
  color: var(--awd-panel-text);
  font-size: var(--awd-font-size-body);
  white-space: normal;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: background-color var(--awd-motion-fast), border-color var(--awd-motion-fast);
}
.mini-btn { flex: 1; }
.mini-btn::after, .workdeck-btn::after, .settings-toggle::after { border: none; }
.mini-btn:not([disabled]):hover, .workdeck-btn:not([disabled]):hover { background: var(--awd-panel-hover); border-color: var(--awd-border-strong); }
.mini-btn.active { color: var(--awd-accent-text); background: var(--awd-accent-soft); border-color: var(--awd-accent); font-weight: 600; }
.workdeck-btn-primary { border-color: var(--awd-accent); background: var(--awd-accent); color: var(--awd-text-on-accent); font-weight: 600; }
.workdeck-btn-primary:not([disabled]):hover { background: var(--awd-accent-hover); border-color: var(--awd-accent-hover); }
.mini-btn[disabled], .workdeck-btn[disabled] { background: var(--awd-surface-2); color: var(--awd-text-3); border-color: var(--awd-border); cursor: not-allowed; }
.operation-tabs { padding-block: var(--awd-panel-gap); }
.full-width { width: 100%; }
.help-text { display: block; color: var(--awd-text-2); font-size: var(--awd-panel-fs); line-height: 1.6; margin: var(--awd-panel-gap) 0; overflow-wrap: anywhere; }
.suspect-text { color: var(--awd-warning-text); }
.suspect-list { display: flex; flex-direction: column; gap: var(--awd-space-1); }
.suspect-item { display: flex; align-items: center; gap: var(--awd-panel-gap); padding: var(--awd-space-1) var(--awd-space-2); border: 1px solid var(--awd-panel-border); border-radius: var(--awd-panel-radius); background: var(--awd-surface); }
.suspect-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.suspect-value { font-size: var(--awd-font-size-body); overflow-wrap: anywhere; direction: ltr; unicode-bidi: isolate; user-select: text; }
.suspect-type { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); }
.mini-btn.suspect-mask { flex: 0 0 auto; }
.text-input { width: 100%; box-sizing: border-box; min-height: 64px; height: 76px; border: 1px solid var(--awd-border); border-radius: var(--awd-panel-radius); padding: var(--awd-space-2); color: var(--awd-text); background: var(--awd-surface); font-size: var(--awd-font-size-body); }
.password-input { min-height: var(--awd-control-height); height: var(--awd-control-height); margin-bottom: var(--awd-panel-gap); }
.preview-text { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow: auto; padding: var(--awd-space-2); margin: var(--awd-panel-gap) 0; border: 1px solid var(--awd-border); border-radius: var(--awd-panel-radius); background: var(--awd-surface); font-size: var(--awd-font-size-body); line-height: 1.7; user-select: text; }
.settings-toggle { display: flex; align-items: center; justify-content: space-between; gap: var(--awd-space-2); width: 100%; min-height: var(--awd-control-height); margin: 0; padding: var(--awd-space-1) 0; background: transparent; color: var(--awd-panel-text); font-size: var(--awd-panel-fs); font-weight: 600; line-height: var(--awd-line-height-ui); text-align: left; border: none; border-radius: var(--awd-panel-radius); }
.settings-summary { font-size: var(--awd-panel-fs-meta); font-weight: 400; flex-shrink: 0; color: var(--awd-text-2); }
.settings-section { border-top: 1px solid var(--awd-panel-border); }
.settings-content { padding-top: var(--awd-space-1); }
.strategies-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 120px), 1fr)); gap: var(--awd-space-1) var(--awd-space-2); }
.strategy-item { display: flex; align-items: center; min-width: 0; min-height: var(--awd-control-sm); cursor: pointer; }
.strategy-item:hover { background: var(--awd-panel-accent-wash); }
.checkbox { width: 14px; height: 14px; flex-shrink: 0; border: 1px solid var(--awd-border-strong); border-radius: var(--awd-radius-sm); margin-right: var(--awd-space-2); display: flex; align-items: center; justify-content: center; }
.checkbox.checked { background: var(--awd-accent); border-color: var(--awd-accent); }
.check-mark { color: var(--awd-text-on-accent); font-size: var(--awd-panel-fs-meta); }
.strategy-label { font-size: var(--awd-panel-fs); color: var(--awd-panel-text); overflow-wrap: anywhere; }
.error-text, .processing-text { margin: 0 var(--awd-panel-pad-x) var(--awd-panel-gap); padding: var(--awd-space-2); font-size: var(--awd-panel-fs); line-height: 1.5; border-radius: var(--awd-panel-radius); overflow-wrap: anywhere; }
.error-text { color: var(--awd-danger-text); background: var(--awd-danger-soft); }
.processing-text { color: var(--awd-accent-text); background: var(--awd-accent-wash); }
button:focus-visible, .path-display:focus-visible, .strategy-item:focus-visible, .text-input:focus-within { outline: var(--awd-focus-width) solid var(--awd-accent); outline-offset: var(--awd-focus-offset); }
@container (max-width: 300px) { .mode-options, .suspect-item { flex-direction: column; align-items: stretch; } }
@container (max-width: 240px) { .settings-toggle { flex-wrap: wrap; } }
@media (pointer: coarse) { .mini-btn, .workdeck-btn, .settings-toggle, .strategy-item { min-height: var(--awd-control-height-touch); } }
@media (prefers-reduced-motion: reduce) { .mini-btn, .workdeck-btn { transition: none; } }
</style>
