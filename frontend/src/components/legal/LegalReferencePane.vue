<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="legal-reference-pane" :class="'kind-' + kind" :data-reference-kind="kind" :aria-label="$t('legalReference.kind.' + kind)">
    <header class="reference-toolbar">
      <span>{{ $t('legalReference.kind.' + kind) }}</span>
      <button v-if="safeUrl" type="button" class="reference-source-button" @click="$emit('open-url', safeUrl)">{{ $t('legalReference.openSource') }} <span aria-hidden="true">↗</span></button>
    </header>
    <div class="reference-scroll" tabindex="0" :aria-label="$t('legalReference.readingArea')">
      <article class="reference-paper">
        <header class="reference-document-heading">
          <p class="reference-document-type">{{ $t('legalReference.documentType.' + kind) }}</p>
          <h1>{{ reference.title || $t('legalReference.untitled') }}</h1>
        </header>
        <dl v-if="metadata.length" class="reference-metadata">
          <div v-for="(item, index) in metadata" :key="index"><dt>{{ $t(item.labelKey) }}</dt><dd>{{ item.value }}</dd></div>
        </dl>
        <aside class="reference-provenance">
          <div class="reference-provenance-heading"><strong>{{ reference.source || $t('legalReference.unknownSource') }}</strong><span :class="'status-' + status">{{ $t('legalReference.status.' + status) }}</span></div>
          <p>{{ $t(status === 'unverified' ? 'legalReference.unverifiedNote' : 'legalReference.evidenceNote') }}</p>
          <p v-if="reference.retrievedAt">{{ $t('legalReference.retrievedAt') }} <time>{{ reference.retrievedAt }}</time></p>
          <p v-if="reference.note">{{ reference.note }}</p>
          <p v-if="safeUrl" class="reference-source-url">{{ safeUrl }}</p>
        </aside>
        <div v-if="sections.length" class="reference-sections">
          <section v-for="(section, index) in sections" :key="index" class="reference-section">
            <h2>{{ $t(section.labelKey) }}</h2>
            <p>{{ section.text }}</p>
          </section>
        </div>
        <p v-else class="reference-empty">{{ $t('legalReference.emptyBody') }}</p>
        <footer class="reference-document-footer">{{ $t('legalReference.endOfMaterial') }}</footer>
      </article>
    </div>
  </section>
</template>

<script>
export default {
  name: 'LegalReferencePane',
  props: { reference: { type: Object, required: true } },
  emits: ['open-url'],
  computed: {
    kind() { return ['LAW', 'CASE', 'PENALTY'].includes(this.reference.kind) ? this.reference.kind : 'LAW' },
    status() { return ['retrieved', 'metadata', 'unavailable'].includes(this.reference.status) ? this.reference.status : 'unverified' },
    metadata() { return (this.reference.metadata || []).filter((item) => item.value) },
    sections() { return (this.reference.sections || []).filter((item) => item.text) },
    safeUrl() {
      try {
        const url = new URL(this.reference.url)
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
      } catch (_) { return '' }
    },
  },
}
</script>

<style scoped>
.legal-reference-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color: var(--awd-text); background: var(--awd-bg); text-align: start; container-type: inline-size; }
.reference-toolbar { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--awd-space-2); min-height: 44px; padding: var(--awd-space-2) var(--awd-space-4); border-block-end: 1px solid var(--awd-border); font-size: var(--awd-panel-fs); color: var(--awd-text-2); background: var(--awd-surface); }
.reference-source-button { display: inline-flex; align-items: center; gap: var(--awd-space-2); margin: 0; padding: var(--awd-space-1) var(--awd-space-2); min-height: 32px; font: inherit; line-height: 1.5; color: var(--awd-accent-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); cursor: pointer; }
.reference-source-button::after { border: 0; }
.reference-source-button:hover { background: var(--awd-accent-soft); }
.reference-source-button:focus-visible, .reference-scroll:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: -2px; }
.reference-scroll { flex: 1; min-height: 0; overflow: auto; padding: var(--awd-space-6); scrollbar-gutter: stable; }
.reference-paper { box-sizing: border-box; width: 100%; max-width: 860px; margin-inline: auto; padding: clamp(20px, 5cqw, 56px); border: 1px solid var(--awd-border); background: var(--awd-surface); box-shadow: var(--awd-shadow-sm); }
.reference-document-heading { padding-block-end: var(--awd-space-6); border-block-end: 2px solid var(--awd-accent); }
.reference-document-type { margin: 0 0 var(--awd-space-3); font-size: var(--awd-panel-fs-meta); letter-spacing: .12em; color: var(--awd-text-3); }
.reference-document-heading h1 { margin: 0; font-family: var(--awd-font-serif); font-size: clamp(20px, 3.6cqw, 28px); font-weight: 600; line-height: 1.75; overflow-wrap: anywhere; }
.kind-CASE .reference-document-heading, .kind-PENALTY .reference-document-heading { text-align: center; }
.kind-CASE .reference-document-heading { border-block-end-color: var(--awd-text-2); }
.kind-PENALTY .reference-document-heading { border-block-end-color: var(--awd-gold); }
.reference-metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--awd-space-4); margin: var(--awd-space-6) 0; font-size: var(--awd-font-size-body); line-height: 1.7; }
.reference-metadata > div { min-width: 0; }
.reference-metadata dt { margin-block-end: var(--awd-space-1); font-size: var(--awd-panel-fs-meta); color: var(--awd-text-3); }
.reference-metadata dd { margin: 0; overflow-wrap: anywhere; }
.reference-provenance { margin-block: var(--awd-space-6); padding: var(--awd-space-3) var(--awd-space-4); border-inline-start: 2px solid var(--awd-border-strong); background: var(--awd-surface-2); color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); line-height: 1.7; overflow-wrap: anywhere; }
.reference-provenance-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--awd-space-2); }
.reference-provenance-heading strong { font-weight: 600; }
.reference-provenance p { margin: var(--awd-space-1) 0 0; }
.reference-provenance time, .reference-source-url { direction: ltr; unicode-bidi: isolate; }
.status-unavailable, .status-unverified { color: var(--awd-danger-text); }
.reference-section + .reference-section { margin-block-start: var(--awd-space-7); }
.reference-section h2 { margin: 0 0 var(--awd-space-3); color: var(--awd-text-2); font-size: var(--awd-font-size-body); font-weight: 600; }
.reference-section p { margin: 0; font-family: var(--awd-font-serif); font-size: var(--awd-font-size-reading); line-height: 2; white-space: pre-wrap; overflow-wrap: anywhere; }
.kind-LAW .reference-section { padding-inline-start: var(--awd-space-4); border-inline-start: 1px solid var(--awd-border); }
.kind-PENALTY .reference-section h2 { padding-block-end: var(--awd-space-2); border-block-end: 1px solid var(--awd-border); }
.reference-empty { padding-block: var(--awd-space-6); color: var(--awd-text-3); font-size: var(--awd-font-size-body); line-height: 1.8; }
.reference-document-footer { margin-block-start: var(--awd-space-8); padding-block-start: var(--awd-space-4); border-block-start: 1px solid var(--awd-border); text-align: center; color: var(--awd-text-3); font-size: var(--awd-panel-fs-meta); }
@container (max-width: 480px) { .reference-scroll { padding: var(--awd-space-2); } .reference-paper { padding: var(--awd-space-4); } .reference-metadata { grid-template-columns: 1fr; } }
</style>
