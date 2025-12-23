<template>
  <div class="process-card" :class="{ 'is-expanded': (isExpanded || isHeadless), 'is-system-actions': isSystemActions, 'headless-process': isHeadless }">
    <div class="process-header" @click="toggle" v-if="!isHeadless">
      <div class="left">
        <!-- Status Dot or Icon -->
        <span class="status-indicator" :class="{ 'thinking': !isFinished }"></span>
        <span class="title">{{ processTitle }}</span>
      </div>
      <div class="right">
        <span class="chevron-icon"></span>
      </div>
    </div>

    <div class="process-body" v-if="isExpanded || isHeadless">
      <!-- Items List -->
      <div class="items-list" v-if="process.items && process.items.length > 0">
        <div v-for="(item, idx) in process.items" :key="idx" class="process-item">
            
            <!-- CASE 1: Normal Step -->
            <div v-if="item.type === 'step'" class="step-row">
                <span class="step-check" :class="{ 'done': item.status !== 'doing' }"></span>
                <span class="step-text">{{ item.text || 'Working...' }}</span>
            </div>

            <!-- CASE 2: Nested Thinking -->
            <div v-else-if="item.type === 'thinking'" class="thinking-row">
                <ThinkingCard 
                   variant="inline"
                   :status="item.status"
                   :content="item.content"
                   :duration="item.duration || 0" 
                   :start-time="item.startTime"
                />
            </div>

            <!-- CASE 3: Tool Execution -->
            <div v-else-if="item.type === 'tool'" class="tool-row">
                <div class="tool-header">
                     <!-- Removed tool-icon -->
                     <span class="tool-name">{{ formatToolName(item.code) }}</span>
                </div>
                <!-- Status aligned to right already -->
                <div class="tool-status">
                     <span v-if="item.status === 'loading'" class="status-loading">执行中...</span>
                     <span v-else-if="item.status === 'success'" class="status-success">成功</span>
                     <span v-else class="status-error">失败</span>
                </div>
            </div>

        </div>
      </div>
      
      <!-- Fallback for legacy 'steps' array if 'items' is empty -->
      <div class="steps-list" v-else-if="process.steps && process.steps.length > 0">
         <div class="step-item" v-for="(step, idx) in process.steps" :key="idx">
            <span class="step-check"></span>
            <span class="step-text">{{ step.text }}</span>
         </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import ThinkingCard from './ThinkingCard.vue'

const props = defineProps({
  process: { type: Object, required: true }
})

const isExpanded = ref(false)

const isSystemActions = computed(() => {
  return props.process.title === 'System Actions'
})

// Headless if title is exactly "Processing..." (the default generic title)
const isHeadless = computed(() => {
    return !props.process.title || props.process.title === 'Processing...'
})

const processTitle = computed(() => {
    return props.process.title || 'Processing...'
})

const isFinished = computed(() => {
    return true
})

// Track if user has manually toggled (to prevent auto-expand from overriding)
const userHasToggled = ref(false)

const toggle = () => {
  userHasToggled.value = true
  isExpanded.value = !isExpanded.value
}

// Auto-expand when first items arrive, but respect user manual toggle

watch(() => props.process.items?.length, (newLen, oldLen) => {
    // Only auto-expand if:
    // 1. Items were just added (went from 0 or undefined to > 0)
    // 2. User hasn't manually toggled this card
    if (newLen > 0 && (!oldLen || oldLen === 0) && !userHasToggled.value) {
        isExpanded.value = true
    }
}, { immediate: true })

const formatToolName = (code) => {
    if (!code) return 'Tool Call'
    if (code.includes('read_document')) {
        return 'Reading Document'
    }
    const match = code.match(/^([\w_.]+)\(/)
    return match ? match[1] : (code.length > 40 ? code.substring(0, 37) + '...' : code)
}
</script>

<style scoped>
.process-card {
  border-bottom: 1px solid #E9ECEF; /* Gray-Light */
  background: #fff;
  transition: background 0.15s;
}

/* Headless: Merge visually with previous content */
.process-card.headless-process {
    background: transparent;
    border-bottom: none; /* Remove separator */
    margin-top: -8px; /* Pull up to join previous card visually */
}

.process-card.is-system-actions {
  background: #FAFbfc; /* Very subtle gray */
}

.process-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px; /* 恢复适度内边距 */
  cursor: pointer;
  transition: background 0.15s;
}

.process-header:hover {
  background: #F8F9FA; /* Gray-Pale */
}

.process-card.is-expanded .process-header {
  background: transparent; /* No background when expanded */
}

/* System Actions Header - More Subtle */
.process-card.is-system-actions .process-header {
  padding: 8px 16px;
}
.process-card.is-system-actions .title {
  color: #6C757D; /* Gray-Medium */
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 600;
}
.process-card.is-system-actions .status-indicator {
  background: #CED4DA; /* Gray-Light/Medium */
}

.left {
  display: flex;
  align-items: center;
  gap: 10px; /* 增加间距 */
}

.status-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1A5336; /* King Forest - Default/Processing */
  flex-shrink: 0;
}
.status-indicator.thinking {
  background: #5BD197; /* King Mint - Active */
  box-shadow: 0 0 0 2px rgba(91, 209, 151, 0.2);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse { 
  0% { box-shadow: 0 0 0 0px rgba(91, 209, 151, 0.4); } 
  70% { box-shadow: 0 0 0 4px rgba(91, 209, 151, 0); } 
  100% { box-shadow: 0 0 0 0px rgba(91, 209, 151, 0); } 
}

.title {
  font-size: 13px;
  font-weight: 500;
  color: #2C3338; /* Gray-Dark */
}

/* V-Shape Chevron */
.chevron-icon {
  width: 6px;
  height: 6px;
  border-right: 1.5px solid #ADB5BD; /* Gray-Medium */
  border-bottom: 1.5px solid #ADB5BD;
  transform: rotate(45deg);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: block;
  margin-right: 4px;
}
.process-card.is-expanded .chevron-icon {
  transform: rotate(-135deg);
  margin-top: 4px;
}

.process-body {
  padding: 4px 16px 12px 32px; /* 左侧留出对齐 header title 的空间 (16padding + 10gap + 6indicator) */
}

/* Adjust padding for headless to align with flattened structure */
.process-card.headless-process .process-body {
    padding-top: 0;
    padding-bottom: 8px;
}

/* Process Items */
.process-item {
    margin-bottom: 6px;
}

/* 1. Step Row */
.step-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: #495057; /* Gray-Dark/Medium */
  line-height: 1.5;
}

.step-check {
  width: 6px;
  height: 10px;
  border-right: 1.5px solid #CED4DA;
  border-bottom: 1.5px solid #CED4DA;
  transform: rotate(45deg);
  margin-top: 2px;
  flex-shrink: 0;
}
.step-check.done {
    border-color: #5BD197; /* King Mint */
}

/* 2. Nested Thinking - NO INDENT, NO BORDER */
.thinking-row {
    margin-left: 0; 
    border-left: none;
    padding-left: 0;
    margin-bottom: 8px;
}

/* 3. Tool Row */
.tool-row {
  margin-left: 0; /* Reset margin, handle alignment internally if needed */
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 4px 0;
  font-size: 12px;
  color: #6C757D; /* Gray-Medium */
  
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tool-name {
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
    background: rgba(0,0,0,0.03);
    padding: 2px 6px;
    border-radius: 4px;
}
.tool-status {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap; 
}
.status-loading { color: #1A5336; } /* Forest */
.status-success { color: #5BD197; } /* Mint */
.status-error { color: #E74C3C; } /* Error Red */

/* Legacy Steps Support */
.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
  color: #495057;
}
</style>
