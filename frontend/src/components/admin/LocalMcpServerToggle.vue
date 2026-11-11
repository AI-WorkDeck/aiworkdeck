<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section v-if="available" class="local-mcp" :aria-label="$t('mcp.localTitle')">
    <div class="local-mcp-heading">
      <h3>{{ $t('mcp.localTitle') }}</h3>
      <span class="local-mcp-state" role="status">{{ $t(enabled ? 'mcp.localOn' : 'mcp.localOff') }}</span>
    </div>
    <p class="local-mcp-note">{{ $t('mcp.localDesc') }}</p>
    <p v-if="error" role="alert" class="local-mcp-error">{{ error }}</p>
    <div class="local-mcp-actions">
      <button type="button" :disabled="busy" @click="enable">{{ $t(enabled ? 'mcp.localRotate' : 'mcp.localEnable') }}</button>
      <button v-if="enabled" type="button" :disabled="busy" @click="disable">{{ $t('mcp.localDisable') }}</button>
    </div>
    <template v-if="issued">
      <p class="local-mcp-warn" role="alert">{{ $t('mcp.localWarn') }}</p>
      <div v-for="item in snippets" :key="item.key" class="local-mcp-snippet">
        <div class="local-mcp-heading">
          <strong>{{ $t(item.label) }}</strong>
          <button type="button" :data-copy="item.key" @click="copy(item.text)">{{ $t('mcp.localCopy') }}</button>
        </div>
        <pre :data-snippet="item.key" dir="ltr">{{ item.text }}</pre>
      </div>
    </template>
  </section>
</template>
<script>
import { getLocalMcpServerStatus, enableLocalMcpServer, disableLocalMcpServer } from '@/services/api.js'
import { copyToClipboard } from '@/utils/chatClipboard.js'
export default {
  name: 'LocalMcpServerToggle',
  data: () => ({ available: false, enabled: false, busy: false, error: '', issued: null }),
  computed: {
    snippets() {
      const i = this.issued
      if (!i) return []
      return [
        { key: 'claude', label: 'mcp.localClaude', text: i.claudeCodeCommand },
        { key: 'codex', label: 'mcp.localCodex', text: `[mcp_servers.aiworkdeck]\nurl = ${JSON.stringify(i.endpoint)}\nhttp_headers = { Authorization = ${JSON.stringify('Bearer ' + i.token)} }` }
      ]
    }
  },
  mounted() { this._alive = true; this.load() },
  beforeUnmount() { this._alive = false; this.issued = null },
  methods: {
    async load() {
      try {
        const res = await getLocalMcpServerStatus()
        if (!this._alive) return
        this.available = res?.code === 0; this.enabled = res?.enabled === true
      } catch (e) { if (this._alive) this.available = false } // 非单机模式 404：整块隐藏
    },
    async run(action) {
      this.busy = true; this.error = ''
      try { return await action() }
      catch (e) { if (this._alive) this.error = e.message || this.$t('common.failed') }
      finally { if (this._alive) this.busy = false }
    },
    async enable() {
      const res = await this.run(enableLocalMcpServer)
      if (res && this._alive) { this.enabled = true; this.issued = { endpoint: res.endpoint, token: res.token, claudeCodeCommand: res.claudeCodeCommand } }
    },
    async disable() {
      const res = await this.run(disableLocalMcpServer)
      if (res && this._alive) { this.enabled = false; this.issued = null }
    },
    copy(text) { copyToClipboard(text) }
  }
}
</script>
<style scoped>
.local-mcp { padding: 12px 14px; margin-block: 0 12px; border: 1px solid var(--awd-border); border-radius: 8px; background: var(--awd-surface); min-width: 0; }
.local-mcp-heading, .local-mcp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.local-mcp-heading { justify-content: space-between; }
.local-mcp h3 { font-size: 14px; font-weight: 600; margin: 0; }
.local-mcp p { margin: 4px 0 0; }
.local-mcp-actions { margin-block-start: 8px; }
.local-mcp-state { font-size: 12px; color: var(--awd-text-2); }
.local-mcp-note { color: var(--awd-text-2); font-size: 12px; overflow-wrap: anywhere; }
.local-mcp-warn { color: var(--awd-danger); font-size: 13px; overflow-wrap: anywhere; }
.local-mcp-error { color: var(--awd-danger); overflow-wrap: anywhere; }
.local-mcp-snippet { margin-block: 12px; min-width: 0; }
.local-mcp pre { margin: 6px 0 0; padding: 8px; border: 1px solid var(--awd-border); border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere; unicode-bidi: isolate; text-align: start; font-size: 12px; }
.local-mcp button { margin: 0; padding: 4px 12px; font-size: 12px; line-height: 1.5; color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: 6px; cursor: pointer; }
.local-mcp button:disabled { opacity: .5; cursor: default; }
.local-mcp button:focus-visible { outline: var(--awd-focus-width, 2px) solid var(--awd-accent-text); outline-offset: var(--awd-focus-offset, 2px); }
</style>
