<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="message-center" :aria-label="$t('messageCenter.title')">
    <header class="center-heading"><div><h2>{{ $t('messageCenter.title') }}</h2><small>{{ $t('messageCenter.subtitle') }}</small></div><button :disabled="loading" @click="refresh">{{ $t('messageCenter.refresh') }}</button></header>
    <p v-if="error" class="center-error" role="alert">{{ error }} <button @click="refresh">{{ $t('messageCenter.retry') }}</button><button v-if="accountRequired" @click="connectAccount">{{ $t('messageCenter.login') }}</button></p>
    <p v-if="unavailableSources.length" class="center-hint source-warning" role="status">{{ $t('messageCenter.sourcesUnavailable') }}</p>
    <div class="center-body" :class="{ 'has-selection': !!(selectedConversation || selectedNotice) }">
      <aside class="center-list" :aria-label="$t('messageCenter.title')">
        <label class="project-filter"><span>{{ $t('messageCenter.projectFilter') }}</span><select v-model="projectKey" @change="changeProject"><option value="">{{ $t('messageCenter.allProjects') }}</option><option v-for="project in projects" :key="project.key" :value="project.key">{{ project.name }}</option></select></label>
        <div class="center-tabs" role="tablist"><button v-for="tab in categories" :key="tab.key" role="tab" :aria-selected="category === tab.key" @click="changeCategory(tab.key)">{{ $t('messageCenter.' + tab.key) }}<span v-if="tab.count"> {{ tab.count }}</span></button></div>
        <input v-model="search" class="center-search" type="search" :placeholder="$t('messageCenter.search')" :aria-label="$t('messageCenter.search')" />
        <div v-if="category === 'conversations'" class="list-actions"><button v-if="currentProjectId" :disabled="creating" @click="openProjectGroup">{{ $t('messageCenter.projectGroup') }}</button><button @click="form = 'create'">{{ $t('messageCenter.newChat') }}</button><button @click="form = 'join'">{{ $t('messageCenter.joinChat') }}</button></div>
        <form v-if="form" class="create-form" @submit.prevent="createConversation"><select v-if="form === 'create'" v-model="formType" :aria-label="$t('messageCenter.chatType')"><option value="DIRECT">{{ $t('messageCenter.direct') }}</option><option value="GROUP">{{ $t('messageCenter.group') }}</option></select><input v-model="formValue" :aria-label="$t(form === 'create' ? 'messageCenter.titleLabel' : 'messageCenter.inviteLabel')" :placeholder="$t(form === 'create' ? 'messageCenter.titleLabel' : 'messageCenter.inviteLabel')" maxlength="120" required /><button :disabled="creating">{{ $t(form === 'create' ? 'messageCenter.create' : 'messageCenter.join') }}</button><button type="button" @click="form = ''">{{ $t('messageCenter.cancel') }}</button></form>
        <p v-if="loading && !items.length" role="status">{{ $t('messageCenter.loading') }}</p>
        <div class="list-scroll">
          <template v-if="category === 'conversations'">
            <div v-if="availableAgents.length" class="scope-agents"><small>{{ $t('messageCenter.assistants') }}</small><button v-for="agent in availableAgents" :key="agent.scopeKey" :disabled="creating" @click="openAgent(agent)"><span>{{ agent.title || agent.name }}</span><small>{{ $t('messageCenter.' + agent.scope) }}</small></button></div>
            <p v-if="projectReason" class="center-hint">{{ projectReason }}</p>
          </template>
          <button v-for="item in items" :key="itemKey(item)" class="inbox-row" :class="{ selected: selection === itemKey(item), unread: category === 'conversations' ? item.unreadCount > 0 : !isNoticeRead(item) }" @click="selectItem(item)"><span class="row-title">{{ item.title }}<template v-if="item.historicalDiscussion"> · {{ $t('messageCenter.historicalDiscussion') }}</template><span v-if="category === 'conversations' && item.unreadCount" class="unread-count">{{ item.unreadCount }}</span><span v-else-if="category !== 'conversations' && !isNoticeRead(item)" class="unread-dot" :aria-label="$t('messageCenter.unread')"></span></span><span class="row-preview">{{ category === 'conversations' ? (item.lastMessage?.text || item.lastMessage || '') : item.body }}</span><small>{{ item.projectName || item.sourceName || (item.agent ? $t('messageCenter.' + item.agent.scope) : '') }}<span v-if="item.actionState === 'pending'"> · {{ $t('messageCenter.statusPending') }}</span></small></button>
          <p v-if="!loading && !items.length" class="center-empty">{{ $t(category === 'pending' ? 'messageCenter.emptyPending' : 'messageCenter.empty') }}</p>
        </div>
        <p v-if="hasMore" class="center-hint recent-only">{{ $t('messageCenter.recentOnly') }}</p>
      </aside>
      <div class="center-detail">
        <MessageConversationPane v-if="selectedConversation && current" :conversation="selectedConversation" :messages="current.messages" :pending-messages="current.pending" :draft="current.draft" :self-id="selectedConversation.sourceId === 'dd-client' ? current.selfId : selfId" :loading="current.loading" :has-more="current.hasMore" :error="current.error" :agent-status="current.status" :agent-busy="isAgentBusy(current)" :failures="Object.values(current.failures)" :can-reply="!!lastOwnMessage(current)" @back="selection = ''" @draft="current.draft = $event" @send="sendMessage" @retry-send="sendMessage($event)" @older="loadMessages(selectedConversation, true)" @reply="requestReply(selectedConversation, lastOwnMessage(current)?.id)" @retry-reply="requestReply(selectedConversation, $event)" @private="openPrivate" @invite="createInvite" @download="downloadAttachment" />
        <article v-else-if="selectedNotice" class="notice-detail"><button class="notice-back" @click="selection = ''">{{ $t('messageCenter.back') }}</button><small>{{ $t('messageCenter.source', { name: selectedNotice.sourceName || selectedNotice.sourceId }) }}</small><h3>{{ selectedNotice.title }}</h3><time>{{ displayDate(selectedNotice.createdAt) }}</time><p class="notice-body">{{ selectedNotice.body }}</p><p v-if="selectedNotice.actionState !== 'none'" class="notice-state">{{ $t('messageCenter.' + ({pending:'statusPending',done:'statusDone',cancelled:'statusCancelled'}[selectedNotice.actionState] || 'notifications')) }}</p><p class="center-hint">{{ $t('messageCenter.readNotDone') }}</p><p v-if="noticeError" class="center-error" role="alert">{{ noticeError }}</p><div class="notice-actions"><button v-if="!isNoticeRead(selectedNotice)" @click="markNoticeRead(selectedNotice)">{{ $t('messageCenter.markRead') }}</button><button v-if="selectedNotice.target?.kind" class="primary" :disabled="opening" @click="openNotice">{{ $t(selectedNotice.actionState === 'pending' ? 'messageCenter.goHandle' : 'messageCenter.openBusiness') }}</button></div></article>
        <div v-else class="center-placeholder"><h3>{{ $t('messageCenter.choose') }}</h3><p>{{ $t('messageCenter.chooseHint') }}</p></div>
        <div v-if="inviteCode && selectedConversation" class="invite-result" role="status"><strong>{{ $t('messageCenter.inviteLabel') }}</strong><code>{{ inviteCode }}</code><button @click="inviteCode = ''">{{ $t('messageCenter.cancel') }}</button></div>
      </div>
    </div>
  </section>
</template>
<script>
import MessageConversationPane from './MessageConversationPane.vue'
import { messageCenterRequest, messageCenterIdentity } from '@/services/messageCenter.js'
import { normalizeMessageTarget } from '@/utils/messageTargets.js'
import { requireAccount, ACCOUNT_CHANGED_EVENT } from '@/utils/requireAccount.js'

const conversationKey = row => `${row.sourceId === 'dd-client' ? `dd:${row.connectionId}:` : 'im:'}${row.id}`
const historyState = () => ({ messages: [], pending: [], draft: '', failures: {}, status: null, admitting: false, loading: false, hasMore: false, error: '', humanCount: null, selfId: null })
export default {
  components: { MessageConversationPane },
  props: { currentProjectId: { type: [String, Number], default: null }, initialConversationId: { type: String, default: '' }, openTarget: { type: Function, required: true }, inviteProject: { type: Function, default: null } },
  data: () => ({ category: 'conversations', selection: '', search: '', projectKey: '', projects: [], conversations: [], notifications: [], counts: {}, agents: [], projectReason: '', unavailableSources: [], histories: {}, selfId: null, loading: false, error: '', accountRequired: false, hasMore: false, identityLoaded: false, form: '', formType: 'DIRECT', formValue: '', creating: false, noticeError: '', opening: false, inviteCode: '', epoch: 0, listSerial: 0 }),
  computed: {
    availableAgents() { return this.agents.filter(agent => !this.conversations.some(row => row.agent?.scopeKey === agent.scopeKey && row.agent.scope === agent.scope && !row.agent.private && row.type !== 'AGENT_DIRECT')) },
    categories() { return [{ key: 'conversations', count: this.counts.unreadMessages }, { key: 'notifications', count: this.counts.unreadNotifications }, { key: 'pending', count: this.counts.pending }] },
    items() { const list = this.category === 'conversations' ? this.conversations : this.notifications.filter(row => this.category !== 'pending' || row.actionState === 'pending'); const query = this.search.trim().toLowerCase(); return query ? list.filter(row => `${row.title || ''} ${row.body || ''} ${row.projectName || ''}`.toLowerCase().includes(query)) : list },
    selectedConversation() { return this.category === 'conversations' ? this.conversations.find(row => conversationKey(row) === this.selection) : null },
    selectedNotice() { return this.category !== 'conversations' ? this.notifications.find(row => row.id === this.selection) : null },
    current() { return this.selectedConversation ? this.histories[this.selection] : null },
  },
  watch: { initialConversationId(value) { if (value) this.focusConversation(value) }, currentProjectId() { this.resetAccount() } },
  mounted() {
    this._alive = true
    this._accountChanged = () => this.resetAccount()
    uni.$on(ACCOUNT_CHANGED_EVENT, this._accountChanged)
    this._onMessagesChanged = () => this.refresh()
    uni.$on('awd:message-center-changed', this._onMessagesChanged)
    this._onFocus = () => this.refresh()
    window.addEventListener('focus', this._onFocus)
    this.refresh(true)
    this._poll = setInterval(() => { if (document.hidden) return; if (this.selectedConversation) this.loadMessages(this.selectedConversation); if (++this._pollCount % 5 === 0) this.refresh() }, 3000)
    this._pollCount = 0
  },
  beforeUnmount() { this._alive = false; this.epoch++; clearInterval(this._poll); uni.$off(ACCOUNT_CHANGED_EVENT, this._accountChanged); uni.$off('awd:message-center-changed', this._onMessagesChanged); window.removeEventListener('focus', this._onFocus) },
  methods: {
    ticket() { return { epoch: this.epoch, identity: messageCenterIdentity() } },
    valid(ticket) { return this._alive && ticket.epoch === this.epoch && ticket.identity === messageCenterIdentity() },
    im(action, params = {}, conversation = null) {
      if (conversation?.sourceId === 'dd-client') return messageCenterRequest('ddClientIm', { connectionId: conversation.connectionId, action, params })
      // A cloud project number is never a local project ID. Only a verified local association can supply private project materials.
      const project = conversation ? (conversation.localProjectId || null) : (action === 'agentScopes' || action === 'ensureAgent' || action === 'projectGroup' ? this.currentProjectId : null)
      return messageCenterRequest('im', { action, params }, project)
    },
    withProjectContext(conversation) {
      if (conversation.agent?.scope !== 'project') return conversation
      const scope = this.agents.find(agent => agent.scope === 'project' && (agent.scopeKey === conversation.agent.scopeKey || agent.legacyScopeKey === conversation.agent.scopeKey))
      if (!scope) return conversation
      return { ...conversation, ...(scope.localProjectId ? { localProjectId: scope.localProjectId } : {}), historicalDiscussion: scope.legacyScopeKey === conversation.agent.scopeKey && !conversation.agent.private && conversation.type !== 'AGENT_DIRECT' }
    },
    itemKey(item) { return this.category === 'conversations' ? conversationKey(item) : item.id },
    state(conversation) { const key = conversationKey(conversation); if (!this.histories[key]) this.histories[key] = historyState(); return this.histories[key] },
    resetAccount() { this.epoch++; this.listSerial++; this.selection = ''; this.conversations = []; this.notifications = []; this.projects = []; this.counts = {}; this.agents = []; this.histories = {}; this.selfId = null; this.projectKey = ''; this.projectReason = ''; this.unavailableSources = []; this.inviteCode = ''; this.form = ''; this.formType = 'DIRECT'; this.formValue = ''; this.error = ''; this.noticeError = ''; this.identityLoaded = false; this.loading = false; this.creating = false; this.opening = false; this.refresh(true) },
    async connectAccount() { if (await requireAccount()) this.resetAccount() },
    async refresh(initial = false) {
      const ticket = this.ticket(), serial = ++this.listSerial
      this.loading = true
      try {
        const result = await messageCenterRequest('list', { ...(this.projectKey ? { projectKey: this.projectKey } : {}), limit: 100 })
        if (!this.valid(ticket) || serial !== this.listSerial) return
        this.conversations = (result.conversations || []).map(row => this.withProjectContext(row)); this.notifications = result.notifications || []; this.counts = result.counts || {}; this.hasMore = !!result.hasMore; this.unavailableSources = result.unavailableSources || []
        const known = new Map(this.projects.map(project => [project.key, project])); for (const project of result.projects || []) if (project.key) known.set(project.key, project); this.projects = [...known.values()]
        this.error = ''; this.accountRequired = false
        if (result.cloudStatus === 'unavailable') { this.error = result.cloudError || this.$t('messageCenter.serviceFailed'); this.accountRequired = true }
        if (!this.identityLoaded) await this.loadIdentity(ticket)
        if (this.valid(ticket) && initial && this.initialConversationId) await this.focusConversation(this.initialConversationId)
      } catch (error) { if (this.valid(ticket) && serial === this.listSerial) { this.error = error.message || this.$t('messageCenter.serviceFailed'); this.accountRequired = !!error.accountRequired } }
      finally { if (this.valid(ticket) && serial === this.listSerial) this.loading = false }
    },
    async loadIdentity(ticket) {
      const [identity, scopes] = await Promise.allSettled([this.im('self'), this.im('agentScopes')])
      if (!this.valid(ticket)) return
      this.identityLoaded = true
      if (identity.status === 'fulfilled') this.selfId = identity.value.id
      if (scopes.status === 'fulfilled') { this.agents = scopes.value.agents || []; this.projectReason = scopes.value.projectReason || ''; this.conversations = this.conversations.map(row => this.withProjectContext(row)) }
      else this.projectReason = scopes.reason?.message || this.$t('messageCenter.serviceFailed')
    },
    changeProject() { this.selection = ''; this.inviteCode = ''; this.refresh() },
    changeCategory(category) { this.category = category; this.selection = ''; this.inviteCode = ''; this.noticeError = '' },
    async selectItem(item) {
      this.selection = this.itemKey(item); this.inviteCode = ''; this.noticeError = ''
      if (this.category !== 'conversations') { await this.markNoticeRead(item); return }
      const ticket = this.ticket(), state = this.state(item)
      this.loadMessages(item)
      try { const data = await this.im('members', { conversationId: item.id }, item); if (this.valid(ticket)) state.humanCount = data.humanCount ?? data.members?.filter(member => member.actorType !== 'AGENT').length } catch (_) { /* Explicit assistant requests remain available when member lookup fails. */ }
      if (!this.valid(ticket)) return
      if (item.sourceId === 'dd-client') { try { const self = await this.im('self', {}, item); if (this.valid(ticket)) state.selfId = self.id } catch (_) { /* Never infer an invited user's identity from the official account. */ } }
    },
    async focusConversation(id) {
      const ticket = this.ticket()
      let conversation = this.conversations.find(row => row.sourceId !== 'dd-client' && String(row.id) === String(id))
      if (!conversation) { try { conversation = await this.im('agentInfo', { conversationId: id }); if (!this.valid(ticket)) return; this.conversations.unshift(conversation) } catch (error) { if (this.valid(ticket)) this.error = error.message; return } }
      this.category = 'conversations'; this.selectItem(conversation)
    },
    mergeMessages(state, messages) { const byId = new Map(state.messages.map(message => [String(message.id), message])); for (const message of messages || []) byId.set(String(message.id), message); state.messages = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)); state.pending = state.pending.filter(pending => !state.messages.some(message => message.clientMessageId === pending.clientMessageId)) },
    canRequestAssistant(conversation) { return !!conversation?.agent && conversation.canRequestAgent !== false && conversation.sourceId !== 'dd-client' },
    applyStatus(state, status, conversation = null) {
      state.status = status || null
      if (!status?.messageId) return
      const id = String(status.messageId)
      if (status.status === 'failed' && (!conversation || this.canRequestAssistant(conversation))) { const source = state.messages.find(message => String(message.id) === id); if (source && source.actorType !== 'AGENT' && String(source.senderId) === String(this.selfId)) state.failures[id] = { messageId: status.messageId, text: source.text, error: status.error } }
      else if (['queued', 'running', 'completed'].includes(status.status)) delete state.failures[id]
    },
    async loadMessages(conversation, older = false) {
      const ticket = this.ticket(), state = this.state(conversation)
      if (state.loading) return
      state.loading = true
      try {
        const result = await this.im('messages', { conversationId: conversation.id, limit: 100, ...(older && state.messages.length ? { beforeId: state.messages[0].id } : {}) }, conversation)
        if (!this.valid(ticket)) return
        this.mergeMessages(state, result.messages); if (older || !state.messages.length || !state.loaded) state.hasMore = !!result.hasMore; state.loaded = true
        if (!older) this.applyStatus(state, result.agentStatus, conversation)
        state.error = ''
        if (this.selection === conversationKey(conversation) && this.category === 'conversations' && state.messages.length) {
          const lastReadId = state.messages.at(-1).id
          if (state.readId !== lastReadId) { await this.im('read', { conversationId: conversation.id, lastReadId }, conversation); if (!this.valid(ticket)) return; state.readId = lastReadId; conversation.unreadCount = 0; uni.$emit('awd:message-center-changed') }
        }
      } catch (error) { if (this.valid(ticket)) state.error = error.message || this.$t('messageCenter.serviceFailed') }
      finally { if (this.valid(ticket)) state.loading = false }
    },
    lastOwnMessage(state) { const id = this.selectedConversation?.sourceId === 'dd-client' ? state.selfId : this.selfId; return id == null ? null : [...state.messages].reverse().find(message => message.actorType !== 'AGENT' && String(message.senderId) === String(id)) },
    isAgentBusy(state) { return state.admitting || ['queued', 'running'].includes(state.status?.status) },
    async sendMessage(pending) {
      const conversation = this.selectedConversation
      if (!conversation) return
      const state = this.state(conversation), ticket = this.ticket()
      if (!pending?.clientMessageId) { const text = state.draft.trim(); if (!text) return; pending = { text, clientMessageId: crypto.randomUUID(), sending: false }; state.pending.push(pending); state.draft = '' }
      if (pending.sending) return
      pending.sending = true
      try {
        const message = await this.im('send', { conversationId: conversation.id, text: pending.text, clientMessageId: pending.clientMessageId }, conversation)
        if (!this.valid(ticket)) return
        this.mergeMessages(state, [message]); state.pending = state.pending.filter(item => item.clientMessageId !== pending.clientMessageId)
        if (this.canRequestAssistant(conversation) && (conversation.agent.private || conversation.type === 'AGENT_DIRECT' || state.humanCount === 1)) this.requestReply(conversation, message.id)
      } catch (error) { if (this.valid(ticket)) { pending.sending = false; state.error = error.message } }
    },
    async requestReply(conversation, messageId) {
      if (!this.canRequestAssistant(conversation) || !messageId) return
      const ticket = this.ticket(), state = this.state(conversation), id = String(messageId)
      const fail = error => { state.failures[id] = { messageId, text: state.messages.find(message => String(message.id) === id)?.text, error } }
      if (conversation.agent?.scope === 'project' && (conversation.agent.private || conversation.type === 'AGENT_DIRECT') && !conversation.localProjectId) { fail(this.$t('messageCenter.openAssistantProject')); return }
      if (state.admitting) { fail(this.$t('messageCenter.admissionPending')); return }
      state.admitting = true
      try { const result = await this.im('agentReply', { conversationId: conversation.id, messageId }, conversation); if (!this.valid(ticket)) return; delete state.failures[id]; this.applyStatus(state, { status: result.status, messageId: result.messageId || messageId }) }
      catch (error) { if (this.valid(ticket)) fail(error.message) }
      finally { if (this.valid(ticket)) state.admitting = false }
    },
    async openAgent(agent, privateChat = false, source = null) {
      const ticket = this.ticket(); this.creating = true
      try { const conversation = await this.im('ensureAgent', { scope: agent.scope, scopeKey: agent.scopeKey, title: agent.title || agent.name, private: privateChat }, source); if (!this.valid(ticket)) return; this.upsertConversation(conversation); this.category = 'conversations'; this.selectItem(conversation) }
      catch (error) { if (this.valid(ticket)) this.error = error.message }
      finally { if (this.valid(ticket)) this.creating = false }
    },
    openPrivate() { const conversation = this.selectedConversation; if (!this.canRequestAssistant(conversation)) return; if (conversation.agent.scope === 'project' && !conversation.localProjectId) { this.state(conversation).error = this.$t('messageCenter.openAssistantProject'); return } this.openAgent(conversation.agent, true, conversation) },
    upsertConversation(conversation) { const index = this.conversations.findIndex(row => conversationKey(row) === conversationKey(conversation)); if (index >= 0) this.conversations.splice(index, 1, conversation); else this.conversations.unshift(conversation) },
    async openProjectGroup() {
      const ticket = this.ticket(); this.creating = true
      try { const conversation = await this.im('projectGroup'); if (!this.valid(ticket)) return; this.upsertConversation(conversation); this.category = 'conversations'; this.selectItem(conversation) }
      catch (error) { if (this.valid(ticket)) this.error = error.message }
      finally { if (this.valid(ticket)) this.creating = false }
    },
    async createConversation() {
      if (!this.formValue.trim() || this.creating) return
      const ticket = this.ticket(); this.creating = true
      try { const conversation = await this.im(this.form === 'create' ? 'create' : 'join', this.form === 'create' ? { title: this.formValue.trim(), type: this.formType } : { code: this.formValue.trim() }); if (!this.valid(ticket)) return; this.upsertConversation(conversation); this.form = ''; this.formType = 'DIRECT'; this.formValue = ''; this.category = 'conversations'; this.selectItem(conversation) }
      catch (error) { if (this.valid(ticket)) this.error = error.message }
      finally { if (this.valid(ticket)) this.creating = false }
    },
    async createInvite() { const conversation = this.selectedConversation, ticket = this.ticket(); try { if (conversation.projectId) { if (!this.inviteProject) throw new Error(this.$t('messageCenter.targetUnavailable')); await this.inviteProject(conversation); return } const result = await this.im('invite', { conversationId: conversation.id, role: 'MEMBER' }, conversation); if (this.valid(ticket) && this.selection === conversationKey(conversation)) this.inviteCode = result.code } catch (error) { if (this.valid(ticket)) this.state(conversation).error = error.message } },
    isNoticeRead(notice) { return typeof notice.read === 'boolean' ? notice.read : !!notice.readAt },
    async markNoticeRead(notice) { if (this.isNoticeRead(notice)) return; const ticket = this.ticket(); try { await messageCenterRequest('read', { id: notice.id }); if (this.valid(ticket)) { notice.read = true; this.counts.unreadNotifications = Math.max(0, (this.counts.unreadNotifications || 0) - 1); uni.$emit('awd:message-center-changed') } } catch (error) { if (this.valid(ticket)) this.noticeError = error.message } },
    async openNotice() {
      const notice = this.selectedNotice, ticket = this.ticket(); if (!notice || this.opening) return; this.opening = true; this.noticeError = ''
      try { const resolved = await messageCenterRequest('target', { id: notice.id }); if (!this.valid(ticket) || this.selection !== notice.id) return; const target = normalizeMessageTarget(resolved.target || resolved); if (!target) throw new Error(this.$t('messageCenter.targetUnavailable')); const opened = await this.openTarget(target, notice.id); if (opened === false) throw new Error(this.$t('messageCenter.openFailed')) }
      catch (error) { if (this.valid(ticket)) this.noticeError = error.message || this.$t('messageCenter.openFailed') }
      finally { if (this.valid(ticket)) this.opening = false }
    },
    async downloadAttachment(attachment) {
      const conversation = this.selectedConversation, ticket = this.ticket()
      try { const data = await this.im('download', { conversationId: conversation.id, attachmentId: attachment.id }, conversation); if (!this.valid(ticket)) return; if (typeof data.base64 !== 'string' || data.base64.length > 11184812 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) throw new Error(this.$t('messageCenter.attachmentUnavailable')); const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes])); const link = document.createElement('a'); link.href = url; link.download = String(data.name || attachment.name || 'attachment').replace(/[/\\\x00-\x1f]/g, '_'); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
      catch (error) { if (this.valid(ticket)) this.state(conversation).error = error.message }
    },
    displayDate(date) { return date && Number.isFinite(new Date(date).getTime()) ? new Date(date).toLocaleString() : '-' },
  },
}
</script>
<style scoped>
.message-center{container:message-center / inline-size;display:flex;flex-direction:column;min-height:0;height:100%;background:var(--awd-bg);color:var(--awd-text);font-size:13px}.center-heading{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--awd-border);gap:12px}.center-heading h2{font-size:16px;margin:0 0 3px;font-weight:600}.center-heading small{color:var(--awd-text-2)}.center-body{display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr);min-height:0;flex:1}.center-list{display:flex;flex-direction:column;min-height:0;padding:12px 10px 0;border-right:1px solid var(--awd-border);gap:10px}.project-filter{display:flex;align-items:center;gap:8px;font-size:11px}.project-filter select{flex:1;min-width:0}.center-tabs{display:flex;gap:4px}.center-tabs button{flex:1;padding:6px 3px;background:transparent;border-color:transparent;white-space:nowrap}.center-tabs button[aria-selected=true]{background:var(--awd-accent-wash);color:var(--awd-accent-text);font-weight:600}.list-actions{display:flex;gap:6px;flex-wrap:wrap}.list-actions button{font-size:11px}.list-scroll{min-height:0;overflow:auto;flex:1}.scope-agents{display:flex;flex-direction:column;gap:4px;padding-bottom:12px;border-bottom:1px solid var(--awd-border);margin-bottom:6px}.scope-agents>small{padding:2px 6px;color:var(--awd-text-2)}.scope-agents button{display:flex;align-items:center;justify-content:space-between;gap:6px;border-color:transparent;background:transparent;text-align:left}.scope-agents button small{color:var(--awd-text-2)}.inbox-row{display:flex;flex-direction:column;gap:5px;width:100%;padding:10px;text-align:left;border-color:transparent;background:transparent;margin-bottom:3px}.inbox-row:hover,.scope-agents button:hover{background:var(--awd-surface)}.inbox-row.selected{background:var(--awd-accent-wash);border-color:var(--awd-border)}.row-title{display:flex;justify-content:space-between;gap:8px;align-items:center;overflow-wrap:anywhere}.inbox-row.unread .row-title{font-weight:600}.row-preview{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:100%;color:var(--awd-text-2);font-size:12px}.inbox-row small{color:var(--awd-text-3);font-size:11px}.unread-count{font-size:10px;min-width:16px;text-align:center;border-radius:10px;padding:1px 3px;background:var(--awd-accent);color:var(--awd-text-on-accent)}.unread-dot{width:6px;height:6px;border-radius:50%;background:var(--awd-accent);flex:none}.center-detail{position:relative;min-width:0;min-height:0}.center-placeholder{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:28px;box-sizing:border-box;text-align:center;color:var(--awd-text-2)}.center-placeholder h3{font-size:16px;font-weight:500;margin:0}.center-placeholder p{font-size:12px;max-width:300px;line-height:1.6}.center-empty,.center-hint{font-size:11px;color:var(--awd-text-2);line-height:1.6;overflow-wrap:anywhere}.center-empty{padding:12px 8px}.source-warning{padding:0 12px}.recent-only{border-top:1px solid var(--awd-border);margin:0;padding:8px 0}.center-error{font-size:12px;color:var(--awd-danger-text,var(--awd-danger));padding:0 12px;overflow-wrap:anywhere}.create-form{display:flex;flex-wrap:wrap;gap:5px}.create-form input{width:100%}.notice-detail{padding:24px;overflow:auto;box-sizing:border-box;height:100%}.notice-detail>small,.notice-detail time{font-size:11px;color:var(--awd-text-2)}.notice-detail h3{font-size:19px;font-weight:600;line-height:1.5;margin:8px 0}.notice-body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.notice-state{color:var(--awd-accent-text);font-size:12px}.notice-actions{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}.notice-back{display:none}.invite-result{position:absolute;bottom:0;left:0;right:0;padding:12px;background:var(--awd-surface);border:1px solid var(--awd-border);display:flex;gap:12px;align-items:center;flex-wrap:wrap}.invite-result code{user-select:all;overflow-wrap:anywhere}button,input,select{font:inherit;color:var(--awd-text);background:var(--awd-surface);border:1px solid var(--awd-border);border-radius:var(--awd-radius-sm,4px);padding:6px 8px;box-sizing:border-box;min-height:30px}button{cursor:pointer}button.primary{background:var(--awd-accent);border-color:var(--awd-accent);color:var(--awd-text-on-accent)}button:disabled{cursor:default;opacity:.5}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--awd-accent);outline-offset:2px}@container message-center (max-width:620px){.center-body{grid-template-columns:minmax(0,1fr)}.center-list{border-right:0}.center-body:not(.has-selection) .center-detail{display:none}.center-body.has-selection .center-list{display:none}.notice-back{display:block;margin-bottom:16px}.notice-detail{padding:16px}.center-heading{padding:10px 12px}}
</style>
