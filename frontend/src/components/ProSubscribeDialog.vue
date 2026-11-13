<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div v-if="visible" class="awd-mask" @click.self="close">
    <div class="awd-dialog pro-dialog">
      <div class="awd-header pro-header">
        <div class="pro-title-row">
          <span class="awd-title">{{ $t('admin.proSubscribeTitle') }}</span>
          <span v-if="isCnSite && !bqtOnly && isIntro" class="pro-intro-badge">{{ $t('admin.proSubscribeIntroBadge') }}</span>
        </div>
        <span class="pro-subtitle">{{ $t('admin.proSubscribeSubtitle') }}</span>
      </div>
      <div class="awd-body">
        <span v-if="bqtOnly" class="pro-hint">{{ $t('admin.bqtPayInApp') }}</span>
        <div v-else-if="!isCnSite" class="pro-intl-wrap">
          <span class="pro-hint">{{ $t('admin.proSubscribeIntlNote') }}</span>
        </div>
        <div v-else class="pro-cn-wrap">
          <div class="pro-price-box">
            <div class="pro-price-row">
              <span class="pro-price-cur">¥</span>
              <span class="pro-price-main">{{ priceText }}</span>
              <span class="pro-price-unit">{{ $t('admin.proSubscribePer30Days') }}</span>
              <span v-if="isIntro" class="pro-price-orig">¥149.00</span>
            </div>
            <span class="pro-price-note">
              {{ isIntro ? $t('admin.proSubscribeIntroNote') : $t('admin.proSubscribeStandardNote') }}
            </span>
          </div>

          <div class="pro-benefits">
            <span class="pro-benefit-item">{{ $t('admin.proSubscribeBenefit1') }}</span>
            <span class="pro-benefit-item">{{ $t('admin.proSubscribeBenefit2') }}</span>
            <span class="pro-benefit-item">{{ $t('admin.proSubscribeBenefit3') }}</span>
          </div>

          <div v-if="loading" class="pro-state-wrap">
            <div class="pro-waiting-dot"></div>
            <span class="pro-waiting">{{ $t('admin.rechargeSubmitting') }}</span>
          </div>
          <div v-else-if="errorMsg" class="pro-error-wrap">
            <span class="pro-error">{{ errorMsg }}</span>
            <button type="button" class="awd-btn awd-btn-primary pro-retry-btn" @click="startOrder">{{ $t('common.retry') }}</button>
          </div>
          <div v-else-if="step === 'qrcode'" class="pro-qr-wrap">
            <div class="pro-qr-frame">
              <img v-if="qrDataUrl" :src="qrDataUrl" class="pro-qr" />
            </div>
            <span class="pro-qr-hint">{{ $t('admin.proSubscribeQrHint', { amount: amountText }) }}</span>
            <div class="pro-state-wrap">
              <div v-if="!pollTimedOut" class="pro-waiting-dot"></div>
              <span class="pro-waiting">{{ pollHint }}</span>
            </div>
          </div>
          <div v-else-if="step === 'redirect'" class="pro-qr-wrap">
            <span class="pro-qr-hint">{{ $t('admin.rechargeRedirectHint', { amount: amountText }) }}</span>
            <div class="pro-state-wrap">
              <div v-if="!pollTimedOut" class="pro-waiting-dot"></div>
              <span class="pro-waiting">{{ pollHint }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="awd-footer">
        <button
          v-if="!bqtOnly"
          type="button"
          class="awd-btn awd-btn-secondary"
          @click="openWebsiteAccount"
        >{{ isCnSite ? $t('admin.proSubscribeOpenWeb') : $t('admin.subscriptionManage') }}</button>
        <button type="button" class="awd-btn awd-btn-secondary" @click="close">{{ $t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<script>
// Standalone dialog mounted on document.body via requireSubscription: use native HTML tags and @click.
import { createAccountSubscriptionOrder, getRechargeStatus, getAccountBalance } from '@/services/api.js'
import { isBqtBillingLine } from '@/utils/bqtBilling.js'
import { siteLinks, accountPageUrl } from '@/utils/siteLinks.js'
import { openExternalUrl } from '@/utils/externalLink.js'
import { refreshEntitlements } from '@/composables/useEntitlement.js'

const POLL_INTERVAL_MS = 3000
const POLL_MAX_MS = 5 * 60 * 1000

export default {
  name: 'ProSubscribeDialog',
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ['update:visible', 'subscribed'],
  data() {
    return {
      loading: false,
      bqtOnly: false,
      step: 'idle', // idle | qrcode | redirect
      skuId: 'pro_monthly_intro',
      amountCents: 990,
      qrDataUrl: '',
      outTradeNo: '',
      errorMsg: '',
      pollTimedOut: false,
    }
  },
  computed: {
    isCnSite() {
      return siteLinks().current === 'cn'
    },
    isIntro() {
      return this.skuId === 'pro_monthly_intro' || this.amountCents === 990
    },
    priceText() {
      const fen = Number(this.amountCents) || 990
      return (fen % 100 === 0 ? String(fen / 100) : (fen / 100).toFixed(2))
    },
    amountText() {
      return '¥' + ((Number(this.amountCents) || 990) / 100).toFixed(2)
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
          this.initAndStart()
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
      this.loading = false
      this.bqtOnly = false
      this.step = 'idle'
      this.skuId = 'pro_monthly_intro'
      this.amountCents = 990
      this.qrDataUrl = ''
      this.outTradeNo = ''
      this.errorMsg = ''
      this.pollTimedOut = false
    },
    async initAndStart() {
      this.resetState()
      try {
        const balance = await getAccountBalance()
        if (!this.visible) return
        this.bqtOnly = isBqtBillingLine(balance)
      } catch (e) {
        // Proceed cleanly; server validates eligibility if reached.
      }
      if (!this.visible || this.bqtOnly || !this.isCnSite) return
      await this.startOrder()
    },
    async startOrder() {
      if (this.loading || this.bqtOnly || !this.isCnSite) return
      this.stopPolling()
      this.loading = true
      this.errorMsg = ''
      this.qrDataUrl = ''
      this.outTradeNo = ''
      this.pollTimedOut = false
      try {
        const res = await createAccountSubscriptionOrder()
        if (!this.visible) return
        if (res && res.skuId) this.skuId = String(res.skuId)
        if (res && typeof res.amount === 'number' && Number.isFinite(res.amount)) {
          this.amountCents = res.amount
        }
        this.outTradeNo = (res && res.outTradeNo) || ''
        if (res && res.present === 'redirect' && res.redirectUrl) {
          this.step = 'redirect'
          openExternalUrl(res.redirectUrl)
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
        this.errorMsg = (e && e.message) || this.$t('admin.proSubscribeFailed')
      } finally {
        this.loading = false
      }
    },
    startPolling() {
      this.stopPolling()
      this.pollTimedOut = false
      this._pollStartedAt = Date.now()
      this._pollTimer = setInterval(() => this.pollOnce(), POLL_INTERVAL_MS)
    },
    async pollOnce() {
      if (Date.now() - this._pollStartedAt > POLL_MAX_MS) {
        this.stopPolling()
        this.pollTimedOut = true
        return
      }
      try {
        const res = await getRechargeStatus(this.outTradeNo)
        const order = res && res.order
        if (order && order.status === 'paid') {
          this.stopPolling()
          try { await refreshEntitlements(true) } catch (e) { /* best-effort */ }
          uni.showToast({ title: this.$t('admin.proSubscribeSuccess'), icon: 'success' })
          uni.$emit('awd:wallet-refresh')
          uni.$emit('awd:entitlements-changed', { source: 'subscription' })
          this.$emit('subscribed', { skuId: this.skuId, outTradeNo: this.outTradeNo })
          this.close()
        }
      } catch (e) {
        // Keep polling on transient failures until timeout.
      }
    },
    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
    },
    openWebsiteAccount() {
      openExternalUrl(accountPageUrl())
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
.awd-dialog {
  width: 440px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  background: var(--awd-surface); color: var(--awd-text);
  border-radius: var(--awd-radius-dialog); overflow: hidden;
  box-shadow: var(--awd-shadow-lg);
}
.awd-header { padding: 20px 24px 14px; border-bottom: 1px solid var(--awd-border); }
.pro-header { display: flex; flex-direction: column; gap: 6px; }
.pro-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.awd-title {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-title);
  font-weight: 600;
  line-height: 1.35;
  color: var(--awd-text);
}
.pro-intro-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--awd-radius-md);
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  font-family: var(--awd-font-sans);
  font-size: var(--awd-panel-fs);
  font-weight: 600;
}
.pro-subtitle {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui);
  color: var(--awd-text-2);
}
.awd-body { padding: 18px 24px; overflow-y: auto; flex: 1; }
.pro-intl-wrap, .pro-cn-wrap { display: flex; flex-direction: column; gap: 14px; }
.pro-price-box {
  padding: 12px 14px;
  border-radius: var(--awd-radius-md);
  background: var(--awd-surface-2);
  border: 1px solid var(--awd-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pro-price-row { display: flex; align-items: baseline; gap: 4px; }
.pro-price-cur {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-body);
  font-weight: 600;
  color: var(--awd-accent-text);
}
.pro-price-main {
  font-family: var(--awd-font-sans);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--awd-accent-text);
  font-variant-numeric: tabular-nums;
}
.pro-price-unit {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
}
.pro-price-orig {
  margin-left: 6px;
  font-family: var(--awd-font-sans);
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
  text-decoration: line-through;
  font-variant-numeric: tabular-nums;
}
.pro-price-note {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-panel-fs);
  line-height: var(--awd-line-height-ui);
  color: var(--awd-text-2);
}
.pro-benefits {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pro-benefit-item {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui);
  color: var(--awd-text);
}
.pro-qr-wrap, .pro-error-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}
.pro-qr-frame {
  padding: 10px;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-dialog);
  box-shadow: var(--awd-shadow-md);
}
.pro-qr { width: 168px; height: 168px; display: block; }
.pro-qr-hint, .pro-hint {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui);
  color: var(--awd-text);
  text-align: center;
}
.pro-state-wrap { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 0; }
.pro-waiting-dot {
  width: 6px; height: 6px; border-radius: 50%; background: var(--awd-mint);
  animation: pro-pulse 1.2s ease-in-out infinite;
}
@keyframes pro-pulse {
  0%, 100% { opacity: .35; transform: scale(.85); }
  50% { opacity: 1; transform: scale(1); }
}
.pro-waiting {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-panel-fs);
  color: var(--awd-info-text);
}
.pro-error {
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-body);
  color: var(--awd-danger-text);
  text-align: center;
}
.pro-retry-btn { margin-top: 4px; }
.awd-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 24px 18px; border-top: 1px solid var(--awd-border);
}
.awd-btn {
  height: var(--awd-control-height); min-width: 88px; box-sizing: border-box;
  padding: 0 16px; border: 1px solid transparent; border-radius: var(--awd-radius-md);
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-body);
  font-weight: 500;
  line-height: var(--awd-control-height);
  text-align: center; white-space: nowrap;
  cursor: pointer; transition: background .15s ease, border-color .15s ease;
}
.awd-btn-primary { background: var(--awd-accent); color: var(--awd-text-on-accent); }
.awd-btn-primary:hover { background: var(--awd-accent-hover); }
.awd-btn-secondary { background: transparent; color: var(--awd-text); border-color: var(--awd-border); }
.awd-btn-secondary:hover { background: var(--awd-surface-2); }

@media (prefers-reduced-motion: reduce) {
  .pro-waiting-dot { animation: none; }
}
</style>
