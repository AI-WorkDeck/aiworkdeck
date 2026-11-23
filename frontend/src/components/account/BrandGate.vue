<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  贴牌版本的整屏锁（后端 GET /api/brand/gate，配置 ai.brand.paid-gate.*；AI WorkDeck 本身 required=false，不挂）。
  未登录 → 登录按钮（requireAccount）；已登录未付费 → 选择方案（插件订阅弹层）/ 官网购买 / 重新检查。
  z-index 9970：低于订阅弹层（9980）与登录弹层（9990），它们开在锁屏之上。
-->
<template>
  <div v-if="locked" class="brand-gate" role="dialog" aria-modal="true" :aria-label="$t('account.brandGateTitle')">
    <div class="brand-gate-card">
      <img class="brand-gate-logo awd-brand-logo" src="/static/logo_full_v2.png" alt="" />
      <h1 class="brand-gate-title">{{ $t('account.brandGateTitle') }}</h1>
      <template v-if="!state.accountConnected">
        <p class="brand-gate-body">{{ $t('account.brandGateSignInBody') }}</p>
        <button type="button" class="brand-gate-primary" @click="signIn">{{ $t('account.brandGateSignIn') }}</button>
      </template>
      <template v-else>
        <p class="brand-gate-body">{{ $t('account.brandGatePlanBody') }}</p>
        <button type="button" class="brand-gate-primary" @click="choosePlan">{{ $t('account.brandGateChoosePlan') }}</button>
        <button v-if="state.buyUrl" type="button" class="brand-gate-secondary" @click="openSite">{{ $t('account.brandGateOpenSite') }}</button>
        <button type="button" class="brand-gate-link" :disabled="checking" @click="check(true)">{{ $t('account.brandGateRecheck') }}</button>
        <p v-if="notFound" class="brand-gate-note" role="status">{{ $t('account.brandGateStillLocked') }}</p>
      </template>
    </div>
  </div>
</template>

<script>
import { getBrandGate } from '@/services/api.js'
import { requireAccount, requirePluginSubscription, ACCOUNT_CHANGED_EVENT } from '@/utils/requireAccount.js'
import { openExternalUrl } from '@/utils/externalLink.js'
import { setGlobalOverlay } from '@/utils/overlayState.js'

const OVERLAY_HOLDER = 'awd-brand-gate'

export default {
  name: 'BrandGate',
  data() {
    return { state: { required: false, unlocked: true, accountConnected: false, buyUrl: '', entitlement: '' }, checking: false, notFound: false }
  },
  computed: {
    locked() { return this.state.required && !this.state.unlocked },
    pluginId() {
      const e = this.state.entitlement || ''
      return e.startsWith('plugin:') ? e.slice('plugin:'.length) : ''
    },
  },
  watch: {
    locked(v) { setGlobalOverlay(v, OVERLAY_HOLDER) },
  },
  mounted() {
    this.onAccountChanged = () => this.check(true)
    try {
      uni.$on(ACCOUNT_CHANGED_EVENT, this.onAccountChanged)
      uni.$on('awd:entitlements-changed', this.onAccountChanged)
    } catch (e) { /* ignore */ }
    this.check(false)
  },
  beforeUnmount() {
    try {
      uni.$off(ACCOUNT_CHANGED_EVENT, this.onAccountChanged)
      uni.$off('awd:entitlements-changed', this.onAccountChanged)
    } catch (e) { /* ignore */ }
    setGlobalOverlay(false, OVERLAY_HOLDER)
  },
  methods: {
    async check(refresh) {
      if (this.checking) return
      this.checking = true
      const wasLocked = this.locked
      try {
        const res = await getBrandGate(refresh)
        if (res && res.data) this.state = { ...this.state, ...res.data }
        this.notFound = refresh && wasLocked && this.locked && this.state.accountConnected
      } catch (e) {
        // 后端暂不可达：已锁保持锁，未锁不因网络抖动锁住
      } finally {
        this.checking = false
      }
    },
    signIn() {
      requireAccount({ force: true, reason: 'account' }).then(() => this.check(true)).catch(() => {})
    },
    async choosePlan() {
      if (!this.pluginId) { this.openSite(); return }
      const outcome = await requirePluginSubscription({ pluginId: this.pluginId })
      if (outcome && outcome.subscribed) this.check(true)
    },
    openSite() {
      if (this.state.buyUrl) openExternalUrl(this.state.buyUrl)
    },
  },
}
</script>

<style scoped>
.brand-gate {
  position: fixed; inset: 0; z-index: 9970;
  display: flex; align-items: center; justify-content: center;
  background: var(--awd-bg, #FFFEFB);
}
.brand-gate-card {
  width: min(440px, calc(100vw - 48px)); text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
}
.brand-gate-logo { height: 40px; width: auto; margin-bottom: 8px; }
.brand-gate-title { font-size: 22px; font-weight: 600; margin: 0; color: var(--awd-text, #121212); }
.brand-gate-body { font-size: 14px; line-height: 1.7; margin: 0 0 6px; color: var(--awd-text-2, #4a4a4a); }
.brand-gate-primary, .brand-gate-secondary {
  width: 100%; height: 44px; border-radius: 10px; font-size: 15px; cursor: pointer;
}
.brand-gate-primary { border: none; background: var(--awd-accent, #121212); color: #fff; }
.brand-gate-secondary { border: 1px solid var(--awd-border, #d9d6cf); background: transparent; color: var(--awd-text, #121212); }
.brand-gate-link { border: none; background: none; color: var(--awd-text-2, #4a4a4a); font-size: 13px; cursor: pointer; text-decoration: underline; }
.brand-gate-link:disabled { opacity: .5; cursor: default; }
.brand-gate-note { font-size: 13px; margin: 0; color: var(--awd-text-2, #4a4a4a); }
</style>
