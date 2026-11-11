<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  平台 AI 跨境单独同意的就地征求卡：对话被同意闸拦下时出现在那条回答里，启动时发现同意失效（告知改版、
  换账户、切站点）时出现在征求框里。用户在原地看告知、点同意，不用跳去设置页。
  同意绝不预设：只有用户点「同意并继续」才记（个保法第三十九条单独同意）；措辞按站点取，
  与登录弹层同一套词条（国内站「可能涉及境外处理」，国际站「跨境传输」）。
-->
<template>
  <div class="awd-consent-card" :class="{ 'is-bare': bare }" role="group" :aria-label="$t('onboarding.unlock.consentCardTitle')">
    <div class="awd-consent-title">{{ $t('onboarding.unlock.consentCardTitle') }}</div>
    <div class="awd-consent-label">{{ $t(key('crossBorderLabel')) }}</div>
    <div v-if="noticeOpen" class="awd-consent-notice">{{ $t(key('crossBorderNoticeBody')) }}</div>
    <div class="awd-consent-actions">
      <!-- component :is 'button'：uni-h5 会把模板里的 <button> 换成自带样式的 uni-button -->
      <component :is="'button'" type="button" class="awd-btn awd-btn-primary awd-consent-accept" :disabled="busy" @click="accept">
        {{ $t('onboarding.unlock.consentAccept') }}
      </component>
      <component :is="'button'" type="button" class="awd-consent-link" :aria-expanded="noticeOpen ? 'true' : 'false'" @click="noticeOpen = !noticeOpen">
        {{ $t(noticeOpen ? 'onboarding.unlock.consentHideNotice' : 'onboarding.unlock.crossBorderView') }}
      </component>
    </div>
    <div v-if="failed" class="awd-consent-error" role="alert">{{ $t('onboarding.unlock.consentFailed') }}</div>
  </div>
</template>

<script>
import { getCrossBorderConsent, acceptCrossBorderConsent } from '@/services/api.js'

export default {
  name: 'CrossBorderConsentCard',
  props: {
    /** 'cn' | 'intl'；不给就自己问后端 */
    site: { type: String, default: '' },
    /** 放在对话框里时去掉自身边框与内边距，免得框套框 */
    bare: { type: Boolean, default: false },
  },
  emits: ['accepted'],
  data() {
    return { currentSite: this.site, noticeOpen: false, busy: false, failed: false }
  },
  async mounted() {
    if (this.currentSite) return
    try {
      const res = await getCrossBorderConsent()
      this.currentSite = (res && (res.data || res).site) || ''
    } catch (e) {
      // 拿不到站点就用国内站措辞（默认站点）
    }
  },
  methods: {
    key(name) {
      return `onboarding.unlock.${name}${this.currentSite === 'intl' ? '' : 'Domestic'}`
    },
    async accept() {
      if (this.busy) return
      this.busy = true
      this.failed = false
      try {
        await acceptCrossBorderConsent()
        this.$emit('accepted')
      } catch (e) {
        this.failed = true
      } finally {
        this.busy = false
      }
    },
  },
}
</script>

<style scoped>
.awd-consent-card {
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-2);
  padding: var(--awd-space-3);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  background: var(--awd-surface);
  color: var(--awd-text);
}
.awd-consent-card.is-bare {
  padding: 0;
  border: 0;
  background: none;
}
.awd-consent-title {
  font-weight: 600;
  font-size: var(--awd-font-size-body);
}
.awd-consent-label,
.awd-consent-notice {
  font-size: var(--awd-font-size-body);
  line-height: 1.6;
  color: var(--awd-text-2);
}
.awd-consent-notice {
  padding: var(--awd-space-2);
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface-2);
}
.awd-consent-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--awd-space-4);
  margin-top: var(--awd-space-1);
}
.awd-consent-accept {
  height: var(--awd-control-height);
  min-width: 88px;
  box-sizing: border-box;
  margin: 0;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: var(--awd-radius-md);
  background: var(--awd-accent);
  color: var(--awd-text-on-accent);
  font-family: var(--awd-font-sans);
  font-size: var(--awd-font-size-body);
  font-weight: 600;
  cursor: pointer;
}
.awd-consent-accept:hover {
  background: var(--awd-accent-hover);
}
.awd-consent-accept:disabled {
  opacity: 0.6;
  cursor: default;
}
.awd-consent-link {
  border: 0;
  padding: 0;
  background: none;
  color: var(--awd-accent);
  font: inherit;
  font-size: var(--awd-font-size-body);
  cursor: pointer;
}
.awd-consent-error {
  font-size: var(--awd-font-size-body);
  color: var(--awd-danger-text);
}
</style>
