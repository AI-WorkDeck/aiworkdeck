<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="chat-suggestion-control">
    <div v-if="suggestion" class="chat-suggestion" aria-live="polite">
      <button class="suggestion-text" type="button" @click="$emit('edit')" :title="$t('chatSuggestions.edit')">{{ suggestion.text }}</button>
      <span class="suggestion-shortcut">{{ $t('chatSuggestions.tab') }}</span>
      <button class="suggestion-dismiss" type="button" :aria-label="$t('chatSuggestions.dismiss')" @click="$emit('dismiss')">×</button>
    </div>
    <div class="suggestion-settings">
      <button type="button" class="suggestion-toggle" :aria-pressed="enabled" @click="$emit('toggle')">{{ $t(enabled ? 'chatSuggestions.on' : 'chatSuggestions.off') }}</button>
      <details><summary>{{ $t('chatSuggestions.about') }}</summary><p>{{ $t('chatSuggestions.help') }}</p></details>
    </div>
  </div>
</template>
<script>
export default {
  props: { enabled: Boolean, suggestion: Object },
  emits: ['edit', 'dismiss', 'toggle'],
}
</script>
<style scoped>
.chat-suggestion-control { padding: 4px 2px; color: var(--awd-text-2); font-size: 11px; }
.chat-suggestion { display: flex; align-items: center; gap: 8px; padding: 7px 9px; margin-bottom: 5px; background: var(--awd-surface-2); border: 1px solid var(--awd-border); border-radius: 8px; }
.chat-suggestion-control button { font: inherit; color: inherit; background: transparent; border: 0; padding: 3px 0; margin: 0; cursor: pointer; line-height: 1.5; }
.chat-suggestion-control button::after { border: 0; }
.chat-suggestion-control button:focus-visible, summary:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 2px; }
.suggestion-text { flex: 1; min-width: 0; text-align: left; overflow-wrap: anywhere; color: var(--awd-text) !important; font-size: 12px !important; }
.suggestion-shortcut { flex-shrink: 0; font-size: 10px; }
.suggestion-dismiss { flex-shrink: 0; width: 22px; }
.suggestion-settings { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.suggestion-toggle[aria-pressed="true"] { color: var(--awd-accent-text); }
summary { cursor: pointer; list-style: none; }
details p { max-width: 40em; margin: 5px 0; line-height: 1.6; }
</style>
