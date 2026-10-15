<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="plugin-summary">
    <text class="plugin-summary-name">{{ plugin.label }}</text>
    <text class="plugin-summary-description">{{ plugin.description || $t('panels.pgWorkspaceHint') }}</text>
    <button class="plugin-summary-open" @tap="$emit('open')">{{ $t('panels.pgOpenWorkspace') }}</button>

    <view v-if="isLawFirmPlugin" class="lawfirm-summary-card">
      <view class="lawfirm-stat-grid">
        <view class="lawfirm-stat-item">
          <text class="lawfirm-stat-label">在办案件</text>
          <text class="lawfirm-stat-val">{{ lawfirmStats.activeMatters }}</text>
        </view>
        <view class="lawfirm-stat-item">
          <text class="lawfirm-stat-label">待审利冲</text>
          <text class="lawfirm-stat-val warn">{{ lawfirmStats.pendingClearances }}</text>
        </view>
        <view class="lawfirm-stat-item">
          <text class="lawfirm-stat-label">签约总额</text>
          <text class="lawfirm-stat-val">{{ lawfirmStats.contractedText }}</text>
        </view>
        <view class="lawfirm-stat-item">
          <text class="lawfirm-stat-label">实收到账</text>
          <text class="lawfirm-stat-val accent">{{ lawfirmStats.collectedText }}</text>
        </view>
      </view>
      <view class="lawfirm-quick-jumps">
        <button class="lawfirm-jump-btn" @tap="openLawFirmTab('intake')">立案与利冲</button>
        <button class="lawfirm-jump-btn" @tap="openLawFirmTab('finance')">开票与财务</button>
        <button class="lawfirm-jump-btn" @tap="openLawFirmTab('dashboard')">全所三维看板</button>
        <button class="lawfirm-jump-btn" @tap="openLawFirmTab('oa')">OA与IM联动</button>
      </view>
    </view>

    <text class="plugin-summary-hint">{{ $t('panels.pgWorkspaceHint') }}</text>
  </view>
</template>
<script>
import { getLawFirmOverview } from '@/services/api.js'

export default {
  name: 'PluginWorkspaceSummary',
  props: {
    plugin: { type: Object, required: true },
    projectId: { type: [Number, String], default: null },
  },
  emits: ['open'],
  data() {
    return {
      lawfirmOverview: null,
    }
  },
  computed: {
    isLawFirmPlugin() {
      return !!(this.plugin && this.plugin.pluginId === 'lawfirm-management')
    },
    lawfirmStats() {
      const ov = this.lawfirmOverview || {}
      const d = ov.kpi || ov.kpis || (ov.dashboard && (ov.dashboard.kpi || ov.dashboard.kpis)) || ov.dashboard || {}
      const matters = Array.isArray(ov.intakes) ? ov.intakes : (Array.isArray(ov.matters) ? ov.matters : [])
      const clearances = Array.isArray(ov.clearances) ? ov.clearances : []
      const activeMatters = d.activeMatterCount ?? d.activeCases ?? d.activeMatters ?? matters.length
      const pendingClearances = d.pendingClearances ?? clearances.filter((c) => c.decision === 'PENDING' || c.status === 'PENDING').length
      const contractedCents = d.totalContractedCents ?? d.contractedCents
      const collectedCents = d.totalCollectedCents ?? d.collectedCents
      const contractedWan = d.totalContractedWan ?? (contractedCents != null ? (Number(contractedCents) / 1000000).toFixed(2) : '0.00')
      const collectedWan = d.totalCollectedWan ?? (collectedCents != null ? (Number(collectedCents) / 1000000).toFixed(2) : '0.00')
      return {
        activeMatters,
        pendingClearances,
        contractedText: `${contractedWan} 万`,
        collectedText: `${collectedWan} 万`,
      }
    },
  },
  watch: {
    'plugin.pluginId': {
      immediate: true,
      handler(val) {
        if (val === 'lawfirm-management') {
          this.loadLawFirmSummary()
        }
      },
    },
  },
  methods: {
    async loadLawFirmSummary() {
      try {
        const res = await getLawFirmOverview(this.projectId ? { projectId: this.projectId } : {})
        const payload = res && res.data && ('intakes' in res.data || 'matters' in res.data || 'dashboard' in res.data || 'overview' in res.data || 'kpi' in res.data)
          ? res.data
          : res
        if (payload) {
          this.lawfirmOverview = payload.overview || payload
        }
      } catch (e) {
        // ignore
      }
    },
    openLawFirmTab(tab) {
      this.$emit('open')
      setTimeout(() => {
        uni.$emit('awd:lawfirm-tab', tab)
      }, 80)
    },
  },
}
</script>
<style scoped>
.plugin-summary { display: flex; flex-direction: column; gap: var(--awd-panel-gap-lg); padding: var(--awd-panel-gap) var(--awd-panel-pad-x); }
.plugin-summary-name { font-size: var(--awd-font-size-title); font-weight: 600; color: var(--awd-text); }
.plugin-summary-description { font-size: var(--awd-font-size-body); line-height: 1.7; color: var(--awd-text); }
.plugin-summary-open { min-height: var(--awd-control-height); border-radius: var(--awd-radius-md); width: 100%; margin: 0; font-size: var(--awd-font-size-body); color: var(--awd-text-on-accent, #fff); background: var(--awd-accent); }
.plugin-summary-hint { font-size: var(--awd-panel-fs); line-height: 1.6; color: var(--awd-text-2); }
.lawfirm-summary-card { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: var(--awd-radius-md); background: var(--awd-surface-2); border: 1px solid var(--awd-border-subtle); }
.lawfirm-stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.lawfirm-stat-item { padding: 8px; border-radius: var(--awd-radius-sm); background: var(--awd-surface); border: 1px solid var(--awd-border-subtle); }
.lawfirm-stat-label { display: block; font-size: 11px; color: var(--awd-text-2); }
.lawfirm-stat-val { display: block; margin-top: 2px; font-size: 14px; font-weight: 600; color: var(--awd-text); font-variant-numeric: tabular-nums; }
.lawfirm-stat-val.warn { color: var(--awd-warning); }
.lawfirm-stat-val.accent { color: var(--awd-accent); }
.lawfirm-quick-jumps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.lawfirm-jump-btn { min-height: 30px; line-height: 28px; padding: 0 8px; margin: 0; font-size: 12px; color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); }
</style>
