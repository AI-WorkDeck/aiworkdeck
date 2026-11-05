<!--
SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
SPDX-License-Identifier: AGPL-3.0-or-later
-->
<!--
  这台电脑连着多于一条云端连接、「放进团队案件库」被拒时，就地列出这几条连接，
  每条一个「断开」（问题 126，dev-board#1713）。不自动选、不自动断开：确认后才调
  现有的 POST /api/cloud/connections/{id}/disconnect，断开完 emit('disconnected')，
  由所在弹窗重读连接；剩一条时律师自己再点「放进团队案件库」。
  CollabDialog 与 InviteMemberDialog 共用。
-->
<template>
  <view class="lib-list">
    <view v-for="row in rows" :key="row.id" class="lib-row">
      <view class="lib-info">
        <view class="lib-server-line">
          <text class="lib-server">{{ row.server }}</text>
          <text v-if="row.official" class="lib-tag">{{ $t('version.libraryOfficialTag') }}</text>
        </view>
        <text v-if="row.who" class="lib-meta">{{ $t('version.librarySignedInAs', { name: row.who }) }}</text>
        <text v-if="row.connectedAt" class="lib-meta">{{ $t('version.libraryConnectedAt', { time: row.connectedAt }) }}</text>
      </view>
      <view
        class="lib-disconnect"
        :class="{ disabled: busyId !== null }"
        @tap="onDisconnect(row)"
      >{{ $t('version.disconnectLibrary') }}</view>
    </view>
    <text v-if="errorMessage" class="lib-error">{{ errorMessage }}</text>
  </view>
</template>

<script>
import { disconnectCloudConnection } from '@/services/api.js'
import { describeLibraryConnections, disconnectLibraryConnection } from '@/utils/cloudShare.js'

export default {
  name: 'LibraryConnectionList',
  props: {
    connections: { type: Array, default: () => [] },
    officialServerUrl: { type: String, default: '' },
  },
  emits: ['disconnected'],
  data() {
    return { busyId: null, errorMessage: '' }
  },
  computed: {
    rows() {
      return describeLibraryConnections(this.connections, this.officialServerUrl)
    },
  },
  methods: {
    confirm(row) {
      return new Promise((resolve) => {
        uni.showModal({
          title: this.$t('version.disconnectLibraryTitle'),
          content: this.$t('version.disconnectLibraryConfirm', { server: row.server }),
          confirmText: this.$t('version.disconnectLibrary'),
          success: (r) => resolve(!!(r && r.confirm)),
          fail: () => resolve(false),
        })
      })
    },
    async onDisconnect(row) {
      if (this.busyId !== null) return
      this.busyId = row.id
      this.errorMessage = ''
      try {
        const res = await disconnectLibraryConnection({
          connectionId: row.id,
          confirm: () => this.confirm(row),
          disconnect: disconnectCloudConnection,
        })
        if (res.ok) {
          uni.showToast({ title: this.$t('version.disconnectedLibrary'), icon: 'none' })
          this.$emit('disconnected')
        }
      } catch (e) {
        this.errorMessage = (e && e.message) || this.$t('version.disconnectLibraryFailed')
      } finally {
        this.busyId = null
      }
    },
  },
}
</script>

<style lang="scss" scoped>
.lib-list { display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 10px; }
.lib-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--awd-border); border-radius: 8px; background: var(--awd-surface);
}
.lib-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lib-server-line { display: flex; align-items: center; gap: 6px; }
.lib-server {
  font-size: var(--awd-font-size-body); font-weight: 600; color: var(--awd-text);
  word-break: break-all; direction: ltr; unicode-bidi: isolate;
}
.lib-tag {
  font-size: 11px; padding: 1px 6px; border-radius: 4px;
  color: var(--awd-accent-text); border: 1px solid var(--awd-accent);
}
.lib-meta { font-size: var(--awd-panel-fs); color: var(--awd-text-3); }
.lib-disconnect {
  flex-shrink: 0; padding: 4px 12px; border-radius: 6px; cursor: pointer;
  font-size: var(--awd-panel-fs); color: var(--awd-danger-text); border: 1px solid var(--awd-border);
}
.lib-disconnect:hover { background: var(--awd-surface-2); }
.lib-disconnect.disabled { opacity: 0.5; pointer-events: none; }
.lib-error { font-size: var(--awd-panel-fs); color: var(--awd-danger-text); line-height: 1.7; }
</style>
