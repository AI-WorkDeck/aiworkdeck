<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="message-conversation" :aria-label="conversation.title">
    <header class="conversation-heading">
      <button class="message-back" @click="$emit('back')">{{ $t('messageCenter.back') }}</button>
      <div class="conversation-name"><strong>{{ conversation.title }}<template v-if="conversation.historicalDiscussion"> · {{ $t('messageCenter.historicalDiscussion') }}</template></strong><small>{{ visibilityLabel }}</small></div>
      <button v-if="canRequestAssistant && !isPrivate" @click="$emit('private')">{{ $t('messageCenter.talkPrivately') }}</button>
      <button v-if="conversation.role === 'OWNER' && !isPrivate && (!conversation.agent || conversation.agent.scope === 'project')" @click="$emit('invite')">{{ $t(conversation.projectId ? 'messageCenter.inviteClient' : 'messageCenter.inviteLabel') }}</button>
    </header>
    <p v-if="error" class="message-error" role="alert">{{ error }}</p>
    <div ref="scroll" class="message-history">
      <button v-if="hasMore" :disabled="loading" @click="$emit('older')">{{ $t('messageCenter.older') }}</button>
      <p v-if="loading && !messages.length" role="status">{{ $t('messageCenter.loading') }}</p>
      <p v-else-if="!messages.length && !pendingMessages.length" class="message-empty">{{ $t('messageCenter.noMessages') }}</p>
      <div role="log" aria-live="polite" :aria-label="$t('messageCenter.conversations')">
        <article v-for="message in messages" :key="message.id" class="message-row" :class="{ mine: message.actorType !== 'AGENT' && String(message.senderId) === String(selfId) }">
          <small>{{ message.senderName }}<template v-if="message.actorType === 'AGENT'"> · {{ $t('messageCenter.ai') }}</template></small>
          <div class="message-bubble"><p v-if="message.text">{{ message.text }}</p>
            <div v-if="message.attachment" class="message-attachment">
              <template v-if="message.attachment.available !== false">
                <span>{{ message.attachment.name || $t('messageCenter.attachment') }}</span>
                <button @click="$emit('download', message.attachment)">{{ $t('messageCenter.download') }}</button>
              </template>
              <span v-else>{{ $t('messageCenter.attachmentUnavailable') }}</span>
            </div>
          </div>
        </article>
        <article v-for="pending in pendingMessages" :key="pending.clientMessageId" class="message-row mine">
          <div class="message-bubble"><p>{{ pending.text }}</p></div>
          <small>{{ $t(pending.sending ? 'messageCenter.sending' : 'messageCenter.sendFailed') }}</small>
          <button v-if="!pending.sending" @click="$emit('retry-send', pending)">{{ $t('messageCenter.retrySend') }}</button>
        </article>
      </div>
    </div>
    <div class="message-compose-area">
    <div v-if="conversation.agent" class="message-cloud-info">
      <p v-if="!canRequestAssistant">{{ $t('messageCenter.cloudClient') }}</p>
      <p v-else>{{ $t(isPrivate ? (conversation.agent.scope === 'project' ? 'messageCenter.cloudPrivate' : 'messageCenter.cloudScope') : 'messageCenter.cloudGroup') }}</p>
      <details><summary>{{ $t('messageCenter.contextDetails') }}</summary><p>{{ $t(isPrivate ? (conversation.agent.scope === 'project' ? 'messageCenter.contextPrivate' : 'messageCenter.contextScope') : 'messageCenter.contextShared') }}</p></details>
    </div>
    <div v-if="agentBusy || (canRequestAssistant && failures.length)" class="message-agent-status" role="status">
      <p v-if="agentBusy">{{ $t(agentStatus?.status === 'running' ? 'messageCenter.running' : 'messageCenter.waiting') }}</p>
      <div v-for="failed in (canRequestAssistant ? failures : [])" :key="failed.messageId" class="message-retry"><span>{{ failed.text || $t('messageCenter.message') }}：{{ failed.error || $t('messageCenter.replyFailed') }}</span><button :disabled="agentBusy" @click="$emit('retry-reply', failed.messageId)">{{ $t('messageCenter.retryReply') }}</button></div>
    </div>
    <form class="message-composer" @submit.prevent="$emit('send')">
      <textarea :value="draft" maxlength="8000" rows="3" :aria-label="$t('messageCenter.composer')" :placeholder="$t('messageCenter.composer')" @input="$emit('draft', $event.target.value)" @keydown="onKeydown"></textarea>
      <div class="message-send-row"><button v-if="canRequestAssistant" type="button" :disabled="agentBusy || !canReply" @click="$emit('reply')">{{ $t('messageCenter.askAssistant') }}</button><small>{{ $t('messageCenter.enterHint') }}</small><button type="submit" class="primary" :disabled="!draft.trim()">{{ $t('messageCenter.send') }}</button></div>
    </form>
    </div>
  </section>
</template>
<script>
export default {
  props: {
    conversation: { type: Object, required: true }, messages: { type: Array, default: () => [] }, pendingMessages: { type: Array, default: () => [] },
    draft: { type: String, default: '' }, selfId: { type: [String, Number], default: '' }, error: { type: String, default: '' },
    loading: Boolean, hasMore: Boolean, agentBusy: Boolean, canReply: Boolean,
    agentStatus: { type: Object, default: null }, failures: { type: Array, default: () => [] },
  },
  emits: ['back', 'private', 'invite', 'older', 'download', 'draft', 'send', 'retry-send', 'retry-reply', 'reply'],
  computed: {
    canRequestAssistant() { return !!this.conversation.agent && this.conversation.canRequestAgent !== false && this.conversation.sourceId !== 'dd-client' },
    isPrivate() { return this.conversation.type === 'AGENT_DIRECT' || this.conversation.agent?.private },
    visibilityLabel() { return this.$t(this.conversation.agent ? (this.isPrivate ? 'messageCenter.assistantPrivate' : 'messageCenter.assistantShared') : (this.conversation.type === 'DIRECT' ? 'messageCenter.direct' : 'messageCenter.group')) },
  },
  watch: {
    messages() { const scroll = this.$refs.scroll; if (!scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80) this.$nextTick(() => { if (this.$refs.scroll) this.$refs.scroll.scrollTop = this.$refs.scroll.scrollHeight }) },
    'conversation.id'() { this.$nextTick(() => { if (this.$refs.scroll) this.$refs.scroll.scrollTop = this.$refs.scroll.scrollHeight }) },
  },
  methods: {
    onKeydown(event) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); this.$emit('send') } },
  },
}
</script>
<style scoped>
.message-conversation{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}.conversation-heading{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--awd-border);flex-wrap:wrap}.conversation-name{display:flex;flex-direction:column;min-width:80px;flex:1}.conversation-name strong{overflow-wrap:anywhere}.message-history{flex:1;min-height:70px;overflow:auto;padding:16px}.message-row{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-bottom:16px}.message-row.mine{align-items:flex-end}.message-row small{color:var(--awd-text-2)}.message-bubble{max-width:90%;border:1px solid var(--awd-border);background:var(--awd-surface);border-radius:var(--awd-radius-md,6px);padding:8px 11px;overflow-wrap:anywhere;white-space:pre-wrap}.mine .message-bubble{background:var(--awd-accent-wash)}.message-bubble p{margin:0}.message-attachment{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.message-compose-area{min-width:0;margin:0 16px 16px;border:1px solid var(--awd-border);border-radius:var(--awd-radius-md,6px);background:var(--awd-surface)}.message-compose-area:focus-within{border-color:var(--awd-accent)}.message-composer{padding:10px 12px}textarea{font:inherit;color:inherit;display:block;width:100%;box-sizing:border-box;min-height:70px;resize:vertical;max-height:200px;padding:6px 0;border:0;border-radius:0;background:transparent}.message-send-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px}.message-send-row small{flex:1}.message-send-row>button:not(.primary){padding:4px;border-color:transparent;background:transparent;color:var(--awd-text-2)}.message-send-row>button:not(.primary):hover:not(:disabled){background:var(--awd-panel-hover)}.message-cloud-info{padding:10px 12px 0;font-size:11px;line-height:1.5;color:var(--awd-text-2);overflow-wrap:anywhere}.message-cloud-info p{margin:0}.message-cloud-info summary{cursor:pointer;width:fit-content}.message-agent-status{max-height:140px;overflow:auto;margin:6px 12px 0;padding:6px 8px;border-radius:var(--awd-radius-sm,4px);background:var(--awd-accent-wash);font-size:12px}.message-agent-status p{margin:0}.message-retry{display:flex;align-items:center;flex-wrap:wrap;gap:6px;overflow-wrap:anywhere}.message-error{color:var(--awd-danger-text,var(--awd-danger));padding:0 16px;font-size:12px}.message-empty{color:var(--awd-text-2)}small{font-size:11px;color:var(--awd-text-2)}button{font:inherit;color:var(--awd-text);background:var(--awd-surface);border:1px solid var(--awd-border);border-radius:var(--awd-radius-sm,4px);padding:5px 9px;min-height:30px;cursor:pointer;max-width:100%}button.primary{color:var(--awd-text-on-accent);background:var(--awd-accent);border-color:var(--awd-accent)}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--awd-accent);outline-offset:2px}textarea:focus-visible{outline:0}.message-back{display:none}@container message-center (max-width:620px){.message-back{display:block}.conversation-heading,.message-composer{padding:8px 10px}.message-compose-area{margin:0 10px 10px}.message-history{padding:10px}.message-bubble{max-width:95%}.message-cloud-info{padding:8px 10px 0}}
</style>
