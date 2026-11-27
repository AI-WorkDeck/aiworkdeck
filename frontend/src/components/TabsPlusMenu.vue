<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- D30：标签栏末尾「＋」的小菜单。原先「＋」直接在磁盘上复制当前文档，律师不会这么理解「＋」；
     现在只提供新建 Word / Excel / PowerPoint 与新浏览器标签，「创建副本」留在资源管理器右键菜单。
     交互与样式同 ExplorerCreateMenu（遮罩关闭、方向键/Home/End/Enter/Esc、关闭后焦点还给「＋」）。 -->
<template>
  <div v-if="visible" class="tabs-plus-layer" @mousedown.stop @click.stop @contextmenu.prevent.stop>
    <div class="tabs-plus-mask" @click="close()"></div>
    <div ref="menu" class="tabs-plus-menu" role="menu" :aria-label="$t('workbench.plusMenu.aria')"
      :style="{ left: position.x + 'px', top: position.y + 'px' }" @keydown.stop="onKey">
      <div v-for="item in items" :key="item.key" role="menuitem" tabindex="-1" :data-key="item.key" @click="choose(item.key)">
        <FileTypeIcon v-if="item.type" :type="item.type" />
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M3 9h18 M12 6.5h6" />
        </svg>
        <span>{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import FileTypeIcon from '@/components/FileTypeIcon.vue'
import { setGlobalOverlay } from '@/utils/overlayState.js'

let menuSequence = 0

export const TABS_PLUS_ITEMS = ['docx', 'xlsx', 'pptx', 'web']

export default {
  name: 'TabsPlusMenu',
  components: { FileTypeIcon },
  emits: ['select', 'close'],
  data() {
    return { visible: false, position: { x: 0, y: 0 } }
  },
  computed: {
    items() {
      return [
        { key: 'docx', type: 'docx', label: this.$t('workbench.plusMenu.newWord') },
        { key: 'xlsx', type: 'xlsx', label: this.$t('workbench.plusMenu.newExcel') },
        { key: 'pptx', type: 'pptx', label: this.$t('workbench.plusMenu.newPowerPoint') },
        { key: 'web', type: '', label: this.$t('workbench.plusMenu.newBrowserTab') },
      ]
    },
  },
  created() { this.overlayHolder = `tabs-plus-${++menuSequence}` },
  beforeUnmount() { this.visible = false; this.detach(); setGlobalOverlay(false, this.overlayHolder) },
  methods: {
    /** 在「＋」下沿打开，右对齐到它（标签栏在窗口右侧时不会溢出）。 */
    async open({ anchor, trigger = null }) {
      this.detach()
      this.trigger = trigger
      const r = anchor || { left: 0, right: 0, bottom: 0 }
      this.position = { x: r.left, y: r.bottom + 4 }
      this.visible = true
      setGlobalOverlay(true, this.overlayHolder)
      await this.$nextTick()
      if (!this.visible || !this.$refs.menu) return
      const rect = this.$refs.menu.getBoundingClientRect()
      const x = Math.min(r.left, r.right - rect.width)
      this.position = {
        x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - rect.height - 8)),
      }
      window.addEventListener('resize', this.dismiss)
      window.addEventListener('scroll', this.dismiss, true)
      this.focusItem(0)
    },
    detach() {
      window.removeEventListener('resize', this.dismiss)
      window.removeEventListener('scroll', this.dismiss, true)
    },
    dismiss() { this.close(false) },
    close(restoreFocus = true) {
      this.detach()
      this.visible = false
      setGlobalOverlay(false, this.overlayHolder)
      if (restoreFocus) this.trigger?.focus?.({ preventScroll: true })
      this.$emit('close')
    },
    choose(key) { this.close(); this.$emit('select', key) },
    focusItem(index) {
      const items = this.$refs.menu?.querySelectorAll('[role=menuitem]')
      items?.[index]?.focus({ preventScroll: true })
    },
    onKey(event) {
      const items = Array.from(this.$refs.menu.querySelectorAll('[role=menuitem]'))
      const index = items.indexOf(document.activeElement)
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Enter', ' '].includes(event.key)) event.preventDefault()
      if ((event.key === 'Enter' || event.key === ' ') && items[index]) this.choose(items[index].dataset.key)
      else if (event.key === 'ArrowDown') this.focusItem((index + 1) % items.length)
      else if (event.key === 'ArrowUp') this.focusItem((index + items.length - 1) % items.length)
      else if (event.key === 'Home') this.focusItem(0)
      else if (event.key === 'End') this.focusItem(items.length - 1)
      else if (event.key === 'Escape') this.close()
      else if (event.key === 'Tab') this.close(false)
    },
  },
}
</script>

<style scoped>
.tabs-plus-layer { position: fixed; inset: 0; z-index: 2200; }
.tabs-plus-mask { position: absolute; inset: 0; }
.tabs-plus-menu {
  position: fixed; min-width: 200px; max-width: calc(100vw - 16px); padding: 4px;
  background: var(--awd-surface); color: var(--awd-text); border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-dialog, 8px); box-shadow: var(--awd-shadow-lg); box-sizing: border-box;
}
.tabs-plus-menu [role=menuitem] {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: 100%; min-height: 32px; margin: 0; padding: 6px 10px;
  border-radius: var(--awd-radius-sm, 4px); background: transparent; color: inherit;
  font-size: 13px; line-height: 20px; text-align: start; cursor: pointer; white-space: nowrap;
}
.tabs-plus-menu [role=menuitem]:hover,
.tabs-plus-menu [role=menuitem]:focus-visible { background: var(--awd-accent); color: var(--awd-text-on-accent); }
.tabs-plus-menu [role=menuitem]:focus-visible { outline: var(--awd-focus-width, 2px) solid var(--awd-accent); outline-offset: -2px; }
</style>
