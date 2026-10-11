<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="plugin-summary">
    <text class="plugin-summary-name">{{ plugin.label }}</text>
    <text class="plugin-summary-description">{{ plugin.description || $t('panels.pgWorkspaceHint') }}</text>
    <button class="plugin-summary-open" @tap="$emit('open')">{{ $t('panels.pgOpenWorkspace') }}</button>
    <text class="plugin-summary-hint">{{ $t('panels.pgWorkspaceHint') }}</text>
  </view>
</template>
<script>
export default {
  name: 'PluginWorkspaceSummary',
  props: { plugin: { type: Object, required: true } },
  emits: ['open'],
}
</script>
<style scoped>
.plugin-summary { display: flex; flex-direction: column; gap: var(--awd-panel-gap-lg); padding: var(--awd-panel-gap) var(--awd-panel-pad-x); }
.plugin-summary-name { font-size: var(--awd-font-size-title); font-weight: 600; color: var(--awd-text); }
.plugin-summary-description { font-size: var(--awd-font-size-body); line-height: 1.7; color: var(--awd-text); }
.plugin-summary-open { min-height: var(--awd-control-height); border-radius: var(--awd-radius-md); width: 100%; margin: 0; font-size: var(--awd-font-size-body); color: var(--awd-text-on-accent, #fff); background: var(--awd-accent); }
.plugin-summary-hint { font-size: var(--awd-panel-fs); line-height: 1.6; color: var(--awd-text-2); }
</style>
