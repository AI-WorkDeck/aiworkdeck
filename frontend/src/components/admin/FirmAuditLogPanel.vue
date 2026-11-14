<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  律所审计日志（readiness S20，设计见 readiness/s20/S20-audit-log-design.md）。
  设置页「个人」组的一栏，只在服务端确认当前账户是律所管理员时出现（AdminPane 里判定）。
  身份与可见范围全在服务端（cloud.audit.list 只回本所的行，非管理员直接拒绝）；这里不做任何闸门。
  导出：按当前筛选逐页拉取（每页 500，上限 20,000 条），本地拼 CSV，公式注入已处理（utils/firmAuditCsv.js）。
-->
<template>
  <view class="audit-pane">
    <view class="section-card">
      <view class="section-header">
        <text class="section-title">{{ $t('auditLog.title') }}</text>
        <text class="section-subtitle">{{ $t('auditLog.subtitle') }}</text>
        <text v-if="retentionDays" class="section-subtitle">{{ $t('auditLog.retention', { days: retentionDays }) }}</text>
      </view>
      <view class="section-body">
        <view class="filter-row">
          <view class="filter-item">
            <text class="filter-label">{{ $t('auditLog.from') }}</text>
            <input v-model="filters.from" class="filter-input audit-from" type="date" />
          </view>
          <view class="filter-item">
            <text class="filter-label">{{ $t('auditLog.to') }}</text>
            <input v-model="filters.to" class="filter-input audit-to" type="date" />
          </view>
          <view class="filter-item">
            <text class="filter-label">{{ $t('auditLog.category') }}</text>
            <picker :range="categoryOptions" range-key="label" :value="categoryIndex" @change="onCategory">
              <view class="filter-input picker-value audit-category">{{ categoryOptions[categoryIndex].label }}</view>
            </picker>
          </view>
          <view class="filter-item">
            <text class="filter-label">{{ $t('auditLog.actor') }}</text>
            <input v-model="filters.actor" class="filter-input audit-actor" :placeholder="$t('auditLog.actorPlaceholder')" @confirm="search" />
          </view>
        </view>
        <view class="action-row">
          <view class="audit-btn primary audit-search" :class="{ 'is-busy': loading }" @tap="search">{{ $t('auditLog.search') }}</view>
          <view class="audit-btn audit-reset" @tap="resetFilters">{{ $t('auditLog.reset') }}</view>
          <view class="audit-btn audit-export" :class="{ 'is-busy': exporting }" @tap="exportCsv">
            {{ exporting ? $t('auditLog.exporting') : $t('auditLog.exportCsv') }}
          </view>
          <view class="audit-btn audit-verify" :class="{ 'is-busy': verifying }" @tap="verify">{{ $t('auditLog.verify') }}</view>
        </view>
        <text v-if="notice" class="notice-line" :class="{ warn: noticeWarn }">{{ notice }}</text>
        <text v-if="error" class="notice-line warn">{{ $t('auditLog.loadFailed', { message: error }) }}</text>
      </view>
    </view>

    <view class="section-card">
      <view class="audit-table">
        <view class="audit-tr audit-th">
          <text class="col col-time">{{ $t('auditLog.colTime') }}</text>
          <text class="col col-action">{{ $t('auditLog.colAction') }}</text>
          <text class="col">{{ $t('auditLog.colActor') }}</text>
          <text class="col">{{ $t('auditLog.colTarget') }}</text>
          <text class="col">{{ $t('auditLog.colProject') }}</text>
          <text class="col col-detail">{{ $t('auditLog.colDetail') }}</text>
          <text class="col col-ip">{{ $t('auditLog.colIp') }}</text>
        </view>
        <view v-for="e in events" :key="e.id" class="audit-tr" :class="{ failed: e.outcome === 'FAILURE' }">
          <text class="col col-time">{{ formatTime(e.occurredAt) }}</text>
          <text class="col col-action">{{ actionLabel(e) }}</text>
          <text class="col">{{ e.actorName || '—' }}</text>
          <text class="col">{{ e.targetLabel || e.targetId || '—' }}</text>
          <text class="col">{{ e.projectName || '—' }}</text>
          <text class="col col-detail">{{ shortDetail(e.detail) || '—' }}</text>
          <text class="col col-ip">{{ e.sourceIp || '—' }}</text>
        </view>
        <text v-if="!loading && !events.length && !error" class="empty-line">{{ $t('auditLog.empty') }}</text>
      </view>
      <view v-if="hasMore" class="more-row">
        <view class="audit-btn audit-more" :class="{ 'is-busy': loading }" @tap="loadMore">{{ $t('auditLog.loadMore') }}</view>
      </view>
    </view>
  </view>
</template>

<script>
import { firmCloudAction } from '@/services/api'
import { buildAuditCsv, detailText } from '@/utils/firmAuditCsv.js'

const CATEGORIES = ['AUTH', 'DEVICES', 'MEMBERSHIP', 'SHARING', 'CLIENT', 'DATA', 'SETTINGS', 'ACCESS']
const PAGE = 100
const EXPORT_PAGE = 500
const EXPORT_MAX = 20000

export default {
  name: 'FirmAuditLogPanel',
  data() {
    return {
      filters: { from: '', to: '', category: '', actor: '' },
      events: [],
      hasMore: false,
      nextBeforeId: null,
      retentionDays: 0,
      loading: false,
      exporting: false,
      verifying: false,
      error: '',
      notice: '',
      noticeWarn: false,
      seq: 0,
    }
  },
  computed: {
    categoryOptions() {
      return [{ key: '', label: this.$t('auditLog.catAll') }]
        .concat(CATEGORIES.map((k) => ({ key: k, label: this.$t(`auditLog.cat.${k}`) })))
    },
    categoryIndex() {
      return Math.max(0, this.categoryOptions.findIndex((o) => o.key === this.filters.category))
    },
  },
  mounted() {
    this.search()
  },
  methods: {
    detailText,
    // 表格里省掉只有导出才用得上的内部 id（CSV 仍是全量）
    shortDetail(detail) {
      if (!detail || typeof detail !== 'object') return ''
      const rest = { ...detail }
      for (const k of ['actorAccountId', 'teamId', 'conversationId', 'deviceTokenId']) delete rest[k]
      return detailText(rest)
    },
    query(extra = {}) {
      const p = { ...extra }
      for (const k of ['from', 'to', 'category', 'actor']) {
        const v = (this.filters[k] || '').trim()
        if (v) p[k] = v
      }
      return p
    },
    onCategory(ev) {
      const opt = this.categoryOptions[Number(ev.detail.value)] || this.categoryOptions[0]
      this.filters.category = opt.key
      this.search()
    },
    resetFilters() {
      this.filters = { from: '', to: '', category: '', actor: '' }
      this.search()
    },
    async search() {
      this.events = []
      this.nextBeforeId = null
      this.hasMore = false
      this.notice = ''
      await this.fetchPage()
    },
    loadMore() {
      if (!this.loading && this.hasMore) this.fetchPage()
    },
    async fetchPage() {
      const seq = ++this.seq
      this.loading = true
      this.error = ''
      try {
        const params = this.query({ limit: PAGE })
        if (this.nextBeforeId) params.beforeId = this.nextBeforeId
        const data = await firmCloudAction('cloud.audit.list', params)
        if (seq !== this.seq) return
        this.events = this.events.concat((data && data.events) || [])
        this.hasMore = !!(data && data.hasMore)
        this.nextBeforeId = data && data.nextBeforeId
        this.retentionDays = (data && data.retentionDays) || this.retentionDays
      } catch (e) {
        if (seq === this.seq) this.error = (e && e.message) || ''
      } finally {
        if (seq === this.seq) this.loading = false
      }
    },
    actionLabel(e) {
      const key = `auditLog.action.${e.action}`
      const label = this.$te && this.$te(key) ? this.$t(key) : e.action
      const shown = e.outcome === 'FAILURE' ? `${label} (${this.$t('auditLog.outcomeFailure')})` : label
      // 官网上报的事件标一下来源（入所退所、官网登录、账户 Key）
      return e.source === 'website' ? `${shown} · ${this.$t('auditLog.sourceWebsite')}` : shown
    },
    formatTime(iso) {
      if (!iso) return ''
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return iso
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    },
    async exportCsv() {
      if (this.exporting) return
      this.exporting = true
      this.notice = ''
      try {
        const all = []
        let before = null
        let more = true
        while (more && all.length < EXPORT_MAX) {
          const params = this.query({ limit: EXPORT_PAGE })
          if (before) params.beforeId = before
          const data = await firmCloudAction('cloud.audit.list', params)
          const rows = (data && data.events) || []
          all.push(...rows)
          more = !!(data && data.hasMore) && rows.length > 0
          before = data && data.nextBeforeId
        }
        const rows = all.slice(0, EXPORT_MAX)
        const columns = [
          { label: this.$t('auditLog.colTime'), value: (e) => e.occurredAt },
          { label: this.$t('auditLog.colCategory'), value: (e) => e.category },
          { label: this.$t('auditLog.colAction'), value: (e) => this.actionLabel(e) },
          { label: this.$t('auditLog.colActionCode'), value: (e) => e.action },
          { label: this.$t('auditLog.colOutcome'), value: (e) => e.outcome },
          { label: this.$t('auditLog.colSource'), value: (e) => e.source || '' },
          { label: this.$t('auditLog.colActor'), value: (e) => e.actorName },
          { label: this.$t('auditLog.colActorId'), value: (e) => e.actorUserId },
          { label: this.$t('auditLog.colTarget'), value: (e) => e.targetLabel },
          { label: this.$t('auditLog.colTargetType'), value: (e) => e.targetType },
          { label: this.$t('auditLog.colTargetId'), value: (e) => e.targetId },
          { label: this.$t('auditLog.colProject'), value: (e) => e.projectName },
          { label: this.$t('auditLog.colProjectId'), value: (e) => e.projectId },
          { label: this.$t('auditLog.colDetail'), value: (e) => detailText(e.detail) },
          { label: this.$t('auditLog.colIp'), value: (e) => e.sourceIp },
          { label: this.$t('auditLog.colUserAgent'), value: (e) => e.userAgent },
          { label: this.$t('auditLog.colEventId'), value: (e) => e.id },
        ]
        const blob = new Blob([buildAuditCsv(rows, columns)], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.setAttribute('href', url)
        link.setAttribute('download', `firm-audit-log_${new Date().toISOString().slice(0, 10)}.csv`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => URL.revokeObjectURL(url), 0)
        const truncated = more || all.length > EXPORT_MAX
        this.noticeWarn = truncated
        this.notice = truncated
          ? this.$t('auditLog.exportTruncated', { count: rows.length })
          : this.$t('auditLog.exportDone', { count: rows.length })
      } catch (e) {
        this.noticeWarn = true
        this.notice = this.$t('auditLog.loadFailed', { message: (e && e.message) || '' })
      } finally {
        this.exporting = false
      }
    },
    async verify() {
      if (this.verifying) return
      this.verifying = true
      this.notice = ''
      try {
        const r = await firmCloudAction('cloud.audit.verify', {})
        this.noticeWarn = !(r && r.ok)
        this.notice = r && r.ok
          ? this.$t('auditLog.verifyOk', { count: r.checked })
          : this.$t('auditLog.verifyBroken', { id: r && r.firstBrokenId })
      } catch (e) {
        this.noticeWarn = true
        this.notice = this.$t('auditLog.loadFailed', { message: (e && e.message) || '' })
      } finally {
        this.verifying = false
      }
    },
  },
}
</script>

<style scoped>
.audit-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 72px;
}
.section-card {
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: 8px;
  overflow: hidden;
}
.section-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--awd-border-subtle);
}
.section-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--awd-text);
}
.section-subtitle {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--awd-text-2);
  line-height: 18px;
}
.section-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.filter-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 160px;
  min-width: 150px;
}
.filter-label {
  font-size: 12px;
  color: var(--awd-text-2);
}
.filter-input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--awd-border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--awd-text);
  background: var(--awd-surface);
  box-sizing: border-box;
}
.picker-value {
  display: flex;
  align-items: center;
  cursor: pointer;
}
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.audit-btn {
  padding: 6px 14px;
  border: 1px solid var(--awd-border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--awd-text);
  cursor: pointer;
  user-select: none;
}
.audit-btn.primary {
  background: var(--awd-accent, #1f6feb);
  border-color: var(--awd-accent, #1f6feb);
  color: #fff;
}
.audit-btn.is-busy {
  opacity: 0.6;
  pointer-events: none;
}
.notice-line {
  font-size: 12px;
  color: var(--awd-text-2);
}
.notice-line.warn {
  color: var(--awd-danger, #c62828);
}
.audit-table {
  display: flex;
  flex-direction: column;
  overflow-x: auto;
}
.audit-tr {
  display: flex;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--awd-border-subtle);
  font-size: 12px;
  color: var(--awd-text);
  min-width: 860px;
}
.audit-th {
  font-weight: 600;
  color: var(--awd-text-2);
}
.audit-tr.failed .col-action {
  color: var(--awd-danger, #c62828);
}
.col {
  flex: 1 1 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.col-time {
  flex: 0 0 132px;
}
.col-action {
  flex: 1.3 1 0;
}
.col-detail {
  flex: 1.4 1 0;
  color: var(--awd-text-2);
}
.col-ip {
  flex: 0 0 110px;
  direction: ltr;
  unicode-bidi: isolate;
}
.empty-line {
  padding: 16px 14px;
  font-size: 12px;
  color: var(--awd-text-2);
}
.more-row {
  padding: 10px 14px;
  display: flex;
  justify-content: center;
}
</style>
