<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <SettingsSection title="扫描件识别" description="本地识别不可用时，按你的选择继续任务。此设置仅对当前账号生效。">
    <text v-if="error" role="alert">{{ error }}</text>
    <text v-if="notice">{{ notice }}</text>
    <view class="ocr-settings-actions">
      <button v-for="option in options" :key="option.value" :disabled="busy || !version" :class="{ selected: choice === option.value }" @click="save(option.value)">{{ option.label }}</button>
      <button v-if="error" :disabled="busy" @click="load">重新加载</button>
    </view>
    <text v-if="saved" role="status">已保存</text>
  </SettingsSection>
</template>
<script setup>
import { ref, onMounted } from 'vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import { getOcrRouting, setOcrRouting } from '@/services/api.js'
const choice = ref('ask'), notice = ref(''), version = ref(''), error = ref(''), busy = ref(false), saved = ref(false)
const options = [{ value: 'ask', label: '每次询问' }, { value: 'cloud', label: '允许云端识别并计费' }, { value: 'local', label: '准备本地引擎' }]
async function load() {
  busy.value = true; error.value = ''
  try { const response = await getOcrRouting(); const data = response.data || response; choice.value = data.choice; notice.value = data.notice; version.value = data.version }
  catch (e) { error.value = e.message || '读取失败' }
  finally { busy.value = false }
}
async function save(value) {
  busy.value = true; error.value = ''; saved.value = false
  try { await setOcrRouting({ choice: value, version: version.value }); choice.value = value; saved.value = true }
  catch (e) { error.value = e.message || '保存失败' }
  finally { busy.value = false }
}
onMounted(load)
</script>
<style scoped>
.ocr-settings-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.ocr-settings-actions button { font-size: 13px; margin: 0; }
.ocr-settings-actions .selected { border-color: var(--awd-accent, #315f54); color: var(--awd-accent, #315f54); }
</style>
