// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { normalizeMessageTarget } from '../../utils/messageTargets.js'
import { messageCenterRequest, messageCenterIdentity } from '../../services/messageCenter.js'
import { getDdRequestDetails } from '../../services/api.js'
import { isGlobalPlugin } from '../../utils/pluginViews.js'
import { ACCOUNT_CHANGED_EVENT } from '../../utils/requireAccount.js'

export const messageCenterTabMethods = {
  startMessageCenterBadge() {
    this._messageBadgeStopped = false
    this._messageBadgeSeq = 0
    this._messageBadgeChanged = () => this.refreshMessageCenterBadge()
    this._messageBadgeAccount = () => {
      this._messageBadgeSeq++; this._messageBadgeBusy = false
      this.messageCenterUnread = null; this.messageCenterBadgePartial = false
      this.refreshMessageCenterBadge()
    }
    uni.$on(ACCOUNT_CHANGED_EVENT, this._messageBadgeAccount)
    uni.$on('awd:message-center-changed', this._messageBadgeChanged)
    document.addEventListener('visibilitychange', this._messageBadgeChanged)
    this._messageBadgeTimer = setInterval(this._messageBadgeChanged, 30000)
    this.refreshMessageCenterBadge()
  },
  stopMessageCenterBadge() {
    this._messageBadgeStopped = true; this._messageBadgeSeq++
    clearInterval(this._messageBadgeTimer)
    uni.$off(ACCOUNT_CHANGED_EVENT, this._messageBadgeAccount)
    uni.$off('awd:message-center-changed', this._messageBadgeChanged)
    document.removeEventListener('visibilitychange', this._messageBadgeChanged)
  },
  async refreshMessageCenterBadge() {
    if (this._messageBadgeStopped || this._messageBadgeBusy || this.isClientView || document.hidden || !this.isActiveOverviewInstance()) return
    this._messageBadgeBusy = true
    const sequence = ++this._messageBadgeSeq, identity = messageCenterIdentity()
    const current = () => !this._messageBadgeStopped && sequence === this._messageBadgeSeq && identity === messageCenterIdentity()
    try {
      const result = await messageCenterRequest('counts')
      if (!current() || !this.isActiveOverviewInstance()) return
      const count = Math.max(0, Number(result.unreadMessages) || 0) + Math.max(0, Number(result.unreadNotifications) || 0)
      this.messageCenterBadgePartial = !!result.partial
      this.messageCenterUnread = result.partial ? Math.max(this.messageCenterUnread || 0, count) : count
    } catch (_) {
      // Retain the last acknowledged count; unavailable sources are not evidence of an empty inbox.
      if (current()) this.messageCenterBadgePartial = true
    } finally { if (sequence === this._messageBadgeSeq) this._messageBadgeBusy = false }
  },
  openMessageCenterTab(options = {}) {
    for (const pane of ['left', 'right']) {
      const existing = this[pane === 'left' ? 'leftFiles' : 'rightFiles'].find(tab => tab.tabType === 'message-center')
      if (!existing) continue
      if (options.conversationId) {
        existing.messageFocus = ''
        this.$nextTick(() => { existing.messageFocus = String(options.conversationId) })
      }
      this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = existing.id
      this.focusedPane = pane
      if (pane === 'right' && !this.splitMode) this.splitMode = true
      this.$nextTick(() => this.triggerWorkbenchResize())
      return
    }
    const pane = this.splitMode && this.focusedPane === 'right' ? 'right' : 'left'
    this[pane === 'left' ? 'leftFiles' : 'rightFiles'].push({ id: 'message-center', tabType: 'message-center', name: this.$t('messageCenter.title'), messageFocus: options.conversationId || '' })
    this[pane === 'left' ? 'activeFileIdLeft' : 'activeFileIdRight'] = 'message-center'
    this.focusedPane = pane
    this.$nextTick(() => this.triggerWorkbenchResize())
  },
  async inviteMessageProject(conversation) {
    const id = String(conversation?.localProjectId || '')
    if (!/^[1-9][0-9]{0,15}$/.test(id)) throw new Error(this.$t('messageCenter.projectUnavailable'))
    if (id !== String(this.projectId || '')) return this.leaveWorkbench(`/pages/project-overview/project-overview?id=${id}&inviteMembers=1`)
    this.showInviteModal = true
    return true
  },
  async resolveMessageTarget(notificationId) {
    if (typeof notificationId !== 'string' || !notificationId || notificationId.length > 512) return
    const identity = messageCenterIdentity()
    try {
      const result = await messageCenterRequest('target', { id: notificationId })
      if (identity !== messageCenterIdentity() || !this.isActiveOverviewInstance()) return
      await this.openMessageTarget(result.target || result, notificationId)
    } catch (error) {
      if (identity === messageCenterIdentity()) uni.showToast({ title: error.message || this.$t('messageCenter.openFailed'), icon: 'none' })
    }
  },
  async openMessageTarget(value, notificationId) {
    const target = normalizeMessageTarget(value)
    if (!target || !this.isActiveOverviewInstance()) throw new Error(this.$t('messageCenter.targetUnavailable'))
    const identity = messageCenterIdentity()
    const stillCurrent = () => identity === messageCenterIdentity() && this.isActiveOverviewInstance()
    if (target.kind === 'im') { this.openMessageCenterTab({ conversationId: target.conversationId }); return true }
    // Invited-client project numbers belong to the remote connection, never the local project table.
    if (target.kind === 'dd-client') { this.openDdClientTab(target); return true }
    if (target.projectId && String(target.projectId) !== String(this.projectId || '')) {
      if (!notificationId) throw new Error(this.$t('messageCenter.targetUnavailable'))
      return this.leaveWorkbench(`/pages/project-overview/project-overview?id=${target.projectId}&messageId=${encodeURIComponent(notificationId)}`)
    }
    if (target.kind === 'dd') {
      const result = await getDdRequestDetails(target.requestId, target.projectId)
      if (!stillCurrent()) return false
      const detail = result.data || result
      const request = detail.request || detail
      if (String(request.id) !== target.requestId) throw new Error(this.$t('messageCenter.targetUnavailable'))
      this.handleOpenDdRequest({ ...request, focusItemId: target.itemId || null })
      return true
    }
    if (target.kind === 'agent') { this.openConversationInPanel(target.conversationId); return true }
    if (target.kind === 'calendar' || target.kind === 'plugin') {
      await this.loadDynamicPlugins()
      if (!stillCurrent()) return false
      const pluginId = target.kind === 'calendar' ? 'calendar' : target.pluginId
      const plugin = this.dynamicPlugins.find(p => p.pluginId === pluginId)
      if (!plugin || (!this.hasProject && !isGlobalPlugin(plugin))) throw new Error(this.$t('messageCenter.pluginUnavailable'))
      if (target.kind === 'calendar') this.openCalendarTab({ focus: target.recordId })
      else if (pluginId === 'lawfirm-management') await this.handleOpenLawFirmPlugin({ tab: target.view, recordId: target.recordId })
      else {
        this.openPluginTab(pluginId)
        this.$nextTick(() => { if (stillCurrent()) uni.$emit('awd:plugin-sidebar-command', { pluginId, command: 'message-open', view: target.view, recordId: target.recordId, projectId: this.projectId }) })
      }
      return true
    }
    throw new Error(this.$t('messageCenter.targetUnavailable'))
  },
}
