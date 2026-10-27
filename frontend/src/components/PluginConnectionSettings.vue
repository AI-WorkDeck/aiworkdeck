<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view v-if="rows.length || error || devInstalled" class="plugin-connections">
    <text class="connection-title">{{ $t('pluginPlatform.connections') }}</text>
    <text class="connection-note">{{ $t('pluginPlatform.credentialNotice') }}</text>
    <view v-if="devInstalled" class="connection-row">
      <text class="connection-note">{{ $t('pluginPlatform.devTrustNotice') }}</text>
      <component :is="'button'" type="button" :disabled="!!busy" class="connection-button" @click="changeTrust">{{ $t(trusted ? 'pluginPlatform.revokeTrust' : 'pluginPlatform.grantTrust') }}</component>
    </view>
    <view v-for="row in rows" :key="row.id" class="connection-row">
      <view class="connection-heading">
        <text>{{ row.label || row.id }}</text>
        <text class="connection-note">{{ $t(row.connected ? 'pluginPlatform.connected' : 'pluginPlatform.disconnected') }}</text>
      </view>
      <component :is="'input'" v-if="row.authType === 'bearer' && !row.connected" :value="tokens[row.id] || ''" @input="tokens[row.id] = $event.target.value" type="password" maxlength="8192" autocapitalize="off" :spellcheck="false"
        autocomplete="off" class="connection-input" :aria-label="$t('pluginPlatform.token')" :placeholder="$t('pluginPlatform.token')" />
      <view class="connection-actions">
        <component :is="'button'" type="button" v-if="row.authType !== 'none'" :disabled="!!busy" class="connection-button" @click="act(row)">
          {{ $t(row.connected ? 'pluginPlatform.disconnect' : 'pluginPlatform.connect') }}
        </component>
        <component :is="'button'" type="button" :disabled="!!busy" class="connection-button" @click="reload">{{ $t('pluginPlatform.refresh') }}</component>
        <component :is="'button'" type="button" v-if="row.billing" :disabled="!!busy" class="connection-button" @click="checkBilling(row)">{{ $t('pluginPlatform.subscription') }}</component>
      </view>
      <text v-if="subscription[row.id]" class="connection-note">{{ subscription[row.id] }}</text>
    </view>
    <text v-if="error" class="connection-error" role="alert">{{ error }}</text>
    <component :is="'button'" type="button" v-if="error && !rows.length" class="connection-button" @click="reload">{{ $t('pluginPlatform.refresh') }}</component>
  </view>
</template>
<script>
import { pluginPlatformRequest, getPluginDevTrust, setPluginDevTrust } from '@/services/api.js'
import { openExternalUrlChecked } from '@/utils/externalLink.js'
export default {
  props: { pluginId: { type: String, required: true } },
  data: () => ({ rows: [], tokens: {}, subscription: {}, error: '', busy: '', generation: 0, reloadSequence: 0, billingSequence: {}, devInstalled: false, trusted: false }),
  watch: { pluginId: { immediate: true, handler() { this.generation++; this.tokens = {}; this.rows = []; this.subscription = {}; this.devInstalled = false; this.trusted = false; this.busy = ''; this.reload() } } },
  mounted() { this._changed = () => { this.generation++; this.tokens = {}; this.rows = []; this.subscription = {}; this.devInstalled = false; this.trusted = false; this.busy = ''; this.reload() }; uni.$on('awd:account-changed', this._changed) },
  beforeUnmount() { this.generation++; this.tokens = {}; uni.$off('awd:account-changed', this._changed) },
  methods: {
    async reload() {
      const generation = this.generation, sequence = ++this.reloadSequence
      const current = () => generation === this.generation && sequence === this.reloadSequence
      try {
        const trust = await getPluginDevTrust(this.pluginId)
        if (!current()) return
        this.devInstalled = trust.devInstalled; this.trusted = trust.trusted
        if (!trust.trusted) { this.rows = []; this.error = ''; return }
        const response = await pluginPlatformRequest(this.pluginId, 'connections.list')
        if (current()) { this.rows = response.connections || []; this.error = '' }
      } catch (error) { if (current()) this.error = error.message }
    },
    async changeTrust() {
      if (this.busy) return
      const generation = this.generation, pluginId = this.pluginId, trusted = !this.trusted
      if (trusted) {
        const confirmed = await new Promise(resolve => uni.showModal({ title: this.$t('pluginPlatform.grantTrust'), content: this.$t('pluginPlatform.devTrustNotice'), success: result => resolve(result.confirm), fail: () => resolve(false) }))
        if (!confirmed || generation !== this.generation) return
      }
      this.reloadSequence++
      this.subscription = {}
      Object.keys(this.billingSequence).forEach(id => { this.billingSequence[id]++ })
      this.busy = 'trust'
      try { await setPluginDevTrust(pluginId, trusted); if (generation === this.generation) await this.reload() }
      catch (error) { if (generation === this.generation) this.error = error.message }
      finally { if (generation === this.generation) this.busy = '' }
    },
    async act(row) {
      if (this.busy) return
      const generation = this.generation
      this.reloadSequence++
      this.subscription[row.id] = ''
      this.billingSequence[row.id] = (this.billingSequence[row.id] || 0) + 1
      this.busy = row.id; this.error = ''
      try {
        if (row.connected) {
          await pluginPlatformRequest(this.pluginId, 'connections.disconnect', { connectionId: row.id })
        } else if (row.authType === 'bearer') {
          const token = this.tokens[row.id] || ''
          this.tokens[row.id] = ''
          await pluginPlatformRequest(this.pluginId, 'connections.connect', { connectionId: row.id, token })
        } else {
          const response = await pluginPlatformRequest(this.pluginId, 'connections.authorize', { connectionId: row.id })
          if (generation !== this.generation) return
          const url = new URL(response.data.authorizationUrl)
          if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) throw new Error('Invalid authorization URL')
          await openExternalUrlChecked(url.href)
        }
        if (generation === this.generation) {
          uni.$emit('awd:plugin-settings-changed', { pluginId: this.pluginId })
          await this.reload()
        }
      } catch (error) { if (generation === this.generation) this.error = error.message }
      finally { if (generation === this.generation) this.busy = '' }
    },
    async checkBilling(row) {
      const generation = this.generation
      const sequence = (this.billingSequence[row.id] || 0) + 1
      this.billingSequence[row.id] = sequence
      this.subscription[row.id] = ''; this.error = ''
      const current = () => generation === this.generation && sequence === this.billingSequence[row.id]
      try {
        const response = await pluginPlatformRequest(this.pluginId, 'billing.status', { connectionId: row.id })
        if (!current()) return
        this.subscription[row.id] = this.$t(response.data.active ? 'pluginPlatform.active' : 'pluginPlatform.inactive')
      } catch (error) { if (current()) this.error = error.message }
    }
  }
}
</script>
<style scoped>
.plugin-connections { display: flex; flex-direction: column; gap: var(--awd-space-3, 12px); padding-block: var(--awd-space-4, 16px); }
.connection-title { font-weight: 600; color: var(--awd-text); }
.connection-note { font-size: var(--awd-font-size-body, 13px); color: var(--awd-text-2); }
.connection-row { display: flex; flex-direction: column; gap: var(--awd-space-2, 8px); padding-block: var(--awd-space-3, 12px); border-top: 1px solid var(--awd-border); }
.connection-heading, .connection-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--awd-space-2, 8px); }
.connection-heading { justify-content: space-between; }
.connection-input { border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm, 4px); background: var(--awd-surface); color: var(--awd-text); padding: var(--awd-space-2, 8px); }
.connection-button { margin: 0; min-height: var(--awd-control-height, 32px); line-height: var(--awd-line-height-ui, 1.5); font-size: var(--awd-font-size-body, 13px); color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm, 4px); }
.connection-button:focus-visible, .connection-input:focus-visible { outline: var(--awd-focus-width, 2px) solid var(--awd-accent); outline-offset: var(--awd-focus-offset, 2px); }
.connection-error { color: var(--awd-danger-text); font-size: var(--awd-font-size-body, 13px); }
</style>
