<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="tag-filter">
    <view class="tag-filter-head">
      <component :is="'button'" type="button" class="tag-filter-button tag-filter-toggle" :aria-expanded="open" @click.stop="open = !open">
        <text class="tag-filter-chevron" :class="{ open }" aria-hidden="true">›</text>
        <text class="tag-filter-title">{{ $t('files.filterByTag') }}</text>
        <text class="tag-filter-total">{{ tags.length }}</text>
      </component>
      <component :is="'button'" v-if="modelValue.length" type="button" class="tag-filter-button tag-filter-clear" @click.stop="$emit('update:modelValue', [])">
        {{ $t('files.tagClear') }}
      </component>
    </view>

    <view v-if="selectedTags.length" class="tag-filter-selected">
      <component :is="'button'"
        v-for="tag in selectedTags"
        :key="tag.id"
        type="button"
        class="tag-filter-button selected-tag"
        :aria-label="$t('files.tagRemoveFilter', { name: tag.name })"
        :title="tag.name"
        @click.stop="toggleTag(tag.id)"
      >
        <text class="tag-dot" :style="{ backgroundColor: tag.color || 'var(--awd-panel-text-2)' }"></text>
        <text class="tag-name">{{ tag.name }}</text>
        <text class="tag-remove" aria-hidden="true">×</text>
      </component>
    </view>
    <text v-if="modelValue.length > 1" class="tag-filter-hint">{{ $t('files.tagMatchAll') }}</text>

    <view v-if="open" class="tag-filter-body">
      <view v-if="error" class="tag-filter-error" role="alert">
        <text>{{ error }}</text>
        <component :is="'button'" type="button" class="tag-filter-button tag-filter-retry" :disabled="loading" @click.stop="$emit('retry')">{{ $t('files.archiveRetry') }}</component>
      </view>
      <text v-else-if="loading" class="tag-filter-message" role="status">{{ $t('files.tagLoading') }}</text>
      <text v-else-if="!tags.length" class="tag-filter-message">{{ $t('files.tagEmptyHint') }}</text>
      <template v-if="tags.length">
        <component
          :is="'input'"
          type="text"
          :value="query"
          @input="query = $event.target.value"
          class="tag-filter-input"
          :placeholder="$t('files.tagFilterPlaceholder')"
          :aria-label="$t('files.tagFilterPlaceholder')"
        />
        <view class="tag-filter-options">
          <template v-for="group in tagGroups" :key="group.type">
            <template v-if="group.tags.length">
              <text class="tag-group-title">{{ $t(group.labelKey) }}</text>
              <component :is="'button'"
                v-for="tag in group.tags"
                :key="tag.id"
                type="button"
                class="tag-filter-button tag-option"
                :class="{ selected: isSelected(tag.id) }"
                :aria-pressed="isSelected(tag.id)"
                :title="tag.name"
                @click.stop="toggleTag(tag.id)"
              >
                <text class="tag-dot" :style="{ backgroundColor: tag.color || 'var(--awd-panel-text-2)' }"></text>
                <text class="tag-name">{{ tag.name }}</text>
                <text v-if="counts[tag.id]" class="tag-count">{{ counts[tag.id] }}</text>
                <text class="tag-check" aria-hidden="true">{{ isSelected(tag.id) ? '✓' : '' }}</text>
              </component>
            </template>
          </template>
          <text v-if="!filteredTags.length" class="tag-filter-message">{{ $t('files.tagNoMatch') }}</text>
        </view>
      </template>
    </view>
  </view>
</template>

<script>
import { TAG_TYPE_PARTY, TAG_TYPE_ISSUE, TAG_TYPE_NORMAL, normalizeTagType } from '@/utils/tagTypes.js'

export default {
  name: 'TagFilter',
  props: {
    tags: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] },
    counts: { type: Object, default: () => ({}) },
    loading: { type: Boolean, default: false },
    error: { type: String, default: '' }
  },
  emits: ['update:modelValue', 'retry'],
  data() {
    return { open: true, query: '' }
  },
  computed: {
    selectedTags() {
      return this.tags.filter(tag => this.isSelected(tag.id))
    },
    filteredTags() {
      const query = this.query.trim().toLowerCase()
      return this.tags.filter(tag => String(tag.name || '').toLowerCase().includes(query)).sort((a, b) => {
        const selected = Number(this.isSelected(b.id)) - Number(this.isSelected(a.id))
        return selected || (this.counts[b.id] || 0) - (this.counts[a.id] || 0)
          || String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
      })
    },
    tagGroups() {
      return [
        { type: TAG_TYPE_PARTY, labelKey: 'files.tagGroupParty' },
        { type: TAG_TYPE_ISSUE, labelKey: 'files.tagGroupIssue' },
        { type: TAG_TYPE_NORMAL, labelKey: 'files.tagGroupOther' }
      ].map(group => ({ ...group, tags: this.filteredTags.filter(tag => normalizeTagType(tag) === group.type) }))
    }
  },
  methods: {
    isSelected(id) {
      return this.modelValue.some(selected => String(selected) === String(id))
    },
    toggleTag(id) {
      this.$emit('update:modelValue', this.isSelected(id)
        ? this.modelValue.filter(selected => String(selected) !== String(id))
        : [...this.modelValue, id])
    }
  }
}
</script>

<style scoped>
.tag-filter {
  min-width: 0;
  padding: 0 var(--awd-panel-pad-x) var(--awd-panel-gap);
  color: var(--awd-panel-text);
}

.tag-filter-button {
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--awd-panel-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--awd-panel-fs);
  line-height: 1.4;
  cursor: pointer;
}

.tag-filter-button::after { border: 0; }
.tag-filter-button:hover { background: var(--awd-panel-hover); }
.tag-filter-button:focus-visible,
.tag-filter-input:focus-visible {
  outline: var(--awd-focus-width) solid var(--awd-accent-text);
  outline-offset: var(--awd-focus-offset);
}

.tag-filter-head,
.tag-filter-toggle,
.tag-option,
.selected-tag {
  display: flex;
  align-items: center;
  gap: var(--awd-space-1);
  min-width: 0;
}

.tag-filter-head { gap: var(--awd-panel-gap); }
.tag-filter .tag-filter-toggle { flex: 1; min-height: var(--awd-control-height); text-align: left; }
.tag-filter-chevron { flex: 0 0 12px; text-align: center; color: var(--awd-panel-text-2); }
.tag-filter-chevron.open { transform: rotate(90deg); }
.tag-filter-title { font-weight: 600; }
.tag-filter-total { color: var(--awd-panel-text-2); font-size: var(--awd-panel-fs-meta); }
.tag-filter .tag-filter-clear,
.tag-filter .tag-filter-retry { flex-shrink: 0; min-height: var(--awd-control-height); color: var(--awd-accent-text); }
.tag-filter-selected { display: flex; flex-wrap: wrap; gap: var(--awd-space-1); max-height: 88px; overflow-y: auto; padding: var(--awd-space-1); }
.tag-filter .selected-tag { max-width: 100%; min-height: 26px; padding: 2px 6px; border: 1px solid var(--awd-accent-text); background: var(--awd-panel-accent-wash); font-size: var(--awd-panel-fs-meta); }
.tag-dot { flex: 0 0 7px; width: 7px; height: 7px; border-radius: 50%; }
.tag-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.tag-remove { flex-shrink: 0; font-size: var(--awd-font-size-body); }
.tag-filter-hint,
.tag-filter-message { display: block; padding: var(--awd-space-1) 0; color: var(--awd-panel-text-2); font-size: var(--awd-panel-fs-meta); line-height: 1.5; overflow-wrap: anywhere; }
.tag-filter-input { box-sizing: border-box; width: 100%; min-width: 0; height: var(--awd-control-height); padding: 0 var(--awd-panel-gap); margin: var(--awd-space-1) 0; border: 1px solid var(--awd-panel-border); border-radius: var(--awd-panel-radius); background: var(--awd-surface); color: var(--awd-panel-text); font-size: var(--awd-panel-fs); }
.tag-filter-options { box-sizing: border-box; max-height: 144px; overflow-y: auto; padding: var(--awd-space-1); }
.tag-group-title { display: block; padding: var(--awd-space-1) 0; color: var(--awd-panel-text-2); font-weight: 600; font-size: var(--awd-panel-fs-meta); }
.tag-filter .tag-option { width: 100%; min-height: 28px; padding: var(--awd-space-1); text-align: left; }
.tag-filter .tag-option.selected { background: var(--awd-panel-accent-wash); color: var(--awd-accent-text); }
.tag-count { flex-shrink: 0; font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-2); }
.tag-check { flex: 0 0 14px; text-align: center; }
.tag-filter-error { display: flex; align-items: center; gap: var(--awd-panel-gap); color: var(--awd-danger-text); font-size: var(--awd-panel-fs-meta); }
.tag-filter-error > text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
</style>
