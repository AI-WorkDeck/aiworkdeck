<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section
    v-if="localRecord"
    class="harness-evolution-card"
    :class="{ 'is-reverted': isReverted, 'is-promoted': !!localRecord.promotedSkillId }"
    data-harness-evolution-card
  >
    <div class="he-header">
      <div class="he-badges">
        <span class="he-main-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          <span>{{ $t('chat.evolutionCardBadge') }}</span>
        </span>
        <span class="he-sub-badge">{{ signalLabel }}</span>
        <span class="he-sub-badge category">{{ categoryLabel }}</span>
        <span class="he-scope-badge" :class="{ global: localRecord.scope === 'user' }">{{ scopeLabel }}</span>
      </div>
    </div>

    <div v-if="!isReverted" class="he-body">
      <div class="he-title">{{ localRecord.title }}</div>
      <div class="he-rule">{{ localRecord.actionableRule }}</div>

      <div v-if="localRecord.beforeSummary || localRecord.afterSummary" class="he-contrast-wrap">
        <button type="button" class="he-contrast-toggle" data-evolution-contrast-toggle @click="showContrast = !showContrast">
          <span>{{ $t('chat.evolutionContrastToggle') }}</span>
          <span class="he-chevron" :class="{ open: showContrast }">›</span>
        </button>
        <div v-if="showContrast" class="he-contrast-box" data-evolution-contrast>
          <div v-if="localRecord.beforeSummary" class="he-contrast-row before">
            <span class="he-contrast-tag">{{ $t('chat.evolutionContrastBefore') }}</span>
            <span class="he-contrast-text">{{ localRecord.beforeSummary }}</span>
          </div>
          <div v-if="localRecord.afterSummary" class="he-contrast-row after">
            <span class="he-contrast-tag">{{ $t('chat.evolutionContrastAfter') }}</span>
            <span class="he-contrast-text">{{ localRecord.afterSummary }}</span>
          </div>
        </div>
      </div>

      <div class="he-actions">
        <button
          type="button"
          class="he-btn secondary"
          :disabled="busy"
          data-evolution-scope-btn
          @click="handleToggleScope"
        >
          {{ localRecord.scope === 'user' ? $t('chat.evolutionSwitchToProject') : $t('chat.evolutionSwitchToUser') }}
        </button>

        <button
          v-if="!localRecord.promotedSkillId"
          type="button"
          class="he-btn primary"
          :disabled="busy"
          data-evolution-promote-btn
          @click="handlePromoteSkill"
        >
          {{ $t('chat.evolutionPromoteSkillBtn') }}
        </button>
        <span v-else class="he-promoted-pill" data-evolution-promoted-pill>
          {{ $t('chat.evolutionPromotedBadge', { id: localRecord.promotedSkillId }) }}
        </span>

        <button
          type="button"
          class="he-btn ghost"
          :disabled="busy"
          data-evolution-revert-btn
          @click="handleRevert"
        >
          {{ $t('chat.evolutionRevertBtn') }}
        </button>
      </div>
    </div>

    <div v-else class="he-reverted-notice" data-evolution-reverted-notice>
      {{ $t('chat.evolutionRevertedBadge') }}
    </div>
    <div v-if="errorText" class="he-error" role="alert" data-evolution-error>{{ errorText }}</div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import {
  switchHarnessEvolutionScope,
  promoteHarnessEvolutionToSkill,
  revertHarnessEvolution,
} from '@/services/api.js'

const props = defineProps({
  evolution: { type: Object, required: true }
})

const emit = defineEmits(['updated'])

const localRecord = ref({ ...props.evolution })
const showContrast = ref(false)
const busy = ref(false)
// 操作失败的就地提示：不能只打 console——用户点了「撤销」没反应，会以为规则已经撤掉
const errorText = ref('')

function applyResult(res) {
  const updated = res?.data && res.data.id ? res.data : res
  if (!updated || !updated.id) {
    throw new Error(t('chat.evolutionActionFailed'))
  }
  localRecord.value = { ...localRecord.value, ...updated }
  emit('updated', localRecord.value)
}

function reportError(e) {
  errorText.value = (e && e.status === 403)
    ? t('chat.evolutionPromoteAdminOnly')
    : ((e && e.message) || t('chat.evolutionActionFailed'))
}

watch(
  () => props.evolution,
  (next) => {
    if (next) localRecord.value = { ...next }
  },
  { deep: true }
)

const isReverted = computed(() => localRecord.value?.status === 'REVERTED')

const signalLabel = computed(() => {
  const sig = localRecord.value?.signalType || ''
  if (sig === 'ROLLBACK_CORRECTION') return t('chat.evolutionSignalRollback')
  if (sig === 'STEER_INTERJECTION') return t('chat.evolutionSignalSteer')
  return t('chat.evolutionSignalSelfHealing')
})

const categoryLabel = computed(() => {
  return localRecord.value?.category === 'DOMAIN'
    ? t('chat.evolutionCategoryDomain')
    : t('chat.evolutionCategoryInvariant')
})

const scopeLabel = computed(() => {
  return localRecord.value?.scope === 'user'
    ? t('chat.evolutionScopeUser')
    : t('chat.evolutionScopeProject')
})

async function handleToggleScope() {
  if (busy.value || !localRecord.value?.id) return
  const targetScope = localRecord.value.scope === 'user' ? 'project' : 'user'
  busy.value = true
  errorText.value = ''
  try {
    const res = await switchHarnessEvolutionScope(localRecord.value.id, targetScope)
    applyResult(res)
  } catch (e) {
    console.warn('[HarnessEvolutionCard] switchScope failed:', e)
    reportError(e)
  } finally {
    busy.value = false
  }
}

async function handlePromoteSkill() {
  if (busy.value || !localRecord.value?.id) return
  busy.value = true
  errorText.value = ''
  try {
    const res = await promoteHarnessEvolutionToSkill(localRecord.value.id, {
      name: localRecord.value.suggestedSkillName,
      triggers: localRecord.value.suggestedSkillTriggers,
      actionableRule: localRecord.value.actionableRule,
      verificationPolicy: localRecord.value.verificationPolicy,
    })
    applyResult(res)
  } catch (e) {
    console.warn('[HarnessEvolutionCard] promoteToSkill failed:', e)
    reportError(e)
  } finally {
    busy.value = false
  }
}

async function handleRevert() {
  if (busy.value || !localRecord.value?.id) return
  busy.value = true
  errorText.value = ''
  try {
    const res = await revertHarnessEvolution(localRecord.value.id)
    applyResult(res)
  } catch (e) {
    console.warn('[HarnessEvolutionCard] revertEvolution failed:', e)
    reportError(e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.he-error {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-danger, #dc2626);
}
.harness-evolution-card {
  margin-top: var(--awd-space-2);
  padding: var(--awd-space-3);
  border-radius: var(--awd-radius-md);
  border: 1px solid var(--awd-border-subtle);
  border-left: 3px solid var(--awd-accent);
  background: var(--awd-surface);
  font-size: var(--awd-panel-fs);
  line-height: 1.45;
}
.harness-evolution-card.is-reverted {
  opacity: 0.72;
  border-left-color: var(--awd-text-3);
}
.he-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.he-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.he-main-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  padding: 1px 7px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}
.he-sub-badge {
  font-size: var(--awd-panel-fs-meta);
  padding: 1px 6px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-bg);
  color: var(--awd-text-2);
}
.he-scope-badge {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 500;
  padding: 1px 6px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}
.he-scope-badge.global {
  background: rgba(16, 185, 129, 0.14);
  color: var(--awd-accent-text);
}
.he-body {
  margin-top: 8px;
}
.he-title {
  font-weight: 600;
  color: var(--awd-text);
}
.he-rule {
  margin-top: 4px;
  color: var(--awd-text-2);
  font-size: var(--awd-panel-fs-meta);
}
.he-contrast-wrap {
  margin-top: 6px;
}
.he-contrast-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--awd-text-3);
  font-size: var(--awd-panel-fs-meta);
  cursor: pointer;
}
.he-chevron {
  display: inline-block;
  transition: transform 0.15s;
}
.he-chevron.open {
  transform: rotate(90deg);
}
.he-contrast-box {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-bg);
  display: grid;
  gap: 4px;
  font-size: var(--awd-panel-fs-meta);
}
.he-contrast-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.he-contrast-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
}
.he-contrast-row.after .he-contrast-tag {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}
.he-contrast-text {
  color: var(--awd-text-2);
}
.he-actions {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.he-btn {
  padding: 3px 9px;
  border-radius: var(--awd-radius-sm);
  font-size: var(--awd-panel-fs-meta);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--awd-border-subtle);
  background: var(--awd-bg);
  color: var(--awd-text);
  transition: background 0.15s, border-color 0.15s;
}
.he-btn:hover:not(:disabled) {
  background: var(--awd-surface-2);
  border-color: var(--awd-border);
}
.he-btn.primary {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  border-color: transparent;
}
.he-btn.ghost {
  background: transparent;
  border-color: transparent;
  color: var(--awd-text-3);
}
.he-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.he-promoted-pill {
  font-size: var(--awd-panel-fs-meta);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
}
.he-reverted-notice {
  margin-top: 6px;
  font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-3);
}
</style>
