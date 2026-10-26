<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="evidence-tags" @tap.stop @mousedown.stop>
    <view class="tag-options">
      <button v-for="tag in options" :key="tag" role="button" class="tag-chip"
        :class="{ on: tag === modelValue }" :aria-pressed="tag === modelValue" :disabled="disabled" :tabindex="disabled ? -1 : 0" :aria-disabled="disabled"
        @click.stop="!disabled && $emit('change', tag)" @keydown.enter.prevent.stop="!disabled && $emit('change', tag)" @keydown.space.prevent.stop="!disabled && $emit('change', tag)">{{ label(tag) }}</button>
      <button role="button" tabindex="0" class="tag-manage" :aria-expanded="editing" @click.stop="toggleEditor" @keydown.enter.prevent.stop="toggleEditor" @keydown.space.prevent.stop="toggleEditor">{{ $t('workbench.evidence.tags.manage') }}</button>
    </view>
    <view v-if="editing" class="tag-editor" :class="{ floating }" @keydown.esc.stop="editing = false">
      <text class="tag-title">{{ $t('workbench.evidence.tags.title') }}</text>
      <text class="tag-hint">{{ $t('workbench.evidence.tags.hint') }}</text>
      <view class="tag-presets">
        <text>{{ $t('workbench.evidence.tags.presets') }}</text>
        <button v-for="preset in presets" :key="preset" role="button" tabindex="0" class="tag-chip" @click.stop="usePreset(preset)" @keydown.enter.prevent.stop="usePreset(preset)" @keydown.space.prevent.stop="usePreset(preset)">{{ $t('workbench.evidence.tags.' + preset) }}</button>
      </view>
      <view class="tag-rows">
        <view v-for="(tag, index) in draft" :key="index" class="tag-row">
          <input class="tag-input" :value="tag" :maxlength="maxLength" :aria-label="$t('workbench.evidence.tags.name', { index: index + 1 })"
            @input="updateDraft(index, $event)" @blur="updateDraft(index, $event)" @confirm="updateDraft(index, $event)" />
          <button role="button" tabindex="0" class="tag-manage" :aria-label="$t('workbench.evidence.tags.removeName', { name: tag })" @click.stop="draft.splice(index, 1)" @keydown.enter.prevent.stop="draft.splice(index, 1)" @keydown.space.prevent.stop="draft.splice(index, 1)">{{ $t('workbench.evidence.tags.remove') }}</button>
        </view>
      </view>
      <button v-if="draft.length < maxTags" role="button" tabindex="0" class="tag-manage" @click.stop="draft.push('')" @keydown.enter.prevent.stop="draft.push('')" @keydown.space.prevent.stop="draft.push('')">+ {{ $t('workbench.evidence.tags.add') }}</button>
      <text v-if="error" class="tag-error" role="alert">{{ error }}</text>
      <view class="tag-actions">
        <button role="button" tabindex="0" class="tag-manage" @click.stop="editing = false" @keydown.enter.prevent.stop="editing = false" @keydown.space.prevent.stop="editing = false">{{ $t('workbench.evidence.tags.cancel') }}</button>
        <button role="button" tabindex="0" class="tag-chip on" @click.stop="save" @keydown.enter.prevent.stop="save" @keydown.space.prevent.stop="save">{{ $t('workbench.evidence.tags.save') }}</button>
      </view>
    </view>
  </view>
</template>

<script>
import {
  EVIDENCE_TAGS_CHANGED, EVIDENCE_TAG_PRESETS, MAX_EVIDENCE_TAGS, MAX_EVIDENCE_TAG_LENGTH,
  evidenceTagLabel, evidenceTagPreset, evidenceTagsFromLabels, loadEvidenceTags, saveEvidenceTags,
} from '@/utils/evidenceTags.js'

export default {
  name: 'EvidenceTagPicker',
  emits: ['change'],
  props: {
    modelValue: { type: String, default: '' },
    floating: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  data() {
    return { tags: loadEvidenceTags(), editing: false, draft: [], error: '', presets: EVIDENCE_TAG_PRESETS, maxTags: MAX_EVIDENCE_TAGS, maxLength: MAX_EVIDENCE_TAG_LENGTH }
  },
  computed: {
    options() {
      return this.modelValue && !this.tags.includes(this.modelValue) ? [this.modelValue, ...this.tags] : this.tags
    },
  },
  mounted() { uni.$on(EVIDENCE_TAGS_CHANGED, this.reload) },
  beforeUnmount() { uni.$off(EVIDENCE_TAGS_CHANGED, this.reload) },
  methods: {
    updateDraft(index, event) {
      this.draft[index] = event.detail ? event.detail.value : event.target.value
    },
    label(tag) { return evidenceTagLabel(tag, (key, params) => this.$t(key, params)) },
    reload() { this.tags = loadEvidenceTags() },
    toggleEditor() {
      if (!this.editing) {
        this.reload()
        this.draft = this.tags.map(this.label)
        this.error = ''
      }
      this.editing = !this.editing
    },
    usePreset(name) {
      this.draft = evidenceTagPreset(name, (key) => this.$t(key)).map(this.label)
      this.error = ''
    },
    save() {
      let tags
      try {
        tags = evidenceTagsFromLabels(this.draft, (key) => this.$t(key))
      } catch (e) {
        this.error = this.$t('workbench.evidence.tags.' + e.message)
        return
      }
      try {
        this.tags = saveEvidenceTags(tags)
        this.editing = false
        this.error = ''
      } catch (_) {
        this.error = this.$t('workbench.evidence.tags.saveFailed')
      }
    },
  },
}
</script>

<style scoped>
.evidence-tags { min-width: 0; max-width: 100%; color: var(--awd-text); font-size: 12px; }
.tag-options, .tag-presets, .tag-row, .tag-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.tag-chip, .tag-manage { margin: 0; padding: 3px 10px; font: inherit; line-height: 1.5; cursor: pointer; white-space: normal; overflow-wrap: anywhere; }
.tag-chip::after, .tag-manage::after { border: none; }
.tag-chip { border-radius: 999px; border: 1px solid var(--awd-border); background: var(--awd-bg); color: var(--awd-text-2); }
.tag-chip:hover, .tag-chip.on { border-color: var(--awd-accent); color: var(--awd-accent-text); }
.tag-chip.on { background: var(--awd-accent-soft); font-weight: 600; }
.tag-chip[disabled] { opacity: .6; cursor: wait; }
.tag-manage { border: none; background: transparent; color: var(--awd-accent-text); }
.tag-chip:focus-visible, .tag-manage:focus-visible, .tag-input:focus-within { outline: 2px solid var(--awd-accent); outline-offset: 2px; }
.tag-editor { box-sizing: border-box; width: 360px; max-width: 100%; max-height: min(380px, 50vh); overflow-y: auto; margin-top: 8px; padding: 12px; border: 1px solid var(--awd-border); border-radius: 8px; background: var(--awd-surface); }
.tag-editor.floating { position: absolute; left: 0; bottom: calc(100% + 8px); box-shadow: 0 6px 20px rgba(0, 0, 0, .12); }
.tag-title, .tag-hint, .tag-error { display: block; }
.tag-title { font-weight: 600; }
.tag-hint { color: var(--awd-text-2); line-height: 1.6; margin: 6px 0 10px; }
.tag-presets { margin-bottom: 10px; color: var(--awd-text-2); }
.tag-rows { display: flex; flex-direction: column; gap: 6px; }
.tag-input { box-sizing: border-box; flex: 1; min-width: 0; width: 0; height: 30px; padding: 4px 8px; border: 1px solid var(--awd-border); border-radius: 4px; background: var(--awd-bg); color: var(--awd-text); font: inherit; }
.tag-actions { justify-content: flex-end; margin-top: 10px; }
.tag-error { color: var(--awd-danger-text); margin-top: 6px; }
</style>
