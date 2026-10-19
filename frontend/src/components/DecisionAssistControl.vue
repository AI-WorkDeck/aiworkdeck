<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <details class="decision-assist" :class="{ enabled }">
    <summary class="decision-assist-summary">
      <span class="decision-assist-entry">{{ $t('chat.decisionAssistEntry') }}</span>
      <span class="decision-assist-summary-state">{{ $t(enabled ? 'chat.decisionAssistOn' : 'chat.decisionAssistOff') }}</span>
    </summary>
    <div class="decision-assist-body">
      <button type="button" role="switch" class="decision-assist-switch"
        :aria-checked="enabled ? 'true' : 'false'" @click="$emit('toggle')">
        <span class="decision-assist-track" aria-hidden="true"><span /></span>
        <span class="decision-assist-label">{{ $t('chat.decisionAssistLabel') }}</span>
        <span class="decision-assist-state">{{ $t(enabled ? 'chat.decisionAssistOn' : 'chat.decisionAssistOff') }}</span>
      </button>
      <text class="decision-assist-hint">{{ $t(localOnly ? 'chat.decisionAssistLocal' : enabled ? 'chat.decisionAssistOnHint' : 'chat.decisionAssistOffHint') }}</text>
      <text v-if="!localOnly" class="decision-assist-hint">{{ $t('chat.decisionAssistNextSend') }}</text>
      <details v-if="!localOnly" class="decision-assist-details">
        <summary>{{ $t('chat.decisionAssistDetails') }}</summary>
        <text class="decision-assist-hint">{{ $t('chat.decisionAssistData') }}</text>
        <text class="decision-assist-hint">{{ $t('chat.decisionAssistMaterials') }}</text>
        <text class="decision-assist-hint">{{ $t('chat.decisionAssistFallback') }}</text>
      </details>
    </div>
  </details>
</template>

<script>
export default {
  name: 'DecisionAssistControl',
  props: { enabled: { type: Boolean, default: false }, localOnly: { type: Boolean, default: false } },
  emits: ['toggle'],
}
</script>

<style scoped>
.decision-assist { margin: var(--awd-space-2) 0 0; border: none; background: transparent; color: var(--awd-text-2); }
.decision-assist-summary { display: flex; align-items: center; gap: var(--awd-space-2); min-height: 28px; box-sizing: border-box; padding: var(--awd-space-1) 0; list-style: none; font-size: var(--awd-panel-fs); line-height: 1.5; cursor: pointer; }
.decision-assist-summary::-webkit-details-marker { display: none; }
.decision-assist-summary::before { content: ''; width: 5px; height: 5px; flex-shrink: 0; margin: 0 3px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: rotate(-45deg); }
.decision-assist[open] > .decision-assist-summary::before { transform: rotate(45deg); }
.decision-assist-summary:hover { color: var(--awd-accent-text); }
.decision-assist-summary:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 2px; border-radius: var(--awd-radius-sm); }
.decision-assist-entry { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.decision-assist-summary-state { flex-shrink: 0; font-size: var(--awd-panel-fs-meta); }
.enabled .decision-assist-summary-state { color: var(--awd-accent-text); font-weight: 600; }
.decision-assist-body { padding: var(--awd-space-2) 0; }
.decision-assist-switch { display: flex; align-items: center; gap: 7px; width: 100%; margin: 0; padding: 0; border: 0; border-radius: 3px; background: transparent; color: var(--awd-text); font: inherit; font-size: 12px; line-height: 1.5; text-align: left; cursor: pointer; }
.decision-assist-switch::after { border: 0; }
.decision-assist-switch:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 3px; }
.decision-assist-label { flex: 1; min-width: 0; }
.decision-assist-state { flex-shrink: 0; font-weight: 600; }
.enabled .decision-assist-state { color: var(--awd-accent-text); }
.decision-assist-track { display: flex; align-items: center; flex-shrink: 0; width: 26px; height: 16px; padding: 2px; box-sizing: border-box; border-radius: 12px; background: var(--awd-text-tertiary, #777); }
.decision-assist-track > span { width: 12px; height: 12px; border-radius: 50%; background: var(--awd-surface, white); }
.enabled .decision-assist-track { justify-content: flex-end; background: var(--awd-accent); }
.decision-assist-hint { display: block; margin-top: 4px; color: var(--awd-text-secondary); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.decision-assist-details { margin-top: 4px; font-size: 11px; line-height: 1.5; }
.decision-assist-details > summary { color: var(--awd-accent-text); cursor: pointer; }
.decision-assist-details > summary:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 2px; }
</style>
