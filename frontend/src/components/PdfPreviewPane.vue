<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="pdf-preview-slot" :class="{ 'is-standby': !active }">
    <FilePreview
      ref="preview"
      :file="file"
      :project-id="projectId"
      :locator="locator"
      :show-edit-btn="false"
      @extracted="$emit('extracted', $event)"
      @locator-consumed="$emit('locator-consumed', $event)"
    />
  </view>
</template>

<script>
import FilePreview from '@/components/FilePreview.vue'

export default {
  name: 'PdfPreviewPane',
  components: { FilePreview },
  props: {
    file: { type: Object, required: true },
    projectId: { type: [String, Number], default: null },
    locator: { type: Object, default: null },
    active: { type: Boolean, default: false },
  },
  emits: ['extracted', 'locator-consumed'],
  methods: {
    reloadFromBackend(force = true) {
      return this.$refs.preview.reloadFromBackend(force)
    },
  },
}
</script>

<style scoped>
.pdf-preview-slot {
  position: absolute;
  inset: 0;
  visibility: visible;
  pointer-events: auto;
}

.pdf-preview-slot.is-standby {
  visibility: hidden;
  pointer-events: none;
}
</style>
