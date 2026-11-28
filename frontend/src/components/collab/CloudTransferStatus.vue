<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <!-- 大文件交稿/取回进行中时占一格状态栏：谁触发的都算（交稿、结束工作后的后台交稿、取回）。
       慢网络下一块可能传十几分钟（#1764），没有这一格就像卡死了。 -->
  <view v-if="text" class="status-item cloud-transfer" role="status" aria-live="polite">
    <view class="status-dot amber"></view>
    <text>{{ text }}</text>
  </view>
</template>

<script>
import { getCloudTransfer } from '@/services/api.js'
import { formatTransfer } from '@/utils/transferProgress.js'

const TRANSFER_KICK_EVENT = 'awd:cloud-transfer-kick'
// C12 nit: a 交稿/取回 on this page shows its own progress line; stand down meanwhile (no second copy)
const FOREGROUND_EVENT = 'awd:cloud-transfer-foreground'
const IDLE_MS = 15000
const ACTIVE_MS = 2000
// 交稿/取回刚发起时字节还没开始走：先快查一阵，别等 15 秒才亮
const KICK_WINDOW_MS = 12000

export default {
  name: 'CloudTransferStatus',
  props: { projectId: { type: [String, Number], default: null } },
  data: () => ({ progress: null, timer: null, fastUntil: 0, seq: 0, foreground: false }),
  computed: {
    text() { return this.foreground ? '' : formatTransfer(this.progress, (k, p) => this.$t(k, p)) },
  },
  watch: {
    projectId() { this.progress = null; this.schedule(0) },
  },
  mounted() {
    this._onKick = (id) => { if (id == null || String(id) === String(this.projectId)) { this.fastUntil = Date.now() + KICK_WINDOW_MS; this.schedule(0) } }
    this._onForeground = (e) => { if (e && String(e.projectId) === String(this.projectId)) this.foreground = !!e.on }
    if (typeof uni !== 'undefined' && uni.$on) {
      uni.$on(TRANSFER_KICK_EVENT, this._onKick)
      uni.$on(FOREGROUND_EVENT, this._onForeground)
    }
    this.schedule(0)
  },
  beforeUnmount() {
    clearTimeout(this.timer)
    this.timer = null
    this.seq++
    if (typeof uni !== 'undefined' && uni.$off) {
      uni.$off(TRANSFER_KICK_EVENT, this._onKick)
      uni.$off(FOREGROUND_EVENT, this._onForeground)
    }
  },
  methods: {
    schedule(ms) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.poll(), ms)
    },
    async poll() {
      const seq = ++this.seq
      const projectId = this.projectId
      if (projectId == null || projectId === '') { this.progress = null; return }
      try {
        const res = await getCloudTransfer(projectId)
        if (seq !== this.seq || String(projectId) !== String(this.projectId)) return
        this.progress = (res && res.data) || res || null
      } catch {
        if (seq === this.seq) this.progress = null
      }
      if (seq !== this.seq) return
      const active = !!(this.progress && this.progress.active)
      this.schedule(active || Date.now() < this.fastUntil ? ACTIVE_MS : IDLE_MS)
    },
  },
}
</script>
