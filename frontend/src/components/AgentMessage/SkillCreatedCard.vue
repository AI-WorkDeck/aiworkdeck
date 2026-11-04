<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="skill-created-card" data-skill-created-card>
    <div class="sc-label">{{ $t('chat.skillCreatedLabel') }}</div>
    <div class="sc-name">{{ skill.name }}</div>
    <div v-if="skill.description" class="sc-desc">{{ skill.description }}</div>
    <dl class="sc-rows">
      <template v-if="skill.input">
        <dt>{{ $t('chat.skillCardInput') }}</dt>
        <dd>{{ skill.input }}</dd>
      </template>
      <template v-if="skill.rules">
        <dt>{{ $t('chat.skillCardRules') }}</dt>
        <dd>{{ skill.rules }}</dd>
      </template>
      <template v-if="skill.output">
        <dt>{{ $t('chat.skillCardOutput') }}</dt>
        <dd>{{ skill.output }}</dd>
      </template>
    </dl>
    <div class="sc-foot">
      <span class="sc-added">{{ $t('chat.skillCardAdded') }}</span>
      <button type="button" class="sc-open" @click="openDetail">{{ $t('chat.skillCardOpen') }}</button>
    </div>
    <div class="sc-hint">{{ $t('chat.skillCardTryHint', { name: skill.name }) }}</div>
  </section>
</template>

<script setup>
const props = defineProps({
  skill: { type: Object, required: true },
})

// 工作台（project-overview）订阅此事件打开 Skill 详情标签，发布按钮在详情页里。
const openDetail = () => {
  uni.$emit('awd:open-market-detail', { kind: 'skill', id: props.skill.id, name: props.skill.name })
}
</script>

<style scoped>
.skill-created-card {
  margin-top: var(--awd-space-2);
  padding: var(--awd-space-3);
  border-radius: var(--awd-radius-md);
  border: 1px solid var(--awd-border-subtle);
  border-inline-start: 3px solid var(--awd-accent);
  background: var(--awd-surface);
  font-size: var(--awd-panel-fs);
  line-height: 1.5;
}
.sc-label {
  font-size: 12px;
  color: var(--awd-text-2);
}
.sc-name {
  margin-top: 2px;
  font-weight: 600;
  color: var(--awd-text);
}
.sc-desc {
  margin-top: 2px;
  color: var(--awd-text-2);
}
.sc-rows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: var(--awd-space-2) 0 0;
}
.sc-rows dt {
  color: var(--awd-text-2);
  white-space: nowrap;
}
.sc-rows dd {
  margin: 0;
  white-space: pre-wrap;
  color: var(--awd-text);
}
.sc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--awd-space-2);
  margin-top: var(--awd-space-2);
}
.sc-added {
  font-size: 12px;
  color: var(--awd-text-2);
}
.sc-open {
  border: 1px solid var(--awd-border-subtle);
  background: transparent;
  border-radius: var(--awd-radius-sm);
  padding: 2px 10px;
  font-size: 12px;
  color: var(--awd-text);
  cursor: pointer;
}
.sc-open:hover {
  background: var(--awd-surface-2);
}
.sc-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--awd-text-3);
}
</style>
