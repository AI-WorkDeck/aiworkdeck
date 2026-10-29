<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <article class="legal-reference-card" :class="'kind-' + kind" :data-reference-kind="kind">
    <header class="reference-card-heading">
      <span class="reference-kind">{{ $t('legalReference.kind.' + kind) }}</span>
      <button type="button" class="reference-open" :title="$t('legalReference.openTab')" :aria-label="$t('legalReference.openTab')" @click="$emit('open', reference)">
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
      </button>
    </header>
    <h3 class="reference-title">{{ reference.title || $t('legalReference.untitled') }}</h3>
    <dl v-if="metadata.length" class="reference-card-meta">
      <div v-for="(item, index) in metadata" :key="index"><dt>{{ $t(item.labelKey) }}</dt><dd>{{ item.value }}</dd></div>
    </dl>
    <p v-if="excerpt" class="reference-excerpt">{{ excerpt }}</p>
    <footer class="reference-card-footer">
      <span class="reference-source">{{ reference.source || $t('legalReference.unknownSource') }}</span>
      <span class="reference-status" :class="'status-' + status">{{ $t('legalReference.status.' + status) }}</span>
    </footer>
  </article>
</template>

<script>
export default {
  name: 'LegalReferenceCard',
  props: { reference: { type: Object, required: true } },
  emits: ['open'],
  computed: {
    kind() { return ['LAW', 'CASE', 'PENALTY'].includes(this.reference.kind) ? this.reference.kind : 'LAW' },
    status() { return ['retrieved', 'metadata', 'unavailable'].includes(this.reference.status) ? this.reference.status : 'unverified' },
    metadata() { return (this.reference.metadata || []).filter((item) => item.value).slice(0, 3) },
    excerpt() { return (this.reference.sections || []).find((item) => item.text)?.text || '' },
  },
}
</script>

<style scoped>
.legal-reference-card { box-sizing: border-box; min-width: 0; max-width: 100%; margin-block: var(--awd-space-3); padding: var(--awd-space-4); color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-inline-start: 3px solid var(--awd-accent); border-radius: var(--awd-radius-md); text-align: start; }
.kind-CASE { border-inline-start-color: var(--awd-text-2); }
.kind-PENALTY { border-inline-start-color: var(--awd-gold); }
.reference-card-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--awd-space-2); }
.reference-kind { color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); font-weight: 600; letter-spacing: .06em; }
.reference-open { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 32px; height: 32px; margin: 0; padding: 0; color: var(--awd-text-2); background: transparent; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); cursor: pointer; }
.reference-open:hover { color: var(--awd-accent-text); background: var(--awd-accent-soft); }
.reference-open:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 2px; }
.reference-open::after { border: 0; }
.reference-title { margin: var(--awd-space-2) 0 var(--awd-space-3); font-family: var(--awd-font-serif); font-size: var(--awd-font-size-reading); font-weight: 600; line-height: 1.65; overflow-wrap: anywhere; }
.reference-card-meta { display: grid; gap: var(--awd-space-1); margin: 0; font-size: var(--awd-panel-fs-meta); line-height: 1.6; }
.reference-card-meta > div { display: flex; gap: var(--awd-space-2); min-width: 0; }
.reference-card-meta dt { color: var(--awd-text-3); flex: none; }
.reference-card-meta dd { color: var(--awd-text-2); margin: 0; overflow-wrap: anywhere; }
.reference-excerpt { margin: var(--awd-space-3) 0 0; color: var(--awd-text-2); font-size: var(--awd-font-size-body); line-height: 1.8; white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.reference-card-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--awd-space-2); margin-block-start: var(--awd-space-3); padding-block-start: var(--awd-space-2); border-block-start: 1px solid var(--awd-border); color: var(--awd-text-3); font-size: var(--awd-panel-fs-meta); line-height: 1.5; }
.reference-source { overflow-wrap: anywhere; min-width: 0; }
.reference-status { color: var(--awd-text-2); }
.status-unavailable, .status-unverified { color: var(--awd-danger-text); }
</style>
