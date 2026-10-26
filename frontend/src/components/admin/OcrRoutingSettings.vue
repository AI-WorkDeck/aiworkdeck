<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <SettingsSection :title="t('admin.ocrSettingsTitle')" :description="t('admin.ocrSettingsDesc')">
    <text v-if="error" role="alert">{{ error }}</text>
    <text v-if="notice">{{ notice }}</text>
    <view class="ocr-settings-actions">
      <button v-for="option in options" :key="option.value" :disabled="busy || !version" :class="{ selected: choice === option.value }" @click="save(option.value)">{{ option.label }}</button>
      <button v-if="error" :disabled="busy" @click="load">{{ t('admin.ocrSettingsReload') }}</button>
    </view>
    <text v-if="saved" role="status">{{ t('admin.ocrSettingsSaved') }}</text>
  </SettingsSection>
</template>
<script setup>
import { ref, computed, onMounted } from 'vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import { getOcrRouting, setOcrRouting } from '@/services/api.js'
import { t } from '@/i18n'
const choice = ref('ask'), notice = ref(''), version = ref(''), error = ref(''), busy = ref(false), saved = ref(false)
const options = computed(() => [
  { value: 'ask', label: t('admin.ocrSettingsOptAsk') },
  { value: 'cloud', label: t('admin.ocrSettingsOptCloud') },
  { value: 'local', label: t('admin.ocrSettingsOptLocal') },
])
async function load() {
  busy.value = true; error.value = ''
  try { const response = await getOcrRouting(); const data = response.data || response; choice.value = data.choice; notice.value = data.notice; version.value = data.version }
  catch (e) { error.value = e.message || t('admin.ocrSettingsLoadFailed') }
  finally { busy.value = false }
}
async function save(value) {
  busy.value = true; error.value = ''; saved.value = false
  try { await setOcrRouting({ choice: value, version: version.value }); choice.value = value; saved.value = true }
  catch (e) { error.value = e.message || t('admin.ocrSettingsSaveFailed') }
  finally { busy.value = false }
}
onMounted(load)
</script>
<style scoped>
.ocr-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.ocr-settings-actions button { font-size: 13px; margin: 0; }
.ocr-settings-actions .selected { border-color: var(--awd-accent, #315f54); color: var(--awd-accent, #315f54); }
</style>
