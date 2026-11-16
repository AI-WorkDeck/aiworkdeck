<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  「已自动合入的相邻段落」逐段列出（2026-11-15，协调会话定的折中）：每段一张卡，三栏（共同的上一版 /
  主稿 / 另一侧），每一侧相对共同的上一版改了的字轻量标出来。只给看，不要裁决。
  合并比对稿右栏（ReviewPanel 的折叠块）与版本面板的「过目」共用。
-->
<template>
  <view class="mnl">
    <view v-for="n in rows" :key="n.key + n.side" class="mnl-card">
      <view class="mnl-head">
        <text class="mnl-where">{{ n.where }}</text>
        <text class="mnl-by">{{ $t('version.mergeNeighborsChangedBy', { side: n.side === 'M' ? mainLabel : otherLabel }) }}</text>
      </view>
      <view class="mnl-col">
        <text class="mnl-h">{{ $t('version.mergeBaseSideLabel') }}</text>
        <text class="mnl-t">{{ n.baseText || $t('editor.review.emptyText') }}</text>
      </view>
      <view class="mnl-col">
        <text class="mnl-h">{{ mainLabel }}</text>
        <text class="mnl-t"><text v-for="(seg, si) in n.mainDiff" :key="si" :class="'mnl-d-' + seg.type">{{ seg.text }}</text></text>
      </view>
      <view class="mnl-col">
        <text class="mnl-h">{{ otherLabel }}</text>
        <text class="mnl-t"><text v-for="(seg, si) in n.otherDiff" :key="si" :class="'mnl-d-' + seg.type">{{ seg.text }}</text></text>
      </view>
    </view>
  </view>
</template>

<script>
import { charDiff } from '@/utils/textDiff.js'
import { unitLabel } from '@/utils/historyMerges.js'

export default {
  name: 'MergeNeighborList',
  props: {
    neighbors: { type: Array, default: () => [] },
    mainLabel: { type: String, default: '' },
    otherLabel: { type: String, default: '' },
  },
  computed: {
    rows() {
      return (this.neighbors || []).map((n) => ({
        ...n,
        where: unitLabel(this.$t.bind(this), n.key),
        mainDiff: charDiff(n.baseText || '', n.mainText || ''),
        otherDiff: charDiff(n.baseText || '', n.otherText || ''),
      }))
    },
  },
}
</script>

<style scoped>
.mnl { display: flex; flex-direction: column; gap: 8px; }
.mnl-card { padding: 8px 9px; background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-dialog); }
.mnl-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; margin-bottom: 4px; }
.mnl-where { font-size: var(--awd-panel-fs); color: var(--awd-text); font-weight: 600; }
.mnl-by { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-3); }
.mnl-col { padding: 5px 7px; margin-top: 4px; border-radius: var(--awd-radius-md); background: var(--awd-surface-2); }
.mnl-h { display: block; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-3); margin-bottom: 2px; }
.mnl-t { display: block; font-size: var(--awd-panel-fs); color: var(--awd-text); line-height: 1.45; word-break: break-all; }
.mnl-d-ins { background: var(--awd-accent-soft); color: var(--awd-accent-text); text-decoration: underline; }
.mnl-d-del { color: var(--awd-danger-text); text-decoration: line-through; }
</style>
