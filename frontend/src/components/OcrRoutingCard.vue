<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="ocr-choice" role="dialog" aria-label="选择扫描件识别方式">
    <text class="ocr-title">继续识别这份扫描件</text>
    <text>{{ state.reason }}</text>
    <text>{{ state.notice }}</text>
    <text>本地识别不上传文档；缺少组件时会引导下载，装好后继续。</text>
    <text v-if="state.error" class="ocr-error" role="alert">{{ state.error }}</text>
    <view v-if="state.phase === 'choose'">
      <button class="ocr-remember" type="button" role="checkbox" :aria-checked="remember" @click="remember = !remember"><view class="ocr-check" :class="{ checked: remember }" />记住我的选择，可在设置中更改</button>
      <view class="ocr-actions">
        <button @click="$emit('choose', 'cloud', remember)">使用云端并继续</button>
        <button :disabled="!state.localAvailable" @click="$emit('choose', 'local', remember)">使用本地并继续</button>
      </view>
    </view>
    <text v-else-if="state.phase !== 'cancelFailed'" role="status">{{ state.phase === 'saving' ? '正在保存选择…' : '已确认，当前回复结束后继续原任务…' }}</text>
    <button class="ocr-cancel" @click="$emit('cancel')">{{ state.phase === 'cancelFailed' ? '重试取消' : '取消' }}</button>
  </view>
</template>
<script setup>
import { ref } from 'vue'
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
