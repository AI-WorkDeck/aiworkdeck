<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="voice-panel" v-if="ready">
    <view class="voice-tabs" role="tablist">
      <button class="voice-tab" role="tab" :aria-selected="tab === 'speech'" @click="tab = 'speech'">{{ $t('workbench.voiceTts') }}</button>
      <button class="voice-tab" role="tab" :aria-selected="tab === 'recording'" @click="tab = 'recording'">{{ $t('workbench.voiceRecorder') }}</button>
    </view>
    <EasyVoicePane v-if="tab === 'speech'" :download-artifact="downloadAudio" @request-doc-text="importText" @highlight-sentence="highlight" @clear-highlight="clearHighlight" />
    <MeetingRecordingPanel v-else :project-id="projectId" :load-audio="loadAudio" :focus-meeting-id="focusMeetingId" @generate-minutes="generateMinutes" />
  </view>
</template>
<script>
import EasyVoicePane from '@/components/EasyVoicePane.vue'
import MeetingRecordingPanel from '@/components/MeetingRecordingPanel.vue'
import { initializeHost } from './host.js'
import { voice } from './api.js'
import { refreshRecorder } from './meetingRecorder.js'
export default {
  components: { EasyVoicePane, MeetingRecordingPanel },
  props: { projectId: [String, Number] },
  data: () => ({ ready: false, tab: 'speech', focusMeetingId: null }),
  async mounted() {
    await initializeHost()
    if (this._gone) return
    this.ready = true
    this._off = window.awd.events.on('sidebar.command', event => { if (event.command === 'recording-focus') { this.focusMeetingId = event.meetingId; this.tab = 'recording' } })
    this._offStopped = window.awd.events.on('speech.stopped', () => uni.$emit('awd:meeting-recording-stopped'))
    const poll = () => refreshRecorder().catch(() => {})
    poll(); this._timer = setInterval(poll, 500)
  },
  beforeUnmount() { this._gone = true; this._off?.(); this._offStopped?.(); clearInterval(this._timer); this.clearHighlight() },
  methods: {
    downloadAudio: payload => voice('download', payload),
    importText(callback) { voice('importText', {}, { timeoutMs: 120000 }).then(callback).catch(() => {}) },
    highlight(sentence) { voice('highlight', { sentence }).catch(() => {}) },
    clearHighlight() { voice('clearHighlight').catch(() => {}) },
    async loadAudio(meeting) { const data = await voice('audio', { id: meeting.id }); return new Blob([data.bytes], { type: data.type }) },
    generateMinutes({ prompt }) { window.awd.chat.send(prompt) },
  },
}
</script>
<style scoped>
.voice-panel { height: 100%; min-width: 0; display: flex; flex-direction: column; overflow: auto; }
.voice-tabs { display: flex; flex-shrink: 0; border-bottom: 1px solid var(--awd-border); }
.voice-tab { flex: 1; min-width: 0; min-height: 32px; margin: 0; padding: 0 12px; line-height: 32px; border-radius: 0; background: transparent; border: 0; color: var(--awd-text-2); font-family: inherit; font-size: var(--awd-font-size-body); cursor: pointer; }
.voice-tab::after { border: 0; }
.voice-tab:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: -2px; }
@media (pointer: coarse) { .voice-tab { min-height: 48px; line-height: 48px; } }
.voice-tab[aria-selected="true"] { color: var(--awd-accent); border-bottom: 2px solid var(--awd-accent); }
</style>
