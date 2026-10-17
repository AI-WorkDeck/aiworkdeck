<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <scroll-view scroll-y class="easy-voice-pane">
    <view class="section">
      <view class="section-header">
        <text class="section-title">{{ $t('panels.evTextContentTitle') }}</text>
        <view class="section-actions">
          <button class="ev-btn mini-btn" role="button" tabindex="0" @tap="importFromDoc"
            @keydown="onActionKey($event, importFromDoc)" :title="$t('panels.evImportTitle')" :aria-label="$t('panels.evImportTitle')">
            {{ $t('panels.evImport') }}
          </button>
          <button class="ev-btn mini-btn icon" role="button" :tabindex="text ? 0 : -1" :disabled="!text" :aria-disabled="!text"
            @tap="clearText" @keydown="onActionKey($event, clearText, !text)" :title="$t('panels.evClearTitle')" :aria-label="$t('panels.evClearTitle')">
            <svg class="btn-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path v-for="(d, gi) in ICONS.trash" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        </view>
      </view>
      <textarea class="voice-textarea" :value="text"
        :aria-label="$t('panels.evTextContentTitle')" :placeholder="$t('panels.evTextPlaceholder')" maxlength="-1" />
    </view>

    <view class="section">
      <view class="section-header"><text class="section-title">{{ $t('panels.evVoiceSettingsTitle') }}</text></view>
      <view class="ev-gate" v-if="engineGateVisible" role="status">
        <text class="ev-gate-msg">{{ gateMessage }}</text>
        <view class="ev-gate-actions">
          <template v-if="modelDownloading">
            <text class="ev-gate-hint">{{ $t('panels.evModelDownloading', { percent: installPercent }) }}</text>
            <button class="ev-btn ev-gate-btn secondary" role="button" tabindex="0" @tap="onCancelModel"
              @keydown="onActionKey($event, onCancelModel)">{{ $t('panels.evCancelDownload') }}</button>
          </template>
          <template v-else>
            <button class="ev-btn ev-gate-btn primary" v-if="canDownloadModel" role="button" tabindex="0" @tap="onDownloadModel"
              @keydown="onActionKey($event, onDownloadModel)">{{ downloadButtonText }}</button>
            <button class="ev-btn ev-gate-btn secondary" role="button" :tabindex="rechecking ? -1 : 0"
              :disabled="rechecking" :aria-disabled="rechecking" @tap="onRecheck" @keydown="onActionKey($event, onRecheck, rechecking)">
              {{ rechecking ? $t('panels.evRechecking') : $t('panels.evRecheck') }}
            </button>
          </template>
        </view>
      </view>
      <view class="form-item">
        <text class="label">{{ $t('panels.evSpeakerLabel') }}</text>
        <AwdSelect class="voice-select" :range="voiceLabels" :value="voiceIndex" :disabled="!voices.length"
          :aria-label="$t('panels.evSpeakerLabel')" searchable :search-label="$t('panels.evSearchVoicePlaceholder')"
          :search-placeholder="$t('panels.evSearchVoicePlaceholder')" :empty-text="$t('panels.evNoMatchVoice')" @change="selectVoiceIndex" />
        <text v-if="!voicesLoaded" class="field-hint" role="status">{{ $t('panels.evLoadingVoices') }}</text>
        <text v-else-if="reading.segments.length" class="field-hint">{{ $t('panels.evVoiceNextRead') }}</text>
      </view>
      <view class="form-item rate-field">
        <view class="slider-header">
          <text class="label">{{ $t('panels.evRateLabel') }}</text>
          <text class="value-text">{{ speedText }}</text>
        </view>
        <slider class="rate-slider" :value="rate" @change="onRateChange" @changing="onRateChange"
          @keydown="onRateKey" role="slider" tabindex="0" :aria-label="$t('panels.evRateLabel')"
          aria-valuemin="0.5" aria-valuemax="2" :aria-valuenow="rate / 100" :aria-valuetext="speedText"
          min="50" max="200" step="5" block-size="14" activeColor="var(--awd-accent)"
          backgroundColor="var(--awd-border)" block-color="var(--awd-accent)" />
        <view class="rate-limits">
          <text>0.5x</text>
          <button class="ev-btn rate-reset" role="button" :tabindex="rate === 100 ? -1 : 0" :disabled="rate === 100" :aria-disabled="rate === 100"
            @tap="resetRate" @keydown="onActionKey($event, resetRate, rate === 100)">{{ $t('panels.evResetRate') }}</button>
          <text>2.0x</text>
        </view>
      </view>
    </view>

    <view class="action-area">
      <button class="ev-btn workdeck-btn full-width" :class="reading.segments.length ? 'secondary' : 'primary'"
        role="button" :tabindex="startDisabled ? -1 : 0" :aria-disabled="startDisabled"
        @tap="handleGenerate" @keydown="onActionKey($event, handleGenerate, startDisabled)" :disabled="startDisabled">
        {{ startLabel }}
      </button>
      <text v-if="!canReadText && !reading.segments.length" class="field-hint">{{ $t('panels.evEnterTextHint') }}</text>
    </view>

    <view v-if="reading.segments.length" class="section result-area">
      <view class="section-header"><text class="section-title">{{ $t('panels.evResultTitle') }}</text></view>
      <text v-if="readingError" class="reading-error" role="alert">{{ $t(readingError === 'playback' ? 'panels.evPlaybackRetryHint' : 'panels.evGenerationRetryHint') }}</text>
      <view class="custom-player">
        <view class="player-info" role="status" aria-live="polite">
          <text class="player-status">{{ readingStatus }}</text>
          <text v-if="reading.generating" class="player-progress">{{ $t('panels.evPreparedSegments', { done: reading.generated, total: reading.segments.length }) }}</text>
        </view>
        <view class="player-actions">
          <button class="ev-btn play-btn primary" role="button" :tabindex="reading.status === 'error' ? -1 : 0"
            :disabled="reading.status === 'error'" :aria-disabled="reading.status === 'error'" @tap="togglePlay"
            @keydown="onActionKey($event, togglePlay, reading.status === 'error')" :aria-label="playActionLabel">
            <svg class="btn-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path v-for="(d, gi) in (canPause ? ICONS.pause : ICONS.play)" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <text>{{ playActionLabel }}</text>
          </button>
          <button class="ev-btn stop-btn secondary" role="button" tabindex="0" @tap="stopAudio"
            @keydown="onActionKey($event, stopAudio)">{{ $t('panels.evStop') }}</button>
        </view>
      </view>
      <scroll-view scroll-y :scroll-with-animation="!reduceMotion" class="reading-transcript" tabindex="0"
        :aria-label="$t('panels.evResultTitle')" :scroll-into-view="reading.currentIndex >= 0 ? 'tts-segment-' + reading.currentIndex : ''">
        <view v-for="(segment, index) in reading.segments" :key="index" :id="'tts-segment-' + index"
          class="reading-segment" :class="{ active: index === reading.currentIndex }"
          :aria-current="index === reading.currentIndex ? 'true' : undefined"><text>{{ segment }}</text></view>
      </scroll-view>
      <view class="export-area">
        <button class="ev-btn download-link secondary" role="button" :tabindex="reading.exportBuffer ? 0 : -1"
          :disabled="!reading.exportBuffer" :aria-disabled="!reading.exportBuffer" @tap="downloadAudio"
          @keydown="onActionKey($event, downloadAudio, !reading.exportBuffer)">
          <svg class="btn-glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path v-for="(d, gi) in ICONS.download" :key="gi" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <text>{{ $t('panels.evDownload') }}</text>
        </button>
        <text class="export-hint">{{ $t('panels.evExportHint') }}</text>
      </view>
    </view>
  </scroll-view>
</template>

<script>
import { getTtsVoices, generateTtsAudio, promptFeatureNotConfigured } from '@/services/api.js'
import { ICONS } from '@/config/icons.js'
import { host } from '@/services/host.js'
import { componentDownloads } from '@/services/componentDownloads.js'
import { createTtsReader } from '@/utils/ttsReader.js'
import { hasTtsText } from '@/utils/ttsText.js'
import AwdSelect from '@/components/AwdSelect.vue'

// 本机语音引擎 = 运行时 pack + 模型两件事（设计 §3.1）。0.38.0 起运行时也是按需下载的，
// 面板上仍然只是一个按钮，底层顺序执行两条通道（pack → 模型 → ensure，顺序不能换：
// 模型下载器本身跑在 pack 的 venv 里）。
// kokoro-service 的 descriptor 把 enabled 门在模型上——模型没下，服务根本不启动，
// 于是 /api/tts/voices 恒返回空数组。
const TTS_PACK_ID = 'kokoro-runtime'
const TTS_MODEL_ID = 'kokoro-models'

export default {
  name: 'EasyVoicePane',
  components: { AwdSelect },
  data() {
    return {
      text: '',
      voices: [],
      selectedVoiceId: '',  // 本机 Kokoro 的 voiceId
      selectedVoiceName: '',  // Display name
      readingError: '',
      reduceMotion: false,
      voicesLoaded: false,
      // 本机语音组件的状态：absent / downloading / installed（读自 host.model.status）
      modelState: '',
      modelPercent: 0,
      modelSizeHint: '300 MB',
      rechecking: false,
      // 运行时 pack 的状态。初值 true：没问过之前不要先喊「组件没装」
      runtimeInstalled: true,
      componentItem: null,
      installing: false,
      // 应用级下载单例（dev-board#581）：别的入口正在下的，这里接上同一份进度
      controller: componentDownloads,
      // 100 = 原速；仅影响播放，完整下载仍为原速 WAV。
      rate: 100,
      reading: { status: 'idle', segments: [], currentIndex: -1, generated: 0, generating: false, paused: false, exportBuffer: null }
    }
  },
  computed: {
    ICONS() { return ICONS },
    speedText() { return (this.rate / 100).toFixed(2).replace(/0$/, '') + 'x' },
    canReadText() { return hasTtsText(this.text) },
    startDisabled() { return this.reading.generating || !this.canReadText || !this.selectedVoiceId },
    startLabel() {
      if (this.reading.generating) return this.$t('panels.evPreparing')
      if (this.reading.status === 'error') return this.$t('panels.evRetry')
      return this.$t(this.reading.segments.length ? 'panels.evRestart' : 'panels.evGenerate')
    },
    playActionLabel() {
      return this.$t(this.reading.status === 'complete' ? 'panels.evReplay' : this.canPause ? 'panels.evPause' : 'panels.evResume')
    },
    canPause() { return ['playing', 'buffering'].includes(this.reading.status) },
    readingStatus() {
      if (this.reading.status === 'playing') return this.$t('panels.evReadingSegment', { current: this.reading.currentIndex + 1, total: this.reading.segments.length })
      const keys = { buffering: 'evPreparingAudio', paused: 'evPaused', complete: 'evReadComplete', error: 'evGenerateFailed' }
      return this.$t('panels.' + (keys[this.reading.status] || 'evClickToPlay'))
    },
    /** 拿不到音色 = 引擎没就绪。问过之后才判，免得加载中先闪一下红字。 */
    engineGateVisible() {
      return this.voicesLoaded && this.voices.length === 0
    },
    /** 浏览器态没有 host.model，下载入口整块不出现（那儿也没有本机引擎可言）。 */
    canDownloadModel() {
      return !!host.model && !(this.runtimeInstalled && this.modelState === 'installed')
    },
    modelDownloading() {
      return this.installing || this.modelState === 'downloading'
    },
    /** 运行时段的进度来自控制器写在 item 上的数字，模型段来自主进程事件流。 */
    installPercent() {
      if (this.installing && this.componentItem) return this.componentItem.percent || 0
      return this.modelPercent
    },
    /**
     * 三件事三种下一步，不能合并：
     * - 运行时没装：下运行时组件（模型下载器本身就跑在它的 venv 里，必须先装它）
     * - 运行时装了、模型没下：下 300MB 模型
     * - 都装了：点「重新检测」把服务拉起来
     */
    gateMessage() {
      if (!host.model) return this.$t('panels.evNoVoicesNoticeWeb')
      if (!this.runtimeInstalled) return this.$t('panels.evRuntimeMissing')
      if (this.modelState === 'installed') return this.$t('panels.evEngineNotRunning')
      return this.$t('panels.evModelMissing')
    },
    downloadButtonText() {
      return this.runtimeInstalled
        ? this.$t('panels.evDownloadModel', { size: this.modelSizeHint })
        : this.$t('panels.evDownloadComponent', { size: this.componentSizeHint })
    },
    componentSizeHint() {
      const mb = Math.round((((this.componentItem && this.componentItem.downloadBytes) || 0)
        + ((this.componentItem && this.componentItem.modelBytes) || 0)) / (1024 * 1024))
      return mb ? mb + ' MB' : this.modelSizeHint
    },
    voiceLabels() {
      if (!this.voices.length) return [this.$t(this.voicesLoaded ? 'panels.evSelectVoicePlaceholder' : 'panels.evLoadingVoices')]
      const genders = { female: 'evFemaleVoice', male: 'evMaleVoice' }
      return this.voices.map(v => [v.name, genders[v.gender] ? this.$t('panels.' + genders[v.gender]) : v.gender, v.locale].filter(Boolean).join(' · '))
    },
    voiceIndex() { return Math.max(0, this.voices.findIndex(v => v.voiceId === this.selectedVoiceId)) }
  },
  watch: {
    // 正文变化时旧音频立即失效；下一次朗读重新建立字幕快照。
    text: { flush: 'sync', handler() { this.stopAudio() } }
  },
  mounted() {
    this._unmounted = false
    this.$nextTick?.(() => this.syncTextFieldLabel())
    if (typeof window !== 'undefined' && window.matchMedia) {
      this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      this._motionChanged = () => { this.reduceMotion = this._motionQuery.matches }
      this._motionChanged()
      this._motionQuery.addEventListener('change', this._motionChanged)
    }
    this._reader = createTtsReader({
      generate: generateTtsAudio,
      onChange: state => {
        if (this._unmounted) return
        const previous = this.reading.currentIndex
        this.reading = state
        if (state.status === 'playing') this.readingError = ''
        if (state.currentIndex !== previous) {
          if (state.currentIndex >= 0) this.$emit('highlight-sentence', state.segments[state.currentIndex].trim())
          else this.$emit('clear-highlight')
        }
      },
      onError: (error, phase) => {
        if (this._unmounted) return
        this.readingError = phase
        if (error && error.featureNotConfigured) promptFeatureNotConfigured(error)
        else uni.showToast({ title: this.$t(phase === 'playback' ? 'panels.evCannotPlay' : 'panels.evGenerateFailed'), icon: 'none' })
      }
    })
    this.fetchVoices()
    this.loadModelState()
    // 下载进度直接订阅主进程，与「组件管理」页同一条事件流：
    // 用户在这里点的下载与在设置页点的是同一个下载，两处进度必须一致
    if (host.model) {
      this._modelProgressUnsub = host.model.onProgress((evt) => {
        if (!evt || evt.id !== TTS_MODEL_ID) return
        if (evt.phase === 'progress') {
          this.modelState = 'downloading'
          if (typeof evt.percent === 'number') this.modelPercent = evt.percent
        } else {
          // done / error：重新探一次真相，不拿事件本身当结论
          this.loadModelState()
          if (evt.phase === 'done') this.startEngineThenRefresh()
        }
      })
    }
  },
  updated() { this.syncTextFieldLabel() },
  beforeUnmount() {
    this._unmounted = true
    this._textField?.removeEventListener('input', this._textInput)
    this._motionQuery?.removeEventListener('change', this._motionChanged)
    // 在途的组件下载不停，只是不再由本面板交代结果
    if (this._releaseClaim) { this._releaseClaim(); this._releaseClaim = null }
    this._reader?.destroy()
    this.$emit('clear-highlight')
    if (this._modelProgressUnsub) {
      this._modelProgressUnsub()
      this._modelProgressUnsub = null
    }
  },
  methods: {
    onTextInput(event) {
      // Native input avoids Uni's delayed input/model updates in both directions.
      if (typeof event.target?.value === 'string') this.text = event.target.value
    },
    syncTextFieldLabel() {
      // Uni keeps aria-label on its wrapper; name the actual focusable field too.
      const field = this.$el?.querySelector('.voice-textarea textarea')
      field?.setAttribute('aria-label', this.$t('panels.evTextContentTitle'))
      if (field === this._textField) return
      this._textField?.removeEventListener('input', this._textInput)
      this._textField = field
      this._textInput = event => this.onTextInput(event)
      field?.addEventListener('input', this._textInput)
    },
    onActionKey(event, action, disabled = false) {
      if (!['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      if (!disabled && !event.repeat) action.call(this)
    },
    clearText() { this.text = '' },
    stopAudio() {
      this._reader?.stop()
      this.readingError = ''
      this.$emit('clear-highlight')
    },
    togglePlay() {
      if (this.canPause) this._reader?.pause()
      else this._reader?.resume()
    },
    selectVoiceIndex(index) {
       const voice = this.voices[index]
       if (!voice) return
       this.selectedVoiceId = voice.voiceId
       this.selectedVoiceName = voice.name
    },
    async fetchVoices() {
      try {
        console.log('[EasyVoicePane] Fetching voices...')
        const res = await getTtsVoices()
        console.log('[EasyVoicePane] Voices response:', res)
        
        if (res && Array.isArray(res)) {
            this.voices = res
            // Default to first available voice
            const defaultVoice = this.voices.find(v => v.voiceId === this.selectedVoiceId) || this.voices[0]
            if (defaultVoice) {
                this.selectedVoiceId = defaultVoice.voiceId
                this.selectedVoiceName = defaultVoice.name
            }
        } else {
            console.warn('[EasyVoicePane] Invalid voices response format', res)
        }
      } catch (e) {
        console.error('[EasyVoicePane] Failed to load voices', e)
        uni.showToast({ title: this.$t('panels.evLoadVoicesFailed'), icon: 'none' })
      } finally {
        // 与「还没问过」区分开：空列表 = 引擎没起来，要在合成之前就说出来
        this.voicesLoaded = true
      }
    },
    onRateChange(e) {
      const value = Number(e.detail.value)
      if (!Number.isFinite(value)) return
      this.rate = Math.max(50, Math.min(200, value))
      this._reader?.setRate(this.rate / 100)
    },
    resetRate() { this.onRateChange({ detail: { value: 100 } }) },
    onRateKey(event) {
      const steps = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 25, PageDown: -25 }
      if (!(event.key in steps) && !['Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const value = event.key === 'Home' ? 50 : event.key === 'End' ? 200 : this.rate + steps[event.key]
      this.onRateChange({ detail: { value } })
    },

    // ==================== 本机语音组件 ====================
    async loadModelState() {
      if (!host.model) return
      try {
        const res = await host.model.status()
        const comp = ((res && res.components) || []).find(c => c.id === TTS_MODEL_ID)
        if (comp) {
          this.modelState = comp.state
          if (comp.sizeHint) this.modelSizeHint = comp.sizeHint
        }
        await this.controller.load()
        const item = this.controller.state.items.find(i => i.packId === TTS_PACK_ID)
        if (item) {
          await this.controller.fillSizes(item)
          this.componentItem = item
          this.runtimeInstalled = !!item.installed
          // 别的入口（首次登录面板、组件管理）正在装这个组件：接上同一个任务
          if (this.controller.isInstalling(TTS_PACK_ID) && !this.installing) this.followInstall()
        }
      } catch (e) {
        console.warn('[EasyVoicePane] 读取语音组件状态失败', e)
      }
    },
    /**
     * 一个按钮，两条通道：pack → 模型 → ensure（顺序不能换，模型下载器跑在 pack 的 venv 里）。
     * 装完直接刷新音色列表，用户不用再点一次「重新检测」。
     */
    async onDownloadModel() {
      if (!host.model || this.installing) return
      if (!this.componentItem) await this.loadModelState()
      if (!this.componentItem) {
        uni.showToast({ title: this.$t('panels.evDownloadStartFailed'), icon: 'none' })
        return
      }
      await this.followInstall()
    },
    /** 发起或接上应用级下载管理里的同一个任务（在途时 installOne 返回同一个 Promise）。 */
    async followInstall() {
      this.installing = true
      // 面板开着就由它交代结果；切走面板时释放（beforeUnmount），结果交给全局提示
      this._releaseClaim = this.controller.claim(TTS_PACK_ID)
      try {
        const ok = await this.controller.installOne(this.componentItem)
        if (this._unmounted) return
        this.runtimeInstalled = !!this.componentItem.installed
        if (!ok) {
          uni.showToast({ title: this.$t('components.stateFailed', { msg: this.componentItem.error || '' }), icon: 'none' })
          return
        }
        this.modelState = 'installed'
        await this.fetchVoices()
      } finally {
        if (this._releaseClaim) { this._releaseClaim(); this._releaseClaim = null }
        this.installing = false
        if (!this._unmounted) await this.loadModelState()
      }
    },
    async onCancelModel() {
      if (!host.model) return
      try {
        await host.model.cancel(TTS_MODEL_ID)
      } finally {
        this.modelState = 'absent'
        this.modelPercent = 0
        await this.loadModelState()
      }
    },
    /**
     * kokoro-service 的 descriptor 把 enabled 门在模型上，所以**模型下完之后
     * 还要显式拉一次服务**——否则要等到下次启动应用才会起来，用户会以为下载没用。
     * service-manager 的 start() 每次都重新求值 enabled，此刻求值必然为真。
     */
    async startEngineThenRefresh() {
      try {
        if (host.services && host.services.ensure) await host.services.ensure('kokoro-service')
      } catch (e) {
        console.warn('[EasyVoicePane] 拉起本机语音服务失败', e)
      }
      await this.fetchVoices()
    },
    async onRecheck() {
      if (this.rechecking) return
      this.rechecking = true
      try {
        await this.loadModelState()
        await this.startEngineThenRefresh()
        if (this.voices.length) {
          uni.showToast({ title: this.$t('panels.evEngineReady'), icon: 'success' })
        }
      } finally {
        this.rechecking = false
      }
    },
    async importFromDoc() {
        // 请求文档前就停下旧朗读，避免父级切换文档时高亮串入新文档。
        this.stopAudio()
        const callback = (content) => {
            if (this._unmounted) return
            if (content) {
                this.text = content;
                uni.showToast({ title: this.$t('panels.evImportedDocSuccess'), icon: 'success' })
            } else {
                 uni.showToast({ title: this.$t('panels.evCannotGetDocContent'), icon: 'none' })
            }
        };
        // Keep global emit for potential other listeners
        uni.$emit('easyvoice-request-doc-text', callback);
        this.$emit('request-doc-text', callback);
    },
    async handleGenerate() {
      if (!this.canReadText || !this.selectedVoiceId || this.reading.generating) return
      this.readingError = ''
      await this._reader?.start({ text: this.text, voice: this.selectedVoiceId, playbackRate: this.rate / 100 })
    },
    downloadAudio() {
      if (!this.reading.exportBuffer) return
      const url = URL.createObjectURL(new Blob([this.reading.exportBuffer], { type: 'audio/wav' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `voice_${Date.now()}.wav`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
}
</script>

<style scoped>
.easy-voice-pane {
  height: 100%;
  min-width: 0;
  background: var(--awd-surface);
  color: var(--awd-text);
  box-sizing: border-box;
  container-type: inline-size;
}
.section { padding: 0 var(--awd-panel-pad-x) var(--awd-panel-gap-lg); }
.section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--awd-space-1);
  min-height: var(--awd-panel-sec-h);
  padding-block: var(--awd-space-1);
}
.section-title {
  font-size: var(--awd-panel-fs-sec);
  font-weight: 700;
  color: var(--awd-text-2);
  line-height: var(--awd-line-height-ui);
}
.section-actions, .ev-gate-actions, .player-actions { display: flex; flex-wrap: wrap; gap: var(--awd-space-2); }
.ev-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--awd-space-1);
  box-sizing: border-box;
  min-width: 0;
  min-height: var(--awd-control-height);
  margin: 0;
  padding: var(--awd-space-1) var(--awd-space-2);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-panel-radius);
  font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui);
  color: var(--awd-text);
  background: var(--awd-surface);
  cursor: pointer;
  overflow-wrap: anywhere;
  transition: background-color var(--awd-motion-fast), border-color var(--awd-motion-fast);
}
.ev-btn::after { border: 0; }
.ev-btn:not([disabled]):hover { background: var(--awd-panel-hover); border-color: var(--awd-border-strong); }
.ev-btn[disabled] { color: var(--awd-text-2); background: var(--awd-surface-2); cursor: not-allowed; }
.ev-btn.primary { background: var(--awd-accent); color: var(--awd-text-on-accent); border-color: var(--awd-accent); font-weight: 600; }
.ev-btn.primary:not([disabled]):hover { background: var(--awd-accent-hover); }
.ev-btn.primary[disabled] { background: var(--awd-surface-2); color: var(--awd-text-2); border-color: var(--awd-border); }
.ev-btn:focus-visible, .rate-slider:focus-visible, .reading-transcript:focus-visible {
  outline: var(--awd-focus-width) solid var(--awd-accent-text);
  outline-offset: var(--awd-focus-offset);
}
.mini-btn { min-height: var(--awd-panel-row-h); }
.mini-btn.icon { min-width: var(--awd-panel-row-h); padding-inline: var(--awd-space-1); }
.btn-glyph { width: 16px; height: 16px; flex-shrink: 0; }
.voice-textarea {
  display: block;
  width: 100%;
  height: 112px;
  box-sizing: border-box;
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-panel-radius);
  padding: var(--awd-space-2);
  font-size: var(--awd-font-size-body);
  line-height: 1.6;
  color: var(--awd-text);
  background: var(--awd-surface);
  resize: none;
}
.voice-textarea:focus-within {
  outline: var(--awd-focus-width) solid var(--awd-accent-text);
  outline-offset: var(--awd-focus-offset);
}
.voice-textarea :deep(.uni-textarea-placeholder) { color: var(--awd-text-2); }
.form-item { margin-bottom: var(--awd-panel-gap); min-width: 0; }
.label { display: block; margin-bottom: var(--awd-space-1); font-size: var(--awd-font-size-body); line-height: var(--awd-line-height-ui); color: var(--awd-text); }
.field-hint, .export-hint, .player-progress {
  display: block;
  margin-top: var(--awd-space-1);
  font-size: var(--awd-panel-fs);
  line-height: var(--awd-line-height-ui);
  color: var(--awd-text-2);
  overflow-wrap: anywhere;
}
.ev-gate { margin-bottom: var(--awd-panel-gap); padding: var(--awd-space-2); border-radius: var(--awd-panel-radius); background: var(--awd-warning-soft); }
.ev-gate-msg, .ev-gate-hint { display: block; font-size: var(--awd-font-size-body); line-height: var(--awd-line-height-ui); color: var(--awd-warning-text); overflow-wrap: anywhere; }
.ev-gate-actions { margin-top: var(--awd-space-2); align-items: center; }
.ev-gate-btn { max-width: 100%; }
.slider-header, .rate-limits { display: flex; align-items: center; justify-content: space-between; gap: var(--awd-space-1); }
.value-text { font-size: var(--awd-font-size-body); color: var(--awd-accent-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.rate-slider { margin: 0 var(--awd-space-2); min-height: var(--awd-control-height); }
.rate-limits { color: var(--awd-text-2); font-size: var(--awd-panel-fs); }
.rate-reset { min-height: var(--awd-panel-row-h); border-color: transparent; font-size: var(--awd-panel-fs); }
.rate-reset[disabled] { background: transparent; }
.action-area { padding: 0 var(--awd-panel-pad-x) var(--awd-panel-gap-lg); }
.full-width { width: 100%; }
.reading-error { display: block; padding: var(--awd-space-2); margin-bottom: var(--awd-space-2); background: var(--awd-danger-soft); color: var(--awd-danger-text); font-size: var(--awd-font-size-body); line-height: var(--awd-line-height-ui); border-radius: var(--awd-panel-radius); }
.custom-player { padding-block: var(--awd-space-2); border-top: 1px solid var(--awd-border-subtle); }
.player-info { min-width: 0; margin-bottom: var(--awd-space-2); }
.player-status { font-size: var(--awd-font-size-body); line-height: var(--awd-line-height-ui); color: var(--awd-text); overflow-wrap: anywhere; }
.play-btn { flex: 1; }
.reading-transcript { height: clamp(144px, 30vh, 240px); box-sizing: border-box; border-block: 1px solid var(--awd-border-subtle); }
.reading-segment { padding: var(--awd-space-2); font-size: var(--awd-font-size-body); color: var(--awd-text); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.reading-segment.active { background: var(--awd-accent-soft); color: var(--awd-accent-text); font-weight: 600; }
.export-area { padding-top: var(--awd-space-2); }
.download-link { max-width: 100%; }
@container (max-width: 200px) {
  .player-actions { flex-direction: column; }
  .section-actions { gap: var(--awd-space-1); }
}
@media (pointer: coarse) {
  .ev-btn, .rate-slider { min-height: var(--awd-control-height-touch); }
  .mini-btn.icon { min-width: var(--awd-control-height-touch); }
}
@media (prefers-reduced-motion: reduce) {
  .ev-btn { transition: none; }
}
</style>
