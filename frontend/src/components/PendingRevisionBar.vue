<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view v-if="items.length" class="prb" @tap.stop>
    <view class="prb-main">
      <view class="prb-dot"></view>
      <text class="prb-text">{{ $t('revision.bannerCount', { count: items.length }) }}</text>
      <text class="prb-link" @tap="expanded = !expanded">{{ expanded ? $t('revision.collapse') : $t('revision.review') }}</text>
    </view>
    <view v-if="expanded" class="prb-list">
      <view v-for="r in items" :key="r.id" class="prb-item">
        <view class="prb-head">
          <text class="prb-source">{{ $t('revision.source', { source: r.source }) }}</text>
          <text v-if="isStale(r)" class="prb-stale">{{ $t('revision.stale') }}</text>
        </view>
        <text v-if="isStale(r)" class="prb-hint">{{ $t('revision.staleHint') }}</text>
        <view v-for="(e, i) in r.edits" :key="i" class="prb-edit">
          <text class="prb-find">{{ preview(e.find) }}</text>
          <text class="prb-arrow">→</text>
          <text class="prb-replace">{{ preview(e.replace) }}</text>
          <text v-if="e.reason" class="prb-reason">{{ $t('revision.reason', { reason: preview(e.reason, 100) }) }}</text>
        </view>
        <view class="prb-acts">
          <text v-if="!isStale(r)" class="prb-btn ok" @tap="onAccept(r)">{{ $t('revision.accept') }}</text>
          <text class="prb-btn" @tap="onReject(r)">{{ $t('revision.reject') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
// PendingRevisionBar.vue — 编辑器顶栏的「N 条外部修订待审」提示条与审阅列表。
// 只展示 + 触发接受/拒绝；接受后修订痕迹由编辑器侧逐条落入文档，用户在文档里照常接受/拒绝。
import { pendingRevisionsOf, startRevisionRefresh, acceptRevision, rejectRevision } from '@/utils/pendingRevisionStore.js'
import { forFile, previewText, isStale } from '@/utils/pendingRevision.js'

export default {
  name: 'PendingRevisionBar',
  props: {
    projectId: { type: [Number, String], default: null },
    fileId: { type: [Number, String], default: null },
    // 编辑器的 executeCommand(action, params)；文档未就绪或只读时为 null，接受按钮不可用
    executor: { type: Function, default: null },
  },
  data() {
    return { expanded: false, busy: false, stopRefresh: null }
  },
  computed: {
    items() {
      return forFile(pendingRevisionsOf(this.projectId), this.fileId)
    },
  },
  mounted() {
    this.stopRefresh = startRevisionRefresh(this.projectId)
  },
  beforeUnmount() {
    if (this.stopRefresh) this.stopRefresh()
  },
  methods: {
    isStale,
    preview: previewText,
    toast(title) { uni.showToast({ title, icon: 'none', duration: 3500 }) },
    async onAccept(r) {
      if (this.busy) return
      if (!this.executor) { this.toast(this.$t('revision.editorNotReady')); return }
      this.busy = true
      try {
        const res = await acceptRevision(r, this.executor)
        if (res.ok) this.toast(this.$t('revision.applied'))
        else this.toast(res.stale ? this.$t('revision.staleHint') : this.$t('revision.failed', { message: res.message || '' }))
      } catch (e) {
        this.toast(this.$t('revision.failed', { message: (e && e.message) || '' }))
      } finally { this.busy = false }
    },
    async onReject(r) {
      if (this.busy) return
      this.busy = true
      try {
        const res = await rejectRevision(r)
        if (!res.ok) this.toast(this.$t('revision.failed', { message: res.message || '' }))
      } catch (e) {
        this.toast(this.$t('revision.failed', { message: (e && e.message) || '' }))
      } finally { this.busy = false }
    },
  },
}
</script>

<style scoped>
.prb { flex: none; padding: 6px 12px; background: var(--awd-warning-soft); color: var(--awd-warning-text);
  border-bottom: 1px solid var(--awd-border); font-size: 12px; }
.prb-main { display: flex; align-items: center; gap: 8px; }
.prb-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--awd-warning-text); }
.prb-link, .prb-btn { cursor: pointer; text-decoration: underline; }
.prb-list { margin-top: 6px; max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.prb-item { padding: 6px 8px; border-radius: var(--awd-radius-sm); background: var(--awd-surface); color: var(--awd-text); }
.prb-head { display: flex; gap: 8px; align-items: center; }
.prb-source { color: var(--awd-text-2); }
.prb-stale { padding: 0 5px; border-radius: var(--awd-radius-sm); background: var(--awd-danger-soft); color: var(--awd-danger-text); }
.prb-hint { display: block; color: var(--awd-text-2); margin: 2px 0; }
.prb-edit { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.prb-find { text-decoration: line-through; color: var(--awd-danger-text); }
.prb-replace { color: var(--awd-accent-text); }
.prb-reason { flex-basis: 100%; color: var(--awd-text-2); }
.prb-acts { display: flex; gap: 12px; margin-top: 6px; }
.prb-btn.ok { color: var(--awd-accent-text); font-weight: 600; }
</style>
