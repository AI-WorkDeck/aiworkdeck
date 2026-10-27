<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="qa-panel-root">
    <EasyVoicePane ref="pane" @request-doc-text="importText" @highlight-sentence="highlight" />
  </view>
</template>
<script>
import EasyVoicePane from '@/components/EasyVoicePane.vue'
export default {
  components: { EasyVoicePane },
  mounted() {
    window.__panelQA = {
      pane: () => this.$refs.pane,
      snapshot: () => {
        const vm = this.$refs.pane
        const s = vm.reading
        return { text: vm.text, status: s.status, currentIndex: s.currentIndex, generated: s.generated, generating: s.generating,
          segments: Array.from(s.segments), voice: vm.selectedVoiceId, rate: vm.rate, exportBytes: s.exportBuffer?.byteLength || 0 }
      },
      decodeExport: async () => {
        const context = new AudioContext()
        try {
          const buffer = await context.decodeAudioData(this.$refs.pane.reading.exportBuffer.slice(0))
          return { duration: buffer.duration, frames: buffer.length, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }
        } finally { await context.close() }
      }
    }
  },
  methods: {
    importText(callback) { window.__qaAudit.imports.push(performance.now()); callback('第一条，验收材料。双方按照约定提交资料。第二条，费用结算。核对无误后办理结算。') },
    highlight(text) { window.__qaAudit.highlights.push(text) }
  }
}
</script>
<style>
.qa-panel-root { width: 100%; height: 100vh; overflow: hidden; }
</style>
