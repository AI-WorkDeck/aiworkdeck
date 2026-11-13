<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  团队「本周」看板（纯展示）。数据全部来自 summary（成员各自的工作记录，无需填报）：
    - 工时格取 members[].daily，缺的天按 0；
    - 负荷档位按「8 小时 × 本周已结束的工作日」估算（上报滞后一天），周一本周还没有过完的工作日，
      改看上周一至周五并标明「上周」，口径在 utils/teamWeek.js 的 boardWeek；
    - 「AI 修订次数」数的是留在文档里的 AI 修改动作，不是文档篇数；
    - 项目名没共享时只说「项目名未共享」，不拿别处的名字补。
-->
<template>
  <view class="week-board">
    <view class="week-head">
      <view class="week-head-main">
        <text class="week-title">{{ $t(week.lastWeek ? 'team.weekTitleLastWeek' : 'team.weekTitle') }}</text>
        <text class="week-range">{{ rangeText }}</text>
        <text class="week-sub">{{ $t('team.weekSubtitle') }}</text>
        <text v-if="week.lastWeek" class="week-sub">{{ $t('team.weekLastWeekNote') }}</text>
        <text class="week-sub">{{ $t('team.weekDataThrough') }}</text>
      </view>
      <view class="week-legend">
        <view v-for="b in bands" :key="b" class="week-legend-item">
          <view class="week-dot" :class="'band-' + b"></view>
          <text class="week-legend-text">{{ bandLabel(b) }}</text>
        </view>
      </view>
    </view>

    <view class="week-kpis">
      <view class="week-kpi">
        <text class="week-kpi-value">{{ kpi.activeProjects || 0 }}</text>
        <text class="week-kpi-label">{{ $t('team.weekKpiProjects') }}</text>
        <text class="week-kpi-sub">{{ $t('team.weekKpiProjectsCaption') }}</text>
      </view>
      <view class="week-kpi">
        <text class="week-kpi-value">{{ $t('team.weekHoursShort', { hours: totalHours }) }}</text>
        <text class="week-kpi-label">{{ $t(week.lastWeek ? 'team.weekKpiHoursLastWeek' : 'team.weekKpiHours') }}</text>
        <text class="week-kpi-sub">{{ $t('team.weekKpiHoursCaption') }}</text>
      </view>
      <view class="week-kpi">
        <text class="week-kpi-value">{{ kpi.agentEditActions || 0 }}</text>
        <text class="week-kpi-label">{{ $t('team.weekKpiAiEdits') }}</text>
        <text class="week-kpi-sub">{{ $t('team.weekKpiAiEditsCaption') }}</text>
      </view>
      <view class="week-kpi">
        <text class="week-kpi-value">{{ kpi.unassignedTasks || 0 }}</text>
        <text class="week-kpi-label">{{ $t('team.weekKpiUnassigned') }}</text>
      </view>
    </view>

    <text v-if="!rows.length" class="week-empty">{{ $t('team.weekEmpty') }}</text>
    <view v-else class="week-table">
      <view class="week-row week-row-head">
        <text class="wcol wcol-member">{{ $t('team.weekColMember') }}</text>
        <text class="wcol wcol-days">{{ $t('team.weekColDays') }}</text>
        <text class="wcol wcol-current">{{ $t('team.weekColCurrent') }}</text>
        <text class="wcol wcol-hours">{{ $t(week.lastWeek ? 'team.weekColHoursLastWeek' : 'team.weekColHours') }}</text>
        <text class="wcol wcol-load">{{ $t('team.weekColLoad') }}</text>
      </view>
      <view v-for="r in rows" :key="r.accountId" class="week-row">
        <view class="wcol wcol-member week-member">
          <view class="week-avatar"><text>{{ r.initial }}</text></view>
          <view class="week-member-text">
            <text class="week-name">{{ r.name }}</text>
            <text class="week-role">{{ r.subline }}</text>
            <text
              v-if="canEditTitle"
              class="week-edit"
              @tap="$emit('edit-title', r.accountId, r.title)"
            >{{ $t('team.weekSetTitle') }}</text>
          </view>
        </view>
        <view class="wcol wcol-days week-cells">
          <view
            v-for="c in r.week.cells"
            :key="c.date"
            class="week-cell"
            :class="'lv-' + c.level"
            :title="c.tip"
          ></view>
        </view>
        <text class="wcol wcol-current">{{ r.current }}</text>
        <text class="wcol wcol-hours">{{ r.hours }}</text>
        <view class="wcol wcol-load week-load">
          <view class="week-bar"><view class="week-bar-fill" :class="'band-' + r.band" :style="{ width: r.barPct + '%' }"></view></view>
          <text class="week-load-text">{{ bandLabel(r.band) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { boardWeek, memberWeek, loadBand, loadRatio, cellLevel } from '@/utils/teamWeek.js'

const BANDS = ['light', 'balanced', 'busy']

export default {
  name: 'TeamWeekBoard',
  props: {
    summary: { type: Object, default: null },
    // 周一看板改看上周：7 天档的窗口够不着上周一，宿主另取一份 30 天档的成员日数据递进来
    lastWeekMembers: { type: Array, default: null },
    myRole: { type: String, default: '' },
    canEditTitle: { type: Boolean, default: false },
  },
  emits: ['edit-title'],
  data() {
    return { bands: BANDS }
  },
  computed: {
    today() {
      return new Date()
    },
    week() {
      return boardWeek(this.today)
    },
    days() {
      return this.week.days
    },
    kpi() {
      return (this.summary && this.summary.kpi) || {}
    },
    locale() {
      return this.$i18n && this.$i18n.locale ? this.$i18n.locale : undefined
    },
    rangeText() {
      const [first, last] = [this.days[0], this.days[4]].map((s) => {
        const [y, m, d] = s.split('-').map(Number)
        return new Date(y, m - 1, d)
      })
      try {
        const fmt = new Intl.DateTimeFormat(this.locale, { month: 'short', day: 'numeric' })
        return `${fmt.format(first)} – ${fmt.format(last)}`
      } catch (e) {
        return `${this.days[0]} – ${this.days[4]}`
      }
    },
    rows() {
      const members = (this.week.lastWeek && this.lastWeekMembers)
        || ((this.summary && Array.isArray(this.summary.members)) ? this.summary.members : [])
      // 忙的排前面：看板要回答的是「谁忙不过来，谁还有余力」
      return members.map((m) => {
        const week = memberWeek(m, this.days)
        const name = m.displayName || m.accountId || ''
        const title = m.title || ''
        const band = loadBand(week.weekMinutes, this.today)
        const ratio = loadRatio(week.weekMinutes, this.today)
        let current = '—'
        if (week.currentLabel) current = week.currentLabel
        else if (week.hasProject) current = this.$t('team.weekProjectHidden')
        return {
          accountId: m.accountId,
          name,
          title,
          initial: Array.from(name)[0] || '?',
          subline: title || this.roleLabel(m.role),
          week: {
            ...week,
            cells: week.cells.map((c) => ({
              ...c,
              level: cellLevel(c.minutes),
              tip: `${c.date} · ${this.$t('team.weekHoursShort', { hours: (c.minutes / 60).toFixed(1) })}`,
            })),
          },
          current,
          hours: this.$t('team.weekHoursShort', { hours: (week.weekMinutes / 60).toFixed(1) }),
          band,
          barPct: Math.round((Math.min(ratio, 1.2) / 1.2) * 100),
        }
      }).sort((a, b) => b.week.weekMinutes - a.week.weekMinutes)
    },
    totalHours() {
      const mins = this.rows.reduce((s, r) => s + r.week.weekMinutes, 0)
      return (mins / 60).toFixed(1)
    },
  },
  methods: {
    roleLabel(role) {
      if (role === 'OWNER') return this.$t('team.roleOwner')
      if (role === 'ADMIN') return this.$t('team.roleAdmin')
      return this.$t('team.roleMember')
    },
    bandLabel(b) {
      return this.$t(b === 'light' ? 'team.weekBandLight' : b === 'busy' ? 'team.weekBandBusy' : 'team.weekBandBalanced')
    },
  },
}
</script>

<style scoped>
.week-board {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-block-end: 14px;
  margin-block-end: 14px;
  border-block-end: 1px solid var(--awd-border-subtle);
}
.week-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.week-head-main { display: flex; flex-direction: column; gap: 2px; }
.week-title { font-size: 15px; font-weight: 600; color: var(--awd-text); }
.week-range { font-size: 12px; color: var(--awd-text-2); }
.week-sub { font-size: 12px; color: var(--awd-text-3); }
.week-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; }
.week-legend-item { display: flex; align-items: center; gap: 4px; }
.week-legend-text { font-size: 12px; color: var(--awd-text-2); }
.week-dot { width: 8px; height: 8px; border-radius: 50%; }
.band-light { background: var(--awd-mint); }
.band-balanced { background: var(--awd-accent); }
.band-busy { background: var(--awd-warning); }

.week-kpis {
  display: grid;
  /* Whole tiles wrap to the next row when the pane is narrow (side panes open), instead of squeezing text */
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.week-kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--awd-bg);
  border-inline-start: 3px solid var(--awd-mint);
  border-radius: 4px;
}
.week-kpi-value { font-size: 20px; font-weight: 600; color: var(--awd-accent-text); white-space: nowrap; }
.week-kpi-label { font-size: 12px; color: var(--awd-text-2); }
.week-kpi-sub { font-size: 11px; color: var(--awd-text-3); }
.week-empty { font-size: 12px; color: var(--awd-text-3); text-align: start; }

.week-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--awd-border-subtle);
  border-radius: 4px;
  overflow-x: auto;
}
.week-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  /* The table scrolls sideways as a whole; every column keeps a readable minimum */
  min-width: 620px;
}
.week-row + .week-row { border-top: 1px solid var(--awd-border-subtle); }
.week-row-head { background: var(--awd-surface-2); }
.wcol { font-size: 12px; color: var(--awd-text); text-align: start; min-width: 0; }
.week-row-head .wcol { color: var(--awd-text-2); }
.wcol-member { flex: 2.2 1 150px; }
.wcol-days { flex: 0 0 132px; }
.wcol-current { flex: 1.6 1 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wcol-hours { flex: 0 0 68px; white-space: nowrap; }
.wcol-load { flex: 1.6 1 120px; }

.week-member { display: flex; align-items: center; gap: 8px; }
.week-avatar {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--awd-accent-text);
  background: var(--awd-accent-wash);
}
.week-member-text { display: flex; flex-direction: column; min-width: 0; }
.week-name { font-size: 13px; font-weight: 500; color: var(--awd-text); }
.week-role { font-size: 11px; color: var(--awd-text-3); }
.week-edit { font-size: 11px; color: var(--awd-accent-text); cursor: pointer; }

.week-cells { display: flex; gap: 4px; }
.week-cell {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--awd-surface-2);
  border: 1px solid var(--awd-border-subtle);
}
.week-cell.lv-1 { background: var(--awd-accent-wash); }
.week-cell.lv-2 { background: var(--awd-accent-soft); }
.week-cell.lv-3 { background: var(--awd-accent); opacity: 0.75; }
.week-cell.lv-4 { background: var(--awd-accent); }

.week-load { display: flex; align-items: center; gap: 8px; }
.week-bar {
  flex: 1 1 auto;
  height: 6px;
  border-radius: 3px;
  background: var(--awd-surface-2);
  overflow: hidden;
}
.week-bar-fill { height: 100%; border-radius: 3px; }
.week-load-text { flex: none; font-size: 12px; color: var(--awd-text-2); }
</style>
