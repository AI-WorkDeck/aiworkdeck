<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="recording-actions" :aria-busy="!!busy" @keydown.stop>
    <div class="recording-actions-buttons">
      <button type="button" :disabled="!!busy" @click="run('minutes')">{{ $t('meeting.generateMinutes') }}</button>
      <button type="button" :disabled="!!busy" @click="run('todos')">{{ $t('meeting.fileTodos') }}</button>
      <button type="button" :disabled="!!busy" @click="run('export')">{{ $t('meeting.fileExportWord') }}</button>
    </div>
    <span v-if="message" role="status" class="recording-actions-message">{{ message }}</span>
  </div>
</template>
<script>
import { getMeetingMinutesPrompt, getMeetingTodosPrompt, exportMeetingTranscript } from '@/services/api.js'

export default {
  name: 'RecordingActions',
  props: { meeting: { type: Object, required: true } },
  emits: ['ai-prompt', 'files-changed'],
  data() { return { busy: '', message: '' } },
  beforeUnmount() { this._disposed = true },
  methods: {
    async run(action) {
      if (this.busy || !this.meeting?.id || this.meeting.status !== 'TRANSCRIBED') return
      const meetingId = this.meeting.id
      this.busy = action
      this.message = this.$t(action === 'export' ? 'common.loading' : 'meeting.sendingToAi')
      try {
        if (action === 'export') {
          const res = await exportMeetingTranscript(meetingId)
          if (this._disposed || this.meeting.id !== meetingId) return
          this.$emit('files-changed', res.file)
          this.message = this.$t('meeting.exported', { name: res.file.name, folder: res.folderName })
        } else {
          const res = await (action === 'todos' ? getMeetingTodosPrompt : getMeetingMinutesPrompt)(meetingId)
          // A late result must not dispatch work for a different recording.
          if (this._disposed || this.meeting.id !== meetingId) return
          this.message = ''
          this.$emit('ai-prompt', { meeting: this.meeting, prompt: res.prompt })
        }
      } catch (e) {
        if (this._disposed || this.meeting.id !== meetingId) return
        this.message = this.$t('meeting.fileActionFailed', { message: e?.message || String(e) })
      } finally {
        this.busy = ''
      }
    },
  },
}
</script>
<style scoped>
.recording-actions { flex: 0 0 auto; width: 100%; max-width: 900px; margin: 0 auto 12px; }
.recording-actions-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.recording-actions button { margin: 0; padding: 8px 12px; border: 1px solid var(--awd-border); border-radius: 6px; background: var(--awd-surface); color: var(--awd-text); font: inherit; font-size: 13px; cursor: pointer; }
.recording-actions button:disabled { opacity: .5; cursor: wait; }
.recording-actions-message { display: block; margin-top: 8px; font-size: 12px; color: var(--awd-text-2); overflow-wrap: anywhere; }
</style>
