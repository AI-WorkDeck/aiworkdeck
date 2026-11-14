<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="portal-chat" :aria-label="$t('ddWorkflow.client.chat.title')">
    <header class="chat-head">
      <div>
        <h3>{{ title || $t('ddWorkflow.client.chat.title') }}</h3>
        <p class="chat-hint">{{ $t('ddWorkflow.client.chat.hint') }}</p>
      </div>
    </header>

    <p v-if="error" class="chat-error" role="alert">{{ error }}</p>

    <div ref="list" class="chat-list" role="log" aria-live="polite">
      <button v-if="hasMore && conversationId" type="button" class="text-button older" :disabled="loadingOlder" @click="loadOlder">
        {{ $t('ddWorkflow.client.chat.older') }}
      </button>
      <p v-if="loading" class="chat-empty">{{ $t('ddWorkflow.client.chat.loading') }}</p>
      <p v-else-if="!messages.length && conversationId" class="chat-empty">{{ $t('ddWorkflow.client.chat.empty') }}</p>
      <article v-for="m in messages" :key="m.id" class="chat-message" :class="{ mine: m.senderId === selfId, agent: m.actorType === 'AGENT' }">
        <div class="chat-meta">
          <strong>{{ m.senderId === selfId ? $t('ddWorkflow.client.chat.you') : m.senderName }}</strong>
          <time :datetime="m.createdAt">{{ formatTime(m.createdAt) }}</time>
        </div>
        <p v-if="m.text" class="chat-text">{{ m.text }}</p>
        <div v-if="m.attachment" class="chat-file">
          <button v-if="m.attachment.available" type="button" class="text-button" :disabled="downloading === m.attachment.id" @click="download(m.attachment)">
            {{ m.attachment.name }}
          </button>
          <span v-else class="chat-file-pending">{{ $t('ddWorkflow.client.chat.filePending') }}</span>
        </div>
      </article>
    </div>

    <form v-if="conversationId" class="chat-compose" @submit.prevent="send">
      <textarea
        v-model="draft"
        class="chat-input"
        rows="2"
        maxlength="8000"
        :placeholder="$t('ddWorkflow.client.chat.placeholder')"
        :aria-label="$t('ddWorkflow.client.chat.placeholder')"
        :disabled="sending || stopped"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <div class="chat-actions">
        <button type="button" class="secondary" :disabled="sending || stopped" @click="pickFile">{{ $t('ddWorkflow.client.chat.attach') }}</button>
        <button type="submit" class="primary" :disabled="sending || stopped || !draft.trim()">{{ sending ? $t('ddWorkflow.client.chat.sending') : $t('ddWorkflow.client.chat.send') }}</button>
      </div>
    </form>
  </section>
</template>

<script>
import { portalChat } from '@/services/ddClient.js'

const POLL_MS = 3000
const MAX_FILE_BYTES = 8 * 1024 * 1024

export default {
  name: 'ClientPortalChat',
  props: {
    connectionId: { type: String, required: true },
    projectId: { type: Number, required: true },
  },
  data: () => ({ conversationId: '', title: '', selfId: null, messages: [], hasMore: false, loading: true, loadingOlder: false,
    draft: '', sending: false, downloading: '', error: '', stopped: false, timer: null, lastReadId: 0 }),
  async mounted() {
    try {
      const [self, group] = [await portalChat(this.connectionId, 'self'), await portalChat(this.connectionId, 'projectGroup', { projectId: this.projectId })]
      this.selfId = self?.id ?? null
      this.conversationId = group.id
      this.title = group.title || ''
      const page = await portalChat(this.connectionId, 'messages', { conversationId: this.conversationId, limit: 50 })
      this.messages = page.messages || []
      this.hasMore = !!page.hasMore
      this.markRead()
      this.scrollToEnd()
      this.timer = setInterval(() => this.poll(), POLL_MS)
    } catch (e) {
      this.stop(e)
    } finally {
      this.loading = false
    }
  },
  beforeUnmount() { clearInterval(this.timer) },
  methods: {
    lastId() { return this.messages.length ? this.messages[this.messages.length - 1].id : 0 },
    // A code that expired or was revoked stops chat on the server; stop polling and say why instead of retrying forever.
    stop(e) {
      this.error = e?.message || this.$t('ddWorkflow.client.chat.unavailable')
      // Only an explicit refusal (code expired or revoked, out of scope: a 200 with an error code, or 401/403) ends chat.
      // 429 (「发送太快」), 5xx and network failures are shown and polling goes on.
      const refused = (e?.status >= 200 && e?.status < 300) || e?.status === 401 || e?.status === 403
      if (refused) { this.stopped = true; clearInterval(this.timer) }
    },
    async poll() {
      if (this.stopped || !this.conversationId) return
      try {
        const page = await portalChat(this.connectionId, 'messages', { conversationId: this.conversationId, afterId: this.lastId(), limit: 50 })
        const fresh = (page.messages || []).filter(m => !this.messages.some(x => x.id === m.id))
        if (fresh.length) { this.messages.push(...fresh); this.markRead(); this.scrollToEnd() }
        if (this.error && !this.stopped) this.error = ''
      } catch (e) { this.stop(e) }
    },
    async loadOlder() {
      if (!this.messages.length) return
      this.loadingOlder = true
      try {
        const page = await portalChat(this.connectionId, 'messages', { conversationId: this.conversationId, beforeId: this.messages[0].id, limit: 50 })
        const older = (page.messages || []).filter(m => !this.messages.some(x => x.id === m.id))
        this.messages.unshift(...older)
        this.hasMore = !!page.hasMore
      } catch (e) { this.stop(e) } finally { this.loadingOlder = false }
    },
    async markRead() {
      const id = this.lastId()
      if (!id || id <= this.lastReadId) return
      this.lastReadId = id
      try { await portalChat(this.connectionId, 'read', { conversationId: this.conversationId, lastReadId: id }) } catch { /* the next poll reports a real failure */ }
    },
    async send() {
      const text = this.draft.trim()
      if (!text || this.sending || this.stopped) return
      this.sending = true; this.error = ''
      try {
        const message = await portalChat(this.connectionId, 'send', { conversationId: this.conversationId, clientMessageId: crypto.randomUUID(), text })
        this.draft = ''
        if (message?.id && !this.messages.some(x => x.id === message.id)) this.messages.push(message)
        this.markRead(); this.scrollToEnd()
      } catch (e) { this.stop(e) } finally { this.sending = false }
    },
    pickFile() {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = () => { const file = input.files && input.files[0]; if (file) this.upload(file) }
      input.click()
    },
    async upload(file) {
      if (file.size > MAX_FILE_BYTES) { this.error = this.$t('ddWorkflow.client.chat.fileTooLarge'); return }
      this.sending = true; this.error = ''
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        const key = crypto.randomUUID()
        const uploaded = await portalChat(this.connectionId, 'upload', { conversationId: this.conversationId, name: file.name, base64, clientMessageId: key })
        const message = await portalChat(this.connectionId, 'send', { conversationId: this.conversationId, clientMessageId: key, attachmentId: uploaded.id, text: '' })
        if (message?.id && !this.messages.some(x => x.id === message.id)) this.messages.push(message)
        this.scrollToEnd()
      } catch (e) { this.stop(e) } finally { this.sending = false }
    },
    async download(attachment) {
      this.downloading = attachment.id
      try {
        const file = await portalChat(this.connectionId, 'download', { conversationId: this.conversationId, attachmentId: attachment.id })
        const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0))
        const url = URL.createObjectURL(new Blob([bytes]))
        const link = document.createElement('a')
        link.href = url; link.download = file.name || attachment.name; link.rel = 'noopener'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (e) { this.error = e?.message || this.$t('ddWorkflow.client.chat.filePending') } finally { this.downloading = '' }
    },
    scrollToEnd() { this.$nextTick(() => { const el = this.$refs.list; if (el) el.scrollTop = el.scrollHeight }) },
    formatTime(value) {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    },
  },
}
</script>

<style scoped>
.portal-chat { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 10px; padding: 16px; }
.chat-head h3 { margin: 0; font-size: 16px; }
.chat-hint { margin: 4px 0 0; color: var(--awd-text-2); font-size: 12px; }
.chat-error { margin: 0; padding: 8px 10px; border-radius: var(--awd-radius-sm); background: var(--awd-danger-soft); color: var(--awd-danger-text); font-size: 13px; }
.chat-list { flex: 1 1 auto; min-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
.chat-empty { color: var(--awd-text-2); font-size: 13px; text-align: center; }
.older { align-self: center; }
.chat-message { max-width: 80%; align-self: flex-start; padding: 8px 10px; border-radius: var(--awd-radius-md); background: var(--awd-surface-2); }
.chat-message.mine { align-self: flex-end; background: var(--awd-accent-soft); }
.chat-meta { display: flex; gap: 8px; align-items: baseline; font-size: 12px; color: var(--awd-text-2); }
.chat-meta strong { color: var(--awd-text); }
.chat-text { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
.chat-file { margin-top: 4px; font-size: 13px; }
.chat-file-pending { color: var(--awd-text-2); }
.chat-compose { display: flex; flex-direction: column; gap: 8px; }
.chat-input { width: 100%; box-sizing: border-box; resize: vertical; padding: 8px 10px; font: inherit; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); }
.chat-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.portal-chat button { margin: 0; min-height: var(--awd-control-height); padding: 6px 14px; line-height: 1.4; cursor: pointer;
  border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-surface); color: var(--awd-text); font: inherit; }
.portal-chat button:disabled { opacity: 0.45; cursor: default; }
.portal-chat button.primary { background: var(--awd-accent); color: var(--awd-text-on-accent); border-color: var(--awd-accent); font-weight: 600; }
.portal-chat button.secondary { background: var(--awd-surface); color: var(--awd-text); border-color: var(--awd-border-strong); }
.portal-chat button.text-button { min-height: 0; padding: 2px 6px; border: 0; background: transparent; color: var(--awd-accent-text); }
</style>
