<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  AwdSelect — 桌面形制的下拉选择器。

  为什么不用 uni 的 <picker mode="selector">：它在 H5 上弹的是移动端那套
  底部抽屉（滚轮 + 取消/确定），在一个桌面工作台里点开设置页的模型选择器
  却从屏幕底部升起一块半屏面板，观感与整套外壳完全对不上。收起来的样子
  各页自己写 CSS 还能凑合，展开的样子是 uni 内置组件，改不动。

  API 刻意与 <picker mode="selector"> 对齐（range 是标签数组、value 是下标），
  迁移只需换标签名；差别只有一处：change 直接抛下标，不再包一层
  event.detail.value——那层是 uni 事件对象的形状，自绘组件没有理由模仿。

  触发器默认渲染「当前项 + 角标」，也可以用默认插槽整个换掉（调用方各有各的
  按钮形制：设置页是输入框样、广场是胶囊按钮样）。

  菜单用 position: fixed + 实时算坐标，不是 absolute：调用点大多在 scroll-view
  或带 overflow 的卡片里，absolute 会被裁掉。代价是滚动/缩放时坐标会失效，
  所以这两种情况直接关闭菜单（比让它飘在错误位置好）。
-->
<template>
  <view class="awd-select" :class="{ 'is-disabled': disabled, 'is-open': open }">
    <view class="awd-select-trigger" role="button" aria-haspopup="listbox" :aria-label="ariaLabel || currentLabel"
      :aria-expanded="open ? 'true' : 'false'" :aria-disabled="disabled ? 'true' : 'false'"
      :tabindex="disabled ? -1 : 0" @keydown="onTriggerKey" @tap.stop="toggle">
      <slot>
        <view class="awd-select-value">
          <text class="awd-select-text">{{ currentLabel }}</text>
          <text class="awd-select-caret">▾</text>
        </view>
      </slot>
    </view>

    <!-- 蒙层负责「点外面关掉」；透明但要吃掉点击，否则关菜单的同时会点到下面的东西 -->
    <view v-if="open" class="awd-select-mask" @tap.stop="close"></view>
    <view v-if="open" class="awd-select-menu" :class="{ 'is-searchable': searchable }" :style="menuStyle">
      <view v-if="searchable" class="awd-select-search">
        <input class="awd-select-search-input" :value="searchQuery" :placeholder="searchPlaceholder" :confirm-hold="true"
          :aria-label="searchLabel || ariaLabel" @input="onSearchInput" @keydown.stop="onSearchKey" />
      </view>
      <view role="listbox" :aria-label="ariaLabel || currentLabel">
        <view
          v-for="(option, position) in filteredOptions"
          :key="option.index"
          class="awd-select-item"
          role="option" :aria-selected="option.index === value ? 'true' : 'false'" tabindex="-1"
          @keydown="onOptionKey($event, position)"
          :class="{ 'is-active': option.index === value }"
          @tap.stop="pick(option.index)"
        >
          <text class="awd-select-item-text">{{ option.label }}</text>
          <text v-if="option.index === value" class="awd-select-check">✓</text>
        </view>
      </view>
      <view v-if="searchable && !filteredOptions.length" class="awd-select-empty" role="status">{{ emptyText }}</view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'AwdSelect',
  props: {
    /** 标签数组，与 <picker> 的 range 同义 */
    range: { type: Array, default: () => [] },
    ariaLabel: { type: String, default: '' },
    searchable: { type: Boolean, default: false },
    searchPlaceholder: { type: String, default: '' },
    searchLabel: { type: String, default: '' },
    emptyText: { type: String, default: '' },
    /** 当前选中项下标 */
    value: { type: Number, default: 0 },
    disabled: { type: Boolean, default: false },
  },
  emits: ['change', 'cancel'],
  data() {
    return {
      open: false,
      searchQuery: '',
      menuStyle: {},
    }
  },
  computed: {
    filteredOptions() {
      const options = this.range.map((label, index) => ({ label, index }))
      const query = this.searchable ? this.searchQuery.trim().toLocaleLowerCase() : ''
      return query ? options.filter(option => String(option.label).toLocaleLowerCase().includes(query)) : options
    },
    currentLabel() {
      return this.range[this.value] !== undefined ? this.range[this.value] : ''
    },
  },
  updated() {
    if (this.searchable && this.open) this.syncSearchLabel()
  },
  beforeUnmount() {
    this.detachDismiss()
  },
  methods: {
    onTriggerKey(event) {
      if (this.disabled) return
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault()
        if (!this.open) this.openMenu()
        this.$nextTick(() => {
          if (this.searchable) this.focusSearch()
          else this.focusOption(event.key === 'ArrowUp' ? this.range.length - 1 : this.value)
        })
      } else if (event.key === 'Escape') this.close()
    },
    focusOption(index) {
      const items = this.$el && this.$el.querySelectorAll('.awd-select-item')
      if (items && items.length) items[Math.max(0, Math.min(index, items.length - 1))].focus()
    },
    onOptionKey(event, index) {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) event.preventDefault()
      const options = this.filteredOptions
      if (event.key === 'ArrowDown' && options.length) this.focusOption((index + 1) % options.length)
      else if (event.key === 'ArrowUp' && options.length) this.focusOption((index + options.length - 1) % options.length)
      else if (event.key === 'Home') this.focusOption(0)
      else if (event.key === 'End') this.focusOption(options.length - 1)
      else if ((event.key === 'Enter' || event.key === ' ') && options[index]) { this.pick(options[index].index); this.focusTrigger() }
      else if (event.key === 'Escape') { this.close(); this.focusTrigger() }
      else if (event.key === 'Tab') this.close()
    },
    syncSearchLabel() {
      const field = this.$el?.querySelector('.awd-select-search-input')
      const input = field?.querySelector('input') || field
      input?.setAttribute?.('aria-label', this.searchLabel || this.ariaLabel)
      return input
    },
    focusSearch() {
      this.syncSearchLabel()?.focus()
    },
    onSearchInput(event) {
      // uni-h5 的 v-model 会节流；键盘选择必须使用本次 input 的完整值。
      this.searchQuery = event.detail?.value ?? event.target?.value ?? ''
    },
    onSearchKey(event) {
      if (event.isComposing) return
      // Uni 也可能节流 @input；提交/导航前读取原生输入的最新文本。
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) && typeof event.target?.value === 'string') {
        this.searchQuery = event.target.value
      }
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) event.preventDefault()
      if (event.key === 'ArrowDown') this.$nextTick(() => this.focusOption(0))
      else if (event.key === 'ArrowUp') this.$nextTick(() => this.focusOption(this.filteredOptions.length - 1))
      else if (event.key === 'Enter' && this.filteredOptions.length) {
        this.pick(this.filteredOptions[0].index)
        this.focusTrigger()
      } else if (event.key === 'Escape') { this.close(); this.focusTrigger() }
      else if (event.key === 'Tab') this.close()
      // 空格和 Home/End 留给输入框编辑，不冒充列表选项快捷键。
    },
    focusTrigger() {
      this.$nextTick(() => this.$el?.querySelector('.awd-select-trigger')?.focus())
    },
    toggle() {
      if (this.disabled) return
      if (this.open) this.close()
      else this.openMenu()
    },
    openMenu() {
      this.searchQuery = ''
      this.open = true
      this.$nextTick(() => {
        this.placeMenu()
        this.attachDismiss()
        if (this.searchable) this.focusSearch()
      })
    },
    close() {
      if (!this.open) return
      this.open = false
      this.detachDismiss()
      this.$emit('cancel')
    },
    pick(i) {
      this.open = false
      this.detachDismiss()
      if (i !== this.value) this.$emit('change', i)
    },
    placeMenu() {
      const el = this.$el && this.$el.querySelector('.awd-select-trigger')
      if (!el) return
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight || 800
      // 下方装不下就翻到上方开——设置页的下拉常常就在可视区底部
      const below = vh - r.bottom
      const openUp = below < 180 && r.top > below
      const vw = window.innerWidth || 800
      const width = Math.min(r.width, vw - 8)
      const horizontal = this.searchable
        ? { left: Math.max(4, Math.min(r.left, vw - width - 4)) + 'px', width: width + 'px' }
        : { left: r.left + 'px', minWidth: r.width + 'px' }
      this.menuStyle = openUp
        ? { ...horizontal, bottom: (vh - r.top + 4) + 'px' }
        : { ...horizontal, top: (r.bottom + 4) + 'px' }
    },
    attachDismiss() {
      this._dismiss = (e) => {
        // 下拉菜单自己超过 280px 就会出现内部滚动条（见组件头注释）。滚动事件不
        // 冒泡，但这里用的是捕获段（第三参 true），会连菜单自己内部的滚动也一起
        // 收到——不加这道判断，用户在菜单里往下滚一下，菜单立刻把自己关掉，列表
        // 长一点根本没法用。只有目标不在菜单内部（真正可能让触发器坐标失效的
        // 外部容器滚动）时才按原逻辑关闭。
        const menuEl = this.$el && this.$el.querySelector('.awd-select-menu')
        if (menuEl && e && e.target && menuEl.contains(e.target)) return
        this.close()
      }
      // 捕获段：调用点大多在 scroll-view 里，滚动事件不冒泡到 window
      window.addEventListener('scroll', this._dismiss, true)
      window.addEventListener('resize', this._dismiss)
    },
    detachDismiss() {
      if (!this._dismiss) return
      window.removeEventListener('scroll', this._dismiss, true)
      window.removeEventListener('resize', this._dismiss)
      this._dismiss = null
    },
  },
}
</script>

<style lang="scss" scoped>
.awd-select {
  position: relative;
  display: block;
  min-width: 0;
}

.awd-select-trigger {
  cursor: pointer;
}

.awd-select-trigger:focus-visible, .awd-select-item:focus-visible, .awd-select-search-input:focus-within {
  outline: var(--awd-focus-width) solid var(--awd-accent-text);
  outline-offset: var(--awd-focus-offset);
}

.awd-select.is-disabled .awd-select-trigger {
  cursor: not-allowed;
  opacity: 0.55;
}

/* 默认触发器：与设置页表单里的输入框同形制 */
.awd-select-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--awd-space-2);
  min-height: var(--awd-control-height);
  padding: var(--awd-space-1) var(--awd-space-3);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  background-color: var(--awd-surface);
  font-size: var(--awd-font-size-body);
  color: var(--awd-text);
  box-sizing: border-box;
  transition: border-color var(--awd-motion-fast) ease;
}

.awd-select-value:hover,
.awd-select.is-open .awd-select-value {
  border-color: var(--awd-accent-text);
}

.awd-select-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.awd-select-caret {
  flex: none;
  color: var(--awd-text-2);
  font-size: var(--awd-panel-fs);
  transition: transform var(--awd-motion-fast) ease;
}

.awd-select.is-open .awd-select-caret {
  transform: rotate(180deg);
}

.awd-select-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
}

.awd-select-menu {
  position: fixed;
  z-index: 4001;
  max-height: 280px;
  overflow-y: auto;
  padding: var(--awd-space-1);
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-dialog);
  box-shadow: var(--awd-shadow-md);
}

.awd-select-menu.is-searchable { box-sizing: border-box; }

.awd-select-search {
  position: sticky;
  top: 0;
  padding-bottom: var(--awd-space-1);
  background: var(--awd-surface);
}

.awd-select-search-input {
  display: block;
  width: 100%;
  min-height: var(--awd-control-height);
  box-sizing: border-box;
  padding: 0 var(--awd-space-2);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  background: var(--awd-surface);
  color: var(--awd-text);
  font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui);
}

.awd-select-search-input::placeholder,
.awd-select-search-input :deep(.uni-input-placeholder) { color: var(--awd-text-2); }

.awd-select-empty {
  padding: var(--awd-space-2);
  color: var(--awd-text-2);
  font-size: var(--awd-font-size-body);
  line-height: var(--awd-line-height-ui);
  overflow-wrap: anywhere;
}

.awd-select-menu.is-searchable .awd-select-item { white-space: normal; }
.awd-select-menu.is-searchable .awd-select-item-text { min-width: 0; overflow-wrap: anywhere; }

.awd-select-item {
  min-height: var(--awd-panel-row-h);
  box-sizing: border-box;
  line-height: var(--awd-line-height-ui);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--awd-space-3);
  padding: var(--awd-space-1) var(--awd-panel-pad-x);
  border-radius: var(--awd-radius-sm);
  font-size: var(--awd-font-size-body);
  color: var(--awd-text);
  cursor: pointer;
  white-space: nowrap;
}

.awd-select-item:hover {
  background: var(--awd-bg);
}

.awd-select-item.is-active {
  color: var(--awd-accent-text);
  font-weight: 600;
}

.awd-select-check {
  flex: none;
  color: var(--awd-accent-text);
  font-size: var(--awd-panel-fs);
}
@media (pointer: coarse) {
  .awd-select-value, .awd-select-item, .awd-select-search-input { min-height: var(--awd-control-height-touch); }
}
@media (prefers-reduced-motion: reduce) {
  .awd-select-value, .awd-select-caret { transition: none; }
}
</style>
