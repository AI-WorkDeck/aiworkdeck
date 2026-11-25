<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- X-S1: loading — skeleton lines when the shape is known (rows), otherwise a spinner. -->
<template>
  <view class="awd-loading-block" role="status" aria-busy="true" :aria-label="label || $t('common.loading')">
    <template v-if="rows > 0">
      <view v-for="i in rows" :key="i" class="awd-loading-row" :style="{ width: (92 - (i % 3) * 14) + '%' }"></view>
    </template>
    <view v-else class="awd-loading-spinner" aria-hidden="true"></view>
  </view>
</template>

<script>
export default {
  name: 'AwdLoadingBlock',
  props: {
    rows: { type: Number, default: 0 },
    label: { type: String, default: '' },
  },
}
</script>

<style scoped>
.awd-loading-block { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
.awd-loading-row { height: 10px; border-radius: 4px; background: var(--awd-border-subtle); animation: awd-pulse 1.2s ease-in-out infinite; }
.awd-loading-spinner {
  width: 16px; height: 16px; align-self: center; border-radius: 50%;
  border: 2px solid var(--awd-border); border-top-color: var(--awd-accent); animation: awd-spin 0.8s linear infinite;
}
@keyframes awd-pulse { 50% { opacity: 0.5; } }
@keyframes awd-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .awd-loading-row, .awd-loading-spinner { animation: none; } }
</style>
