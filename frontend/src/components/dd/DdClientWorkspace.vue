<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="dd-workspace">
    <header class="workspace-header">
      <div><h2>受邀尽调</h2><p>按律师清单准备材料，逐项提交并查看反馈。</p></div>
      <button class="secondary" @click="adding = !adding">加入项目</button>
    </header>
    <div class="notification-bar"><span>{{ notifications.length ? `${notifications.length} 条未读消息` : '项目消息会显示在这里' }}</span><button v-if="notificationPermission === 'default'" class="text-button" @click="enableNotifications">开启系统提醒</button><small v-else-if="notificationPermission !== 'granted'">系统提醒未开启，仍可在这里查收</small></div>
    <div v-if="notifications.length" class="notification-list"><button v-for="n in notifications" :key="`${n.connectionId}:${n.id}`" class="text-button" @click="openNotification(n)">{{ n.title }}</button></div>
    <form v-if="adding || !connections.length" class="join-panel" @submit.prevent="join">
      <label for="dd-invite">律师发送的邀请码</label>
      <div class="join-row"><input id="dd-invite" v-model="code" autocomplete="off" placeholder="输入邀请码" :disabled="joining" @confirm="join" /><button :disabled="joining || !code.trim()" @click="join">{{ joining ? '正在加入…' : '加入项目' }}</button></div>
      <select v-if="cloudConnections.length" v-model="cloudConnectionId" aria-label="案件库"><option value="">官方案件库</option><option v-for="c in cloudConnections" :key="c.id" :value="c.id">{{ c.displayName || c.serverUrl }}</option></select>
      <p>项目加入后保留在这个标签页，您仍可使用 AI WorkDeck 的其他功能。</p>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }} <button class="text-button" @click="load">重试</button></p>
    <p v-if="loading" class="empty" role="status">正在读取受邀项目…</p>
    <div v-if="connections.length" class="workspace-body">
      <aside class="project-list">
        <label for="dd-project">受邀项目</label>
        <select id="dd-project" :value="selectedId" @change="selectConnection($event.target.value)"><option v-for="c in connections" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <div class="list-heading"><span>律师已发布的清单</span><button class="text-button" @click="loadRequests">刷新</button></div>
        <p v-if="requestsLoading" class="empty">正在读取清单…</p>
        <p v-else-if="!requests.length" class="empty">律师确认并发布后，清单会显示在这里。</p>
        <button v-for="request in requests" :key="request.id" class="request-row" :class="{ selected: String(requestId) === String(request.id) }" @click="requestId = request.id"><span>{{ request.name }}</span><small v-if="request.status === 'ARCHIVED'">已归档</small></button>
        <button class="text-button remove" @click="leave">移除本机连接</button>
      </aside>
      <DdClientChecklist v-if="requestId && selected" :key="`${selected.id}:${requestId}`" :request-id="requestId" :project-id="selected.projectId" :connection-id="selected.id" />
      <div v-else class="empty detail-empty">请选择一份清单开始准备材料。</div>
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
  data: () => ({ code: '', connections: [], selectedId: '', requestId: null, requests: [], adding: false, joining: false, loading: false, requestsLoading: false, error: '', cloudConnections: [], cloudConnectionId: '', generation: 0, identity: '', identityTimer: null, notificationTimer: null, notifications: [], notificationPermission: ddNotificationPermission() }),
  computed: { selected() { return this.connections.find(c => c.id === this.selectedId) } },
  mounted() {
    this.identity = ddClientIdentity(); this.load(); this.refreshNotifications(); this.notificationTimer = setInterval(() => this.refreshNotifications(), 15000)
    if (typeof window !== 'undefined' && window.__AWD_PORTAL_CODE__) { this.code = window.__AWD_PORTAL_CODE__; window.__AWD_PORTAL_CODE__ = ''; this.adding = true }
    if (!isClientPortalBuild()) listCloudConnections().then(r => { this.cloudConnections = r?.data?.connections || r?.connections || [] }).catch(() => {})
    this.identityTimer = setInterval(() => { if (this.identity !== ddClientIdentity()) { this.identity = ddClientIdentity(); this.generation++; this.connections = []; this.notifications = []; this.requests = []; this.selectedId = ''; this.requestId = null; this.load() } }, 1000)
  },
  beforeUnmount() { this.generation++; clearInterval(this.identityTimer); clearInterval(this.notificationTimer) },
  methods: {
    async refreshNotifications() { try { const result = await pollDdClientNotifications({ onOpen: n => this.openNotification(n) }); this.notifications = result.notifications; this.notificationPermission = ddNotificationPermission() } catch {} },
    async enableNotifications() { this.notificationPermission = await enableDdNotifications(); await this.refreshNotifications() },
    async openNotification(n) {
      this.selectConnection(n.connectionId)
      await this.loadRequests()
      if (this.requests.some(r => r.id === n.requestId)) this.requestId = n.requestId
      try { await ddClientWrite({ connectionId: n.connectionId, projectId: this.selected?.projectId }, `/notifications/${n.id}/read`, {}); await this.refreshNotifications() } catch (e) { this.error = e.message }
    },
    async load() {
      const generation = ++this.generation; this.loading = true; this.error = ''
      try { const rows = await listDdClientConnections(); if (generation !== this.generation) return; this.connections = rows; if (!rows.some(c => c.id === this.selectedId)) this.selectedId = rows[0]?.id || ''; await this.loadRequests() }
      catch (e) { if (generation === this.generation) this.error = e.message }
      finally { if (generation === this.generation) this.loading = false }
    },
    async join() {
      if (this.joining || !this.code.trim()) return
      this.joining = true; this.error = ''
      try { const row = await connectDdClient(this.code.trim(), this.cloudConnectionId || null); this.code = ''; this.selectedId = row.id; this.adding = false; await this.load() }
      catch (e) { this.error = e.message } finally { this.joining = false }
    },
    selectConnection(id) { this.selectedId = id; this.requestId = null; this.requests = []; this.loadRequests() },
    async loadRequests() {
      const selected = this.selected; if (!selected) return
      const id = selected.id; this.requestsLoading = true; this.error = ''
      try { const rows = await ddClientRead({ connectionId: id, projectId: selected.projectId }, '/projects'); if (id !== this.selectedId) return; this.requests = rows; if (!rows.some(r => r.id === this.requestId)) this.requestId = rows[0]?.id || null }
      catch (e) { if (id === this.selectedId) this.error = e.message }
      finally { if (id === this.selectedId) this.requestsLoading = false }
    },
    async leave() {
      const id = this.selectedId; if (!id) return
      try { await removeDdClientConnection(id); this.selectedId = ''; this.requestId = null; await this.load() } catch (e) { this.error = e.message }
    },
  },
}
</script>
<style scoped>
.dd-workspace{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--awd-bg);color:var(--awd-text);font-size:var(--awd-font-size-reading,14px);overflow:auto}
.notification-bar{display:flex;gap:14px;align-items:center;padding:12px 24px;font-size:12px;color:var(--awd-text-2);flex-wrap:wrap}.notification-list{padding:0 24px 12px;display:flex;flex-direction:column;align-items:flex-start;gap:8px}.workspace-header>.secondary{flex-shrink:0;white-space:nowrap}.workspace-header{padding:24px;display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid var(--awd-border)}h2{font-size:20px;font-weight:600;margin:0 0 8px}p{margin:0;line-height:1.7;color:var(--awd-text-2)}button,input,select{font:inherit}button{margin:0;line-height:1.5;cursor:pointer;border:1px solid transparent;border-radius:var(--awd-radius-sm,6px);padding:9px 14px;background:var(--awd-accent);color:var(--awd-text-on-accent)}button::after{border:0}button:disabled{opacity:.5;cursor:default}.secondary{background:var(--awd-surface);color:var(--awd-text);border-color:var(--awd-border)}input,select{min-width:0;border:1px solid var(--awd-border);border-radius:var(--awd-radius-sm,6px);background:var(--awd-surface);color:var(--awd-text);padding:10px}.join-panel{margin:24px;max-width:600px;display:flex;flex-direction:column;gap:10px}.join-row{display:flex;gap:8px}.join-row input{flex:1}.join-panel p{font-size:12px}.workspace-body{flex:1;min-height:0;display:grid;grid-template-columns:240px minmax(0,1fr)}.project-list{padding:20px;border-right:1px solid var(--awd-border);display:flex;flex-direction:column;gap:12px;overflow:auto}.list-heading{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--awd-text-2)}.text-button{background:none;color:var(--awd-accent-text);padding:4px;border:0}.request-row{background:none;color:var(--awd-text);text-align:left;display:flex;gap:8px;justify-content:space-between;line-height:1.5}.request-row.selected{background:var(--awd-accent-soft,var(--awd-surface-2));color:var(--awd-accent-text)}.request-row small{flex-shrink:0}.empty{padding:18px 0;color:var(--awd-text-3);line-height:1.7}.detail-empty{padding:36px}.remove{align-self:flex-start;margin-top:auto;font-size:12px;color:var(--awd-text-3)}.error{padding:12px 24px;color:var(--awd-danger-text)}
@media(max-width:700px){.workspace-header{padding:18px}.workspace-body{display:flex;flex-direction:column;min-height:auto}.project-list{border-right:0;border-bottom:1px solid var(--awd-border);padding:16px;overflow:visible}.join-panel{margin:18px}.remove{margin-top:0}.dd-workspace{height:auto;min-height:100%}}
</style>
