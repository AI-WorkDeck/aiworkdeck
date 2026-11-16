<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  设置页的分节容器（dev-board#892）。对齐插件广场侧栏 MarketSidebarPanel 的
  `.msb-*` 密度：标题 14px/600 + 可选副标题 12px + 右侧 actions 插槽 + 1px 底线，
  body 12-16px 内边距。取代设置页各分项各画各的 `.section-card`。

  纯展示组件，不带任何业务逻辑；title/description 由调用方传入已翻译好的文案，
  不在这里做 i18n。
-->
<template>
  <view class="awd-set-section">
    <view v-if="title || $slots.actions" class="awd-set-section-head">
      <view class="awd-set-section-head-text">
        <text class="awd-set-section-title">{{ title }}</text>
        <text v-if="description" class="awd-set-section-desc">{{ description }}</text>
      </view>
      <view v-if="$slots.actions" class="awd-set-section-actions">
        <slot name="actions" />
      </view>
    </view>
    <view class="awd-set-section-body">
      <slot />
    </view>
  </view>
</template>

<script>
export default {
  name: 'SettingsSection',
  props: {
    title: { type: String, default: '' },
    description: { type: String, default: '' },
  },
}
</script>

<style lang="scss" scoped>
.awd-set-section {
  background: var(--awd-surface);
  border-radius: 8px;
  border: 1px solid var(--awd-border);
  margin-bottom: 16px;
  overflow: hidden;
}

.awd-set-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--awd-border);
}

/* 说明文字至少留 280px；放不下时右侧按钮整组换到下一行，而不是把说明挤成一字宽的竖条 */
.awd-set-section-head-text {
  flex: 1 1 280px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.awd-set-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--awd-text);
}

.awd-set-section-desc {
  display: block;
  font-size: 12px;
  line-height: 1.6;
  color: var(--awd-text-2);
}

/* 按钮多、译文长（英/德/俄）时换行，不被截在卡片右缘外；空间够时与原来一样排成一行 */
.awd-set-section-actions {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.awd-set-section-body {
  padding: 12px 14px;
}
</style>
