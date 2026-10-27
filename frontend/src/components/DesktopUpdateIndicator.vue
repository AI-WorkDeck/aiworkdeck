<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view v-if="visible" class="desktop-update" @keydown.esc.stop="closeDetails">
    <button ref="trigger" type="button" role="button" :tabindex="restarting ? -1 : 0" @keydown="onActionKey($event, 'activate')" class="update-trigger" :class="{ ready, failed }"
      :disabled="restarting" :title="hint" :aria-label="hint"
      :aria-expanded="ready ? undefined : String(expanded)" @click.stop="activate">
      <svg class="update-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle class="ring-track" cx="16" cy="16" r="13" />
        <circle v-if="busy" class="ring-progress" :class="{ indeterminate: percent === null }"
          cx="16" cy="16" r="13" pathLength="100"
          :stroke-dasharray="percent === null ? '24 76' : `${percent} 100`" />
        <path v-if="ready" d="M10 16l4 4 8-8" />
        <path v-else-if="failed" d="M16 9v9m0 5v.1" />
        <path v-else d="M16 8v14m-5-5 5 5 5-5" />
      </svg>
      <text class="update-label">{{ label }}</text>
    </button>
    <view v-if="expanded" class="update-popover" role="region" :aria-label="$t('shell.updateDetails')">
      <view class="update-popover-header">
        <text role="status" aria-live="polite">{{ statusLabel }}</text>
        <button type="button" role="button" tabindex="0" @keydown="onActionKey($event, 'closeDetails')" class="update-close" :aria-label="$t('shell.updateClose')" @click="closeDetails">×</button>
      </view>
      <text v-if="errorText" class="update-error">{{ errorText }}</text>
      <text v-else class="update-hint">{{ ready ? hint : $t('shell.updateBackground') }}</text>
      <button v-if="failed" type="button" role="button" tabindex="0" @keydown="onActionKey($event, 'retry')" class="update-action" @click="retry">{{ $t('shell.updateRetry') }}</button>
      <button v-if="update.majorAvailable" type="button" role="button" tabindex="0" @keydown="onActionKey($event, 'openDownload')" class="update-action" @click="openDownload">{{ $t('shell.updateManual') }}</button>
    </view>
  </view>
</template>

<script>
import { host, isDesktopHost } from '@/services/host.js'
import { setGlobalOverlay } from '@/utils/overlayState.js'

let indicatorSequence = 0

export default {
  data() {
    return { desktop: isDesktopHost(), update: { phase: 'idle' }, expanded: false, restarting: false, actionError: '' }
  },
  computed: {
    overlayOpen() { return this.visible && this.expanded },
    ready() { return this.update.phase === 'ready' && !!this.update.available },
    failed() { return this.update.phase === 'error' || !!this.actionError },
    busy() { return ['checking', 'downloading', 'preparing'].includes(this.update.phase) },
    visible() { return this.desktop && !this.update.disabled && (this.busy || this.ready || this.failed || !!this.update.majorAvailable) },
    percent() {
      const p = this.update.progress
      if (this.update.phase !== 'downloading' || !p || !Number.isFinite(p.total) || p.total <= 0 || !Number.isFinite(p.received)) return null
      return Math.min(100, Math.max(0, Math.floor(p.received / p.total * 100)))
    },
    statusLabel() {
      if (this.restarting) return this.$t('shell.updateRestarting')
      if (this.failed) return this.$t('shell.updateFailed')
      if (this.ready) return this.$t('shell.updateRestart')
      if (this.update.phase === 'preparing') return this.$t('shell.updatePreparing')
      if (this.update.phase === 'checking') return this.$t('shell.menuCheckingUpdate')
      if (this.update.phase === 'downloading') return this.$t(this.percent === null ? 'shell.updateDownloading' : 'shell.updateProgress', { percent: this.percent })
      return this.$t('shell.updateManual')
    },
    label() { return this.update.phase === 'downloading' && this.percent !== null ? `${this.percent}%` : this.statusLabel },
    hint() { return this.ready && !this.failed && !this.restarting ? this.$t('shell.updateReadyHint', { version: this.update.available.version }) : this.statusLabel },
    errorText() { return this.actionError || this.update.error || '' },
  },
  watch: {
    overlayOpen(open) {
      if (this._overlayHolder) setGlobalOverlay(open, this._overlayHolder)
    },
  },
  mounted() {
    if (!this.desktop || !host.update) return
    this._overlayHolder = `desktop-update-${++indicatorSequence}`
    this._alive = true
    this._revision = 0
    // Subscribe before reading: a slow initial response must not replace newer progress.
    this._unsubscribe = host.update.onEvent((evt) => {
      if (!this._alive || !evt?.state) return
      this._revision++
      this.update = evt.state
      this.actionError = ''
    })
    this.refresh()
    this._unsubscribeQuit = host.lifecycle?.onQuitCancelled(() => {
      if (this._alive) this.restarting = false
    })
    this._outsideClick = (event) => {
      if (!this.$el.contains(event.target)) this.expanded = false
    }
    document.addEventListener('pointerdown', this._outsideClick)
  },
  beforeUnmount() {
    this._alive = false
    if (this._overlayHolder) setGlobalOverlay(false, this._overlayHolder)
    this._unsubscribe?.()
    this._unsubscribeQuit?.()
    if (this._outsideClick) document.removeEventListener('pointerdown', this._outsideClick)
  },
  methods: {
    onActionKey(event, action) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) this[action]()
    },
    async refresh() {
      const revision = this._revision
      try {
        const state = await host.update.status()
        if (this._alive && revision === this._revision && state) this.update = state
      } catch (error) {
        if (this._alive && revision === this._revision) this.actionError = String(error?.message || error)
      }
    },
    async activate() {
      if (this.restarting) return
      if (!this.ready) { this.expanded = !this.expanded; return }
      this.restarting = true
      this.actionError = ''
      try {
        const result = await host.update.restart()
        if (result?.ok === false) throw new Error(result.message || this.$t('shell.menuActionFailed'))
      } catch (error) {
        if (!this._alive) return
        this.restarting = false
        this.actionError = String(error?.message || error)
        this.expanded = true
      }
    },
    async retry() {
      if (this.busy || this.restarting) return
      if (this.ready) return this.activate()
      this.actionError = ''
      this.update = { ...this.update, phase: 'checking', error: null }
      try {
        const state = await host.update.check()
        if (this._alive && state) this.update = state
      } catch (error) {
        if (this._alive) this.update = { ...this.update, phase: 'error', error: String(error?.message || error) }
      }
    },
    closeDetails() {
      this.expanded = false
      this.$refs.trigger?.$el?.focus?.()
      this.$refs.trigger?.focus?.()
    },
    openDownload() {
      const url = this.update.majorAvailable?.page
      if (url) host.shell?.openExternal(url)
    },
  },
}
</script>

<style scoped>
.desktop-update { position: relative; flex: 0 0 auto; -webkit-app-region: no-drag; }
.update-trigger { display: flex; align-items: center; gap: var(--awd-space-1, 4px); margin: 0; padding: 0 var(--awd-space-2, 8px); height: var(--awd-panel-row-h, 28px); border: 1px solid transparent; border-radius: var(--awd-radius-sm, 4px); background: transparent; color: var(--awd-text-2); font: inherit; font-size: calc(var(--awd-font-size-body, 13px) - 1px); line-height: 1.3; cursor: pointer; }
.update-trigger::after, .update-close::after, .update-action::after { border: 0; }
.update-trigger:hover { background: var(--awd-surface-2); }
.update-trigger:focus-visible, .update-close:focus-visible, .update-action:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 2px; }
.update-trigger.ready { color: var(--awd-accent-text); background: var(--awd-accent-soft, var(--awd-surface-2)); }
.update-trigger.failed { color: var(--awd-danger, var(--awd-text)); }
.update-trigger[disabled] { opacity: .7; cursor: wait; }
.update-icon { width: 24px; height: 24px; flex: 0 0 auto; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.ring-track { opacity: .2; }
.ring-progress { transform: rotate(-90deg); transform-origin: center; }
.indeterminate { animation: update-spin 1.2s linear infinite; }
.update-label { white-space: nowrap; }
.update-popover { position: absolute; z-index: 1200; top: calc(100% + var(--awd-space-2, 8px)); right: 0; width: min(300px, calc(100vw - 32px)); box-sizing: border-box; padding: var(--awd-space-3, 12px); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-md, 8px); background: var(--awd-surface); color: var(--awd-text); box-shadow: var(--awd-shadow-lg); font-size: var(--awd-font-size-body, 13px); line-height: 1.6; }
.update-popover-header { display: flex; align-items: center; justify-content: space-between; gap: var(--awd-space-2, 8px); }
.update-close { flex-shrink: 0; margin: 0; padding: 0 var(--awd-space-2, 8px); background: transparent; color: var(--awd-text-2); font: inherit; cursor: pointer; }
.update-hint, .update-error { display: block; margin-top: var(--awd-space-2, 8px); white-space: normal; overflow-wrap: anywhere; }
.update-hint { color: var(--awd-text-2); }
.update-error { color: var(--awd-danger, var(--awd-text)); }
.update-action { margin: var(--awd-space-2, 8px) 0 0; background: var(--awd-surface-2); color: var(--awd-accent-text); font: inherit; cursor: pointer; }
@keyframes update-spin { to { transform: rotate(270deg); } }
@media (prefers-reduced-motion: reduce) { .indeterminate { animation: none; } }
@media (max-width: 1100px) { .update-label { display: none; } }
</style>
