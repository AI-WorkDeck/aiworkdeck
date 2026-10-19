<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div ref="dialog" class="awd-dialog-mask quick-look-mask" role="dialog" aria-modal="true" :aria-label="file.name" tabindex="-1" @click.self="$emit('close')">
    <section class="quick-look-window">
      <header class="quick-look-header">
        <span class="quick-look-hint">{{ $t('files.quickLookHint') }}</span>
        <button type="button" @click="$emit('open')">{{ $t('files.quickLookOpen') }}</button>
        <button type="button" :aria-label="$t('common.close')" @click="$emit('close')">×</button>
      </header>
      <FilePreview :key="file.id" :file="file" :project-id="projectId" :show-edit-btn="false" @extracted="$emit('extracted', $event)" />
    </section>
  </div>
</template>
<script>
import FilePreview from './FilePreview.vue'
import { setGlobalOverlay } from '@/utils/overlayState.js'
let holderSequence = 0
export default {
  name: 'QuickLookDialog',
  components: { FilePreview },
  emits: ['close', 'navigate', 'open', 'extracted'],
  props: { file: { type: Object, required: true }, projectId: { type: [String, Number], default: null } },
  mounted() {
    this._overlayHolder = `quick-look-${++holderSequence}`
    setGlobalOverlay(true, this._overlayHolder)
    window.addEventListener('keydown', this.onKeyDown, true)
    this.$refs.dialog?.focus({ preventScroll: true })
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onKeyDown, true)
    setGlobalOverlay(false, this._overlayHolder)
  },
  methods: {
    onKeyDown(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return
      if (!this.$refs.dialog?.contains(target) && !target?.closest?.('.file-tree')) return
      const key = event.key
      if (key === 'Tab') {
        const controls = Array.from(this.$refs.dialog.querySelectorAll('button:not(:disabled), [tabindex="0"]'))
        const index = controls.indexOf(document.activeElement)
        const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length
        event.preventDefault()
        controls[next]?.focus()
        return
      }
      if (event.shiftKey || !['Escape', ' ', 'ArrowUp', 'ArrowDown'].includes(key)) return
      if (key === ' ' && target?.closest?.('button, a, [role="button"]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (key === 'ArrowUp' || key === 'ArrowDown') this.$emit('navigate', key === 'ArrowUp' ? -1 : 1)
      else if (!event.repeat) this.$emit('close')
    },
  },
}
</script>
<style scoped>
.quick-look-mask { position: fixed; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 28px; background: var(--awd-overlay, rgba(0,0,0,.4)); -webkit-app-region: no-drag; }
.quick-look-mask :deep(*) { -webkit-app-region: no-drag; }
.quick-look-window { display: flex; flex-direction: column; width: min(1120px, 94vw); height: min(820px, 88vh); min-height: 0; overflow: hidden; background: var(--awd-bg); border: 1px solid var(--awd-border); border-radius: 10px; box-shadow: 0 12px 48px #0004; }
.quick-look-header { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--awd-border); }
.quick-look-hint { flex: 1; color: var(--awd-text-2); font-size: 12px; }
.quick-look-header button { margin: 0; height: auto; font-size: 13px; line-height: 1.5; padding: 5px 10px; color: var(--awd-text); background: var(--awd-bg); border: 1px solid var(--awd-border); border-radius: 5px; cursor: pointer; }
.quick-look-window :deep(.file-preview) { flex: 1; min-height: 0; }
</style>
