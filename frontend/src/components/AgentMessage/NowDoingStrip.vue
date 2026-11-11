<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <!-- 「正在做什么」常驻条（用户控制 6）：轮次在跑时钉在输入框上方的一行。
       只陈述、不打断：不弹窗、不抢焦点、不进 aria-live（每秒一跳的秒数会把读屏刷爆）。
       停止键与输入区那颗是同一条路（父组件接 @stop → handleAbort）。 -->
  <div v-if="active" class="now-doing-strip" :aria-label="t('chat.nowDoing')">
    <span class="now-doing-dot" aria-hidden="true"></span>
    <span class="now-doing-activity">{{ activity }}</span>
    <span v-if="progress" class="now-doing-progress">{{ progress }}</span>
    <span v-if="currentStep" class="now-doing-step">{{ currentStep }}</span>
    <span class="now-doing-elapsed">{{ elapsed }}</span>
    <button type="button" class="now-doing-stop" :title="t('chat.nowDoingStop')" :aria-label="t('chat.nowDoingStop')" @click="$emit('stop')">
      <span class="now-doing-stop-icon" aria-hidden="true"></span>
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { t } from '@/i18n'
import { toolDisplayName } from '@/utils/toolDisplayNames.js'

const props = defineProps({
  // 轮次在跑（ChatInterface.isStreaming，单一来源）
  active: { type: Boolean, default: false },
  // 当前在写的助手气泡；切回后台仍在跑的会话时可能暂时没有
  bubble: { type: Object, default: null }
})
defineEmits(['stop'])

// 秒表从本条出现时起算：插话会另起助手段，按气泡算会在用户插话那一刻归零。
const since = ref(0)
const now = ref(Date.now())
let ticker = null
const stopTicker = () => { if (ticker) { clearInterval(ticker); ticker = null } }
watch(() => props.active, (on) => {
  stopTicker()
  if (!on) return
  since.value = now.value = Date.now()
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
onBeforeUnmount(stopTicker)

// 与 RootBubble.runningTool 同一判据：items 只追加不重排，倒着找第一个 loading 的工具。
const runningTool = computed(() => {
  const procs = (props.bubble && props.bubble.processes) || []
  for (let p = procs.length - 1; p >= 0; p--) {
    const items = procs[p].items || []
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].type === 'tool' && items[i].status === 'loading') return items[i]
    }
  }
  return null
})

const activity = computed(() => runningTool.value
  ? (toolDisplayName(runningTool.value.code) || t('chat.toolCallFallback'))
  : t('chat.nowDoingThinking'))

const todos = computed(() => (props.bubble && Array.isArray(props.bubble.planTodos)) ? props.bubble.planTodos : [])
const progress = computed(() => todos.value.length
  ? t('chat.nowDoingProgress', { done: todos.value.filter(todo => todo.status === 'completed').length, total: todos.value.length })
  : '')
const currentStep = computed(() => {
  const todo = todos.value.find(item => item.status === 'in_progress')
  return todo ? (todo.activeForm || todo.content || '') : ''
})

const elapsed = computed(() => {
  const total = Math.max(0, Math.floor((now.value - since.value) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
})
</script>

<style scoped>
.now-doing-strip {
  display: flex;
  align-items: center;
  gap: var(--awd-space-2);
  min-width: 0;
  margin: 0 0 var(--awd-space-1);
  padding-block: 2px;
  padding-inline: var(--awd-space-2) 2px;
  font-size: var(--awd-panel-fs-meta);
  line-height: 1.5;
  color: var(--awd-text-2);
  text-align: start;
}
.now-doing-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--awd-accent);
  animation: now-doing-pulse 1.6s ease-in-out infinite;
}
@keyframes now-doing-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .now-doing-dot { animation: none; } }
.now-doing-activity { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--awd-text); }
.now-doing-progress { flex-shrink: 0; font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
.now-doing-step { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.now-doing-elapsed { flex-shrink: 0; margin-inline-start: auto; font-variant-numeric: tabular-nums; color: var(--awd-text-3); direction: ltr; unicode-bidi: isolate; }
.now-doing-step + .now-doing-elapsed { margin-inline-start: 0; }
.now-doing-stop {
  appearance: none;
  -webkit-appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-sm);
  background: transparent;
  color: var(--awd-text-2);
  cursor: pointer;
  line-height: 1;
}
.now-doing-stop::after { border: 0; }
.now-doing-stop:hover { color: var(--awd-danger); border-color: var(--awd-danger); }
.now-doing-stop:focus-visible { outline: var(--awd-focus-width) solid var(--awd-accent); outline-offset: var(--awd-focus-offset); }
.now-doing-stop-icon { width: 8px; height: 8px; border-radius: 1px; background: currentColor; }
</style>
