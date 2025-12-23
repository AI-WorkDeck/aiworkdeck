<template>
  <div class="root-bubble-wrapper">
      
    <!-- GHOST STATE: Only Show Thinking if not ready -->
    <div v-if="!isReady && bubble.thinking.status === 'thinking'" class="ghost-thinking">
        <ThinkingCard 
           :status="bubble.thinking.status" 
           :duration="bubble.thinking.duration" 
           :content="bubble.thinking.content" 
           :start-time="bubble.thinking.startTime"
           variant="card"
        />
    </div>

    <!-- ACTIVE STATE: Full Card -->
    <div v-else class="active-bubble-wrapper">
        <!-- 1. Thinking Card (Moved Out as Ghost) -->
        <div class="ghost-thinking-wrapper">
             <ThinkingCard 
               :status="bubble.thinking.status" 
               :duration="bubble.thinking.duration" 
               :content="bubble.thinking.content" 
               :start-time="bubble.thinking.startTime"
               variant="ghost"
            />
        </div>

        <div class="root-bubble-container">
            <!-- 2. Title -->
            <TitleCard v-if="bubble.title" :title="bubble.title" />

            <!-- 3. Process Stream -->
            <div class="process-stream">
               <ProcessCard 
                 v-for="proc in bubble.processes" 
                 :key="proc.id" 
                 :process="proc" 
               />
            </div>

            <!-- 4. Artifacts -->
            <div class="artifacts-stream" v-if="bubble.artifacts.length > 0">
               <div v-for="art in bubble.artifacts" :key="art.id" class="artifact-wrapper">
                  <ArtifactCard 
                    :artifact="art" 
                    :id="art.id"
                    :type="art.type"
                    :status="art.status"
                    :file-name="art.fileName"
                    :data="art.data"
                    @open-tab="$emit('open-artifact-tab', $event)"
                    @approve="$emit('approve', $event)"
                  />
               </div>
            </div>

            <!-- 5. Main Content (The Answer) -->
            <div v-if="bubble.content" class="main-content">
               <MarkdownPreview :content="bubble.content" />
            </div>

            <!-- 6. Walkthrough (Summary) - Temporarily hidden as per user request -->
            <!-- <WalkthroughCard 
              v-if="bubble.walkthrough"
              :content="bubble.walkthrough" 
              :is-streaming="bubble.isStreaming" 
              :show-header="true"
              @open-tab="$emit('open-artifact-tab', $event)"
            /> -->
        </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ThinkingCard from './ThinkingCard.vue'
import TitleCard from './TitleCard.vue'
import ProcessCard from './ProcessCard.vue'
import WalkthroughCard from './WalkthroughCard.vue'
import ArtifactCard from '../ArtifactCard.vue'
import MarkdownPreview from '../MarkdownPreview.vue'

const props = defineProps({
  bubble: { type: Object, required: true }
})

defineEmits(['open-artifact-tab', 'approve'])

const isReady = computed(() => {
    // Show full card if we have a Title OR Processes OR Main Content
    // If only "Thinking", remain in Ghost state (unless it's done thinking and has no other content? No, unlikely)
    return !!(props.bubble.title || props.bubble.processes.length > 0 || props.bubble.content)
})
</script>

<style scoped>
.root-bubble-wrapper {
    width: 100%;
}

.ghost-thinking {
    /* Floating style, minimal */
    max-width: 100%;
    margin-left: 0;
    padding: 0;
}

.active-bubble-wrapper {
    width: 100%;
}

.ghost-thinking-wrapper {
    /* 左对齐，无缩进 */
    margin-left: 0;
    padding: 0;
    margin-bottom: 8px; /* 稍微增加与下方内容的间距 */
}

.root-bubble-container {
  display: flex;
  flex-direction: column;
  background: #ffffff;
  /* 移除 heavy border, 使用更轻透的风格 */
  border: 1px solid #E9ECEF; /* Gray-Light */
  border-radius: 8px; /* 适中圆角 */
  overflow: hidden;
  /* box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); 移除阴影，追求扁平化 */
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  word-wrap: break-word;
  overflow-wrap: break-word;
  margin-bottom: 24px; /* 增加消息间距，显得更透气 */
  user-select: text;
  -webkit-user-select: text;
}

/* Connect artifacts visually */
.artifact-wrapper {
  border-bottom: 1px solid #f1f5f9;
}

.main-content {
  padding: 12px 16px; /* 恢复适度内边距，太少会显得拥挤 */
  font-size: 14px; /* 恢复标准字体大小，太小看不清 */
  line-height: 1.6;
  color: #2C3338; /* Gray-Dark */
}

.main-content:deep(p) {
  margin: 0 0 10px 0;
}

.main-content:deep(p:last-child) {
  margin-bottom: 0;
}

.main-content:deep(ul), .main-content:deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}

/* Inline Code Style - King Mint Tint */
.main-content:deep(code) {
  background: rgba(91, 209, 151, 0.12); /* King Mint Tint */
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 85%;
  color: #1A5336; /* King Forest */
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
}

/* Block Code Style */
.main-content:deep(pre) {
  background: #F8F9FA; /* Gray-Pale */
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  border: 1px solid #E9ECEF;
  font-size: 12px;
  margin: 10px 0;
}

.main-content:deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}

/* Override MarkdownPreview default padding in main-content */
.main-content :deep(.markdown-preview) {
  padding: 0 !important;
  background: transparent !important;
  min-height: auto;
  height: auto;
  margin: 0;
  overflow: visible;
}

.main-content :deep(.markdown-body) {
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
  padding: 0;
  color: #2C3338;
}

/* Headings */
.main-content :deep(.markdown-body h1),
.main-content :deep(.markdown-body h2),
.main-content :deep(.markdown-body h3) {
  margin-top: 16px !important;
  margin-bottom: 8px !important;
  font-weight: 600;
  color: #1A5336; /* King Forest for headings */
}
</style>
