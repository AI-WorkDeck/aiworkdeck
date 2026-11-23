<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div v-if="visible" class="awd-mask" @click.self="close">
    <div class="awd-dialog psub-dialog" role="dialog" aria-modal="true">
      <div class="awd-header psub-header">
        <span class="awd-title">{{ $t('pluginPlatform.subscribeTitle') }}</span>
        <span class="psub-subtitle">{{ $t('pluginPlatform.subscribeSubtitle') }}</span>
      </div>
      <div class="awd-body">
        <div v-if="loadingPlans" class="psub-state-wrap">
          <div class="psub-waiting-dot"></div>
          <span class="psub-waiting">{{ $t('common.loading') }}</span>
        </div>

        <div v-else-if="plansError" class="psub-error-wrap">
          <span class="psub-error">{{ plansError }}</span>
          <button type="button" class="awd-btn awd-btn-primary" @click="loadPlans">{{ $t('common.retry') }}</button>
        </div>

        <div v-else class="psub-wrap">
          <div v-if="activeExpiryLabel" class="psub-active-banner">
            {{ $t('pluginPlatform.activeUntilBanner', { date: activeExpiryLabel }) }}
          </div>

          <div class="psub-plans">
            <button
              v-for="plan in plans"
              :key="plan.skuId"
              type="button"
              class="psub-plan-card"
              :class="{ 'is-selected': selectedSkuId === plan.skuId }"
              :disabled="creating || step !== 'select'"
              @click="selectPlan(plan.skuId)"
            >
              <div class="psub-plan-top">
                <span class="psub-plan-name">{{ planDisplayName(plan) }}</span>
                <span v-if="plan.period === 'quarterly'" class="psub-plan-badge">
                  {{ $t('pluginPlatform.recommendedBadge') }}
                </span>
              </div>
              <div class="psub-plan-price">
                <span class="psub-price-val">{{ formatMoney(plan.amountCents, plan.currency) }}</span>
                <span class="psub-price-days">{{ $t('pluginPlatform.daysPass', { days: plan.days }) }}</span>
              </div>
              <span v-if="planSavingsText(plan)" class="psub-plan-savings">{{ planSavingsText(plan) }}</span>
            </button>
          </div>

          <div class="psub-rules-box">
            <div class="psub-rules-title">{{ $t('pluginPlatform.planRulesTitle') }}</div>
            <div class="psub-rules-item">{{ $t('pluginPlatform.planRuleMaxThree') }}</div>
            <div class="psub-rules-item">{{ $t('pluginPlatform.planRuleUnlock') }}</div>
            <div class="psub-rules-item">{{ $t('pluginPlatform.planRulePrepaid') }}</div>
          </div>

          <div v-if="step === 'qrcode'" class="psub-pay-wrap">
            <div class="psub-qr-frame">
              <img v-if="qrDataUrl" :src="qrDataUrl" class="psub-qr" alt="" />
            </div>
            <span class="psub-pay-hint">{{ $t('pluginPlatform.scanWeChatPay', { amount: selectedAmountLabel }) }}</span>
            <div class="psub-state-wrap">
              <div v-if="!pollTimedOut" class="psub-waiting-dot"></div>
              <span class="psub-waiting">{{ pollHint }}</span>
            </div>
          </div>

          <div v-else-if="step === 'redirect'" class="psub-pay-wrap">
            <span class="psub-pay-hint">{{ $t('admin.rechargeRedirectHint', { amount: selectedAmountLabel }) }}</span>
            <div class="psub-redirect-actions">
              <button v-if="redirectUrl" type="button" class="awd-btn awd-btn-secondary" @click="reopenCheckout">
                {{ $t('pluginPlatform.reopenCheckout') }}
              </button>
              <button type="button" class="awd-btn awd-btn-primary" @click="pollNow">
                {{ $t('pluginPlatform.checkPaymentStatus') }}
              </button>
            </div>
            <div class="psub-state-wrap">
              <div v-if="!pollTimedOut" class="psub-waiting-dot"></div>
              <span class="psub-waiting">{{ pollHint }}</span>
            </div>
          </div>

          <div v-if="orderError" class="psub-error-wrap">
            <span class="psub-error">{{ orderError }}</span>
          </div>
        </div>
      </div>
      <div class="awd-footer">
        <button
          v-if="!loadingPlans && !plansError && step === 'select' && selectedPlan"
          type="button"
          class="awd-btn awd-btn-primary"
          :disabled="creating"
          @click="startOrder"
        >
          {{ creating ? $t('common.loading') : $t('pluginPlatform.confirmSubscribe', { amount: selectedAmountLabel }) }}
        </button>
        <button type="button" class="awd-btn awd-btn-secondary" @click="close">{{ $t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<script>
// Standalone dialog mounted on document.body via requirePluginSubscription: use native HTML elements.
import {
  getPluginBillingPlans,
  createPluginSubscriptionOrder,
  getPluginBillingOrderStatus,
  getAccountStatus,
} from '@/services/api.js'
import { openExternalUrlChecked } from '@/utils/externalLink.js'
import { refreshEntitlements } from '@/composables/useEntitlement.js'
import { requireAccount } from '@/utils/requireAccount.js'

const POLL_INTERVAL_MS = 2500
const POLL_MAX_MS = 5 * 60 * 1000

export default {
  name: 'PluginSubscribeDialog',
  props: {
    visible: { type: Boolean, default: false },
    pluginId: { type: String, default: 'aifirm-partner' },
  },
  emits: ['update:visible', 'subscribed'],
  data() {
    return {
      loadingPlans: false,
      plansError: '',
      plans: [],
      currency: 'USD',
      subscription: null,
      selectedSkuId: '',
      step: 'select', // select | qrcode | redirect
      creating: false,
      orderError: '',
      outTradeNo: '',
      qrDataUrl: '',
      redirectUrl: '',
      pollTimedOut: false,
    }
  },
  computed: {
    isZh() {
      return String(this.$i18n?.locale || 'en-US').toLowerCase().startsWith('zh')
    },
    selectedPlan() {
      return this.plans.find(p => p.skuId === this.selectedSkuId) || this.plans[0] || null
    },
    selectedAmountLabel() {
      const p = this.selectedPlan
      return p ? this.formatMoney(p.amountCents, p.currency) : ''
    },
    activeExpiryLabel() {
      const exp = this.subscription && this.subscription.active && this.subscription.expiresAt
      if (!exp) return ''
      return String(exp).slice(0, 10)
    },
    pollHint() {
      return this.pollTimedOut ? this.$t('admin.rechargeTimeout') : this.$t('admin.rechargeWaiting')
    },
  },
  watch: {
    visible: {
      immediate: true,
      handler(v) {
        if (v) {
          this.initDialog()
        } else {
          this.stopPolling()
        }
      },
    },
  },
  beforeUnmount() {
    this.stopPolling()
  },
  methods: {
    resetState() {
      this.stopPolling()
      this.loadingPlans = false
      this.plansError = ''
      this.plans = []
      this.subscription = null
      this.selectedSkuId = ''
      this.step = 'select'
      this.creating = false
      this.orderError = ''
      this.outTradeNo = ''
      this.qrDataUrl = ''
      this.redirectUrl = ''
      this.pollTimedOut = false
    },
    async initDialog() {
      this.resetState()
      await this.loadPlans()
    },
    async loadPlans() {
      this.loadingPlans = true
      this.plansError = ''
      try {
        const res = await getPluginBillingPlans(this.pluginId)
        if (!this.visible) return
        const plans = (res && Array.isArray(res.plans)) ? res.plans : []
        this.plans = plans
        this.currency = (res && res.currency) || 'USD'
        this.subscription = (res && res.subscription) || null
        const quarterly = plans.find(p => p.period === 'quarterly')
        this.selectedSkuId = (quarterly || plans[0] || {}).skuId || ''
      } catch (e) {
        if (!this.visible) return
        this.plansError = (e && e.message) || this.$t('pluginPlatform.subscribeLoadFailed')
      } finally {
        this.loadingPlans = false
      }
    },
    selectPlan(skuId) {
      if (this.step !== 'select' || this.creating) return
      this.selectedSkuId = skuId
      this.orderError = ''
    },
    planDisplayName(plan) {
      return this.isZh ? (plan.nameZh || plan.nameEn) : (plan.nameEn || plan.nameZh)
    },
    planSavingsText(plan) {
      return this.isZh ? (plan.savingsNoteZh || '') : (plan.savingsNoteEn || '')
    },
    formatMoney(amountCents, currency) {
      const n = Number(amountCents) || 0
      const major = n % 100 === 0 ? String(n / 100) : (n / 100).toFixed(2)
      return currency === 'CNY' ? `¥${major}` : `$${major}`
    },
    async ensureAccountConnected() {
      try {
        const status = await getAccountStatus({ accountPrompt: false })
        if (status && status.connected && !status.authExpired) return true
      } catch (e) { /* prompt login */ }
      return await requireAccount({ reason: 'market' })
    },
    async startOrder() {
      const plan = this.selectedPlan
      if (!plan || this.creating) return
      this.orderError = ''
      this.creating = true
      try {
        const loggedIn = await this.ensureAccountConnected()
        if (!this.visible) return
        if (!loggedIn) {
          this.orderError = this.$t('pluginPlatform.signInRequiredNotice')
          return
        }
        const idempotencyKey = `psub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const res = await createPluginSubscriptionOrder(this.pluginId, {
          skuId: plan.skuId,
          amount: plan.amountCents,
          idempotencyKey,
        })
        if (!this.visible) return
        this.outTradeNo = (res && res.outTradeNo) || ''
        if (res && res.status === 'paid') {
          await this.handlePaid()
          return
        }
        if (res && res.present === 'redirect' && res.redirectUrl) {
          this.redirectUrl = res.redirectUrl
          this.step = 'redirect'
          await openExternalUrlChecked(res.redirectUrl)
        } else {
          const qrCode = res && res.qrCode
          const codeUrl = res && res.codeUrl
          if (qrCode && String(qrCode).startsWith('data:')) {
            this.qrDataUrl = qrCode
          } else if (codeUrl || qrCode) {
            const QRCode = (await import('qrcode')).default
            this.qrDataUrl = await QRCode.toDataURL(String(codeUrl || qrCode), { margin: 1, width: 200 })
          }
          if (!this.visible) return
          this.step = 'qrcode'
        }
        if (this.outTradeNo) this.startPolling()
      } catch (e) {
        if (!this.visible) return
        this.orderError = (e && e.message) || this.$t('pluginPlatform.subscribeCreateFailed')
      } finally {
        this.creating = false
      }
    },
    async reopenCheckout() {
      if (!this.redirectUrl) return
      try {
        await openExternalUrlChecked(this.redirectUrl)
      } catch (e) {
        this.orderError = (e && e.message) || this.$t('pluginPlatform.subscribeCreateFailed')
      }
    },
    startPolling() {
      this.stopPolling()
      this.pollTimedOut = false
      this._pollStartedAt = Date.now()
      this._pollTimer = setInterval(() => this.pollOnce(), POLL_INTERVAL_MS)
    },
    async pollNow() {
      if (!this.outTradeNo) return
      this.pollTimedOut = false
      this._pollStartedAt = Date.now()
      await this.pollOnce()
      if (this.visible && !this._pollTimer) this.startPolling()
    },
    async pollOnce() {
      if (!this.outTradeNo || !this.visible) return
      if (Date.now() - this._pollStartedAt > POLL_MAX_MS) {
        this.stopPolling()
        this.pollTimedOut = true
        return
      }
      try {
        const res = await getPluginBillingOrderStatus(this.pluginId, this.outTradeNo)
        const order = res && res.order
        if (order && order.status === 'paid') {
          await this.handlePaid(res.expiresAt || order.expiresAt || null)
        }
      } catch (e) {
        // Keep polling silently on transient errors.
      }
    },
    async handlePaid(expiresAt = null) {
      this.stopPolling()
      try { await refreshEntitlements(true) } catch (e) { /* best-effort */ }
      uni.showToast({ title: this.$t('pluginPlatform.subscribeSuccess'), icon: 'success' })
      uni.$emit('awd:entitlements-changed', { source: 'plugin-subscription', pluginId: this.pluginId })
      uni.$emit('awd:plugin-billing-changed', { pluginId: this.pluginId, expiresAt })
      this.$emit('subscribed', { subscribed: true, expiresAt })
      this.close()
    },
    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
    },
    close() {
      this.stopPolling()
      this.$emit('update:visible', false)
    },
  },
}
</script>

<style scoped>
.awd-mask {
  position: fixed; inset: 0; z-index: 9980;
  display: flex; align-items: center; justify-content: center;
  padding: 16px; box-sizing: border-box;
  background: var(--awd-overlay);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
}
.psub-dialog {
  width: 480px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  background: var(--awd-surface); color: var(--awd-text);
  border-radius: var(--awd-radius-dialog); overflow: hidden;
  box-shadow: var(--awd-shadow-lg);
}
.psub-header {
  display: flex; flex-direction: column; gap: 6px;
  padding: 20px 24px 14px; border-bottom: 1px solid var(--awd-border);
}
.awd-title {
  font-family: var(--awd-font-sans); font-size: var(--awd-font-size-title);
  font-weight: 600; line-height: 1.35; color: var(--awd-text);
}
.psub-subtitle {
  font-family: var(--awd-font-sans); font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui); color: var(--awd-text-2);
}
.awd-body { padding: 18px 24px; overflow-y: auto; flex: 1; }
.psub-wrap { display: flex; flex-direction: column; gap: 14px; }
.psub-active-banner {
  padding: 8px 12px; border-radius: var(--awd-radius-md);
  background: var(--awd-accent-soft); color: var(--awd-accent-text);
  font-family: var(--awd-font-sans); font-size: var(--awd-panel-fs);
}
.psub-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.psub-plan-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  padding: 12px 14px; text-align: start; cursor: pointer;
  border-radius: var(--awd-radius-md); border: 1.5px solid var(--awd-border);
  background: var(--awd-surface-2); color: var(--awd-text);
  transition: border-color .15s ease, background .15s ease;
}
.psub-plan-card.is-selected {
  border-color: var(--awd-accent); background: var(--awd-surface);
  box-shadow: 0 0 0 2px var(--awd-accent-soft);
}
.psub-plan-card:disabled { opacity: .7; cursor: default; }
.psub-plan-top { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.psub-plan-name { font-family: var(--awd-font-sans); font-size: var(--awd-font-size-body); font-weight: 600; color: var(--awd-text); }
.psub-plan-badge {
  padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600;
  background: var(--awd-accent-soft); color: var(--awd-accent-text);
}
.psub-plan-price { display: flex; align-items: baseline; gap: 6px; }
.psub-price-val { font-size: 22px; font-weight: 700; color: var(--awd-accent-text); font-variant-numeric: tabular-nums; }
.psub-price-days { font-size: var(--awd-panel-fs); color: var(--awd-text-2); }
.psub-plan-savings { font-size: var(--awd-panel-fs); color: var(--awd-accent-text); }
.psub-rules-box {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px; border-radius: var(--awd-radius-md);
  background: var(--awd-surface-2); border: 1px solid var(--awd-border-subtle);
  font-family: var(--awd-font-sans); font-size: var(--awd-panel-fs);
  line-height: var(--awd-line-height-ui); color: var(--awd-text-2);
}
.psub-rules-title { font-weight: 600; color: var(--awd-text); margin-bottom: 2px; }
.psub-pay-wrap, .psub-error-wrap {
  display: flex; flex-direction: column; align-items: center; gap: 10px; padding-top: 4px;
}
.psub-qr-frame {
  padding: 10px; background: var(--awd-surface);
  border: 1px solid var(--awd-border); border-radius: var(--awd-radius-dialog);
  box-shadow: var(--awd-shadow-md);
}
.psub-qr { width: 168px; height: 168px; display: block; }
.psub-pay-hint {
  font-family: var(--awd-font-sans); font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui); color: var(--awd-text); text-align: center;
}
.psub-redirect-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.psub-state-wrap { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 0; }
.psub-waiting-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--awd-mint);
  animation: psub-pulse 1.2s ease-in-out infinite;
}
@keyframes psub-pulse {
  0%, 100% { opacity: .35; transform: scale(.85); }
  50% { opacity: 1; transform: scale(1); }
}
.psub-waiting { font-family: var(--awd-font-sans); font-size: var(--awd-panel-fs); color: var(--awd-info-text); }
.psub-error {
  font-family: var(--awd-font-sans); font-size: var(--awd-font-size-body);
  color: var(--awd-danger-text); text-align: center;
}
.awd-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 24px 18px; border-top: 1px solid var(--awd-border);
}
.awd-btn {
  height: var(--awd-control-height); min-width: 88px; box-sizing: border-box;
  padding: 0 16px; border: 1px solid transparent; border-radius: var(--awd-radius-md);
  font-family: var(--awd-font-sans); font-size: var(--awd-font-size-body); font-weight: 500;
  line-height: var(--awd-control-height); text-align: center; white-space: nowrap; cursor: pointer;
}
.awd-btn:disabled { opacity: .6; cursor: default; }
.awd-btn-primary { background: var(--awd-accent); color: var(--awd-text-on-accent); }
.awd-btn-primary:hover:not(:disabled) { background: var(--awd-accent-hover); }
.awd-btn-secondary { background: transparent; color: var(--awd-text); border-color: var(--awd-border); }
.awd-btn-secondary:hover { background: var(--awd-surface-2); }
@media (prefers-reduced-motion: reduce) {
  .psub-waiting-dot { animation: none; }
}
</style>
