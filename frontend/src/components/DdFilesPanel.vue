<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="dd-panel">
    <view class="dd-panel-head">
      <text>{{ $t('ddWorkflow.lists') }}</text><text class="muted">{{ requests.length }}</text>
      <button class="icon-button" :disabled="loading || busy" :aria-label="$t('ddWorkflow.refresh')" @tap="fetchRequests">↻</button>
    </view>
    <view v-if="notifications.length" class="dd-notifications">
      <text class="hint">{{ $t('ddWorkflow.pendingNotifications') }}</text>
      <button v-for="notification in notifications.slice(0, 5)" :key="notification.id" @tap="openNotification(notification)">{{ notification.title }}</button>
    </view>
    <view v-if="canCreateRequest" class="dd-create">
      <button class="primary" :disabled="busy" @tap="startCreate">{{ $t('ddWorkflow.newList') }}</button>
      <view v-if="creating" class="create-form">
        <input v-model="newName" :aria-label="$t('ddWorkflow.listName')" :placeholder="$t('ddWorkflow.listName')" maxlength="120" @confirm="createRequest" />
        <view class="actions"><button :disabled="busy" @tap="creating = false">{{ $t('ddWorkflow.cancel') }}</button><button :disabled="busy || !newName.trim()" @tap="createRequest">{{ $t(busy ? 'ddWorkflow.creating' : 'ddWorkflow.create') }}</button></view>
      </view>
      <button class="import-button" :disabled="busy" @tap="importing = !importing">{{ $t('ddWorkflow.importList') }}</button>
      <DdImportForm v-if="importing" :project-id="projectId" @imported="onImported" @cancel="importing = false" />
      <text class="hint">{{ $t('ddWorkflow.newListHint') }}</text>
    </view>
    <view v-if="error" class="error" role="alert"><text>{{ error }}</text><button :disabled="loading" @tap="fetchRequests">{{ $t('ddWorkflow.retry') }}</button></view>
    <text v-if="loading && !requests.length" class="empty" role="status">{{ $t('ddWorkflow.loading') }}</text>
    <view v-else class="dd-lists">
      <view v-for="req in requests" :key="req.id" class="dd-list" :class="{ active: String(activeRequestId) === String(req.id) }">
        <button class="list-open" @tap="openRequest(req)">
          <text class="list-name">{{ req.name }}</text>
          <view class="list-meta"><text>{{ statusText(req.status) }}</text><text v-if="req.itemCount != null">{{ $t('ddWorkflow.itemCount', { count: req.itemCount }) }}</text></view>
        </button>
        <view v-if="canCreateRequest" class="list-actions"><button :disabled="busy" :aria-label="$t('ddWorkflow.copyList', { name: req.name })" @tap="copyRequest(req)">{{ $t('ddWorkflow.copy') }}</button></view>
      </view>
      <view v-if="!loading && !requests.length && !error" class="empty"><text>{{ $t(canCreateRequest ? 'ddWorkflow.noLists' : 'ddWorkflow.noPublishedLists') }}</text></view>
    </view>
  </view>
</template>
<script>
import api from '@/services/api'
import DdImportForm from '@/components/dd/DdImportForm.vue'

export default {
  name: 'DdFilesPanel',
  components: { DdImportForm },
  props: { projectId: { type: [Number, String], required: true }, currentUser: { type: Object, default: null }, canWrite: { type: Boolean, default: true }, notifications: { type: Array, default: () => [] } },
  emits: ['open-request', 'notification-read'],
  data() { return { requests: [], activeRequestId: null, loading: false, busy: false, error: '', creating: false, importing: false, newName: '', fetchSeq: 0 } },
  computed: { canCreateRequest() { return this.canWrite && !!this.currentUser && this.currentUser.role !== 'CLIENT' } },
  mounted() { this.fetchRequests() },
  beforeUnmount() { this.fetchSeq++ },
  watch: { projectId() { this.requests = []; this.activeRequestId = null; this.creating = false; this.importing = false; this.fetchRequests() } },
  methods: {
    async fetchRequests() {
      const seq = ++this.fetchSeq
      this.loading = true; this.error = ''
      try {
        const res = await api.getDdRequests(this.projectId)
        if (seq === this.fetchSeq) this.requests = Array.isArray(res) ? res : res.data || []
      } catch (e) { if (seq === this.fetchSeq) this.error = e.message || this.$t('ddWorkflow.loadFailed') }
      finally { if (seq === this.fetchSeq) this.loading = false }
    },
    async openNotification(notification) {
      const request = this.requests.find(req => String(req.id) === String(notification.requestId))
      if (request) this.openRequest({ ...request, focusItemId: notification.itemId })
      else {
        try { const details = await api.getDdRequestDetails(notification.requestId, this.projectId); this.openRequest({ ...(details.request || details.data?.request), focusItemId: notification.itemId }) }
        catch (e) { this.error = e.message || this.$t('ddWorkflow.loadFailed'); return }
      }
      this.$emit('notification-read', notification.id)
    },
    async onImported(req) { this.importing = false; await this.fetchRequests(); this.openRequest(req) },
    startCreate() { this.newName = this.$t('ddWorkflow.defaultName'); this.creating = true },
    async createRequest() {
      if (this.busy || !this.canCreateRequest || !this.newName.trim()) return
      const projectId = this.projectId
      this.busy = true; this.error = ''
      try {
        const response = await api.createDdRequest(projectId, { name: this.newName.trim(), content: '' })
        if (String(projectId) !== String(this.projectId)) return
        const req = response.data || response
        this.creating = false
        await this.fetchRequests()
        this.openRequest(req)
      } catch (e) { if (String(projectId) === String(this.projectId)) this.error = e.message || this.$t('ddWorkflow.operationFailed') }
      finally { this.busy = false }
    },
    openRequest(req) { this.activeRequestId = req.id; this.$emit('open-request', req) },
    async copyRequest(req) {
      if (this.busy || !this.canCreateRequest) return
      const projectId = this.projectId
      this.busy = true; this.error = ''
      try {
        const response = await api.copyDdRequest(req.id, projectId)
        if (String(projectId) !== String(this.projectId)) return
        await this.fetchRequests()
        if (response?.id || response?.data?.id) this.openRequest(response.data || response)
      } catch (e) { if (String(projectId) === String(this.projectId)) this.error = e.message || this.$t('ddWorkflow.operationFailed') }
      finally { this.busy = false }
    },
    statusText(status) { return this.$t(`ddWorkflow.requestStatus.${status || 'DRAFT'}`) }
  }
}
</script>
<style scoped lang="scss">
.dd-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; color: var(--awd-text); font-size: var(--awd-panel-fs); }
.dd-panel-head { min-height: var(--awd-panel-sec-h); display: flex; align-items: center; gap: 6px; padding: 0 var(--awd-panel-pad-x); font-weight: 600; }
.dd-panel button { margin: 0; font: inherit; line-height: 1.4; padding: 5px 8px; min-height: 30px; border-radius: var(--awd-radius-sm); color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); cursor: pointer; }
.dd-panel button::after { border: 0; }
.dd-panel button:disabled { opacity: .5; cursor: default; }
.dd-panel button:focus-visible, .dd-panel input:focus-visible { outline: 2px solid var(--awd-accent-text); outline-offset: 2px; }
.dd-panel .primary { color: var(--awd-text-on-accent); background: var(--awd-accent); border-color: var(--awd-accent); width: 100%; }
.dd-panel .icon-button { margin-left: auto; border-color: transparent; background: transparent; }
.dd-notifications { padding: 0 var(--awd-panel-pad-x) 10px; border-bottom: 1px solid var(--awd-border-subtle); }
.dd-notifications button { width: 100%; text-align: left; margin-top: 6px; background: var(--awd-accent-soft); color: var(--awd-accent-text); font-size: var(--awd-panel-fs-meta); }
.dd-create { padding: 6px var(--awd-panel-pad-x) 12px; border-bottom: 1px solid var(--awd-border-subtle); }
.hint, .muted, .list-meta { color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); }
.hint { display: block; line-height: 1.6; margin-top: 8px; }
.create-form { padding-top: 8px; }
.create-form input { width: 100%; box-sizing: border-box; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-surface); padding: 6px 8px; min-height: 32px; }
.actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
.dd-lists { min-height: 0; flex: 1; overflow: auto; padding: 6px var(--awd-panel-pad-x); }
.dd-list { margin-bottom: 4px; border: 1px solid transparent; border-radius: var(--awd-radius-sm); }
.dd-list.active { background: var(--awd-accent-soft); border-color: var(--awd-accent); }
.dd-panel .list-open { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px; }
.list-name { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.list-meta { display: flex; gap: 8px; padding-top: 5px; }
.list-actions { display: flex; justify-content: flex-end; padding: 0 6px 6px; }
.dd-panel .list-actions button { border: 0; background: transparent; color: var(--awd-text-2); font-size: var(--awd-panel-fs-meta); min-height: 24px; }
.empty { display: block; padding: 24px 12px; color: var(--awd-text-2); line-height: 1.7; text-align: center; }
.error { padding: 10px; margin: 6px; color: var(--awd-danger-text); background: var(--awd-danger-soft); border-radius: var(--awd-radius-sm); line-height: 1.6; }
.error button { display: block; margin-top: 8px; }
</style>
