<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="tmeet-transcript-pane">
    <!-- 顶部工具栏与会议概要 -->
    <view class="tmeet-pane-header">
      <view class="tmeet-pane-title-row">
        <text class="tmeet-pane-title">{{ record ? record.subject : (meeting ? meeting.subject : '') }}</text>
        <view class="tmeet-pane-actions">
          <button class="tmeet-pane-btn primary" @tap="onGenerateMinutes">
            <text class="btn-icon">✦</text>
            <text>{{ $t('tmeet.aiMinutes') }}</text>
          </button>
          <button class="tmeet-pane-btn accent" @tap="onGenerateTodos">
            <text class="btn-icon">✓</text>
            <text>{{ $t('tmeet.aiTodos') }}</text>
          </button>
          <button class="tmeet-pane-btn" :disabled="exporting" @tap="onExportDoc">
            <text>{{ exporting ? $t('tmeet.exportingDoc') : $t('tmeet.exportDoc') }}</text>
          </button>
          <button class="tmeet-pane-btn" @tap="onCopyTranscript">
            <text>{{ copied ? $t('tmeet.copied') : $t('tmeet.copyTranscript') }}</text>
          </button>
        </view>
      </view>

      <view class="tmeet-pane-meta-row">
        <view v-if="record && record.meetingCode" class="tmeet-meta-chip">
          <text class="chip-label">{{ $t('tmeet.meetingCode') }}:</text>
          <text class="chip-val">{{ record.meetingCode }}</text>
        </view>
        <view v-if="record && record.startTime" class="tmeet-meta-chip">
          <text class="chip-val">{{ formatTime(record.startTime) }}</text>
        </view>
        <view v-if="record && record.duration" class="tmeet-meta-chip">
          <text class="chip-val">{{ record.duration }}</text>
        </view>
        <view v-if="speakersList.length > 0" class="tmeet-meta-chip">
          <text class="chip-label">{{ $t('tmeet.speakers') }}:</text>
          <text class="chip-val">{{ speakersList.join('、') }}</text>
        </view>
      </view>

      <!-- 视图分段切换 -->
      <view class="tmeet-section-tabs">
        <view
          class="tmeet-tab-item"
          :class="{ active: activeSection === 'transcript' }"
          @tap="activeSection = 'transcript'"
        >
          <text>{{ $t('tmeet.tabSectionTranscript') }}</text>
          <text class="tmeet-count-pill">{{ paragraphs.length }}</text>
        </view>
        <view
          class="tmeet-tab-item"
          :class="{ active: activeSection === 'smart-minutes' }"
          @tap="activeSection = 'smart-minutes'"
        >
          <text>{{ $t('tmeet.tabSectionSmartMinutes') }}</text>
          <text v-if="record && record.smartMinutesText" class="tmeet-dot-pill"></text>
        </view>
      </view>
    </view>

    <!-- 主体内容区域 -->
    <view class="tmeet-pane-body">
      <!-- 逐字稿时间轴 -->
      <view v-if="activeSection === 'transcript'" class="tmeet-timeline-container">
        <view class="tmeet-search-bar">
          <input
            class="tmeet-timeline-search"
            v-model="searchQuery"
            :placeholder="$t('tmeet.tabSearchPlaceholder')"
            :aria-label="$t('tmeet.tabSearchPlaceholder')"
          />
        </view>

        <scroll-view class="tmeet-timeline-scroll" scroll-y>
          <view v-if="filteredParagraphs.length === 0" class="tmeet-pane-empty">
            <text>{{ searchQuery ? $t('tmeet.noMatchedSpeech') : $t('tmeet.noTranscript') }}</text>
          </view>

          <view class="tmeet-timeline">
            <view
              v-for="(p, idx) in filteredParagraphs"
              :key="idx"
              class="tmeet-timeline-item"
            >
              <view class="tmeet-time-col">
                <text class="tmeet-time-pill">{{ p.startTime || '00:00' }}</text>
              </view>
              <view class="tmeet-speaker-col">
                <view
                  class="tmeet-avatar"
                  :style="{ backgroundColor: getSpeakerColor(p.speakerName) }"
                >
                  {{ getSpeakerInitial(p.speakerName) }}
                </view>
              </view>
              <view class="tmeet-content-col">
                <view class="tmeet-speaker-name">{{ p.speakerName || $t('tmeet.defaultSpeaker') }}</view>
                <view class="tmeet-bubble">
                  <text class="tmeet-text">{{ p.text }}</text>
                </view>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 智能纪要视图 -->
      <scroll-view v-else-if="activeSection === 'smart-minutes'" class="tmeet-smart-scroll" scroll-y>
        <view v-if="!record || !record.smartMinutesText" class="tmeet-pane-empty">
          <text>{{ $t('tmeet.noSmartMinutes') }}</text>
        </view>
        <view v-else class="tmeet-smart-content">
          <view class="tmeet-markdown-block">
            <text class="tmeet-markdown-text">{{ record.smartMinutesText }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import {
  getTmeetMeetingDetail,
  exportTmeetToDoc,
  getTmeetMinutesPrompt,
  getTmeetTodosPrompt
} from '@/services/api.js'

export default {
  name: 'TencentMeetingTranscriptPane',
  props: {
    meeting: {
      type: Object,
      default: () => ({})
    },
    projectId: {
      type: [Number, String],
      default: null
    }
  },
  emits: ['generate-minutes', 'generate-todos'],
  data() {
    return {
      record: null,
      loading: false,
      activeSection: 'transcript',
      searchQuery: '',
      exporting: false,
      copied: false,
      colorPalette: [
        'var(--awd-accent)', 'var(--awd-info-text)', 'var(--awd-warning-text)', 'var(--awd-text-2)'
      ]
    }
  },
  computed: {
    paragraphs() {
      if (!this.record || !this.record.transcriptJson) return []
      try {
        const list = JSON.parse(this.record.transcriptJson)
        return Array.isArray(list) ? list : []
      } catch (e) {
        return []
      }
    },
    filteredParagraphs() {
      if (!this.searchQuery) return this.paragraphs
      const q = this.searchQuery.trim().toLowerCase()
      return this.paragraphs.filter(p =>
        (p.text && p.text.toLowerCase().includes(q)) ||
        (p.speakerName && p.speakerName.toLowerCase().includes(q))
      )
    },
    speakersList() {
      if (!this.record || !this.record.speakersJson) return []
      try {
        const list = JSON.parse(this.record.speakersJson)
        return Array.isArray(list) ? list : []
      } catch (e) {
        return []
      }
    }
  },
  watch: {
    meeting: {
      immediate: true,
      handler(newVal) {
        if (newVal && newVal.id) {
          this.loadDetail(newVal.id)
        }
      }
    }
  },
  methods: {
    async loadDetail(recordId) {
      this.loading = true
      try {
        const res = await getTmeetMeetingDetail(recordId)
        if (res && res.data) {
          this.record = res.data
        } else {
          this.record = this.meeting
        }
      } catch (e) {
        console.warn('获取会议逐字稿详情失败:', e)
        this.record = this.meeting
      } finally {
        this.loading = false
      }
    },

    async onGenerateMinutes() {
      const rec = this.record || this.meeting
      try {
        const res = await getTmeetMinutesPrompt(rec.id)
        if (typeof res?.data?.prompt !== 'string' || !res.data.prompt.trim()) throw new Error('missing prompt')
        this.$emit('generate-minutes', { prompt: res.data.prompt, meeting: rec })
      } catch (e) {
        uni.showToast({ title: this.$t('tmeet.prepareFailed'), icon: 'none' })
      }
    },

    async onGenerateTodos() {
      const rec = this.record || this.meeting
      try {
        const res = await getTmeetTodosPrompt(rec.id)
        if (typeof res?.data?.prompt !== 'string' || !res.data.prompt.trim()) throw new Error('missing prompt')
        this.$emit('generate-todos', { prompt: res.data.prompt, meeting: rec })
      } catch (e) {
        uni.showToast({ title: this.$t('tmeet.prepareFailed'), icon: 'none' })
      }
    },

    async onExportDoc() {
      const rec = this.record || this.meeting
      if (!this.projectId) {
        uni.showToast({ title: this.$t('tmeet.openProjectBeforeExport'), icon: 'none' })
        return
      }
      this.exporting = true
      try {
        const res = await exportTmeetToDoc(rec.id, this.projectId)
        const name = (res && res.data && res.data.fileName) || rec.subject
        uni.showToast({
          title: this.$t('tmeet.exportDocSuccess', { name }),
          icon: 'success'
        })
      } catch (e) {
        uni.showToast({ title: this.$t('tmeet.exportDocFailed'), icon: 'none' })
      } finally {
        this.exporting = false
      }
    },

    onCopyTranscript() {
      if (!this.paragraphs.length) return
      const text = this.paragraphs
        .map(p => `[${p.startTime}] ${p.speakerName}：${p.text}`)
        .join('\n\n')
      uni.setClipboardData({
        data: text,
        success: () => {
          this.copied = true
          uni.showToast({ title: this.$t('tmeet.copied'), icon: 'none' })
          setTimeout(() => { this.copied = false }, 2000)
        }
      })
    },

    formatTime(isoStr) {
      if (!isoStr) return ''
      return isoStr.replace('T', ' ').substring(0, 16)
    },

    getSpeakerInitial(name) {
      if (!name) return '?'
      return name.trim().substring(0, 1).toUpperCase()
    },

    getSpeakerColor(name) {
      if (!name) return this.colorPalette[0]
      let hash = 0
      for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i)
        hash |= 0
      }
      const idx = Math.abs(hash) % this.colorPalette.length
      return this.colorPalette[idx]
    }
  }
}
</script>

<style scoped>
.tmeet-transcript-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--awd-surface);
  color: var(--awd-text);
  box-sizing: border-box;
  overflow: hidden;
}

.tmeet-pane-header {
  padding: var(--awd-space-4) var(--awd-space-5) 0;
  border-bottom: 1px solid var(--awd-border);
  background: var(--awd-surface);
  flex-shrink: 0;
}

.tmeet-pane-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--awd-panel-pad-x);
}

.tmeet-pane-title {
  font-size: var(--awd-font-size-title);
  font-weight: 600;
  color: var(--awd-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: var(--awd-space-4);
}

.tmeet-pane-actions {
  display: flex;
  gap: var(--awd-space-2);
  flex-shrink: 0;
}

.tmeet-pane-btn {
  min-height: var(--awd-control-height);
  font-size: var(--awd-panel-fs);
  padding: 5px var(--awd-space-3);
  border-radius: var(--awd-radius-md);
  border: 1px solid var(--awd-border);
  background: var(--awd-surface);
  color: var(--awd-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--awd-space-1);
  transition: background var(--awd-motion-fast), color var(--awd-motion-fast);
}

.tmeet-pane-btn:hover {
  background: var(--awd-surface);
  border-color: var(--awd-text-2);
}

.tmeet-pane-btn.primary {
  background: var(--awd-accent);
  border-color: var(--awd-accent);
  color: var(--awd-text-on-accent);
}

.tmeet-pane-btn.primary:hover {
  background: var(--awd-accent-hover);
}

.tmeet-pane-btn.accent {
  background: var(--awd-accent);
  border-color: var(--awd-accent);
  color: var(--awd-text-on-accent);
}

.tmeet-pane-btn.accent:hover {
  background: var(--awd-accent-hover);
}

.btn-icon {
  font-size: var(--awd-font-size-body);
}

.tmeet-pane-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--awd-panel-pad-x);
  margin-bottom: var(--awd-panel-gap-lg);
}

.tmeet-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--awd-space-1);
  background: var(--awd-surface-2);
  padding: 2px var(--awd-space-2);
  border-radius: var(--awd-radius-sm);
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
}

.chip-label {
  color: var(--awd-text-2);
}

.chip-val {
  font-weight: 500;
}

.tmeet-section-tabs {
  display: flex;
  gap: var(--awd-space-5);
}

.tmeet-tab-item {
  display: flex;
  align-items: center;
  gap: calc(var(--awd-space-3) / 2);
  padding: var(--awd-space-2) var(--awd-space-1);
  font-size: var(--awd-font-size-body);
  font-weight: 500;
  color: var(--awd-text-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: background var(--awd-motion-fast), color var(--awd-motion-fast);
}

.tmeet-tab-item:hover {
  color: var(--awd-text);
}

.tmeet-tab-item.active {
  color: var(--awd-accent);
  border-bottom-color: var(--awd-accent);
}

.tmeet-count-pill {
  font-size: var(--awd-panel-fs-meta);
  background: var(--awd-border);
  color: var(--awd-text-2);
  padding: 1px calc(var(--awd-space-3) / 2);
  border-radius: var(--awd-radius-md);
}

.tmeet-dot-pill {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awd-accent);
}

.tmeet-pane-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--awd-surface);
}

.tmeet-timeline-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tmeet-search-bar {
  padding: var(--awd-space-3) var(--awd-space-5);
  background: var(--awd-surface);
  border-bottom: 1px solid var(--awd-border);
}

.tmeet-timeline-search {
  height: var(--awd-control-height);
  min-height: var(--awd-control-height);
  box-sizing: border-box;
  width: 100%;
  max-width: 480px;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  padding: calc(var(--awd-space-3) / 2) var(--awd-space-3);
  font-size: var(--awd-panel-fs);
  box-sizing: border-box;
}

.tmeet-timeline-scroll {
  flex: 1;
  overflow-y: auto;
  padding: var(--awd-space-4) var(--awd-space-5);
  box-sizing: border-box;
}

.tmeet-pane-empty {
  text-align: center;
  padding: 60px var(--awd-space-5);
  color: var(--awd-text-2);
  font-size: var(--awd-font-size-body);
}

.tmeet-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-4);
  max-width: 900px;
  margin: 0 auto;
}

.tmeet-timeline-item {
  display: flex;
  gap: var(--awd-space-3);
  align-items: flex-start;
}

.tmeet-time-col {
  width: 52px;
  flex-shrink: 0;
  padding-top: var(--awd-space-1);
}

.tmeet-time-pill {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  font-family: monospace;
}

.tmeet-speaker-col {
  flex-shrink: 0;
}

.tmeet-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--awd-text-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--awd-panel-fs);
  font-weight: 600;
}

.tmeet-content-col {
  flex: 1;
}

.tmeet-speaker-name {
  font-size: var(--awd-panel-fs);
  font-weight: 600;
  color: var(--awd-text-2);
  margin-bottom: var(--awd-space-1);
}

.tmeet-bubble {
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  padding: var(--awd-panel-pad-x) var(--awd-panel-gap-lg);
  display: inline-block;
  max-width: 100%;
}

.tmeet-text {
  font-size: var(--awd-font-size-body);
  line-height: 1.6;
  color: var(--awd-text);
  word-break: break-word;
}

.tmeet-smart-scroll {
  flex: 1;
  overflow-y: auto;
  padding: var(--awd-space-6);
  box-sizing: border-box;
}

.tmeet-smart-content {
  max-width: 800px;
  margin: 0 auto;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  padding: var(--awd-space-6);
}

.tmeet-markdown-block {
  line-height: 1.8;
  font-size: var(--awd-font-size-body);
  color: var(--awd-text);
  white-space: pre-wrap;
}
</style>
