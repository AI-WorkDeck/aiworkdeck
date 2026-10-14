<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="mobile-backup">
    <button v-if="state?.available" class="backup-trigger" role="button" tabindex="0" @keydown.enter.prevent="open = true; refresh()" @keydown.space.prevent="open = true; refresh()" @click="open = true; refresh()">{{ $t('workbench.mobileBackup.title') }} · {{ $t('workbench.mobileBackup.' + backupLabel) }}</button>
    <Teleport to="body">
      <div v-if="open && state?.available" class="backup-overlay" @keydown.esc.prevent="close" @keydown.tab="trapFocus">
        <section class="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-title" tabindex="-1" ref="dialog">
          <h2 id="backup-title">{{ $t('workbench.mobileBackup.title') }}</h2>
          <template v-if="state.enabled">
            <p>{{ $t('workbench.mobileBackup.enabledIntro') }}</p>
            <p v-if="state.subscriptionActive">{{ $t('workbench.mobileBackup.pending') }}</p>
            <p v-else class="backup-notice">{{ $t('workbench.mobileBackup.subscriptionRequired') }}</p>
            <p v-if="state.objectBackup?.state === 'pending'" role="status" class="backup-error">{{ $t('workbench.mobileBackup.objectPending') }} {{ state.objectBackup.lastError }}</p>
            <p v-else-if="state.objectBackup?.state === 'syncing'" role="status">{{ $t('workbench.mobileBackup.objectSyncing') }}</p>
            <p>{{ $t('workbench.mobileBackup.disableMessage') }}</p>
          </template>
          <template v-else-if="state.subscriptionActive">
            <p>{{ $t('workbench.mobileBackup.message') }}</p>
          </template>
          <template v-else>
            <p class="backup-notice">{{ $t('workbench.mobileBackup.subscriptionRequired') }}</p>
            <p>{{ $t('workbench.mobileBackup.inactiveIntro') }}</p>
          </template>
          <p v-if="error" role="alert" class="backup-error">{{ error }}</p>
          <div class="backup-actions">
            <button role="button" :tabindex="saving ? -1 : 0" :aria-disabled="saving" :disabled="saving" @keydown.enter.prevent="close" @keydown.space.prevent="close" @click="close">{{ $t('workbench.mobileBackup.' + (state.decided ? 'close' : 'decline')) }}</button>
            <button v-if="state.enabled" role="button" :tabindex="saving ? -1 : 0" :aria-disabled="saving" :disabled="saving" @keydown.enter.prevent="save(false)" @keydown.space.prevent="save(false)" @click="save(false)">{{ $t('workbench.mobileBackup.disable') }}</button>
            <button v-else-if="state.subscriptionActive" class="backup-btn-primary" role="button" :tabindex="saving ? -1 : 0" :aria-disabled="saving" :disabled="saving" @keydown.enter.prevent="save(true)" @keydown.space.prevent="save(true)" @click="save(true)">{{ $t('workbench.mobileBackup.enable') }}</button>
            <button v-else class="backup-btn-primary" role="button" :tabindex="saving ? -1 : 0" :aria-disabled="saving" :disabled="saving" @keydown.enter.prevent="openSubscription" @keydown.space.prevent="openSubscription" @click="openSubscription">{{ $t('workbench.mobileBackup.goSubscribe') }}</button>
          </div>
        </section>
      </div>
    </Teleport>
  </view>
</template>
<script>
import { getMobileBackupConsent, setMobileBackupConsent } from '@/services/api.js'
import { ACCOUNT_CHANGED_EVENT } from '@/utils/requireAccount.js'
import { accountPageUrl } from '@/utils/siteLinks.js'
import { openExternalUrl } from '@/utils/externalLink.js'
export default {
  data: () => ({ state: null, open: false, saving: false, error: '', dismissedScope: '', epoch: 0, requestId: 0, stopped: false, timer: null }),
  computed: {
    backupLabel() {
      if (!this.state?.enabled) return 'disabled'
      if (this.state.objectBackup?.state === 'pending') return 'awaitingSync'
      if (this.state.objectBackup?.state === 'syncing') return 'syncing'
      return 'enabled'
    },
  },
  watch: { open(value) { if (value) this.$nextTick(() => this.$refs.dialog?.focus()) } },
  mounted() { window.addEventListener(ACCOUNT_CHANGED_EVENT, this.accountChanged); this.refresh() },
  beforeUnmount() { this.stopped = true; this.epoch++; clearTimeout(this.timer); window.removeEventListener(ACCOUNT_CHANGED_EVENT, this.accountChanged) },
  methods: {
    trapFocus(event) {
      const buttons = [...this.$refs.dialog.querySelectorAll('[role="button"][tabindex="0"]:not([aria-disabled="true"])')]
      if (!buttons.length) { event.preventDefault(); return }
      const index = buttons.indexOf(document.activeElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1).focus() }
      else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0].focus() }
    },
    accountChanged() { this.epoch++; this.state = null; this.open = false; this.error = ''; this.saving = false; this.refresh() },
    async refresh() {
      clearTimeout(this.timer)
      if (this.saving) return
      const requestId = ++this.requestId
      const epoch = this.epoch
      try {
        const state = await getMobileBackupConsent()
        if (this.stopped || epoch !== this.epoch || requestId !== this.requestId) return
        if (this.state?.accountScope && this.state.accountScope !== state.accountScope) { this.open = false; this.error = '' }
        this.state = state
        if (state.available && !state.decided && this.dismissedScope !== state.accountScope) this.open = true
        if (!state.available) this.open = false
      } catch (_) { /* Unavailable cloud must never block local work or imply consent. */ }
      finally { if (!this.stopped && epoch === this.epoch) this.timer = setTimeout(() => this.refresh(), 60000) }
    },
    async close() {
      if (this.saving) return
      if (this.error) { this.dismissedScope = this.state.accountScope; this.open = false; return }
      if (!this.state.decided) await this.save(false); else this.open = false
    },
    openSubscription() {
      openExternalUrl(accountPageUrl())
    },
    async save(enabled) {
      if (this.saving || !this.state?.accountScope) return
      const epoch = this.epoch
      const scope = this.state.accountScope
      this.saving = true; this.error = ''; this.requestId++
      try {
        const result = await setMobileBackupConsent({ enabled, consentVersion: this.state.consentVersion, accountScope: scope })
        if (this.stopped || epoch !== this.epoch) return
        this.state = { ...result, available: true, accountScope: scope }
        this.open = false
      } catch (_) { if (epoch === this.epoch) this.error = this.$t('workbench.mobileBackup.error') }
      finally { if (epoch === this.epoch) this.saving = false }
    },
  },
}
</script>
<style scoped>
.backup-trigger { margin: 0; padding: 0 10px; line-height: 24px; background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer; }
.backup-trigger::after { border: 0; }
.backup-overlay { position: fixed; inset: 0; z-index: 2200; display: flex; align-items: center; justify-content: center; padding: var(--awd-space-4); background: var(--awd-overlay); }
.backup-dialog { width: min(520px, 100%); max-height: 85vh; overflow: auto; box-sizing: border-box; padding: var(--awd-space-6); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-dialog); background: var(--awd-surface); color: var(--awd-text); box-shadow: var(--awd-shadow-lg); font-size: var(--awd-font-size-reading); line-height: var(--awd-line-height-ui); }
.backup-dialog h2 { margin: 0 0 var(--awd-space-4); font-size: var(--awd-font-size-title); }
.backup-notice { padding: var(--awd-space-3); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-md); background: var(--awd-surface-3); margin: 0 0 var(--awd-space-3); }
.backup-actions { display: flex; flex-wrap: wrap; gap: var(--awd-space-3); justify-content: flex-end; margin-top: var(--awd-space-5); }
.backup-actions button { background: var(--awd-surface-3); color: var(--awd-text); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-md); font: inherit; padding: var(--awd-space-2) var(--awd-space-4); cursor: pointer; }
.backup-actions button.backup-btn-primary { background: var(--awd-accent); color: #fff; border-color: var(--awd-accent); }
.backup-actions button:disabled { opacity: .5; }
.backup-actions button:focus-visible, .backup-trigger:focus-visible { outline: var(--awd-focus-width) solid var(--awd-accent); outline-offset: var(--awd-focus-offset); }
.backup-error { color: var(--awd-danger); }
</style>
