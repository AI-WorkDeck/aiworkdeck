<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  AwdSwitch — 桌面形制的开关。

  替掉 uni 的 <switch>：那个组件的尺寸写死在内部，调用点只能靠
  `style="transform: scale(0.7)"` 硬缩（广场两处、插件详情一处都是这么写的），
  缩完描边和圆角一起变形，跟旁边的按钮/输入框对不齐。这里直接自绘，
  尺寸由 CSS 说了算，颜色跟森林绿主色走。

  change 抛布尔值本身，不是 uni 事件对象的 event.detail.value 形状。
-->
<template>
  <view
    class="awd-switch"
    :class="{ 'is-on': checked, 'is-disabled': disabled }"
    role="switch"
    :aria-label="ariaLabel || undefined"
    :aria-checked="checked ? 'true' : 'false'"
    :aria-disabled="disabled ? 'true' : 'false'"
    :tabindex="disabled ? -1 : 0"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
    @tap.stop="toggle"
  >
    <view class="awd-switch-knob"></view>
  </view>
</template>

<script>
export default {
  name: 'AwdSwitch',
  props: {
    checked: { type: Boolean, default: false },
    ariaLabel: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
  },
  emits: ['change'],
  methods: {
    toggle() {
      if (this.disabled) return
      this.$emit('change', !this.checked)
    },
  },
}
</script>

<style scoped>
.awd-switch {
  position: relative;
  flex: none;
  width: var(--awd-switch-width);
  min-height: var(--awd-panel-row-h);
  cursor: pointer;
}
.awd-switch::before {
  content: '';
  position: absolute;
  inset: 50% auto auto 50%;
  width: var(--awd-switch-width);
  height: var(--awd-switch-track-height);
  transform: translate(-50%, -50%);
  border-radius: var(--awd-switch-track-height);
  background: var(--awd-surface-3);
  border: 1px solid var(--awd-text-2);
  box-sizing: border-box;
  transition: background var(--awd-motion-fast) ease;
}
.awd-switch.is-on::before { background: var(--awd-accent); border-color: var(--awd-accent-text); }
.awd-switch.is-disabled { opacity: 0.5; cursor: not-allowed; }
.awd-switch:focus-visible {
  outline: var(--awd-focus-width) solid var(--awd-accent-text);
  outline-offset: var(--awd-focus-offset);
  border-radius: var(--awd-radius-sm);
}
.awd-switch-knob {
  position: absolute;
  top: calc(50% - var(--awd-switch-knob-size) / 2);
  left: calc(50% - var(--awd-switch-width) / 2 + (var(--awd-switch-track-height) - var(--awd-switch-knob-size)) / 2);
  width: var(--awd-switch-knob-size);
  height: var(--awd-switch-knob-size);
  border-radius: 50%;
  background: var(--awd-text-2);
  box-shadow: var(--awd-shadow-sm);
  transition: transform var(--awd-motion-fast) ease;
}
.awd-switch.is-on .awd-switch-knob {
  background: var(--awd-text-on-accent);
  transform: translateX(calc(var(--awd-switch-width) - var(--awd-switch-track-height)));
}
@media (pointer: coarse) {
  .awd-switch { min-width: var(--awd-control-height-touch); min-height: var(--awd-control-height-touch); }
}
@media (prefers-reduced-motion: reduce) {
  .awd-switch::before, .awd-switch-knob { transition: none; }
}
</style>
