<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- X-S1: designed empty state — optional icon slot, title, hint and one action. -->
<template>
  <view class="awd-empty-state">
    <view v-if="$slots.icon" class="awd-empty-state-icon" aria-hidden="true"><slot name="icon" /></view>
    <text class="awd-empty-state-title">{{ title }}</text>
    <text v-if="hint" class="awd-empty-state-hint">{{ hint }}</text>
    <view v-if="actionLabel" class="awd-empty-state-action" role="button" tabindex="0"
      @tap.stop="$emit('action')" @keydown.enter.prevent="$emit('action')">{{ actionLabel }}</view>
  </view>
</template>

<script>
export default {
  name: 'AwdEmptyState',
  props: {
    title: { type: String, required: true },
    hint: { type: String, default: '' },
    actionLabel: { type: String, default: '' },
  },
  emits: ['action'],
}
</script>

<style scoped>
.awd-empty-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 24px 16px; text-align: center; }
.awd-empty-state-icon { color: var(--awd-text-3); }
.awd-empty-state-title { font-size: var(--awd-panel-fs); color: var(--awd-text-2); }
.awd-empty-state-hint { font-size: 12px; color: var(--awd-text-3); }
.awd-empty-state-action { margin-top: 4px; padding: 3px 12px; border-radius: 4px; cursor: pointer; background: var(--awd-accent); color: var(--awd-text-on-accent); font-size: 12px; }
</style>
