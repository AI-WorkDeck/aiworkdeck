<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  「已自动合入的相邻段落，请过目」（2026-11-15，协调会话定的折中）：自动合并不挡采纳，但挨着另一侧
  改动、只一侧改过的段要请律师过目。提示存本机（mergeNeighborNotices.js），点开「过目」一次才消失；
  过目是只读的逐段清单（MergeNeighborList），不要裁决。挂在版本面板上方，由工作台页面渲染。
-->
<template>
  <view v-if="notices.length || sheet" class="mnn">
    <view v-for="n in notices" :key="n.id" class="mnn-row">
      <text class="mnn-text">{{ $t('version.mergeNeighborsNotice', { path: n.path, count: n.neighbors.length }) }}</text>
      <text class="mnn-link" @tap="open(n)">{{ $t('version.mergeNeighborsReview') }}</text>
    </view>
    <view v-if="sheet" class="awd-mask" @tap.self="sheet = null">
      <view class="awd-dialog mnn-dialog">
        <view class="awd-header">
          <text class="awd-title">{{ $t('version.mergeNeighborsSheetTitle', { path: sheet.path }) }}</text>
        </view>
        <view class="awd-body">
          <view class="mnn-hint">{{ $t('version.mergeNeighborsSheetHint') }}</view>
          <MergeNeighborList :neighbors="sheet.neighbors"
            :main-label="sheet.sides.main || $t('version.mergeSideMainDefault')"
            :other-label="sheet.sides.other || $t('version.mergeSideOtherDefault')" />
        </view>
        <view class="awd-footer">
          <view class="awd-btn awd-btn-primary" @tap="sheet = null">{{ $t('version.mergeNeighborsDone') }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import MergeNeighborList from './MergeNeighborList.vue'
import { unseenMergeNeighborNotices, markMergeNeighborNoticeSeen, MERGE_NEIGHBORS_EVENT } from '@/utils/mergeNeighborNotices.js'

export default {
  name: 'MergeNeighborNotices',
  components: { MergeNeighborList },
  props: { projectId: { type: [String, Number], default: null } },
  data() { return { notices: [], sheet: null } },
  watch: { projectId() { this.load() } },
  mounted() {
    this._on = () => this.load()
    uni.$on(MERGE_NEIGHBORS_EVENT, this._on)
    this.load()
  },
  beforeUnmount() { if (this._on) uni.$off(MERGE_NEIGHBORS_EVENT, this._on) },
  methods: {
    load() { this.notices = this.projectId ? unseenMergeNeighborNotices(this.projectId) : [] },
    // 点开即算看过：提示与版本入口的小角标随之消失
    open(n) {
      this.sheet = n
      markMergeNeighborNoticeSeen(this.projectId, n.id)
    },
  },
}
</script>

<style scoped>
.mnn { display: block; }
.awd-header { padding: 18px 24px; border-bottom: 1px solid var(--awd-border-subtle); }
.awd-title { font-size: 16px; font-weight: 600; color: var(--awd-text); }
.awd-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
.awd-footer {
  display: flex; justify-content: flex-end; gap: 12px; flex-wrap: wrap;
  padding: 14px 24px; border-top: 1px solid var(--awd-border-subtle); background: var(--awd-bg);
}
.mnn-row { display: flex; align-items: baseline; gap: 8px; margin: 6px 12px; padding: 7px 9px; border-radius: var(--awd-radius-md); background: var(--awd-surface-2); border: 1px solid var(--awd-border); }
.mnn-text { flex: 1; font-size: var(--awd-panel-fs); color: var(--awd-text); line-height: 1.45; }
.mnn-link { flex: none; font-size: var(--awd-panel-fs); color: var(--awd-accent-text); text-decoration: underline; cursor: pointer; }
.mnn-dialog { max-width: 720px; }
.mnn-hint { font-size: var(--awd-panel-fs); color: var(--awd-text-2); margin-bottom: 8px; line-height: 1.5; }
</style>
