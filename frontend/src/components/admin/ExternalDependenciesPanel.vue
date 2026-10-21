<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <SettingsSection :title="$t('admin.externalTitle')" :description="$t('admin.externalDescription')">
    <template #actions>
      <button class="external-btn" :disabled="busy" @click="check">{{ $t(busy ? 'admin.externalChecking' : 'admin.externalRecheck') }}</button>
    </template>
    <text v-if="error" class="external-error" role="alert">{{ error }}</text>
    <view v-for="id in ['libreoffice', 'docker', 'tmeet']" :key="id" class="external-item">
      <view class="external-head">
        <text class="external-title">{{ $t(`admin.external_${id}`) }}</text>
        <text class="external-status" aria-live="polite">{{ statusLabel(id) }}</text>
      </view>
      <text class="external-copy">{{ $t(`admin.external_${id}_purpose`) }}</text>
      <text class="external-copy">{{ $t(`admin.external_${id}_${platform}`) }}</text>
      <view class="external-actions">
        <button class="external-btn" @click="open(links[id])">{{ $t('admin.externalOfficialGuide') }}</button>
        <button v-if="id === 'tmeet'" class="external-btn" @click="open('https://nodejs.org/en/download/')">{{ $t('admin.externalNodeDownload') }}</button>
      </view>
    </view>
    <text class="external-copy">{{ $t('admin.externalInstallNote') }}</text>
  </SettingsSection>
</template>

<script>
import SettingsSection from '@/components/settings/SettingsSection.vue'
import { checkExternalDependencies } from '@/services/api.js'
import { openExternalUrlChecked } from '@/utils/externalLink.js'

export default {
  components: { SettingsSection },
  data: () => ({ busy: false, error: '', statuses: {}, platform: 'other', alive: false, awaitingReturn: false }),
  computed: {
    links() {
      return {
        libreoffice: 'https://www.libreoffice.org/installation-instructions/',
        docker: this.platform === 'windows'
          ? 'https://docs.docker.com/desktop/setup/install/windows-install/'
          : this.platform === 'mac' ? 'https://docs.docker.com/desktop/setup/install/mac-install/' : 'https://docs.docker.com/desktop/',
        tmeet: 'https://github.com/TencentCloud/tencentmeeting-cli#readme',
      }
    },
  },
  mounted() { this.alive = true; window.addEventListener('focus', this.onReturn); this.check() },
  beforeUnmount() { this.alive = false; window.removeEventListener('focus', this.onReturn) },
  methods: {
    statusLabel(id) {
      const status = this.statuses[id]
      const key = {
        AVAILABLE: 'externalAvailable', MISSING: 'externalMissing', EXECUTABLE_MISSING: 'externalMissing',
        DAEMON_UNAVAILABLE: 'externalDockerStopped', TIMED_OUT: 'externalTimedOut', PROBE_TIMEOUT: 'externalTimedOut',
        NOT_EXECUTABLE: 'externalNotExecutable', FAILED: 'externalFailed', MISSING_OR_FAILED: 'externalMissingOrFailed',
      }[status] || 'externalUnchecked'
      return this.$t(`admin.${key}`)
    },
    async check() {
      if (this.busy || !this.alive) return
      this.busy = true
      this.error = ''
      try {
        const result = await checkExternalDependencies()
        if (!this.alive) return
        if (result.code !== 0) throw new Error(result.message || this.$t('admin.externalCheckFailed'))
        this.platform = ['windows', 'mac'].includes(result.platform) ? result.platform : 'other'
        this.statuses = Object.fromEntries((result.dependencies || []).map(item => [item.id, item.status]))
      } catch (error) {
        if (this.alive) { this.statuses = {}; this.error = error.message || this.$t('admin.externalCheckFailed') }
      } finally { this.busy = false }
    },
    async open(url) {
      this.error = ''
      try { await openExternalUrlChecked(url); this.awaitingReturn = true }
      catch (error) { this.error = error.message || this.$t('admin.externalOpenFailed') }
    },
    onReturn() { if (this.awaitingReturn) { this.awaitingReturn = false; this.check() } },
  },
}
</script>

<style scoped>
.external-item { padding: 12px 0; border-bottom: 1px solid var(--awd-border); margin-bottom: 12px; }
.external-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
.external-title { font-size: var(--awd-panel-fs); font-weight: 600; color: var(--awd-text); }
.external-status, .external-copy { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); line-height: 1.6; }
.external-copy { display: block; margin-top: 6px; }
.external-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.external-btn { margin: 0; padding: 4px 10px; border: 1px solid var(--awd-border-strong); border-radius: var(--awd-radius-md); font-size: var(--awd-panel-fs-meta); color: var(--awd-text); background: var(--awd-surface); cursor: pointer; }
.external-btn:hover { background: var(--awd-panel-hover); }
.external-btn:disabled { opacity: 0.5; cursor: default; }
.external-error { display: block; color: var(--awd-danger-text); font-size: var(--awd-panel-fs-meta); }
</style>
