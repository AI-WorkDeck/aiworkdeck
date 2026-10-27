<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="tmeet-panel">
    <!-- 头部连接状态卡片 -->
    <view class="tmeet-card tmeet-auth-card">
      <view class="tmeet-row tmeet-between">
        <view class="tmeet-auth-info">
          <view class="tmeet-status-indicator" :class="{ connected: authStatus.authorized }">
            <text class="tmeet-dot">●</text>
            <text class="tmeet-status-text">
              {{ authStatus.authorized ? $t('tmeet.connected') : $t('tmeet.notConnected') }}
            </text>
          </view>
          <text v-if="authStatus.authorized && authStatus.accountName" class="tmeet-account-name">
            {{ authStatus.accountName }}
          </text>
        </view>
        <view class="tmeet-auth-actions">
          <button
            v-if="!authStatus.authorized"
            class="tmeet-btn tmeet-btn-primary"
            :disabled="loggingIn || authStatus.cliAvailable !== true"
            @tap="onLogin"
          >
            {{ loggingIn ? $t('tmeet.authorizingWait') : $t('tmeet.loginBtn') }}
          </button>
          <button
            v-else
            class="tmeet-btn tmeet-btn-ghost"
            @tap="onLogout"
          >
            {{ $t('tmeet.logoutBtn') }}
          </button>
        </view>
      </view>

      <!-- 扫码 / 授权链接展示（未连接或等待授权中） -->
      <view v-if="authorizing && authStatus.authorizeUrl" class="tmeet-auth-qr-box">
        <text class="tmeet-qr-hint">{{ $t('tmeet.scanQrHint') }}</text>
        <view class="tmeet-qr-actions">
          <button class="tmeet-btn tmeet-btn-sm tmeet-btn-secondary" @tap="openAuthLink">
            {{ $t('tmeet.openAuthUrl') }}
          </button>
          <button class="tmeet-btn tmeet-btn-sm tmeet-btn-secondary" @tap="copyAuthLink">
            {{ $t('tmeet.copyAuthUrl') }}
          </button>
        </view>
      </view>
    </view>

    <text v-if="authStatus.cliAvailable === false" class="tmeet-notice" role="status">{{ $t('tmeet.installRequired') }}</text>
    <view v-if="loadError" class="tmeet-notice" role="alert">
      <text>{{ loadError }}</text>
      <button class="tmeet-btn tmeet-btn-secondary" @tap="refreshAll">{{ $t('tmeet.retry') }}</button>
    </view>

    <!-- 同步配置与操作卡片 -->
    <view class="tmeet-card tmeet-sync-card">
      <view class="tmeet-row tmeet-between tmeet-sync-row">
        <view class="tmeet-label-group">
          <text class="tmeet-label">{{ $t('tmeet.autoSync') }}</text>
        </view>
        <AwdSwitch
          :aria-label="$t('tmeet.autoSync')"
          :checked="syncConfig.autoSync"
          @change="onToggleAutoSync"
        />
      </view>

      <view v-if="syncConfig.autoSync" class="tmeet-row tmeet-between tmeet-interval-row">
        <text class="tmeet-label-sub">{{ $t('tmeet.syncInterval') }}</text>
        <AwdSelect
          :aria-label="$t('tmeet.syncInterval')"
          :range="intervalLabels"
          :value="selectedIntervalIndex"
          @change="onIntervalChange"
        />
      </view>

      <view class="tmeet-sync-action-row">
        <button
          class="tmeet-btn tmeet-btn-primary tmeet-sync-btn"
          :disabled="syncing || !authStatus.authorized"
          @tap="onSyncNow"
        >
          <text v-if="syncing" class="tmeet-spinner">↻</text>
          <text>{{ syncing ? $t('tmeet.syncing') : $t('tmeet.syncNow') }}</text>
        </button>
      </view>
    </view>

    <!-- 会议搜索与列表 -->
    <view class="tmeet-search-box">
      <input
        class="tmeet-search-input"
        v-model="searchKeyword"
        :placeholder="$t('tmeet.searchPlaceholder')"
        :aria-label="$t('tmeet.searchPlaceholder')"
        @confirm="onSearch"
        @input="onSearchInput"
      />
    </view>

    <scroll-view class="tmeet-meeting-list" scroll-y>
      <!-- 空态 -->
      <view v-if="filteredMeetings.length === 0" class="tmeet-empty">
        <text class="tmeet-empty-title">{{ $t('tmeet.noMeetings') }}</text>
        <text class="tmeet-empty-hint">{{ $t('tmeet.noMeetingsHint') }}</text>
      </view>

      <!-- 会议卡片 -->
      <view
        v-for="item in filteredMeetings"
        :key="item.id"
        class="tmeet-card tmeet-meeting-card"
        @tap="onOpenMeeting(item)"
      >
        <view class="tmeet-card-header">
          <text class="tmeet-card-title">{{ item.subject }}</text>
          <view
            class="tmeet-badge"
            :class="{
              'badge-synced': item.status === 'SYNCED',
              'badge-failed': item.status === 'FAILED',
              'badge-none': !item.status
            }"
          >
            {{ getStatusText(item.status) }}
          </view>
        </view>

        <view class="tmeet-card-meta">
          <text v-if="item.meetingCode" class="tmeet-meta-item">
            {{ $t('tmeet.meetingCode') }}: {{ item.meetingCode }}
          </text>
          <text v-if="item.startTime" class="tmeet-meta-item">
            {{ formatTime(item.startTime) }}
          </text>
          <text v-if="item.duration" class="tmeet-meta-item">
            {{ item.duration }}
          </text>
        </view>

        <view v-if="item.speakers" class="tmeet-card-speakers">
          <text class="tmeet-speakers-label">{{ $t('tmeet.speakers') }}:</text>
          <text class="tmeet-speakers-text">{{ parseSpeakers(item.speakersJson) }}</text>
        </view>

        <!-- 卡片操作按钮 -->
        <view class="tmeet-card-actions" @tap.stop>
          <button
            class="tmeet-action-btn primary"
            @tap.stop="onOpenMeeting(item)"
          >
            {{ $t('tmeet.openTranscript') }}
          </button>
          <button
            class="tmeet-action-btn"
            @tap.stop="onGenerateMinutes(item)"
          >
            {{ $t('tmeet.aiMinutes') }}
          </button>
          <button
            class="tmeet-action-btn"
            @tap.stop="onGenerateTodos(item)"
          >
            {{ $t('tmeet.aiTodos') }}
          </button>
          <button
            class="tmeet-action-btn"
            :disabled="exportingId === item.id"
            @tap.stop="onExportDoc(item)"
          >
            {{ $t('tmeet.exportDoc') }}
          </button>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import AwdSwitch from '@/components/AwdSwitch.vue'
import AwdSelect from '@/components/AwdSelect.vue'
import {
  getTmeetAuthStatus,
  loginTmeet,
  logoutTmeet,
  getTmeetSyncConfig,
  updateTmeetSyncConfig,
  syncTmeetMeetings,
  getTmeetMeetings,
  exportTmeetToDoc,
  getTmeetMinutesPrompt,
  getTmeetTodosPrompt
} from '@/services/api.js'

export default {
  name: 'TencentMeetingPanel',
  components: {
    AwdSwitch,
    AwdSelect
  },
  props: {
    projectId: {
      type: [Number, String],
      default: null
    }
  },
  emits: ['open-transcript', 'generate-minutes', 'generate-todos'],
  data() {
    return {
      authStatus: {
        cliAvailable: null,
        authorized: false,
        accountName: '',
        authorizeUrl: ''
      },
      loadError: '',
      loggingIn: false,
      authorizing: false,
      authPollTimer: null,
      syncConfig: {
        autoSync: false,
        syncIntervalMinutes: 30,
        excludeKeywords: ''
      },
      syncing: false,
      meetings: [],
      searchKeyword: '',
      exportingId: null,
      intervalValues: [15, 30, 60, 120]
    }
  },
  computed: {
    intervalLabels() {
      return [
        this.$t('tmeet.interval15m'),
        this.$t('tmeet.interval30m'),
        this.$t('tmeet.interval1h'),
        this.$t('tmeet.interval2h')
      ]
    },
    selectedIntervalIndex() {
      const idx = this.intervalValues.indexOf(this.syncConfig.syncIntervalMinutes)
      return idx >= 0 ? idx : 1
    },
    filteredMeetings() {
      if (!this.searchKeyword) return this.meetings
      const kw = this.searchKeyword.trim().toLowerCase()
      return this.meetings.filter(m =>
        (m.subject && m.subject.toLowerCase().includes(kw)) ||
        (m.meetingCode && m.meetingCode.includes(kw))
      )
    }
  },
  mounted() {
    this.refreshAll()
  },
  beforeUnmount() {
    this.stopAuthPoll()
  },
  methods: {
    async refreshAll() {
      this.loadError = ''
      await Promise.all([
        this.fetchAuthStatus(),
        this.fetchSyncConfig(),
        this.fetchMeetings()
      ])
    },

    async fetchAuthStatus() {
      try {
        const res = await getTmeetAuthStatus()
        if (res && res.data) {
          this.authStatus = {
            ...res.data,
            authorized: res.data.loggedIn === true,
            accountName: res.data.userName || '',
            authorizeUrl: this.authorizing ? this.authStatus.authorizeUrl : ''
          }
        }
      } catch (e) {
        this.loadError = this.$t('tmeet.statusFailed')
      }
    },

    async onLogin() {
      if (this.authStatus.cliAvailable !== true) return
      this.loggingIn = true
      this.loadError = ''
      try {
        const res = await loginTmeet()
        if (res && res.data) {
          const login = res.data
          this.authStatus = { ...this.authStatus, authorizeUrl: login.authorizeUrl || '' }
          if (login.loggedIn === true) {
            await this.fetchAuthStatus()
            await this.fetchMeetings()
          } else if (this.authStatus.authorizeUrl) {
            this.authorizing = true
            this.openAuthLink()
            this.startAuthPoll()
          } else {
            this.loadError = this.$t('tmeet.connectFailed')
          }
        }
      } catch (e) {
        this.loadError = this.$t('tmeet.connectFailed')
      } finally {
        this.loggingIn = false
      }
    },

    openAuthLink() {
      if (!this.authStatus.authorizeUrl) return
      if (typeof window !== 'undefined' && window.open) {
        window.open(this.authStatus.authorizeUrl, '_blank')
      }
    },

    copyAuthLink() {
      if (!this.authStatus.authorizeUrl) return
      uni.setClipboardData({
        data: this.authStatus.authorizeUrl,
        success: () => {
          uni.showToast({ title: this.$t('tmeet.authUrlCopied'), icon: 'none' })
        }
      })
    },

    startAuthPoll() {
      this.stopAuthPoll()
      let counter = 0
      this.authPollTimer = setInterval(async () => {
        counter++
        if (counter > 30) {
          this.stopAuthPoll()
          this.authorizing = false
          return
        }
        await this.fetchAuthStatus()
        if (this.authStatus.authorized) {
          this.stopAuthPoll()
          this.authorizing = false
          uni.showToast({ title: this.$t('tmeet.connected'), icon: 'success' })
          this.fetchMeetings()
        }
      }, 3000)
    },

    stopAuthPoll() {
      if (this.authPollTimer) {
        clearInterval(this.authPollTimer)
        this.authPollTimer = null
      }
    },

    async onLogout() {
      try {
        const res = await logoutTmeet()
        if (res?.data !== true) throw new Error('logout failed')
        this.stopAuthPoll()
        this.authorizing = false
        this.authStatus = { ...this.authStatus, authorized: false, accountName: '', authorizeUrl: '' }
        uni.showToast({ title: this.$t('tmeet.notConnected'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: this.$t('tmeet.disconnectFailed'), icon: 'none' })
      }
    },

    async fetchSyncConfig() {
      try {
        const res = await getTmeetSyncConfig()
        if (res && res.data) {
          this.syncConfig = res.data
        }
      } catch (e) {
        this.loadError = this.$t('tmeet.configFailed')
      }
    },

    async onToggleAutoSync(val) {
      this.syncConfig.autoSync = val
      await this.saveConfig()
    },

    async onIntervalChange(idx) {
      this.syncConfig.syncIntervalMinutes = this.intervalValues[idx] || 30
      await this.saveConfig()
    },

    async saveConfig() {
      try {
        await updateTmeetSyncConfig(this.syncConfig)
      } catch (e) {
        this.loadError = this.$t('tmeet.configFailed')
        await this.fetchSyncConfig()
      }
    },

    async fetchMeetings() {
      try {
        const params = {}
        if (this.projectId) params.projectId = this.projectId
        const res = await getTmeetMeetings(params)
        if (res && res.data) {
          this.meetings = res.data
        }
      } catch (e) {
        this.loadError = this.$t('tmeet.listFailed')
      }
    },

    async onSyncNow() {
      this.syncing = true
      try {
        const options = {}
        if (this.projectId) options.projectId = this.projectId
        const res = await syncTmeetMeetings(options)
        if (res && res.data) {
          const s = res.data
          uni.showToast({
            title: this.$t('tmeet.syncSuccess', { added: s.addedCount, skipped: s.skippedCount }),
            icon: 'none'
          })
        }
        await this.fetchMeetings()
      } catch (e) {
        uni.showToast({ title: this.$t('tmeet.syncFailed'), icon: 'none' })
      } finally {
        this.syncing = false
      }
    },

    onSearch() {
      this.fetchMeetings()
    },

    onSearchInput() {
      // 客户端实时过滤 computed
    },

    onOpenMeeting(item) {
      this.$emit('open-transcript', item)
    },

    async onGenerateMinutes(item) {
      try {
        const res = await getTmeetMinutesPrompt(item.id)
        if (typeof res?.data?.prompt !== 'string' || !res.data.prompt.trim()) throw new Error('missing prompt')
        this.$emit('generate-minutes', { prompt: res.data.prompt, meeting: item })
      } catch (e) {
        this.loadError = this.$t('tmeet.prepareFailed')
      }
    },

    async onGenerateTodos(item) {
      try {
        const res = await getTmeetTodosPrompt(item.id)
        if (typeof res?.data?.prompt !== 'string' || !res.data.prompt.trim()) throw new Error('missing prompt')
        this.$emit('generate-todos', { prompt: res.data.prompt, meeting: item })
      } catch (e) {
        this.loadError = this.$t('tmeet.prepareFailed')
      }
    },

    async onExportDoc(item) {
      if (!this.projectId) {
        uni.showToast({ title: this.$t('tmeet.openProjectBeforeExport'), icon: 'none' })
        return
      }
      this.exportingId = item.id
      try {
        const res = await exportTmeetToDoc(item.id, this.projectId)
        const name = (res && res.data && res.data.fileName) || item.subject
        uni.showToast({
          title: this.$t('tmeet.exportDocSuccess', { name }),
          icon: 'success'
        })
      } catch (e) {
        uni.showToast({ title: this.$t('tmeet.exportDocFailed'), icon: 'none' })
      } finally {
        this.exportingId = null
      }
    },

    getStatusText(status) {
      if (status === 'SYNCED') return this.$t('tmeet.statusSynced')
      if (status === 'FAILED') return this.$t('tmeet.statusNoTranscript')
      return status || this.$t('tmeet.statusPending')
    },

    formatTime(isoStr) {
      if (!isoStr) return ''
      return isoStr.replace('T', ' ').substring(0, 16)
    },

    parseSpeakers(speakersJson) {
      if (!speakersJson) return '-'
      try {
        const list = JSON.parse(speakersJson)
        return Array.isArray(list) ? list.join('、') : String(speakersJson)
      } catch (e) {
        return String(speakersJson)
      }
    }
  }
}
</script>

<style scoped>
.tmeet-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--awd-panel-pad-x);
  box-sizing: border-box;
  background-color: var(--awd-surface);
  color: var(--awd-text);
  font-size: var(--awd-font-size-body);
  overflow: hidden;
}

.tmeet-card {
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--awd-border-subtle);
  border-radius: 0;
  padding: var(--awd-panel-gap) 0;
  margin-bottom: var(--awd-panel-pad-x);
}

.tmeet-row {
  flex-wrap: wrap;
  gap: var(--awd-space-2);
  display: flex;
  align-items: center;
}

.tmeet-between {
  justify-content: space-between;
}

.tmeet-auth-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-1);
}

.tmeet-status-indicator {
  display: flex;
  align-items: center;
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
}

.tmeet-status-indicator.connected {
  color: var(--awd-accent-text);
}

.tmeet-dot {
  font-size: var(--awd-panel-fs);
  margin-right: var(--awd-space-1);
}

.tmeet-account-name {
  overflow-wrap: anywhere;
  font-size: var(--awd-panel-fs);
  font-weight: 500;
  color: var(--awd-text);
}

.tmeet-btn {
  min-height: var(--awd-control-height);
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--awd-panel-fs);
  padding: var(--awd-space-1) var(--awd-panel-pad-x);
  border-radius: var(--awd-radius-md);
  cursor: pointer;
  border: none;
  line-height: 1.5;
  transition: background var(--awd-motion-fast), color var(--awd-motion-fast);
}

.tmeet-btn[disabled] {
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
  border: 1px solid var(--awd-border-subtle);
  cursor: default;
}

.tmeet-btn-primary {
  background: var(--awd-accent);
  color: var(--awd-text-on-accent);
}

.tmeet-btn-primary:hover {
  background: var(--awd-accent-hover);
}

.tmeet-btn-ghost {
  background: transparent;
  color: var(--awd-text-2);
  border: 1px solid var(--awd-border);
}

.tmeet-btn-ghost:hover {
  background: var(--awd-surface-2);
  color: var(--awd-text);
}

.tmeet-btn-secondary {
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
  border: 1px solid var(--awd-border);
}

.tmeet-btn-secondary:hover {
  background: var(--awd-border);
}

.tmeet-btn-sm {
  font-size: var(--awd-panel-fs-meta);
  padding: 2px var(--awd-space-2);
}

.tmeet-auth-qr-box {
  margin-top: var(--awd-panel-pad-x);
  padding-top: var(--awd-space-2);
  border-top: 1px dashed var(--awd-border);
  display: flex;
  flex-direction: column;
  gap: calc(var(--awd-space-3) / 2);
}

.tmeet-qr-hint {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
}

.tmeet-qr-actions {
  display: flex;
  gap: var(--awd-space-2);
}

.tmeet-sync-row {
  margin-bottom: var(--awd-space-2);
}

.tmeet-interval-row {
  margin-bottom: var(--awd-space-2);
  padding-top: calc(var(--awd-space-3) / 2);
  border-top: 1px solid var(--awd-surface-2);
}

.tmeet-label {
  font-size: var(--awd-font-size-body);
  font-weight: 500;
}

.tmeet-label-sub {
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
}

.tmeet-sync-action-row {
  margin-top: calc(var(--awd-space-3) / 2);
}

.tmeet-sync-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(var(--awd-space-3) / 2);
}

.tmeet-spinner {
  display: inline-block;
  animation: spin 1s infinite linear;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tmeet-search-box {
  margin-bottom: var(--awd-space-2);
}

.tmeet-search-input {
  height: var(--awd-control-height);
  min-height: var(--awd-control-height);
  line-height: var(--awd-line-height-ui);
  width: 100%;
  box-sizing: border-box;
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  padding: 0 var(--awd-panel-pad-x);
  font-size: var(--awd-panel-fs);
}

.tmeet-meeting-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.tmeet-empty {
  text-align: center;
  padding: var(--awd-space-8) var(--awd-panel-pad-x);
  color: var(--awd-text-2);
}

.tmeet-empty-title {
  display: block;
  font-size: var(--awd-font-size-body);
  font-weight: 500;
  margin-bottom: var(--awd-space-1);
}

.tmeet-empty-hint {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
}

.tmeet-meeting-card {
  cursor: pointer;
  transition: border-color var(--awd-motion-fast);
}

.tmeet-meeting-card:hover {
  border-color: var(--awd-accent);
  box-shadow: none;
}

.tmeet-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: calc(var(--awd-space-3) / 2);
}

.tmeet-card-title {
  font-size: var(--awd-font-size-body);
  font-weight: 600;
  color: var(--awd-text);
  flex: 1;
  margin-right: var(--awd-space-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tmeet-badge {
  font-size: var(--awd-panel-fs-meta);
  padding: 1px calc(var(--awd-space-3) / 2);
  border-radius: var(--awd-radius-sm);
  white-space: nowrap;
}

.badge-synced {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}

.badge-failed {
  background: var(--awd-danger-soft);
  color: var(--awd-danger-text);
}

.badge-none {
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}

.tmeet-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--awd-space-2);
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  margin-bottom: calc(var(--awd-space-3) / 2);
}

.tmeet-card-speakers {
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2);
  margin-bottom: var(--awd-space-2);
  line-height: 1.4;
}

.tmeet-speakers-label {
  color: var(--awd-text-2);
  margin-right: var(--awd-space-1);
}

.tmeet-card-actions {
  flex-wrap: wrap;
  display: flex;
  gap: calc(var(--awd-space-3) / 2);
  border-top: 1px solid var(--awd-surface-2);
  padding-top: var(--awd-space-2);
}

.tmeet-action-btn {
  min-height: var(--awd-panel-row-h);
  flex: 1;
  font-size: var(--awd-panel-fs-meta);
  padding: 3px 0;
  border-radius: var(--awd-radius-sm);
  text-align: center;
  border: 1px solid var(--awd-border);
  background: var(--awd-surface);
  color: var(--awd-text);
  cursor: pointer;
  transition: background var(--awd-motion-fast), color var(--awd-motion-fast);
}

.tmeet-action-btn:hover {
  background: var(--awd-surface);
  border-color: var(--awd-border);
}

.tmeet-action-btn.primary {
  background: var(--awd-accent);
  border-color: var(--awd-accent);
  color: var(--awd-text-on-accent);
}

.tmeet-action-btn.primary:hover {
  background: var(--awd-accent-hover);
}
.tmeet-notice {
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-2);
  margin-bottom: var(--awd-panel-gap);
  color: var(--awd-text-2);
  font-size: var(--awd-panel-fs);
  line-height: var(--awd-line-height-ui);
}
.tmeet-btn:disabled { opacity: .55; cursor: default; }
.tmeet-btn:focus-visible, .tmeet-search-input:focus-within, .tmeet-action-btn:focus-visible {
  outline: var(--awd-focus-width) solid var(--awd-accent-text);
  outline-offset: var(--awd-focus-offset);
}
@media (pointer: coarse) {
  .tmeet-btn, .tmeet-search-input, .tmeet-action-btn {
  min-height: var(--awd-panel-row-h); min-height: var(--awd-control-height-touch); }
}
@media (prefers-reduced-motion: reduce) {
  .tmeet-spinner { animation: none; }
}
</style>
