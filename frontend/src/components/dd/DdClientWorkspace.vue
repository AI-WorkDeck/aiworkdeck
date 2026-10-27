<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="dd-workspace">
    <header class="workspace-header">
      <div class="header-brand">
        <span class="brand-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M16 11l2 2 4-4" />
          </svg>
        </span>
        <div class="brand-copy">
          <h2>{{ $t('ddWorkflow.client.workspaceTitle') }}</h2>
          <p>{{ $t('ddWorkflow.client.workspaceHint') }}</p>
        </div>
      </div>
      <div class="header-actions">
        <div class="notification-bar" :class="{ 'has-unread': notifications.length > 0 }">
          <span class="notif-dot" aria-hidden="true"></span>
          <span class="notif-text">{{ notifications.length ? $t('ddWorkflow.client.unreadMessages', { count: notifications.length }) : $t('ddWorkflow.client.noMessages') }}</span>
          <button v-if="notificationPermission === 'default'" type="button" class="text-button" @click="enableNotifications">{{ $t('ddWorkflow.client.enableNotifications') }}</button>
          <small v-else-if="notificationPermission !== 'granted'" class="notif-hint">{{ $t('ddWorkflow.client.notificationsDisabled') }}</small>
        </div>
        <button v-if="connections.length" type="button" class="secondary" :disabled="submissionBusy" :class="{ 'is-active': adding }" @click="adding = !adding">
          {{ $t(adding ? 'ddWorkflow.cancel' : 'ddWorkflow.client.joinProject') }}
        </button>
      </div>
    </header>

    <div v-if="notifications.length" class="notification-list">
      <button v-for="n in notifications" :key="`${n.connectionId}:${n.id}`" type="button" class="notification-chip" :disabled="submissionBusy" @click="openNotification(n)">
        <span class="chip-dot" aria-hidden="true"></span>
        <span>{{ n.title }}</span>
      </button>
    </div>

    <p v-if="error" class="error-banner" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="text-button" @click="load">{{ $t('ddWorkflow.retry') }}</button>
    </p>

    <div v-if="adding || !connections.length" class="join-stage" :class="{ 'is-empty-stage': !connections.length }">
      <div class="join-container">
        <form class="join-panel" @submit.prevent="join">
          <div class="join-card-head">
            <span class="join-icon-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
            </span>
            <div class="join-head-copy">
              <label for="dd-invite" class="join-title">{{ $t('ddWorkflow.client.invitationLabel') }}</label>
              <p class="join-subtitle">{{ $t('ddWorkflow.client.personalWorkspaceHint') }}</p>
            </div>
          </div>

          <div class="join-fields">
            <div class="join-row">
              <input
                id="dd-invite"
                v-model="code"
                class="invite-input"
                autocomplete="off"
                :placeholder="$t('ddWorkflow.client.invitationPlaceholder')"
                :disabled="joining"
                @confirm="join"
              />
              <button type="submit" class="primary join-submit" :disabled="joining || !code.trim()" @click="join">
                {{ joining ? $t('ddWorkflow.client.joining') : $t('ddWorkflow.client.joinProject') }}
              </button>
            </div>

            <div v-if="cloudConnections.length" class="case-library-row">
              <span class="field-label">{{ $t('ddWorkflow.client.caseLibrary') }}</span>
              <div class="select-wrap">
                <select v-model="cloudConnectionId" :aria-label="$t('ddWorkflow.client.caseLibrary')">
                  <option value="">{{ $t('ddWorkflow.client.officialCaseLibrary') }}</option>
                  <option v-for="c in cloudConnections" :key="c.id" :value="c.id">{{ c.displayName || c.serverUrl }}</option>
                </select>
                <span class="select-chevron" aria-hidden="true">▾</span>
              </div>
            </div>
          </div>
        </form>

        <div v-if="!connections.length" class="join-steps">
          <div class="step-card">
            <strong class="step-title">{{ $t('ddWorkflow.client.stepConnectTitle') }}</strong>
            <p class="step-desc">{{ $t('ddWorkflow.client.stepConnectDesc') }}</p>
          </div>
          <div class="step-card">
            <strong class="step-title">{{ $t('ddWorkflow.client.stepSubmitTitle') }}</strong>
            <p class="step-desc">{{ $t('ddWorkflow.client.stepSubmitDesc') }}</p>
          </div>
          <div class="step-card">
            <strong class="step-title">{{ $t('ddWorkflow.client.stepTrackTitle') }}</strong>
            <p class="step-desc">{{ $t('ddWorkflow.client.stepTrackDesc') }}</p>
          </div>
        </div>
      </div>
    </div>

    <p v-if="loading && !connections.length" class="empty loading-state" role="status">{{ $t('ddWorkflow.client.loadingProjects') }}</p>

    <div v-if="connections.length" class="workspace-body">
      <aside class="project-list">
        <div class="sidebar-group">
          <label for="dd-project" class="sidebar-label">{{ $t('ddWorkflow.client.invitedProjects') }}</label>
          <div class="select-wrap">
            <select id="dd-project" :disabled="submissionBusy" :value="selectedId" @change="selectConnection($event.target.value)">
              <option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <span class="select-chevron" aria-hidden="true">▾</span>
          </div>
        </div>

        <div class="sidebar-group sidebar-checklists">
          <div class="list-heading">
            <span class="sidebar-label">{{ $t('ddWorkflow.client.publishedChecklists') }}</span>
            <button type="button" class="text-button" :disabled="submissionBusy || requestsLoading" @click="loadRequests">{{ $t('ddWorkflow.refresh') }}</button>
          </div>
          <p v-if="requestsLoading" class="empty">{{ $t('ddWorkflow.client.loadingChecklist') }}</p>
          <p v-else-if="!requests.length" class="empty">{{ $t('ddWorkflow.client.awaitingPublication') }}</p>
          <div v-else class="request-picker">
            <select :value="requestId" :disabled="submissionBusy" :aria-label="$t('ddWorkflow.client.publishedChecklists')" @change="selectRequest($event.target.value)">
              <option v-for="request in requests" :key="request.id" :value="request.id">{{ request.name }}</option>
            </select>
          </div>
          <div v-if="requests.length" class="request-stack">
            <button
              v-for="request in requests"
              :key="request.id"
              type="button"
              class="request-row"
              :class="{ selected: String(requestId) === String(request.id) }"
              :disabled="submissionBusy" @click="selectRequest(request.id)"
            >
              <span class="request-name">{{ request.name }}</span>
              <small v-if="request.status === 'ARCHIVED'" class="request-badge">{{ $t('ddWorkflow.requestStatus.ARCHIVED') }}</small>
            </button>
          </div>
        </div>

        <div class="sidebar-footer">
          <button type="button" class="text-button remove" :disabled="submissionBusy" @click="leave">{{ $t('ddWorkflow.client.removeConnection') }}</button>
        </div>
      </aside>

      <DdClientChecklist
        v-if="requestId && selected"
        :key="`${selected.id}:${requestId}`"
        :request-id="requestId"
        :project-id="selected.projectId"
        :connection-id="selected.id"
        :focus-item-id="focusItemId"
        @busy-change="setSubmissionBusy"
      />
      <div v-else class="empty detail-empty">{{ $t('ddWorkflow.client.chooseChecklist') }}</div>
    </div>
  </section>
</template>
<script>
import DdClientChecklist from './DdClientChecklist.vue'
import { listCloudConnections } from '@/services/api.js'
import { isClientPortalBuild } from '@/utils/clientPortal.js'
import { connectDdClient, listDdClientConnections, removeDdClientConnection, ddClientRead, ddClientWrite, ddClientIdentity, pollDdClientNotifications, ddNotificationPermission, enableDdNotifications } from '@/services/ddClient.js'
export default {
  name: 'DdClientWorkspace', components: { DdClientChecklist },
  props: { navigationTarget: { type: Object, default: null } },
  watch: { navigationTarget() { this.applyNavigationTarget() } },
  data: () => ({ submissionBusy: false, pendingNavigation: false, code: '', connections: [], selectedId: '', requestId: null, focusItemId: null, requests: [], adding: false, joining: false, loading: false, requestsLoading: false, error: '', cloudConnections: [], cloudConnectionId: '', generation: 0, identity: '', identityTimer: null, notificationTimer: null, notifications: [], notificationPermission: ddNotificationPermission() }),
  computed: { selected() { return this.connections.find(c => c.id === this.selectedId) } },
  mounted() {
    this.identity = ddClientIdentity(); this.load(); this.refreshNotifications(); this.notificationTimer = setInterval(() => this.refreshNotifications(), 15000)
    if (typeof window !== 'undefined' && window.__AWD_PORTAL_CODE__) { this.code = window.__AWD_PORTAL_CODE__; window.__AWD_PORTAL_CODE__ = ''; this.adding = true }
    if (!isClientPortalBuild()) listCloudConnections().then(r => { this.cloudConnections = r?.data?.connections || r?.connections || [] }).catch(() => {})
    this.identityTimer = setInterval(() => { if (this.identity !== ddClientIdentity()) { this.identity = ddClientIdentity(); this.generation++; this.submissionBusy = false; this.pendingNavigation = false; this.connections = []; this.notifications = []; this.requests = []; this.selectedId = ''; this.requestId = null; this.load() } }, 1000)
  },
  beforeUnmount() { this.generation++; clearInterval(this.identityTimer); clearInterval(this.notificationTimer) },
  methods: {
    setSubmissionBusy(value) { this.submissionBusy = value; if (!value && this.pendingNavigation) { this.pendingNavigation = false; this.applyNavigationTarget() } },
    selectRequest(id) { if (!this.submissionBusy) { this.requestId = this.requests.find(r => String(r.id) === String(id))?.id || null; this.focusItemId = null } },
    async applyNavigationTarget() {
      if (this.submissionBusy) { this.pendingNavigation = true; return }
      const target = this.navigationTarget
      if (!target || !this.connections.length) return
      const connection = this.connections.find(c => c.id === target.connectionId)
      if (!connection || String(connection.projectId) !== String(target.projectId)) { this.error = this.$t('ddWorkflow.client.messageUnavailable'); return }
      const generation = this.generation
      this.selectedId = connection.id; this.requestId = null; this.focusItemId = null
      await this.loadRequests()
      if (generation !== this.generation || target !== this.navigationTarget) return
      const request = this.requests.find(r => String(r.id) === String(target.requestId))
      if (!request) { this.error = this.$t('ddWorkflow.client.messageUnavailable'); return }
      this.requestId = request.id; this.focusItemId = target.itemId || null
    },
    async refreshNotifications() { try { const result = await pollDdClientNotifications({ onOpen: n => this.openNotification(n) }); this.notifications = result.notifications; this.notificationPermission = ddNotificationPermission() } catch {} },
    async enableNotifications() { this.notificationPermission = await enableDdNotifications(); await this.refreshNotifications() },
    async openNotification(n) {
      if (this.submissionBusy) return
      this.selectConnection(n.connectionId)
      await this.loadRequests()
      if (this.requests.some(r => r.id === n.requestId)) this.requestId = n.requestId
      try { await ddClientWrite({ connectionId: n.connectionId, projectId: this.selected?.projectId }, `/notifications/${n.id}/read`, {}); await this.refreshNotifications() } catch (e) { this.error = e.message }
    },
    async load() {
      const generation = ++this.generation; this.loading = true; this.error = ''
      try { const rows = await listDdClientConnections(); if (generation !== this.generation) return; this.connections = rows; if (!rows.some(c => c.id === this.selectedId)) this.selectedId = rows[0]?.id || ''; await this.loadRequests(); if (generation === this.generation) await this.applyNavigationTarget() }
      catch (e) { if (generation === this.generation) this.error = e.message }
      finally { if (generation === this.generation) this.loading = false }
    },
    async join() {
      if (this.submissionBusy || this.joining || !this.code.trim()) return
      this.joining = true; this.error = ''
      try { const row = await connectDdClient(this.code.trim(), this.cloudConnectionId || null); this.code = ''; this.selectedId = row.id; this.adding = false; await this.load() }
      catch (e) { this.error = e.message } finally { this.joining = false }
    },
    selectConnection(id) { if (this.submissionBusy) return; this.focusItemId = null; this.selectedId = id; this.requestId = null; this.requests = []; this.loadRequests() },
    async loadRequests() {
      if (this.submissionBusy) return
      const selected = this.selected; if (!selected) return
      const id = selected.id; this.requestsLoading = true; this.error = ''
      try { const rows = await ddClientRead({ connectionId: id, projectId: selected.projectId }, '/projects'); if (id !== this.selectedId || this.submissionBusy) return; this.requests = rows; if (!rows.some(r => r.id === this.requestId)) this.requestId = rows[0]?.id || null }
      catch (e) { if (id === this.selectedId) this.error = e.message }
      finally { if (id === this.selectedId) this.requestsLoading = false }
    },
    async leave() {
      const id = this.selectedId; if (this.submissionBusy || !id) return
      try { await removeDdClientConnection(id); this.selectedId = ''; this.requestId = null; await this.load() } catch (e) { this.error = e.message }
    },
  },
}
</script>
<style scoped lang="scss">
.dd-workspace {
  container: dd-workspace / inline-size;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--awd-bg);
  color: var(--awd-text);
  font-size: var(--awd-font-size-body);
  overflow: auto;
}

.workspace-header {
  padding: var(--awd-space-4) var(--awd-space-6);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--awd-space-4);
  flex-wrap: wrap;
  background: var(--awd-surface);
  border-bottom: 1px solid var(--awd-border);
}

.header-brand {
  display: flex;
  align-items: center;
  gap: var(--awd-space-3);
  min-width: 0;
}

.brand-glyph {
  width: 36px;
  height: 36px;
  border-radius: var(--awd-radius-md);
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.brand-copy {
  min-width: 0;
}

h2 {
  font-size: var(--awd-font-size-title);
  font-weight: 600;
  margin: 0 0 2px;
  color: var(--awd-text);
  line-height: 1.35;
}

p {
  margin: 0;
  line-height: 1.6;
  color: var(--awd-text-2);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--awd-space-3);
  flex-wrap: wrap;
}

.notification-bar {
  display: inline-flex;
  align-items: center;
  gap: var(--awd-space-2);
  padding: 5px 12px;
  min-height: var(--awd-control-height);
  box-sizing: border-box;
  border-radius: 999px;
  background: var(--awd-bg);
  border: 1px solid var(--awd-border-subtle);
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
  flex-wrap: wrap;
}

.notification-bar.has-unread {
  background: var(--awd-accent-soft);
  border-color: var(--awd-mint);
  color: var(--awd-accent-text);
}

.notif-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--awd-border-strong);
  flex-shrink: 0;
}

.notification-bar.has-unread .notif-dot {
  background: var(--awd-accent);
}

.notif-hint {
  color: var(--awd-text-3);
  font-size: var(--awd-panel-fs-meta);
}

.notification-list {
  padding: var(--awd-space-3) var(--awd-space-6);
  background: var(--awd-accent-soft);
  border-bottom: 1px solid var(--awd-border);
  display: flex;
  flex-wrap: wrap;
  gap: var(--awd-space-2);
}

.dd-workspace button,
.dd-workspace input,
.dd-workspace select {
  font: inherit;
}

/* 显式压过 uni-button 默认样式及 uni-button[disabled]:not([type]) 的 #f7f7f7 灰底 */
.dd-workspace button {
  margin: 0;
  min-height: var(--awd-control-height);
  padding: 6px 14px;
  line-height: 1.4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  background: var(--awd-surface);
  color: var(--awd-text);
  font-size: var(--awd-font-size-body);
  font-weight: 500;
  box-sizing: border-box;
  transition: background var(--awd-motion-fast), border-color var(--awd-motion-fast);
}

.dd-workspace button::after {
  border: 0;
  display: none;
}

.dd-workspace button:hover:not(:disabled) {
  background: var(--awd-accent-wash);
  border-color: var(--awd-mint);
}

.dd-workspace button:disabled,
.dd-workspace button[disabled] {
  background: var(--awd-surface);
  color: var(--awd-text-3);
  border-color: var(--awd-border);
  opacity: 0.55;
  cursor: default;
}

.dd-workspace button.primary {
  background: var(--awd-accent);
  color: var(--awd-text-on-accent);
  border-color: var(--awd-accent);
  font-weight: 600;
}

.dd-workspace button.primary:hover:not(:disabled) {
  background: var(--awd-accent-hover);
  border-color: var(--awd-accent-hover);
}

.dd-workspace button.primary:disabled,
.dd-workspace button.primary[disabled] {
  background: var(--awd-accent);
  color: var(--awd-text-on-accent);
  border-color: var(--awd-accent);
  opacity: 0.45;
}

.dd-workspace button.secondary {
  background: var(--awd-surface);
  color: var(--awd-text);
  border-color: var(--awd-border-strong);
}

.dd-workspace button.secondary.is-active {
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  border-color: var(--awd-mint);
}

.dd-workspace button.text-button {
  min-height: 0;
  padding: 2px 6px;
  border: 0;
  background: transparent;
  color: var(--awd-accent-text);
  font-size: var(--awd-panel-fs);
}

.dd-workspace button.text-button:hover:not(:disabled) {
  background: var(--awd-accent-wash);
}

.dd-workspace button.notification-chip {
  min-height: 28px;
  padding: 4px 10px;
  background: var(--awd-surface);
  border-color: var(--awd-mint);
  color: var(--awd-accent-text);
  font-size: var(--awd-panel-fs);
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--awd-accent);
}

.dd-workspace :focus-visible {
  outline: var(--awd-focus-width) solid var(--awd-accent);
  outline-offset: var(--awd-focus-offset);
}

/* uni-input 宿主显式定高 + 零上下内边距，防止 1.4em 高度裁切文字（dev-board#890） */
.dd-workspace input {
  min-width: 0;
  height: 38px;
  min-height: 38px;
  padding: 0 var(--awd-space-3);
  box-sizing: border-box;
  border: 1px solid var(--awd-border-strong);
  border-radius: var(--awd-radius-md);
  background: var(--awd-bg);
  color: var(--awd-text);
  font-size: var(--awd-font-size-body);
  transition: border-color var(--awd-motion-fast), background var(--awd-motion-fast);
}

.dd-workspace input:focus,
.dd-workspace input:focus-within {
  border-color: var(--awd-accent);
  background: var(--awd-surface);
}

.dd-workspace input :deep(.uni-input-placeholder) {
  color: var(--awd-text-3);
}

.select-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.dd-workspace select {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 32px 0 var(--awd-space-3);
  box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-md);
  background: var(--awd-bg);
  color: var(--awd-text);
  font-size: var(--awd-font-size-body);
  cursor: pointer;
}

.dd-workspace select:focus {
  border-color: var(--awd-accent);
  background: var(--awd-surface);
}

.select-chevron {
  position: absolute;
  right: 10px;
  pointer-events: none;
  color: var(--awd-text-2);
  font-size: var(--awd-panel-fs);
}

.join-stage {
  padding: var(--awd-space-5) var(--awd-space-6);
  border-bottom: 1px solid var(--awd-border);
  background: var(--awd-bg);
}

.join-stage.is-empty-stage {
  flex: 1;
  border-bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--awd-space-8) var(--awd-space-6);
  background: radial-gradient(circle at 50% 0%, var(--awd-halo-1), transparent 72%);
}

.join-container {
  width: 100%;
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-5);
}

.join-panel {
  background: var(--awd-surface);
  border: 1px solid var(--awd-border);
  border-radius: var(--awd-radius-dialog);
  box-shadow: var(--awd-shadow-md);
  padding: var(--awd-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-5);
}

.join-card-head {
  display: flex;
  align-items: flex-start;
  gap: var(--awd-space-3);
}

.join-icon-badge {
  width: 40px;
  height: 40px;
  border-radius: var(--awd-radius-dialog);
  background: var(--awd-accent-soft);
  color: var(--awd-accent-text);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.join-head-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.join-title {
  font-size: var(--awd-font-size-reading);
  font-weight: 600;
  color: var(--awd-text);
  line-height: 1.4;
}

.join-subtitle {
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
  line-height: 1.5;
}

.join-fields {
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-3);
}

.join-row {
  display: flex;
  align-items: center;
  gap: var(--awd-space-2);
}

.join-row .invite-input {
  flex: 1;
}

.dd-workspace button.join-submit {
  height: 38px;
  min-height: 38px;
  padding: 0 var(--awd-space-5);
  flex-shrink: 0;
  white-space: nowrap;
}

.case-library-row {
  display: flex;
  align-items: center;
  gap: var(--awd-space-3);
  padding-top: var(--awd-space-2);
  border-top: 1px solid var(--awd-border-subtle);
}

.field-label {
  font-size: var(--awd-panel-fs);
  font-weight: 500;
  color: var(--awd-text-2);
  white-space: nowrap;
  flex-shrink: 0;
}

.join-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--awd-space-3);
}

.step-card {
  background: var(--awd-surface);
  border: 1px solid var(--awd-border-subtle);
  border-radius: var(--awd-radius-dialog);
  padding: var(--awd-space-4);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-title {
  font-size: var(--awd-font-size-body);
  font-weight: 600;
  color: var(--awd-accent-text);
}

.step-desc {
  font-size: var(--awd-panel-fs);
  color: var(--awd-text-2);
  line-height: 1.55;
}

.workspace-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 268px minmax(0, 1fr);
}

.project-list {
  padding: var(--awd-space-5);
  background: var(--awd-surface);
  border-right: 1px solid var(--awd-border);
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-5);
  overflow: auto;
}

.sidebar-group {
  display: flex;
  flex-direction: column;
  gap: var(--awd-space-2);
}

.sidebar-checklists {
  flex: 1;
  min-height: 0;
}

.sidebar-label {
  font-size: var(--awd-panel-fs);
  font-weight: 600;
  color: var(--awd-text-2);
}

.list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--awd-space-2);
}

.request-picker { display: none; }

.request-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dd-workspace button.request-row {
  width: 100%;
  justify-content: space-between;
  text-align: left;
  padding: 9px 12px;
  background: var(--awd-bg);
  border-color: transparent;
  color: var(--awd-text);
}

.dd-workspace button.request-row:hover:not(:disabled) {
  background: var(--awd-accent-wash);
  border-color: var(--awd-border);
}

.dd-workspace button.request-row.selected {
  background: var(--awd-accent-soft);
  border-color: var(--awd-mint);
  color: var(--awd-accent-text);
  font-weight: 600;
}

.request-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--awd-radius-sm);
  background: var(--awd-surface-2);
  color: var(--awd-text-2);
  font-size: var(--awd-panel-fs-meta);
}

.sidebar-footer {
  margin-top: auto;
  padding-top: var(--awd-space-3);
  border-top: 1px solid var(--awd-border-subtle);
}

.dd-workspace button.remove {
  color: var(--awd-text-3);
  font-size: var(--awd-panel-fs);
}

.dd-workspace button.remove:hover:not(:disabled) {
  color: var(--awd-danger-text);
  background: var(--awd-danger-soft);
}

.empty {
  padding: var(--awd-space-4) 0;
  color: var(--awd-text-3);
  line-height: 1.6;
  font-size: var(--awd-panel-fs);
}

.loading-state,
.detail-empty {
  padding: var(--awd-space-8);
  text-align: center;
}

.error-banner {
  margin: var(--awd-space-4) var(--awd-space-6) 0;
  padding: var(--awd-space-3) var(--awd-space-4);
  border-radius: var(--awd-radius-md);
  background: var(--awd-danger-soft);
  border: 1px solid var(--awd-danger);
  color: var(--awd-danger-text);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--awd-space-3);
  flex-wrap: wrap;
}

@container dd-workspace (max-width: 1100px) {
  .workspace-body { display: flex; flex-direction: column; min-height: auto; }
  .project-list { border-right: 0; border-bottom: 1px solid var(--awd-border); padding: var(--awd-space-4); overflow: visible; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--awd-space-3); }
  .sidebar-group { min-width: 0; }
  .sidebar-footer { grid-column: 1 / -1; padding-top: 0; border-top: 0; }
  .request-stack { display: none; }
  .request-picker { display: block; }
}

@container dd-workspace (max-width: 480px) {
  .project-list { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 760px) {
  .workspace-header {
    padding: var(--awd-space-4);
  }
  .join-stage,
  .join-stage.is-empty-stage {
    padding: var(--awd-space-4);
    align-items: stretch;
  }
  .join-panel {
    padding: var(--awd-space-4);
  }
  .join-steps {
    grid-template-columns: 1fr;
  }
  .case-library-row {
    flex-direction: column;
    align-items: stretch;
  }
  .dd-workspace {
    height: auto;
    min-height: 100%;
  }
}
</style>
