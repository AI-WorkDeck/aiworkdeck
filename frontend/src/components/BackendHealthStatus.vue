<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view v-if="supported" class="backend-health" :class="{ warning: health && !health.ok }" role="status" aria-live="polite">
    <view class="backend-health-dot" :class="{ healthy: health && health.ok }" aria-hidden="true"></view>
    <text class="backend-health-label" :title="message">{{ message }}</text>
    <view v-if="canRestart" class="backend-health-retry" role="button" :tabindex="restartPending ? -1 : 0" :aria-disabled="restartPending"
      @tap="restart" @keydown.enter.prevent="restart" @keydown.space.prevent="restart">
      <text>{{ $t(restartPending ? 'workbench.backendHealth.requesting' : 'workbench.backendHealth.retry') }}</text>
    </view>
  </view>
</template>

<script>
import { host } from '@/services/host.js'

const STATES = ['starting', 'healthy', 'degraded', 'restarting', 'failed', 'suspended', 'stopped']
export default {
  name: 'BackendHealthStatus',
  data() {
    return { supported: false, health: null, recovered: false, readFailed: false, restartPending: false, restartFailed: false }
  },
  computed: {
    canRestart() {
      return this.health?.state === 'failed' && this.health.owned === true && typeof host.backend?.restart === 'function'
    },
    message() {
      if (this.restartFailed) return this.$t('workbench.backendHealth.restartFailed')
      if (!this.health) return this.$t('workbench.backendHealth.' + (this.readFailed ? 'unavailable' : 'checking'))
      const { state, reason, owned } = this.health
      if (owned === false) {
        if (state === 'failed' && reason === 'external-backend') return this.$t('workbench.backendHealth.externalUnavailable')
        if (state === 'failed' && reason === 'startup-failed') return this.$t('workbench.backendHealth.startupFailed')
        if (state === 'degraded' && reason === 'external-health-unverified') return this.$t('workbench.backendHealth.externalUnverified')
      }
      if (state === 'restarting' && reason === 'manual') return this.$t('workbench.backendHealth.manualRestarting')
      if (this.recovered && this.health.state === 'healthy') return this.$t('workbench.backendHealth.recovered')
      return this.$t('workbench.backendHealth.' + this.health.state)
    },
  },
  async mounted() {
    const api = host.backend
    if (typeof api?.getHealth !== 'function' || typeof api?.onHealthChanged !== 'function') return
    this.supported = true
    this._healthDisposed = false
    this._healthEvents = 0
    try {
      this._healthUnsubscribe = api.onHealthChanged(snapshot => {
        this._healthEvents++
        this.applyHealth(snapshot)
      })
      const events = this._healthEvents
      const snapshot = await api.getHealth()
      if (!this._healthDisposed && events === this._healthEvents) this.applyHealth(snapshot)
    } catch (e) {
      if (!this._healthDisposed) this.readFailed = true
    }
  },
  beforeUnmount() {
    this._healthDisposed = true
    clearTimeout(this._recoveredTimer)
    this._healthUnsubscribe?.()
    this._healthUnsubscribe = null
  },
  methods: {
    applyHealth(snapshot) {
      if (this._healthDisposed || !snapshot || !STATES.includes(snapshot.state)) return
      if (this.health?.updatedAt && snapshot.updatedAt < this.health.updatedAt) return
      const recovered = snapshot.state === 'healthy' && snapshot.ok === true && ['degraded', 'restarting', 'failed'].includes(this.health?.state)
      this.health = snapshot
      this.readFailed = false
      this.restartFailed = false
      if (recovered) {
        clearTimeout(this._recoveredTimer)
        this.recovered = true
        this._recoveredTimer = setTimeout(() => { this.recovered = false }, 8000)
      } else if (snapshot.state !== 'healthy') {
        clearTimeout(this._recoveredTimer)
        this.recovered = false
      }
    },
    async restart() {
      if (!this.canRestart || this.restartPending || this._healthDisposed) return
      this.restartPending = true
      this.restartFailed = false
      try {
        const result = await host.backend.restart()
        if (!this._healthDisposed && (result?.ok === false || result?.success === false)) this.restartFailed = true
      } catch (e) {
        if (!this._healthDisposed) this.restartFailed = true
      } finally {
        if (!this._healthDisposed) this.restartPending = false
      }
    },
  },
}
</script>

<style scoped>
.backend-health { display: flex; align-items: center; gap: var(--awd-space-1); min-width: 0; color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); }
.backend-health.warning { color: var(--awd-warning-text); }
.backend-health-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--awd-warning-text); }
.backend-health-dot.healthy { background: var(--awd-accent-text); }
.backend-health-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.backend-health-retry { flex: none; display: flex; align-items: center; min-height: var(--awd-panel-sec-h); padding: 0 var(--awd-space-1); border-radius: var(--awd-radius-sm); color: var(--awd-accent-text); cursor: pointer; }
.backend-health-retry:hover { background: var(--awd-surface-2); }
.backend-health-retry:focus-visible { outline: var(--awd-focus-width) solid var(--awd-accent-text); outline-offset: var(--awd-focus-offset); }
.backend-health-retry[aria-disabled="true"] { opacity: .5; cursor: wait; }
</style>
