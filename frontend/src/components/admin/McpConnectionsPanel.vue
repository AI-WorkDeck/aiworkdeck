<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="mcp-panel" :aria-label="$t('mcp.title')">
    <h2>{{ $t('mcp.title') }}</h2>
    <p>{{ $t('mcp.description') }}</p>
    <p class="mcp-note">{{ $t('mcp.billing') }}</p>
    <p class="mcp-note">{{ $t('mcp.transport') }}</p>
    <div class="mcp-actions">
      <button :disabled="!!busy || !scopeToken" @click="edit(null)">{{ $t('mcp.add') }}</button>
      <button :disabled="!!busy" @click="load">{{ $t('mcp.refresh') }}</button>
    </div>
    <p v-if="busy" role="status">{{ $t(busy === 'test' ? 'mcp.testing' : 'common.loading') }}</p>
    <p v-if="error" role="alert" class="mcp-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <form v-if="draft" class="mcp-editor" @submit.prevent="save">
      <label>{{ $t('mcp.name') }}<input v-model="draft.name" required maxlength="100" autocomplete="off" /></label>
      <label>{{ $t('mcp.url') }}<input v-model="draft.url" required type="url" :disabled="!!draft.presetId" placeholder="https://" autocomplete="off" dir="ltr" /></label>
      <label>{{ $t('mcp.token') }}<input v-model="draft.token" type="password" autocomplete="new-password" :placeholder="$t('mcp.tokenHint')" /></label>
      <p class="mcp-note">{{ $t('mcp.dataNotice') }}</p>
      <div class="mcp-actions">
        <button type="submit" :disabled="!!busy || !draft.name.trim() || !draft.url.trim()">{{ $t('common.save') }}</button>
        <button type="button" :disabled="!!busy" @click="draft = null">{{ $t('common.cancel') }}</button>
      </div>
    </form>
    <article v-for="connection in connections" :key="connection.id" class="mcp-card">
      <div class="mcp-heading"><h3>{{ connection.name }}</h3><span>{{ $t('mcp.' + connection.source) }}</span></div>
      <p v-if="isSaved(connection)">{{ $t(connection.tested ? 'mcp.tested' : 'mcp.notTested') }}</p>
      <p class="mcp-url" dir="ltr">{{ connection.url }}</p>
      <div class="mcp-actions">
        <button :disabled="!!busy" @click="edit(connection)">{{ $t('mcp.configure') }}</button>
        <button v-if="isSaved(connection)" :disabled="!!busy" @click="run('test', connection)">{{ $t('mcp.test') }}</button>
        <button v-if="isSaved(connection) && !connection.enabled" :disabled="!!busy || !connection.tested" @click="enable(connection, true)">{{ $t('mcp.enable') }}</button>
        <button v-if="connection.enabled" :disabled="!!busy" @click="enable(connection, false)">{{ $t(supportsOfficial(connection) ? 'mcp.useOfficial' : 'mcp.disable') }}</button>
        <button v-if="isSaved(connection) || !connection.presetId" :disabled="!!busy" @click="remove(connection)">{{ $t('common.delete') }}</button>
        <button v-if="documentation(connection)" :disabled="!!busy" @click="openDocs(connection)">{{ $t('mcp.docs') }}</button>
      </div>
      <details v-if="connection.tools?.length"><summary>{{ $t('mcp.tools', { count: connection.tools.length }) }}</summary>
        <ul><li v-for="tool in connection.tools" :key="tool.name"><code>{{ tool.name }}</code><p>{{ tool.description }}</p></li></ul>
      </details>
    </article>
  </section>
</template>
<script>
import { getApiBaseUrl, getCloudAccountGeneration, getMcpConnections, saveMcpConnection, testMcpConnection, setMcpConnectionEnabled, deleteMcpConnection } from '@/services/api.js'
import { getCurrentUser } from '@/utils/auth.js'
import { openExternalUrl } from '@/utils/externalLink.js'
export default {
  name: 'McpConnectionsPanel',
  data: () => ({ connections: [], presets: [], draft: null, scopeToken: '', busy: '', error: '', notice: '' }),
  mounted() {
    this._alive = true; this._owner = this.identity(); this.load()
    this._identityTimer = setInterval(() => this.checkIdentity(), 1000)
  },
  beforeUnmount() { this._alive = false; this.draft = null; clearInterval(this._identityTimer) },
  methods: {
    identity() { return JSON.stringify([getApiBaseUrl(), getCurrentUser()?.id, getCloudAccountGeneration()]) },
    current(owner) { return this._alive && this._owner === owner && this.identity() === owner },
    isSaved(connection) { return connection.saved === true || Number(connection.revision) > 0 || connection.configured },
    checkIdentity() {
      if (!this._alive) return false
      if (this.identity() === this._owner) return true
      this._owner = this.identity(); this.scopeToken = ''; this.draft = null; this.connections = []; this.presets = []; this.notice = ''; this.error = ''
      this.load(); return false
    },
    async load() {
      const owner = this._owner
      this.busy = 'load'; this.error = ''
      try { const res = await getMcpConnections(); if (!this.current(owner)) return; this.scopeToken = res.scopeToken || ''; this.connections = res.connections || []; this.presets = res.presets || [] }
      catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) this.busy = '' }
    },
    edit(connection) {
      if (!this.checkIdentity()) return
      this.notice = ''; this.error = ''
      this.draft = connection ? { id: connection.id, presetId: connection.presetId, name: connection.name, url: connection.url, token: '' } : { name: '', url: '', token: '' }
    },
    async save() {
      if (!this.checkIdentity() || !this.draft || !this.scopeToken) return
      const owner = this._owner
      this.busy = 'save'; this.error = ''; this.notice = ''
      try {
        const { id, name, url, token } = this.draft
        await saveMcpConnection(id, { name: name.trim(), url: url.trim(), transport: 'streamable-http', ...(token.trim() ? { token: token.trim() } : {}) }, this.scopeToken)
        if (!this.current(owner)) return
        this.draft = null
        await this.load()
        if (!this.current(owner)) return
        this.notice = this.$t('mcp.saved')
        uni.$emit('awd:mcp-changed')
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) this.busy = '' }
    },
    supportsOfficial(connection) { return this.presets.find(p => p.id === connection.presetId)?.supportsOfficial === true },
    documentation(connection) { return this.presets.find(p => p.id === connection.presetId)?.documentationUrl || '' },
    openDocs(connection) { openExternalUrl(this.documentation(connection)) },
    confirm(message) {
      return new Promise(resolve => uni.showModal({ title: this.$t('mcp.title'), content: message, confirmText: this.$t('common.confirm'), cancelText: this.$t('common.cancel'), success: res => resolve(!!res.confirm), fail: () => resolve(false) }))
    },
    async enable(connection, enabled) {
      if (!this.checkIdentity()) return
      const owner = this._owner
      const message = this.$t(enabled ? 'mcp.enableNotice' : this.supportsOfficial(connection) ? 'mcp.officialNotice' : 'mcp.disableNotice')
      if (await this.confirm(message) && this.current(owner)) await this.run(enabled ? 'enable' : 'disable', connection)
    },
    async remove(connection) {
      if (!this.checkIdentity()) return
      const owner = this._owner
      const message = this.$t(this.supportsOfficial(connection) ? 'mcp.officialNotice' : 'mcp.deleteNotice')
      if (await this.confirm(message) && this.current(owner)) await this.run('delete', connection)
    },
    async run(action, connection) {
      if (!this.checkIdentity()) return
      const owner = this._owner
      this.busy = action; this.error = ''; this.notice = ''
      try {
        if (action === 'test') await testMcpConnection(connection.id, this.scopeToken)
        else if (action === 'delete') await deleteMcpConnection(connection.id, this.scopeToken)
        else await setMcpConnectionEnabled(connection.id, action === 'enable', this.scopeToken)
        if (!this.current(owner)) return
        await this.load()
        if (!this.current(owner)) return
        this.notice = this.$t(action === 'test' ? 'mcp.tested' : 'common.saved')
        uni.$emit('awd:mcp-changed')
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) this.busy = '' }
    },
  },
}
</script>
<style scoped>
.mcp-panel { padding: 24px; color: var(--awd-text); font-size: 14px; line-height: 1.6; }
.mcp-panel h2 { font-size: 22px; margin: 0 0 12px; }
.mcp-panel h3 { font-size: 16px; margin: 0; }
.mcp-note, .mcp-url { color: var(--awd-text-2); font-size: 13px; overflow-wrap: anywhere; }
.mcp-card, .mcp-editor { padding: 16px; margin-block: 16px; border: 1px solid var(--awd-border); border-radius: 8px; background: var(--awd-surface); }
.mcp-heading, .mcp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mcp-heading { justify-content: space-between; }
.mcp-actions button { margin: 0; padding: 6px 12px; font-size: 13px; line-height: 1.5; color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: 6px; cursor: pointer; }
.mcp-actions button:disabled { opacity: .5; cursor: default; }
.mcp-editor label { display: flex; flex-direction: column; gap: 4px; margin-block: 12px; }
.mcp-editor input { box-sizing: border-box; width: 100%; min-height: 36px; padding: 8px; border: 1px solid var(--awd-border); border-radius: 4px; background: var(--awd-surface); color: var(--awd-text); }
.mcp-error { color: var(--awd-danger); }
.mcp-card summary { cursor: pointer; margin-block-start: 12px; }
.mcp-card code { direction: ltr; unicode-bidi: isolate; overflow-wrap: anywhere; }
.mcp-card li p { color: var(--awd-text-2); }
</style>
