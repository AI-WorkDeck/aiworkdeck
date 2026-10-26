<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="ocr-choice" role="dialog" :aria-label="t('admin.ocrChoiceAriaLabel')">
    <text class="ocr-title">{{ t('admin.ocrChoiceTitle') }}</text>
    <text>{{ state.reason }}</text>
    <text>{{ state.notice }}</text>
    <text>{{ t('admin.ocrChoiceLocalHint') }}</text>
    <text v-if="state.error" class="ocr-error" role="alert">{{ state.error }}</text>
    <view v-if="state.phase === 'choose'">
      <button class="ocr-remember" type="button" role="checkbox" :aria-checked="remember" @click="remember = !remember"><view class="ocr-check" :class="{ checked: remember }" />{{ t('admin.ocrChoiceRemember') }}</button>
      <view class="ocr-actions">
        <button @click="$emit('choose', 'cloud', remember)">{{ t('admin.ocrChoiceCloudBtn') }}</button>
        <button :disabled="!state.localAvailable" @click="$emit('choose', 'local', remember)">{{ t('admin.ocrChoiceLocalBtn') }}</button>
      </view>
    </view>
    <text v-else-if="state.phase !== 'cancelFailed'" role="status">{{ state.phase === 'saving' ? t('admin.ocrChoiceSaving') : t('admin.ocrChoiceConfirmed') }}</text>
    <button class="ocr-cancel" @click="$emit('cancel')">{{ state.phase === 'cancelFailed' ? t('admin.ocrChoiceRetryCancel') : t('admin.ocrChoiceCancel') }}</button>
  </view>
</template>
<script setup>
import { ref } from 'vue'
import { t } from '@/i18n'
defineProps({ state: { type: Object, required: true } })
defineEmits(['choose', 'cancel'])
const remember = ref(false)
</script>
<style scoped>
.ocr-choice { padding: 18px; margin: 10px; border: 1px solid var(--awd-border, #d8d5ca); border-radius: 8px; background: var(--awd-surface, #f5f3ed); display: flex; flex-direction: column; gap: 10px; font-size: 13px; line-height: 1.6; font-weight: 400; color: var(--awd-text); }
.ocr-title { font-size: 15px; font-weight: 600; }
.ocr-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ocr-actions button, .ocr-cancel { font-size: 13px; margin: 0; padding: 7px 12px; border: 1px solid var(--awd-border-strong); border-radius: 5px; background: var(--awd-surface); color: var(--awd-text); line-height: 1.5; cursor: pointer; }
.ocr-actions button:first-child { background: var(--awd-accent); color: var(--awd-text-on-accent); }
.ocr-actions button:disabled { opacity: .5; cursor: not-allowed; }
.ocr-remember { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; padding: 0; font-size: 13px; font-weight: 400; background: transparent; color: var(--awd-text); border: none; line-height: 1.5; cursor: pointer; }
.ocr-remember::after { border: none; }
.ocr-check { width: 15px; height: 15px; border: 1px solid var(--awd-border-strong); border-radius: 3px; flex-shrink: 0; }
.ocr-check.checked { background: var(--awd-accent); border-color: var(--awd-accent); }
.ocr-error { color: var(--awd-danger, #b33333); }
.ocr-cancel { align-self: flex-start; }
</style>
