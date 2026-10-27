<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section
    v-if="report"
    class="verification-report-card"
    :class="`status-${statusClass}`"
    data-harness-verification-card
  >
    <div class="vr-header">
      <div class="vr-title-row">
        <span class="vr-icon" aria-hidden="true">
          <svg v-if="report.status === 'VERIFIED_CLEAN'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <polyline points="9 12 11 14 15 10"></polyline>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </span>
        <span class="vr-title">{{ report.skillName ? `${$t('chat.verificationCardTitle')} · ${report.skillName}` : $t('chat.verificationCardTitle') }}</span>
        <span class="vr-status-badge" :class="`badge-${statusClass}`">{{ statusLabel }}</span>
      </div>
      <div class="vr-metrics">
        <span class="vr-metric supported">{{ $t('chat.verificationMetricSupported', { n: report.supportedCount || 0 }) }}</span>
        <span class="vr-metric unverified">{{ $t('chat.verificationMetricUnverified', { n: report.unverifiedCount || 0 }) }}</span>
        <span v-if="report.conflictCount > 0" class="vr-metric conflict">{{ $t('chat.verificationMetricConflict', { n: report.conflictCount || 0 }) }}</span>
      </div>
    </div>

    <div v-if="report.summary" class="vr-summary">{{ report.summary }}</div>

    <div v-if="items.length > 0" class="vr-items-section">
      <button type="button" class="vr-toggle-btn" @click="expanded = !expanded">
        <span>{{ expanded ? $t('chat.verificationHideDetails') : $t('chat.verificationToggleDetails', { n: items.length }) }}</span>
        <span class="vr-chevron" :class="{ open: expanded }">›</span>
      </button>
      <div v-if="expanded" class="vr-items-list">
        <div v-for="(item, idx) in items" :key="idx" class="vr-item">
          <div class="vr-item-head">
            <span class="vr-verdict-pill" :class="`verdict-${(item.verdict || 'UNVERIFIED').toLowerCase()}`">
              {{ verdictLabel(item.verdict) }}
            </span>
            <span class="vr-proposition">{{ item.proposition }}</span>
          </div>
          <div v-if="item.detail && item.detail !== item.proposition" class="vr-item-detail">{{ item.detail }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { t } from '@/i18n'

const props = defineProps({
  report: { type: Object, required: true }
})

const expanded = ref(false)

const items = computed(() => (Array.isArray(props.report?.items) ? props.report.items : []))

const statusClass = computed(() => {
  const s = props.report?.status || 'UNVERIFIED'
  if (s === 'VERIFIED_CLEAN') return 'clean'
  if (s === 'GAPS_FOUND') return 'gaps'
  return 'unverified'
})

const statusLabel = computed(() => {
  const s = props.report?.status || 'UNVERIFIED'
  if (s === 'VERIFIED_CLEAN') return t('chat.verificationStatusClean')
  if (s === 'GAPS_FOUND') return t('chat.verificationStatusGaps')
  return t('chat.verificationStatusUnverified')
})

function verdictLabel(verdict) {
  if (verdict === 'SUPPORTED') return t('chat.verificationVerdictSupported')
  if (verdict === 'CONFLICT') return t('chat.verificationVerdictConflict')
  return t('chat.verificationVerdictUnverified')
}
</script>

<style scoped>
.verification-report-card {
  margin-top: var(--awd-space-2);
  padding: var(--awd-space-3);
  border-radius: var(--awd-radius-md);
  border: 1px solid var(--awd-border-subtle);
  background: var(--awd-surface);
  font-size: var(--awd-panel-fs);
  line-height: 1.45;
}
.verification-report-card.status-clean {
  border-left: 3px solid var(--awd-mint, #10b981);
}
.verification-report-card.status-gaps {
  border-left: 3px solid var(--awd-gold, #f59e0b);
}
.verification-report-card.status-unverified {
  border-left: 3px solid var(--awd-text-3);
}
.vr-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--awd-space-2);
}
.vr-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.vr-icon {
  display: inline-flex;
  align-items: center;
  color: var(--awd-accent);
}
.vr-title {
  font-weight: 600;
  color: var(--awd-text);
}
.vr-status-badge {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  padding: 1px 7px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}
.vr-status-badge.badge-clean {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}
.vr-status-badge.badge-gaps {
  background: rgba(245, 158, 11, 0.14);
  color: var(--awd-gold, #d97706);
}
.vr-metrics {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--awd-panel-fs-meta);
}
.vr-metric {
  padding: 1px 6px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-bg);
  color: var(--awd-text-2);
}
.vr-metric.conflict {
  color: var(--awd-danger, #dc2626);
}
.vr-summary {
  margin-top: 6px;
  color: var(--awd-text-2);
  font-size: var(--awd-panel-fs-meta);
}
.vr-items-section {
  margin-top: 8px;
  border-top: 1px solid var(--awd-border-subtle);
  padding-top: 6px;
}
.vr-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--awd-accent-text);
  font-size: var(--awd-panel-fs-meta);
  cursor: pointer;
}
.vr-chevron {
  display: inline-block;
  transition: transform 0.15s;
}
.vr-chevron.open {
  transform: rotate(90deg);
}
.vr-items-list {
  display: grid;
  gap: 6px;
  margin-top: 6px;
}
.vr-item {
  padding: 6px 8px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-bg);
}
.vr-item-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.vr-verdict-pill {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}
.vr-verdict-pill.verdict-supported {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}
.vr-verdict-pill.verdict-conflict {
  background: rgba(220, 38, 38, 0.12);
  color: var(--awd-danger, #dc2626);
}
.vr-proposition {
  font-weight: 500;
  color: var(--awd-text);
}
.vr-item-detail {
  margin-top: 3px;
  color: var(--awd-text-3);
  font-size: var(--awd-panel-fs-meta);
  white-space: pre-wrap;
}
</style>
