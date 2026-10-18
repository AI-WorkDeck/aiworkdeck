<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="unlock-hint">
    <text class="unlock-hint-text">{{ text }}</text>
    <text class="unlock-hint-link" @tap.stop="onLearnMore">{{ linkText }}</text>
    <view
      v-if="skuId"
      class="unlock-hint-buy"
      :class="{ 'is-busy': purchasing }"
      @tap.stop="onPurchase"
    >
      <text class="unlock-hint-buy-text">{{ purchasing ? t('onboarding.hint.purchasing') : t('onboarding.hint.unlockNow') }}</text>
    </view>
  </view>
</template>

<script>
import { perform } from './api.js'
import { t } from '@/i18n'
export default {
  props: { text: String, linkText: { type: String, default: () => t('onboarding.hint.learnMore') }, skuId: String },
  data: () => ({ purchasing: false }),
  methods: {
    t,
    async onLearnMore() {
      try { await perform('account') }
      catch (error) { uni.showToast({ title: error.message, icon: 'none' }) }
    },
    async onPurchase() {
      if (this.purchasing) return
      this.purchasing = true
      try { await perform('purchase', {}, { timeoutMs: 120000 }) }
      catch (error) { uni.showToast({ title: error.message, icon: 'none' }) }
      finally { this.purchasing = false }
    },
  },
}
</script>

<style scoped>
/* 浅色体系：与顶栏「试用版」chip 同一族暖色，避免做成刺眼的警告条 */
.unlock-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  background: var(--awd-bg);
  border: 1px solid var(--awd-warning);
  border-radius: 4px;
}

.unlock-hint-text {
  font-size: 12px;
  line-height: 18px;
  color: var(--awd-warning-text);
}

.unlock-hint-link {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--awd-accent-text);
  cursor: pointer;
}

.unlock-hint-link:hover {
  color: var(--awd-accent-text);
  text-decoration: underline;
}

/* 应用内一键解锁：品牌绿实心小按钮 */
.unlock-hint-buy {
  background: var(--awd-accent);
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
}

.unlock-hint-buy:hover {
  background: var(--awd-accent-hover);
}

.unlock-hint-buy.is-busy {
  opacity: 0.5;
  pointer-events: none;
}

.unlock-hint-buy-text {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--awd-text-on-accent);
}
</style>
