<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="message-center" :aria-label="$t('messageCenter.title')">
    <header class="center-heading">
      <div class="center-heading-copy"><h2>{{ $t('messageCenter.title') }}</h2><p>{{ $t('messageCenter.subtitle') }}</p></div>
      <button class="refresh-button" :disabled="loading" @click="refresh()">
        <svg :class="{ spinning: loading }" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17" /></svg>
        <span>{{ $t(loading ? 'messageCenter.loading' : 'messageCenter.refresh') }}</span>
      </button>
    </header>
    <div v-if="error" class="center-error" role="alert"><span>{{ error }}</span><button @click="refresh()">{{ $t('messageCenter.retry') }}</button><button v-if="accountRequired" @click="connectAccount">{{ $t('messageCenter.login') }}</button></div>
    <p v-if="unavailableSources.length" class="center-hint source-warning" role="status">{{ $t('messageCenter.sourcesUnavailable') }}</p>
    <div class="center-body" :class="{ 'has-selection': !!(selectedConversation || selectedNotice) }">
      <aside class="center-list" :aria-label="$t('messageCenter.title')">
        <div class="center-tabs" role="tablist" :aria-label="$t('messageCenter.title')">
          <button v-for="tab in categories" :key="tab.key" role="tab" :aria-selected="category === tab.key" @click="changeCategory(tab.key)">{{ $t('messageCenter.' + tab.key) }}<span v-if="tab.count" class="category-count">{{ tab.count > 99 ? '99+' : tab.count }}</span></button>
        </div>
        <div class="list-filters">
          <label class="project-filter"><span class="visually-hidden">{{ $t('messageCenter.projectFilter') }}</span><select v-model="projectKey" @change="changeProject"><option value="">{{ $t('messageCenter.allProjects') }}</option><option v-for="project in projects" :key="project.key" :value="project.key">{{ project.name }}</option></select></label>
          <div class="search-field"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input v-model="search" class="center-search" type="search" :placeholder="$t('messageCenter.search')" :aria-label="$t('messageCenter.search')" /></div>
        </div>
        <div v-if="category === 'conversations'" class="list-actions"><button v-if="currentProjectId" :disabled="creating" @click="openProjectGroup">{{ $t('messageCenter.projectGroup') }}</button><button @click="form = 'create'">{{ $t('messageCenter.newChat') }}</button><button @click="form = 'join'">{{ $t('messageCenter.joinChat') }}</button></div>
        <form v-if="form" class="create-form" @submit.prevent="createConversation"><select v-if="form === 'create'" v-model="formType" :aria-label="$t('messageCenter.chatType')"><option value="DIRECT">{{ $t('messageCenter.direct') }}</option><option value="GROUP">{{ $t('messageCenter.group') }}</option></select><input v-model="formValue" :aria-label="$t(form === 'create' ? 'messageCenter.titleLabel' : 'messageCenter.inviteLabel')" :placeholder="$t(form === 'create' ? 'messageCenter.titleLabel' : 'messageCenter.inviteLabel')" maxlength="120" required /><button :disabled="creating">{{ $t(form === 'create' ? 'messageCenter.create' : 'messageCenter.join') }}</button><button type="button" @click="form = ''">{{ $t('messageCenter.cancel') }}</button></form>
        <p v-if="loading && !items.length" class="list-loading" role="status">{{ $t('messageCenter.loading') }}</p>
        <div class="list-scroll">
          <template v-if="category === 'conversations'">
            <div v-if="availableAgents.length" class="scope-agents"><small>{{ $t('messageCenter.assistants') }}</small><button v-for="agent in availableAgents" :key="agent.scopeKey" :disabled="creating" @click="openAgent(agent)"><span>{{ agent.title || agent.name }}</span><small>{{ $t('messageCenter.' + agent.scope) }}</small></button></div>
            <p v-if="projectReason" class="center-hint">{{ projectReason }}</p>
          </template>
          <button v-for="item in items" :key="itemKey(item)" class="inbox-row" :class="{ selected: selection === itemKey(item), unread: category === 'conversations' ? item.unreadCount > 0 : !isNoticeRead(item) }" :aria-current="selection === itemKey(item) ? 'true' : undefined" @click="selectItem(item)">
            <span class="row-icon" :class="{ 'is-pending': item.actionState === 'pending' }" aria-hidden="true"><svg viewBox="0 0 24 24"><path v-if="category === 'conversations'" d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3V11.5a9 9 0 1 1 18 0Z" /><path v-else-if="item.actionState === 'pending'" d="M8 4H5v17h14V4h-3M8 2h8v5H8zM8 14l3 3 5-6" /><path v-else d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h6" /></svg></span>
            <span class="row-content">
              <span class="row-title"><span class="row-title-text">{{ item.title }}<template v-if="item.historicalDiscussion"> · {{ $t('messageCenter.historicalDiscussion') }}</template></span><span v-if="category === 'conversations' && item.unreadCount" class="unread-count">{{ item.unreadCount > 99 ? '99+' : item.unreadCount }}</span><span v-else-if="category !== 'conversations' && !isNoticeRead(item)" class="unread-dot" :aria-label="$t('messageCenter.unread')"></span></span>
              <span v-if="category === 'conversations' ? item.lastMessage : item.body" class="row-preview">{{ category === 'conversations' ? (item.lastMessage?.text || item.lastMessage || '') : item.body }}</span>
              <span class="row-meta"><span>{{ item.projectName || item.sourceName || (item.agent ? $t('messageCenter.' + item.agent.scope) : '') }}</span><span v-if="item.actionState === 'pending'" class="row-pending">{{ $t('messageCenter.statusPending') }}</span></span>
            </span>
          </button>
          <div v-if="!loading && !error && !items.length" class="center-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 14h5l2 3h2l2-3h5" /></svg><p>{{ $t(search.trim() ? 'messageCenter.emptySearch' : category === 'pending' ? 'messageCenter.emptyPending' : 'messageCenter.empty') }}</p><button v-if="search.trim()" @click="search = ''">{{ $t('messageCenter.clearSearch') }}</button></div>
        </div>
        <p v-if="hasMore" class="center-hint recent-only">{{ $t('messageCenter.recentOnly') }}</p>
      </aside>
      <div class="center-detail">
        <MessageConversationPane v-if="selectedConversation && current" :conversation="selectedConversation" :messages="current.messages" :pending-messages="current.pending" :draft="current.draft" :self-id="selectedConversation.sourceId === 'dd-client' ? current.selfId : selfId" :loading="current.loading" :has-more="current.hasMore" :error="current.error" :agent-status="current.status" :agent-busy="isAgentBusy(current)" :failures="Object.values(current.failures)" :can-reply="!!lastOwnMessage(current)" @back="selection = ''" @draft="current.draft = $event" @send="sendMessage" @retry-send="sendMessage($event)" @older="loadMessages(selectedConversation, true)" @reply="requestReply(selectedConversation, lastOwnMessage(current)?.id)" @retry-reply="requestReply(selectedConversation, $event)" @private="openPrivate" @invite="createInvite" @download="downloadAttachment" />
        <article v-else-if="selectedNotice" class="notice-detail">
          <button class="notice-back" @click="selection = ''">{{ $t('messageCenter.back') }}</button>
          <div class="notice-paper">
            <header class="notice-heading">
              <div class="notice-source"><span>{{ $t('messageCenter.source', { name: selectedNotice.sourceName || selectedNotice.sourceId }) }}</span><span v-if="selectedNotice.actionState && selectedNotice.actionState !== 'none'" class="notice-state" :class="{ 'is-pending': selectedNotice.actionState === 'pending' }">{{ $t('messageCenter.' + ({pending:'statusPending',done:'statusDone',cancelled:'statusCancelled'}[selectedNotice.actionState] || 'notifications')) }}</span></div>
              <h3>{{ selectedNotice.title }}</h3>
              <div class="notice-meta"><time>{{ displayDate(selectedNotice.createdAt) }}</time><span v-if="selectedNotice.projectName">{{ selectedNotice.projectName }}</span></div>
            </header>
            <p v-if="selectedNotice.body" class="notice-body">{{ selectedNotice.body }}</p>
            <p v-if="noticeError" class="center-error" role="alert">{{ noticeError }}</p>
            <footer v-if="selectedNotice.actionState === 'pending' || !isNoticeRead(selectedNotice) || selectedNotice.target?.kind" class="notice-footer">
              <p v-if="selectedNotice.actionState === 'pending'" class="center-hint">{{ $t('messageCenter.readNotDone') }}</p>
              <div class="notice-actions"><button v-if="!isNoticeRead(selectedNotice)" @click="markNoticeRead(selectedNotice)">{{ $t('messageCenter.markRead') }}</button><button v-if="selectedNotice.target?.kind" class="primary" :disabled="opening" @click="openNotice"><span>{{ $t(opening ? 'messageCenter.opening' : selectedNotice.actionState === 'pending' ? 'messageCenter.goHandle' : 'messageCenter.openBusiness') }}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></button></div>
            </footer>
          </div>
        </article>
        <div v-else class="center-placeholder"><div class="placeholder-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM4 6l8 6 8-6" /></svg></div><h3>{{ $t('messageCenter.choose') }}</h3><p>{{ $t('messageCenter.chooseHint') }}</p></div>
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
.message-center { container: message-center / inline-size; display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--awd-surface); color: var(--awd-text); font-size: var(--awd-font-size-body, 13px); }
.message-center svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.center-heading { display: flex; align-items: center; justify-content: space-between; padding: var(--awd-space-6, 24px); border-bottom: 1px solid var(--awd-border-subtle); gap: var(--awd-space-4, 16px); }
.center-heading-copy { min-width: 0; }
.center-heading h2 { font-size: 20px; line-height: 1.4; margin: 0; font-weight: 600; letter-spacing: .02em; }
.center-heading p { color: var(--awd-text-2); margin: 5px 0 0; font-size: 12px; line-height: 1.6; }
.refresh-button { display: flex; align-items: center; gap: 6px; flex: none; }
.refresh-button svg { width: 15px; height: 15px; }
.spinning { animation: refresh-spin 1s linear infinite; }
@keyframes refresh-spin { to { transform: rotate(360deg); } }
.center-body { display: grid; grid-template-columns: clamp(270px, 32%, 340px) minmax(0, 1fr); min-height: 0; flex: 1; }
.center-list { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--awd-border-subtle); }
.center-tabs { display: flex; gap: 4px; padding: var(--awd-space-4, 16px) var(--awd-space-3, 12px) 0; }
.center-tabs button { display: flex; align-items: center; justify-content: center; flex: 1; gap: 5px; padding: 7px 4px; background: transparent; border-color: transparent; white-space: nowrap; }
.center-tabs button[aria-selected=true] { background: var(--awd-accent-wash); color: var(--awd-accent-text); font-weight: 600; }
.category-count { font-size: 10px; line-height: 16px; min-width: 16px; border-radius: 8px; background: var(--awd-surface-2); padding: 0 3px; font-variant-numeric: tabular-nums; }
[aria-selected=true] .category-count { background: var(--awd-surface); }
.list-filters { padding: var(--awd-space-4, 16px); display: flex; flex-direction: column; gap: 10px; }
.project-filter select { width: 100%; border-color: var(--awd-border-subtle); background: var(--awd-bg); }
.search-field { position: relative; display: flex; align-items: center; }
.search-field svg { position: absolute; left: 10px; width: 15px; height: 15px; color: var(--awd-text-3); pointer-events: none; }
.center-search { padding-left: 32px; width: 100%; border-color: var(--awd-border-subtle); }
.list-actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 var(--awd-space-4, 16px) var(--awd-space-3, 12px); }
.list-actions button { font-size: 11px; padding: 4px 7px; min-height: 28px; }
.list-scroll { min-height: 0; overflow: auto; flex: 1; padding: 0 var(--awd-space-2, 8px) var(--awd-space-2, 8px); }
.scope-agents { display: flex; flex-direction: column; gap: 4px; padding: 4px 4px 12px; border-bottom: 1px solid var(--awd-border-subtle); margin-bottom: 8px; }
.scope-agents > small { padding: 2px 8px; color: var(--awd-text-3); font-size: 11px; }
.scope-agents button { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-color: transparent; background: transparent; text-align: left; }
.scope-agents button span { overflow-wrap: anywhere; min-width: 0; }
.scope-agents button small { color: var(--awd-text-2); flex: none; font-size: 11px; }
.inbox-row { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 14px 10px; text-align: left; border: 1px solid transparent; background: transparent; margin: 0 0 4px; }
.inbox-row:hover, .scope-agents button:hover { background: var(--awd-bg); }
.inbox-row.selected { background: var(--awd-accent-wash); border-color: var(--awd-border); }
.row-icon { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: var(--awd-radius-dialog, 8px); background: var(--awd-bg); color: var(--awd-text-2); }
.row-icon.is-pending { color: var(--awd-accent-text); background: var(--awd-accent-wash); }
.selected .row-icon { background: var(--awd-surface); }
.row-content { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 6px; }
.row-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; line-height: 1.55; }
.row-title-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.inbox-row.unread .row-title { font-weight: 600; }
.row-preview { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--awd-text-2); font-size: 12px; line-height: 1.5; }
.row-meta { display: flex; align-items: center; gap: 6px; color: var(--awd-text-3); font-size: 11px; line-height: 1.5; }
.row-meta > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.row-pending { color: var(--awd-accent-text); flex: none; margin-left: auto; }
.unread-count { font-size: 10px; min-width: 17px; text-align: center; border-radius: 10px; padding: 0 4px; background: var(--awd-accent); color: var(--awd-text-on-accent); flex: none; }
.unread-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--awd-accent); flex: none; }
.center-detail { position: relative; min-width: 0; min-height: 0; background: var(--awd-bg); }
.center-placeholder { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 28px; box-sizing: border-box; text-align: center; color: var(--awd-text-2); }
.placeholder-icon { display: grid; place-items: center; width: 60px; height: 60px; background: var(--awd-surface); border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-lg, 10px); margin-bottom: 20px; color: var(--awd-accent-text); }
.placeholder-icon svg { width: 28px; height: 28px; }
.center-placeholder h3 { font-size: 16px; font-weight: 500; margin: 0; color: var(--awd-text); }
.center-placeholder p { font-size: 12px; max-width: 260px; line-height: 1.8; margin: 10px 0 0; }
.center-empty { padding: 32px 12px; text-align: center; color: var(--awd-text-2); font-size: 12px; line-height: 1.7; }
.center-empty svg { width: 28px; height: 28px; color: var(--awd-text-3); }
.center-hint { font-size: 11px; color: var(--awd-text-2); line-height: 1.8; overflow-wrap: anywhere; }
.source-warning { padding: 10px 24px; margin: 0; background: var(--awd-warning-soft); color: var(--awd-warning-text); }
.recent-only { border-top: 1px solid var(--awd-border-subtle); margin: 0; padding: 10px 16px; }
.center-error { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--awd-danger-text, var(--awd-danger)); padding: 12px 16px; overflow-wrap: anywhere; margin: 0; }
.center-error > span { flex: 1; min-width: 120px; }
.create-form { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 12px; }
.create-form input { width: 100%; }
.list-loading { padding: 0 16px; color: var(--awd-text-2); font-size: 12px; }
.notice-detail { padding: var(--awd-space-7, 28px); overflow: auto; box-sizing: border-box; height: 100%; }
.notice-paper { max-width: 720px; margin: 0 auto; padding: var(--awd-space-8, 32px); border: 1px solid var(--awd-border-subtle); border-radius: var(--awd-radius-lg, 10px); background: var(--awd-surface); }
.notice-source { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; color: var(--awd-text-2); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.notice-detail h3 { font-size: 22px; font-weight: 600; line-height: 1.5; margin: 18px 0 12px; overflow-wrap: anywhere; }
.notice-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 11px; color: var(--awd-text-3); line-height: 1.7; overflow-wrap: anywhere; }
.notice-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9; font-size: 14px; margin: 24px 0; }
.notice-state { font-size: 11px; padding: 3px 9px; border-radius: var(--awd-radius-sm, 4px); background: var(--awd-bg); }
.notice-state.is-pending { color: var(--awd-accent-text); background: var(--awd-accent-wash); }
.notice-footer { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--awd-border-subtle); }
.notice-footer .center-hint { margin: 0 0 16px; }
.notice-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.notice-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 14px; }
.notice-actions svg { width: 15px; height: 15px; }
.notice-back { display: none; }
.invite-result { position: absolute; bottom: 0; left: 0; right: 0; padding: 12px; background: var(--awd-surface); border: 1px solid var(--awd-border); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.invite-result code { user-select: all; overflow-wrap: anywhere; }
button, input, select { font: inherit; color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-md, 6px); padding: 7px 10px; box-sizing: border-box; min-height: 32px; min-width: 0; max-width: 100%; line-height: 1.5; }
button { cursor: pointer; margin: 0; }
button::after { border: 0; }
button:hover { background: var(--awd-surface-2); }
button.primary { background: var(--awd-accent); border-color: var(--awd-accent); color: var(--awd-text-on-accent); }
button.primary:hover { background: var(--awd-accent-hover, var(--awd-accent)); }
button:disabled { cursor: default; opacity: .5; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--awd-accent); outline-offset: 2px; }
input::placeholder { color: var(--awd-text-3); }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@container message-center (max-width: 620px) {
  .center-body { grid-template-columns: minmax(0, 1fr); }
  .center-list { border-right: 0; }
  .center-body:not(.has-selection) .center-detail { display: none; }
  .center-body.has-selection .center-list { display: none; }
  .notice-back { display: block; margin-bottom: 16px; }
  .notice-detail { padding: 16px; }
  .notice-paper { padding: 20px; }
  .notice-detail h3 { font-size: 18px; }
  .center-heading { padding: 16px; }
  .center-heading h2 { font-size: 18px; }
}
@container message-center (max-width: 300px) {
  .center-heading { gap: 8px; padding: 12px; }
  .center-heading p { display: none; }
  .refresh-button { padding: 6px; }
  .refresh-button svg { display: none; }
  .center-tabs { gap: 0; padding-inline: 8px; }
  .center-tabs button { font-size: 12px; gap: 3px; }
  .list-filters { padding: 12px; }
  .notice-detail { padding: 10px; }
  .notice-paper { padding: 14px; }
  .row-icon { display: none; }
}
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
