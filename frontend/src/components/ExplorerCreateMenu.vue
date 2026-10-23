<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div v-if="visible" class="explorer-create-layer" @mousedown.stop @click.stop @contextmenu.prevent.stop>
    <div class="explorer-create-mask" @click="close()"></div>
    <div ref="menu" class="explorer-create-menu" role="menu" :aria-label="$t('fileTree.newItem')"
      :style="{ left: position.x + 'px', top: position.y + 'px' }" @keydown.stop="onKey($event, false)">
      <div v-for="item in rootItems" :key="item.key" role="menuitem" tabindex="-1"
        :data-key="item.key" :class="{ active: activeKey === item.key }"
        :aria-haspopup="item.key === 'file' ? 'menu' : undefined"
        :aria-expanded="item.key === 'file' ? String(submenuOpen) : undefined"
        @click="activate(item.key)" @mouseenter="onRootHover(item.key, $event)" @mousemove="onRootHover(item.key, $event)">
        <FileTypeIcon v-if="item.type" :type="item.type" />
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <path v-if="item.key === 'folder'" d="M3 7h7l2 2h9v11H3z M3 7V4h7l2 3" />
          <path v-else-if="item.key === 'recording'" d="M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M6 11v1a6 6 0 0 0 12 0v-1 M12 18v4 M8 22h8" />
          <path v-else d="M14 3H5v18h14V8z M14 3v5h5 M8 13h8 M12 9v8" />
        </svg>
        <span>{{ item.label }}</span>
        <span v-if="item.key === 'file'" class="submenu-arrow" aria-hidden="true">›</span>
      </div>
    </div>
    <div v-if="submenuOpen" ref="submenu" class="explorer-create-menu explorer-create-submenu" role="menu"
      :aria-label="$t('fileTree.newFileMenu')" :style="{ left: subPosition.x + 'px', top: subPosition.y + 'px' }"
      @mouseenter="clearAimTimer" @keydown.stop="onKey($event, true)">
      <div v-for="item in officeItems" :key="item.key" role="menuitem" tabindex="-1"
        :data-key="item.key" @click="choose(item.key)">
        <FileTypeIcon :type="item.type" /><span>{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import FileTypeIcon from '@/components/FileTypeIcon.vue'
import { isWithinSubmenuAim } from '@/utils/menuAim.js'
import { setGlobalOverlay } from '@/utils/overlayState.js'

let menuSequence = 0

export default {
  name: 'ExplorerCreateMenu',
  components: { FileTypeIcon },
  emits: ['select', 'close'],
  data() {
    return {
      visible: false, mode: 'toolbar', submenuOpen: false, activeKey: '',
      position: { x: 0, y: 0 }, subPosition: { x: 0, y: 0 }, subSide: 'right',
    }
  },
  computed: {
    officeItems() {
      return [
        { key: 'docx', type: 'docx', label: 'Word' },
        { key: 'pptx', type: 'pptx', label: 'PPT' },
        { key: 'xlsx', type: 'xlsx', label: 'Excel' },
      ]
    },
    rootItems() {
      const recording = { key: 'recording', label: this.$t('fileTree.newRecording') }
      return this.mode === 'toolbar' ? [...this.officeItems, recording] : [
        { key: 'file', label: this.$t('fileTree.newFileMenu') },
        { key: 'folder', label: this.$t('fileTree.newFolder') }, recording,
      ]
    },
  },
  created() { this.overlayHolder = `explorer-create-${++menuSequence}` },
  beforeUnmount() { this.visible = false; this.detach(); setGlobalOverlay(false, this.overlayHolder) },
  methods: {
    async open({ x, y, mode = 'toolbar', trigger = null }) {
      this.detach()
      this.trigger = trigger
      this.mode = mode
      this.submenuOpen = false
      this.activeKey = ''
      this.aimOrigin = null
      this.position = { x, y }
      this.visible = true
      setGlobalOverlay(true, this.overlayHolder)
      await this.$nextTick()
      if (!this.visible) return
      const rect = this.$refs.menu.getBoundingClientRect()
      this.position = this.clamp(x, y, rect)
      await this.$nextTick()
      if (!this.visible) return
      document.addEventListener('mousemove', this.onPointerMove)
      window.addEventListener('resize', this.dismiss)
      window.addEventListener('scroll', this.dismiss, true)
      this.focusItem(false, 0)
    },
    clamp(x, y, rect) {
      return { x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) }
    },
    clearAimTimer() { clearTimeout(this.aimTimer); this.aimTimer = null },
    detach() {
      this.clearAimTimer()
      document.removeEventListener('mousemove', this.onPointerMove)
      window.removeEventListener('resize', this.dismiss)
      window.removeEventListener('scroll', this.dismiss, true)
    },
    dismiss() { this.close(false) },
    close(restoreFocus = true) {
      this.detach()
      this.visible = false
      setGlobalOverlay(false, this.overlayHolder)
      this.submenuOpen = false
      if (restoreFocus) this.trigger?.focus?.({ preventScroll: true })
      this.$emit('close')
    },
    choose(key) { this.close(); this.$emit('select', key) },
    activate(key) {
      if (key === 'file') this.openSubmenu(true)
      else this.choose(key)
    },
    async openSubmenu(focus = false) {
      this.clearAimTimer()
      this.activeKey = 'file'
      this.submenuOpen = true
      await this.$nextTick()
      if (!this.submenuOpen || !this.visible) return
      const row = this.$refs.menu.querySelector('[data-key="file"]').getBoundingClientRect()
      const rect = this.$refs.submenu.getBoundingClientRect()
      const root = this.$refs.menu.getBoundingClientRect()
      this.subSide = root.right + 4 + rect.width <= window.innerWidth - 8 ? 'right' : 'left'
      this.subPosition = this.clamp(this.subSide === 'right' ? root.right + 4 : root.left - rect.width - 4, row.top - 4, rect)
      if (focus) this.focusItem(true, 0)
    },
    onRootHover(key, event) {
      if (key === 'file') {
        this.aimOrigin = { x: event.clientX, y: event.clientY }
        if (!this.submenuOpen) this.openSubmenu()
        this.clearAimTimer()
      } else if (!this.submenuOpen) this.activeKey = key
    },
    onPointerMove(event) {
      if (!this.submenuOpen) return
      const submenu = this.$refs.submenu
      if (!submenu || submenu.contains(event.target)) { this.clearAimTimer(); return }
      const row = event.target.closest?.('[data-key]')
      if (row?.dataset.key === 'file' && this.$refs.menu.contains(row)) return
      const key = row && this.$refs.menu.contains(row) ? row.dataset.key : ''
      const leave = () => { this.submenuOpen = false; this.activeKey = key; this.clearAimTimer() }
      if (isWithinSubmenuAim({ x: event.clientX, y: event.clientY }, this.aimOrigin, submenu.getBoundingClientRect(), this.subSide)) {
        this.clearAimTimer()
        this.aimTimer = setTimeout(leave, 350)
      } else leave()
    },
    focusItem(sub, index) {
      const items = (sub ? this.$refs.submenu : this.$refs.menu)?.querySelectorAll('[role=menuitem]')
      items?.[index]?.focus({ preventScroll: true })
    },
    onKey(event, sub) {
      const menu = sub ? this.$refs.submenu : this.$refs.menu
      const items = Array.from(menu.querySelectorAll('[role=menuitem]'))
      const index = items.indexOf(document.activeElement)
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Enter', ' '].includes(event.key)) event.preventDefault()
      if ((event.key === 'Enter' || event.key === ' ') && items[index]) {
        if (sub) this.choose(items[index].dataset.key)
        else this.activate(items[index].dataset.key)
      } else if (event.key === 'ArrowDown') this.focusItem(sub, (index + 1) % items.length)
      else if (event.key === 'ArrowUp') this.focusItem(sub, (index + items.length - 1) % items.length)
      else if (event.key === 'Home') this.focusItem(sub, 0)
      else if (event.key === 'End') this.focusItem(sub, items.length - 1)
      else if (event.key === 'ArrowRight' && !sub && items[index]?.dataset.key === 'file') this.openSubmenu(true)
      else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && sub) {
        this.submenuOpen = false; this.clearAimTimer(); this.focusItem(false, 0)
      } else if (event.key === 'Escape') this.close()
      else if (event.key === 'Tab') this.close(false)
    },
  },
}
</script>

<style scoped>
.explorer-create-layer { position: fixed; inset: 0; z-index: 2200; }
.explorer-create-mask { position: absolute; inset: 0; }
.explorer-create-menu {
  position: fixed; min-width: 172px; max-width: calc(100vw - 16px); padding: 4px;
  background: var(--awd-surface); color: var(--awd-text); border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-dialog, 8px); box-shadow: var(--awd-shadow-lg); box-sizing: border-box;
}
.explorer-create-menu [role=menuitem] {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: 100%; min-height: 32px; margin: 0; padding: 6px 10px;
  border: 0; border-radius: var(--awd-radius-sm, 4px); background: transparent; color: inherit;
  font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; white-space: nowrap;
}
.explorer-create-menu [role=menuitem]::after { border: 0; }
.explorer-create-menu [role=menuitem].active, .explorer-create-menu [role=menuitem]:focus-visible,
.explorer-create-submenu [role=menuitem]:hover { background: var(--awd-accent); color: var(--awd-text-on-accent); }
.explorer-create-menu [role=menuitem]:focus-visible { outline: var(--awd-focus-width, 2px) solid var(--awd-accent); outline-offset: -2px; }
.submenu-arrow { margin-left: auto; font-size: 18px; }
</style>
