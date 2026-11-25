<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- X-S1: the one way to show a failure inline. The message comes from the errors.* catalogue
     (utils/userMessage.js); raw text only appears behind "Details". -->
<template>
  <view class="awd-inline-error" role="alert">
    <text class="awd-inline-error-message">{{ text }}</text>
    <view class="awd-inline-error-actions">
      <view v-if="showAction" class="awd-inline-error-btn primary" role="button" tabindex="0"
        @tap.stop="onAction" @keydown.enter.prevent="onAction">{{ $t('errors.actions.' + message.action) }}</view>
      <view v-if="message.detail" class="awd-inline-error-btn" role="button" tabindex="0" :aria-expanded="detailsOpen"
        @tap.stop="detailsOpen = !detailsOpen" @keydown.enter.prevent="detailsOpen = !detailsOpen">{{ $t(detailsOpen ? 'errors.actions.hideDetails' : 'errors.actions.details') }}</view>
    </view>
    <text v-if="detailsOpen && message.detail" class="awd-inline-error-detail">{{ message.detail }}</text>
  </view>
</template>

<script>
import { toUserMessage } from '@/utils/userMessage.js'

export default {
  name: 'AwdInlineError',
  props: {
    // Anything that failed: Error, fetch failure, backend envelope, or a precomputed toUserMessage() result.
    error: { type: [Object, String, Error], default: null },
    // toUserMessage context: { partial, desktop, area, params, fallbackKey }
    context: { type: Object, default: () => ({}) },
    // Hide the primary button when the caller has nothing to wire it to.
    actionable: { type: Boolean, default: true },
  },
  emits: ['retry', 'sign-in', 'refresh', 'action'],
  data() {
    return { detailsOpen: false }
  },
  computed: {
    message() {
      const e = this.error
      if (e && typeof e === 'object' && typeof e.key === 'string' && 'action' in e && 'detail' in e) return e
      const desktop = typeof window !== 'undefined' && !!window.checkbaDesktop
      return toUserMessage(e, { desktop, ...this.context })
    },
    text() {
      return this.$t('errors.' + this.message.key, this.message.params || {})
    },
    showAction() {
      return this.actionable && !!this.message.action
    },
  },
  methods: {
    onAction() {
      const a = this.message.action
      this.$emit('action', a)
      if (a === 'signIn') this.$emit('sign-in')
      else if (a === 'refresh') this.$emit('refresh')
      else this.$emit('retry')
    },
  },
}
</script>

<style scoped>
.awd-inline-error {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border-radius: 6px;
  background: var(--awd-danger-soft); border: 1px solid var(--awd-border-subtle);
  color: var(--awd-text); font-size: var(--awd-panel-fs);
}
.awd-inline-error-message { line-height: 1.5; }
.awd-inline-error-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.awd-inline-error-btn {
  padding: 2px 10px; border-radius: 4px; cursor: pointer;
  color: var(--awd-text-2); border: 1px solid var(--awd-border);
}
.awd-inline-error-btn.primary { background: var(--awd-accent); color: var(--awd-text-on-accent); border-color: transparent; }
.awd-inline-error-detail {
  font-family: var(--awd-font-mono); font-size: 11px; color: var(--awd-text-3);
  white-space: pre-wrap; word-break: break-all; direction: ltr; unicode-bidi: isolate;
}
</style>
