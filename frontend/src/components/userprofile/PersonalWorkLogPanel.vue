<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  「工作记录」栏目。2026-08-20 从 components/userprofile/UserProfilePane.vue 整块搬出来：
  个人中心并进了统一的「设置」页（AdminPane 的「个人」组），四段内容各自成组件，
  免得 AdminPane 再涨两千行。

  内容一行没改，只有生命周期换了宿主：原来靠 UserProfilePane 的 mounted 补一次
  loadActivityLogs（默认 tab 是懒加载的），现在这个组件只在 activeNav === 'work_log'
  时才渲染，自己的 mounted 就是那一次加载。
-->
<template>
  <SettingsSection class="panel-work-log" :title="$t('account.tabWorkLog')" :description="$t('account.workLogSubtitle')">
      <template #actions>
        <view class="log-filter-bar header-actions">
          <picker class="filter-input filter-date" mode="date" :value="activityFilter.from" :end="activityFilter.to" @change="onRangeChange('from', $event)">
            <text class="filter-date-text">{{ activityFilter.from }}</text>
          </picker>
          <text class="filter-range-sep">–</text>
          <picker class="filter-input filter-date" mode="date" :value="activityFilter.to" :start="activityFilter.from" @change="onRangeChange('to', $event)">
            <text class="filter-date-text">{{ activityFilter.to }}</text>
          </picker>
          <AwdSelect
            class="filter-project-select"
            :range="projectFilterLabels"
            :value="projectFilterIndex"
            @change="onProjectFilterChange"
          />
          <input class="filter-input" v-model="activityFilter.content" :placeholder="$t('account.filterContentPlaceholder')" />
          <button class="btn-export" @tap="exportLogsToExcel">{{ $t('account.exportExcelBtn') }}</button>
        </view>
      </template>

      <view v-if="activityTruncated" class="log-truncated-hint">{{ $t('account.workLogTruncatedHint') }}</view>
      <view class="log-table-container">
        <view class="log-table-header">
          <text class="th th-project">{{ $t('account.thProject') }}</text>
          <text class="th th-action">{{ $t('account.thAction') }}</text>
          <text class="th th-object">{{ $t('account.thObject') }}</text>
          <text class="th th-start">{{ $t('account.thStart') }}</text>
          <text class="th th-end">{{ $t('account.thEnd') }}</text>
          <text class="th th-duration">{{ $t('account.thDuration') }}</text>
          <text class="th th-idle">{{ $t('account.thIdle') }}</text>
        </view>
        <view v-if="activityLoading" class="loading-row">{{ $t('account.loadingEllipsis') }}</view>
        <view v-else-if="getFilteredLogs().length === 0" class="empty-row">{{ $t('account.noRecords') }}</view>
        <scroll-view v-else scroll-y class="log-table-body">
          <view v-for="log in getFilteredLogs()" :key="log.id" class="log-table-row">
            <text class="td td-project" :title="getLogProject(log)"><text class="project-badge">{{ getLogProject(log) }}</text></text>
            <text class="td td-action">{{ getLogActionLabel(log) }}</text>
            <text class="td td-object" :title="getLogObject(log)">{{ getLogObject(log) }}</text>
            <text class="td td-start">{{ getLogStartTime(log) }}</text>
            <text class="td td-end">{{ getLogEndTime(log) }}</text>
            <text class="td td-duration">{{ getLogDuration(log) }}</text>
            <text class="td td-idle" :title="getLogIdleTime(log)">{{ getLogIdleTime(log) }}</text>
          </view>
        </scroll-view>
      </view>
  </SettingsSection>
</template>

<script>
import { getUserActivityHistory } from '@/services/api.js'
import AwdSelect from '@/components/AwdSelect.vue'
import SettingsSection from '@/components/settings/SettingsSection.vue'
import { toolDisplayName } from '@/utils/toolDisplayNames.js'

// dev-board BUG-45：actionType → i18n key。取值范围见 backend
// UserActivityLog.actionType 的文档注释（LOGIN/OPEN_FILE/CLOSE_FILE/PAGE_VIEW/
// OPEN_URL/CLOSE_URL）+ activityTracker.js 目前实际会发的 WORK。
// 本地时区的 YYYY-MM-DD（toISOString 是 UTC，凌晨会差一天）
function localDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ACTION_TYPE_I18N_KEYS = {
  LOGIN: 'account.actionLogin',
  OPEN_FILE: 'account.actionOpenFile',
  CLOSE_FILE: 'account.actionCloseFile',
  PAGE_VIEW: 'account.actionPageView',
  OPEN_URL: 'account.actionOpenUrl',
  CLOSE_URL: 'account.actionCloseUrl',
  WORK: 'account.actionWork',
  ai_tool: 'account.actionAiTool',
}

export default {
  name: 'PersonalWorkLogPanel',
  components: { AwdSelect, SettingsSection },
  data() {
    return {
      activityLogs: [],
      activityLoading: false,
      activityTruncated: false,
      // 默认查本月（dev-board#1713）；日期按本地时区
      activityFilter: {
        from: localDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
        to: localDateString(new Date()),
        content: '',
      },
      // 'all' | 'unassociated' | 项目 id 的字符串形式
      projectFilterKey: 'all',
    }
  },
  computed: {
    // 从当前记录里去重出的项目筛选项：全部 + 各项目 + 未关联项目（只在存在时才出现）
    projectFilterOptions() {
      const options = [{ key: 'all', label: this.$t('account.allProjectsOption') }]
      const seen = new Map()
      let hasUnassociated = false
      this.activityLogs.forEach(log => {
        if (log.projectId) {
          if (!seen.has(log.projectId)) {
            seen.set(log.projectId, log.projectName || this.$t('account.unassociatedProjectOption'))
          }
        } else {
          hasUnassociated = true
        }
      })
      seen.forEach((label, id) => options.push({ key: String(id), label }))
      if (hasUnassociated) {
        options.push({ key: 'unassociated', label: this.$t('account.unassociatedProjectOption') })
      }
      return options
    },
    projectFilterLabels() {
      return this.projectFilterOptions.map(o => o.label)
    },
    projectFilterIndex() {
      const idx = this.projectFilterOptions.findIndex(o => o.key === this.projectFilterKey)
      return idx >= 0 ? idx : 0
    },
  },
  mounted() {
    this.loadActivityLogs()
  },
  methods: {
    onProjectFilterChange(index) {
      const option = this.projectFilterOptions[index]
      this.projectFilterKey = option ? option.key : 'all'
    },
    onRangeChange(which, e) {
      const value = e && e.detail ? e.detail.value : ''
      if (!value || value === this.activityFilter[which]) return
      this.activityFilter[which] = value
      this.loadActivityLogs()
    },
    async loadActivityLogs() {
      this.activityLoading = true
      try {
        const res = await getUserActivityHistory({ from: this.activityFilter.from, to: this.activityFilter.to })
        this.activityLogs = res.data || []
        this.activityTruncated = !!res.truncated
      } catch (e) {
        console.error('Failed to load activity logs', e)
      } finally {
        this.activityLoading = false
      }
    },
    getFilteredLogs() {
      // 关键词同时匹配对象列（文件名 / 网址）、项目名和备注，忽略大小写
      const keyword = (this.activityFilter.content || '').trim().toLowerCase()
      return this.activityLogs.filter(log => {
        const contentMatch = !keyword || [this.getLogObject(log), this.getLogProject(log), log.metaInfo]
          .some(v => v && String(v).toLowerCase().includes(keyword))
        let projectMatch = true
        if (this.projectFilterKey === 'unassociated') {
          projectMatch = !log.projectId
        } else if (this.projectFilterKey !== 'all') {
          projectMatch = String(log.projectId) === this.projectFilterKey
        }
        return projectMatch && contentMatch
      })
    },
    getLogProject(log) {
      // 结构化项目归属优先；projectId 有值但查不到名字（项目已删除）归「未关联项目」
      if (log.projectId) {
        return log.projectName || this.$t('account.unassociatedProjectOption')
      }
      // 老数据没有 projectId，兼容旧的 metaInfo 自由文本 "Project: 名称"
      if (log.metaInfo && log.metaInfo.includes('Project:')) {
        const match = log.metaInfo.match(/Project:\s*([^,;]+)/)
        if (match) return match[1]
      }
      if (log.actionType === 'WORK' && log.targetName) return log.targetName
      return this.$t('account.unassociatedProjectOption')
    },
    getLogActionLabel(log) {
      // dev-board BUG-45：表格与 CSV 导出原来直接渲染后端枚举
      // （OPEN_FILE/OPEN_URL/...），对律师用户不可读；这里映射成 i18n 文案。
      // 枚举取值见 backend UserActivityLog.actionType 文档注释 + activityTracker.js
      // 里实际在发的 WORK/OPEN_FILE/OPEN_URL 三种；未知值原样展示，不吞掉信息。
      const key = ACTION_TYPE_I18N_KEYS[log.actionType]
      return key ? this.$t(key) : log.actionType
    },
    getLogObject(log) {
      if (log.actionType === 'OPEN_FILE' || log.actionType === 'CLOSE_FILE') return log.targetName
      if (log.actionType === 'WORK') return '-'
      if (log.actionType === 'ai_tool') {
        // 工具显示名 + 来源（metaInfo 只含摘要，不含参数/输出）
        let source = 'agent'
        try { source = JSON.parse(log.metaInfo || '{}').source || 'agent' } catch (e) { /* 老数据/非 JSON */ }
        const key = { agent: 'aiToolSourceAgent', mcp: 'aiToolSourceMcp', 'plugin-ui': 'aiToolSourcePlugin' }[source] || 'aiToolSourceAgent'
        return `${toolDisplayName(log.targetName)}（${this.$t('account.' + key)}）`
      }
      return log.targetName || '-'
    },
    getLogStartTime(log) {
      if (log.duration && log.duration > 0) {
        const end = new Date(log.timestamp).getTime()
        // duration 已扣掉空闲段，开始时间要把空闲加回来
        const idle = this.parseIdleSegments(log).reduce((sum, seg) => sum + (seg.end - seg.start), 0)
        const dur = (Number(log.duration) || 0) + idle
        return this.formatDateTime(new Date(end - dur))
      }
      return this.formatDateTime(log.timestamp)
    },
    getLogEndTime(log) {
      return this.formatDateTime(log.timestamp)
    },
    getLogDuration(log) {
      if (log.duration && log.duration > 0) {
        return this.formatDuration(log.duration)
      }
      // Fallback for old logs or if duration is 0 (instant actions)
      if (log.metaInfo && log.metaInfo.includes('总时长:')) {
        const match = log.metaInfo.match(/总时长:\s*([\d.]+)分/)
        if (match) return this.formatDuration(Number(match[1]) * 60000)
      }
      return '-'
    },
    // 按 15 秒（0.25 分）向上取整：「0.25 分」「1.75 分」「2 分」，满 60 分写「x 小时 y 分」（dev-board#1713）
    formatDuration(ms) {
      const quarters = Math.max(1, Math.ceil((Number(ms) || 0) / 15000))
      const hours = Math.floor(quarters / 240)
      const minutes = String((quarters % 240) / 4)
      if (hours > 0) return this.$t('account.durationHoursMinutes', { hours, minutes })
      return this.$t('account.durationMinutes', { minutes })
    },
    // activityTracker 写的格式：IdleSegments: <开始毫秒>-<结束毫秒>;...
    parseIdleSegments(log) {
      const meta = log && log.metaInfo
      if (!meta || !meta.includes('IdleSegments:')) return []
      const raw = meta.split('IdleSegments:')[1].trim()
      const segs = []
      for (const part of raw.split(';')) {
        const m = /^(\d{10,})-(\d{10,})$/.exec(part.trim())
        if (m) segs.push({ start: Number(m[1]), end: Number(m[2]) })
      }
      return segs
    },
    formatClock(ms) {
      const d = new Date(ms)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    },
    getLogIdleTime(log) {
      if (!log.metaInfo) return '-'
      const segs = this.parseIdleSegments(log)
      if (segs.length) {
        return segs.map(seg => `${this.formatClock(seg.start)}-${this.formatClock(seg.end)} (${this.formatDuration(seg.end - seg.start)})`).join(', ')
      }
      if (log.metaInfo.includes('IdleSegments:')) {
        return log.metaInfo.split('IdleSegments:')[1].trim()
      }
      if (log.metaInfo.includes('空闲:')) {
        const idx = log.metaInfo.indexOf('空闲:')
        if (idx >= 0) return log.metaInfo.substring(idx)
      }
      return '-'
    },
    exportLogsToExcel() {
      // 原来拼 data: URI，内容里的 # 会被当成片段标识把文件截断；改用 Blob
      const blob = new Blob([this.buildLogsCsv(this.getFilteredLogs())], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.setAttribute('href', url)
      link.setAttribute('download', `work_log_${localDateString(new Date())}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 0)
    },
    // 标准 CSV：每格双引号包裹、内部 " 写成 ""，行尾 CRLF；BOM 让 Excel 按 UTF-8 打开
    buildLogsCsv(logs) {
      const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`
      const header = ['thProject', 'thAction', 'thObject', 'thStart', 'thEnd', 'thDuration', 'thIdle']
        .map(k => cell(this.$t(`account.${k}`))).join(',')
      const rows = logs.map(log => [
        this.getLogProject(log),
        this.getLogActionLabel(log),
        this.getLogObject(log),
        this.getLogStartTime(log),
        this.getLogEndTime(log),
        this.getLogDuration(log),
        this.getLogIdleTime(log),
      ].map(cell).join(','))
      return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n'
    },
    formatTime(timeStr) {
      if (!timeStr) return ''
      try {
        const date = new Date(timeStr)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      } catch (e) {
        return timeStr
      }
    },
    formatDateTime(timeStr) {
      if (!timeStr) return ''
      try {
        const date = new Date(timeStr)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hour = String(date.getHours()).padStart(2, '0')
        const minute = String(date.getMinutes()).padStart(2, '0')
        const second = String(date.getSeconds()).padStart(2, '0')
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`
      } catch (e) {
        return timeStr
      }
    },
  },
}
</script>

<style lang="scss" scoped>
@import '@/components/settings/settings.scss';

/* dev-board BUG-04：SettingsSection 头部默认 head-text flex:1 + min-width:0，
   actions 侧 flex-shrink:0；本栏目的筛选行（4 个控件）比其它分节的 actions 宽
   得多，中栏（~1000px 宽，右栏开着）下 actions 占满自然宽度不收缩，标题区被
   挤到 0 附近，中文逐字竖排。给标题区一个下限宽度，并允许头部整行换行——
   容器不够宽时筛选行掉到第二行，标题独占一行，而不是被压扁。 */
.panel-work-log :deep(.awd-set-section-head) {
  flex-wrap: wrap;
}

.panel-work-log :deep(.awd-set-section-head-text) {
  min-width: 220px;
}

/* dev-board BUG-04 复核缺口：折到第二行后，actions 容器（SettingsSection
   共用的 .awd-set-section-actions）本身仍是 flex-shrink:0 + 自然宽度
   （筛选行 4 个控件约 517px），右栏开着、区块约 410px 宽时超出
   .awd-set-section 的 overflow:hidden 被裁掉，导出按钮和关键词输入框一部分
   看不见也点不到。让 actions 容器可收缩到区块宽度内，内部筛选行再允许换行。 */
.panel-work-log :deep(.awd-set-section-actions) {
  flex-shrink: 1;
  min-width: 0;
  max-width: 100%;
}

/* 筛选条并成一条 32px 工具栏，挂在 SettingsSection 的头部 #actions 里 */
.log-filter-bar {
  display: flex;
  align-items: center;
  gap: var(--awd-space-2);
  flex-wrap: wrap;
}

.filter-input {
  flex: 1;
  min-width: 0;
  height: var(--awd-control-height);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  padding: 0 10px;
  font-size: var(--awd-panel-fs);
  background: var(--awd-surface);
  color: var(--awd-text);
  box-sizing: border-box;
}

.filter-date {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.filter-date-text {
  line-height: calc(var(--awd-control-height) - 2px);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.filter-range-sep {
  color: var(--awd-text-3);
}

.log-truncated-hint {
  margin-bottom: var(--awd-space-2);
  font-size: var(--awd-panel-fs-sec);
  color: var(--awd-text-2);
}

.filter-project-select {
  flex: 1;
  min-width: 0;
  height: var(--awd-control-height);
}

.btn-export {
  @extend .awd-set-btn-secondary;
  flex-shrink: 0;
  height: var(--awd-control-height);
  line-height: calc(var(--awd-control-height) - 2px);
  padding: 0 var(--awd-space-3);
  font-size: var(--awd-panel-fs);
  border-radius: var(--awd-radius-md);
  box-sizing: border-box;
}

/* 表格用固定列宽（含末列），配合 overflow-x 横向滚动——容器比列宽总和窄时
   横向滚动，而不是把最后一列挤到逐字竖排换行（dev-board#892 走查）。 */
.log-table-container {
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  /* 容器比列宽总和窄时整块横向滚动（表头与行一起动），而不是把末列挤到
     逐字竖排换行（dev-board#892 走查）。 */
  overflow-x: auto;
}

.log-table-header,
.log-table-row {
  display: flex;
  /* 120(项目) + 96(操作) + 120(对象 min-width) + 150(开始) + 150(结束) +
     80(累计时长) + 150(连续无动作时间) = 866 */
  min-width: 866px;
}

.log-table-header {
  background: var(--awd-bg);
  border-bottom: 1px solid var(--awd-border);
  height: var(--awd-control-height);
  align-items: center;
}

.th {
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 12px;
  font-size: var(--awd-panel-fs-sec);
  font-weight: 600;
  color: var(--awd-text-2);
  white-space: nowrap;
}

.th-project { width: 120px; }
.th-action { width: 96px; }
/* 对象列是唯一允许省略的列——其余列一律定宽 + nowrap 不截断（dev-board#892
   二次走查：开始/结束时间戳被截成「2026-09-23 10:0…」、操作截成「OPEN…」，
   时间戳/枚举值截断等于信息丢失；超宽时整表横向滚动兜底，容器已有 overflow-x）。 */
.th-object { flex: 1 1 120px; width: auto; min-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.th-start, .th-end { width: 150px; }
.th-duration { width: 80px; text-align: right; }
.th-idle { width: 150px; }

.log-table-body {
  max-height: 500px;
}

.log-table-row {
  height: var(--awd-control-height);
  align-items: center;
  border-bottom: 1px solid var(--awd-border-subtle);
  font-size: var(--awd-panel-fs);
  color: var(--awd-text);

  &:last-child {
    border-bottom: none;
  }

  &:nth-child(even) {
    background: var(--awd-bg);
  }

  &:hover {
    background: var(--awd-surface-2);
  }
}

.td {
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 12px;
  white-space: nowrap;
}

.td-project { width: 120px; }

.project-badge {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--awd-surface-2);
  color: var(--awd-text);
  font-size: var(--awd-panel-fs-sec);
  font-weight: 500;
}
.td-action { width: 96px; font-weight: 500; }
.td-object {
  flex: 1 1 120px;
  width: auto;
  min-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--awd-text);
}
.td-start, .td-end {
  width: 150px;
  color: var(--awd-text-2);
  font-size: var(--awd-panel-fs);
  font-variant-numeric: tabular-nums;
}
.td-duration {
  width: 80px;
  color: var(--awd-text-3);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.td-idle { width: 150px; color: var(--awd-text-2); }

.loading-row, .empty-row {
  padding: 40px;
  text-align: center;
  color: var(--awd-text-3);
  font-size: var(--awd-font-size-body);
}
</style>
