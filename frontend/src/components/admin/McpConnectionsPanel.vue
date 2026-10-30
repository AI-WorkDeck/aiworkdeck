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
      <button :disabled="!!busy" @click="load()">{{ $t('mcp.refresh') }}</button>
      <button :disabled="!!busy || !scopeToken" @click="openImport">{{ $t('mcp.import') }}</button>
    </div>
    <p v-if="busy" role="status">{{ $t(busy === 'test' ? 'mcp.testing' : 'common.loading') }}</p>
    <p v-if="error" role="alert" class="mcp-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <form v-if="importOpen" class="mcp-editor mcp-import" @submit.prevent="previewImport">
      <h3>{{ $t('mcp.import') }}</h3>
      <p class="mcp-note">{{ $t('mcp.importHint') }}</p>
      <p class="mcp-note">{{ $t('mcp.commandHint') }}</p>
      <label>{{ $t('mcp.importFile') }}<input ref="importFile" type="file" accept=".json,application/json" :disabled="!!busy" @change="readImportFile" /></label>
      <label>{{ $t('mcp.importJson') }}<textarea v-model="importJson" :disabled="!!busy" rows="7" spellcheck="false" autocomplete="off" dir="ltr" @input="invalidatePreview" /></label>
      <div class="mcp-actions">
        <button type="submit" :disabled="!!busy || !importJson.trim()">{{ $t('mcp.preview') }}</button>
        <button type="button" :disabled="!!busy" @click="closeImport">{{ $t('common.cancel') }}</button>
      </div>
      <div v-if="importPreview" class="mcp-preview">
        <p class="mcp-note">{{ $t('mcp.importReview') }}</p>
        <label v-for="entry in importPreview.entries" :key="entry.index" class="mcp-import-entry">
          <input v-model="selectedIndices" type="checkbox" :value="entry.index" :disabled="!!busy" />
          <span><strong>{{ entry.name }}</strong> · {{ entry.transport }}
            <span class="mcp-url" dir="ltr">{{ entry.transport === 'stdio' ? localCommand(entry) : entry.url }}</span>
            <span v-if="entry.cwd" class="mcp-url" dir="ltr">{{ entry.cwd }}</span>
            <span v-if="entry.secretFields?.length" class="mcp-note">{{ $t('mcp.secretNames', { names: entry.secretFields.join(', ') }) }}</span>
            <span v-for="(warning, index) in entry.warnings" :key="index" class="mcp-note">{{ warning }}</span>
          </span>
        </label>
        <p v-for="(item, index) in importPreview.errors" :key="index" class="mcp-error">{{ item.name || item.index }}: {{ item.message }}</p>
        <button type="button" :disabled="!!busy || !selectedIndices.length" @click="importSelected">{{ $t('mcp.importSelected', { count: selectedIndices.length }) }}</button>
      </div>
    </form>
    <form v-if="draft" class="mcp-editor" @submit.prevent="save">
      <label>{{ $t('mcp.name') }}<input v-model="draft.name" name="mcp-name" required maxlength="100" autocomplete="off" /></label>
      <label>{{ $t('mcp.transportLabel') }}
        <select v-model="draft.transport" name="mcp-transport" :disabled="!!draft.presetId" @change="draft.pairs = []">
          <option value="streamable-http">{{ $t('mcp.http') }}</option><option value="stdio">{{ $t('mcp.stdio') }}</option>
        </select>
      </label>
      <template v-if="draft.transport === 'stdio'">
        <p class="mcp-note">{{ $t('mcp.commandHint') }}</p>
        <p v-if="!stdioAvailable" class="mcp-note">{{ $t('mcp.stdioUnavailable') }}</p>
        <label>{{ $t('mcp.command') }}<input v-model="draft.command" name="mcp-command" required autocomplete="off" dir="ltr" /></label>
        <label>{{ $t('mcp.args') }}<textarea v-model="draft.argsText" name="mcp-args" rows="3" placeholder='["--flag", "value"]' spellcheck="false" dir="ltr" /></label>
        <label>{{ $t('mcp.cwd') }}<input v-model="draft.cwd" name="mcp-cwd" autocomplete="off" dir="ltr" /></label>
      </template>
      <template v-else>
        <label>{{ $t('mcp.url') }}<input v-model="draft.url" name="mcp-url" required type="url" :disabled="!!draft.presetId" placeholder="https://" autocomplete="off" dir="ltr" /></label>
        <label>{{ $t('mcp.authType') }}<select v-model="draft.authType" name="mcp-auth">
          <option value="none">{{ $t('mcp.authNone') }}</option><option value="bearer">{{ $t('mcp.token') }}</option><option value="oauth2">{{ $t('mcp.authOAuth') }}</option>
        </select></label>
        <label v-if="draft.authType === 'bearer'">{{ $t('mcp.token') }}<input v-model="draft.token" name="mcp-token" type="password" autocomplete="new-password" :placeholder="$t('mcp.tokenHint')" /></label>
        <p v-if="draft.authType === 'oauth2'" class="mcp-note">{{ $t('mcp.oauthHint') }}</p>
      </template>
      <details class="mcp-advanced">
        <summary>{{ $t('mcp.advanced') }}</summary>
        <label v-if="draft.transport === 'stdio'">{{ $t('mcp.timeout') }}<input v-model.number="draft.timeoutSeconds" name="mcp-timeout" type="number" min="1" max="180" required /></label>
        <fieldset>
          <legend>{{ $t(draft.transport === 'stdio' ? 'mcp.env' : 'mcp.headers') }}</legend>
          <p class="mcp-note">{{ $t('mcp.secretHint') }}</p>
          <div v-for="(pair, index) in draft.pairs" :key="index" class="mcp-pair" :class="{ 'is-removed': pair.deleted }">
            <input v-model="pair.key" :disabled="pair.saved" :aria-label="$t('mcp.key')" :placeholder="$t('mcp.key')" autocomplete="off" dir="ltr" />
            <input v-model="pair.value" :disabled="pair.deleted" type="password" :aria-label="$t('mcp.value')" :placeholder="$t('mcp.value')" autocomplete="new-password" dir="ltr" />
            <button type="button" @click="removePair(index)">{{ $t(pair.deleted ? 'common.cancel' : 'common.delete') }}</button>
          </div>
          <button type="button" @click="draft.pairs.push({ key: '', value: '' })">{{ $t('mcp.addField') }}</button>
        </fieldset>
        <template v-if="draft.transport !== 'stdio' && draft.authType === 'oauth2'">
          <label>{{ $t('mcp.clientId') }}<input v-model="draft.oauthClientId" name="mcp-client-id" autocomplete="off" dir="ltr" /></label>
          <label>{{ $t('mcp.clientSecret') }}<input v-model="draft.oauthClientSecret" name="mcp-client-secret" type="password" autocomplete="new-password" :placeholder="$t('mcp.tokenHint')" /></label>
          <label>{{ $t('mcp.scopes') }}<input v-model="draft.oauthScopes" name="mcp-scopes" autocomplete="off" dir="ltr" /></label>
        </template>
      </details>
      <p class="mcp-note">{{ $t('mcp.dataNotice') }}</p>
      <div class="mcp-actions">
        <button type="submit" :disabled="!!busy || !draft.name.trim() || !(draft.transport === 'stdio' ? draft.command.trim() : draft.url.trim())">{{ $t('common.save') }}</button>
        <button type="button" :disabled="!!busy" @click="draft = null">{{ $t('common.cancel') }}</button>
      </div>
    </form>
    <article v-for="connection in connections" :key="connection.id" class="mcp-card" :data-connection-id="connection.id">
      <div class="mcp-heading"><h3>{{ connection.name }}</h3><span>{{ $t('mcp.' + connection.source) }}</span></div>
      <p v-if="isSaved(connection)">{{ $t(connection.tested ? 'mcp.tested' : 'mcp.notTested') }}</p>
      <p class="mcp-url" dir="ltr">{{ connection.transport === 'stdio' ? localCommand(connection) : connection.url }}</p>
      <p v-if="connection.transport === 'stdio' && !stdioAvailable" class="mcp-note">{{ $t('mcp.stdioUnavailable') }}</p>
      <div v-if="connection.authType === 'oauth2'" class="mcp-oauth">
        <p role="status">{{ $t(!isSaved(connection) ? 'mcp.oauthSaveFirst' : connection.oauthStatus?.pending ? 'mcp.oauthPending' : connection.oauthStatus?.connected ? 'mcp.oauthConnected' : connection.oauthStatus?.needsReconnect ? 'mcp.oauthReconnect' : 'mcp.oauthRequired') }}</p>
        <div class="mcp-actions">
          <button v-if="!connection.oauthStatus?.pending" :disabled="!!busy || !isSaved(connection)" @click="authorize(connection)">{{ $t('mcp.authorize') }}</button>
          <button v-if="connection.oauthStatus?.pending && oauthLinks[connection.id]" :disabled="!!busy" @click="openAuthorization(connection)">{{ $t('mcp.reopen') }}</button>
          <button v-if="connection.oauthStatus?.pending || connection.oauthStatus?.connected" :disabled="!!busy" @click="disconnectOAuth(connection)">{{ $t(connection.oauthStatus?.pending ? 'mcp.cancelAuthorization' : 'mcp.disconnect') }}</button>
        </div>
      </div>
      <div class="mcp-actions">
        <button :disabled="!!busy" @click="edit(connection)">{{ $t('mcp.configure') }}</button>
        <button v-if="isSaved(connection)" :disabled="!!busy || !canTest(connection)" @click="run('test', connection)">{{ $t('mcp.test') }}</button>
        <button v-if="isSaved(connection) && !connection.enabled" :disabled="!!busy || !connection.tested || !canTest(connection)" @click="enable(connection, true)">{{ $t('mcp.enable') }}</button>
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
import { getApiBaseUrl, getCloudAccountGeneration, getMcpConnections, saveMcpConnection, testMcpConnection, setMcpConnectionEnabled, deleteMcpConnection, previewMcpImport, importMcpConnections, authorizeMcpConnection, disconnectMcpOAuth } from '@/services/api.js'
import { getCurrentUser } from '@/utils/auth.js'
import { openExternalUrl, openExternalUrlChecked } from '@/utils/externalLink.js'
export default {
  name: 'McpConnectionsPanel',
  data: () => ({ connections: [], presets: [], draft: null, scopeToken: '', stdioAvailable: false, busy: '', error: '', notice: '', importOpen: false, importJson: '', importPreview: null, selectedIndices: [], oauthLinks: {} }),
  mounted() {
    this._alive = true; this._owner = this.identity(); this._loadVersion = 0; this._importVersion = 0; this.load()
    this._identityTimer = setInterval(() => this.checkIdentity(), 1000)
  },
  beforeUnmount() { this._alive = false; this.draft = null; this.closeImport(); this.oauthLinks = {}; clearInterval(this._identityTimer); clearTimeout(this._oauthTimer) },
  methods: {
    identity() { return JSON.stringify([getApiBaseUrl(), getCurrentUser()?.id, getCloudAccountGeneration()]) },
    current(owner) { return this._alive && this._owner === owner && this.identity() === owner },
    isSaved(connection) { return connection.saved === true || Number(connection.revision) > 0 || connection.configured },
    canTest(connection) { return (connection.transport !== 'stdio' || this.stdioAvailable) && (connection.authType !== 'oauth2' || connection.oauthStatus?.connected) },
    localCommand(connection) { return [connection.command, ...(connection.args || []).map(arg => JSON.stringify(arg))].join(' ') },
    checkIdentity() {
      if (!this._alive) return false
      if (this.identity() === this._owner) return true
      this._owner = this.identity(); this.scopeToken = ''; this.draft = null; this.connections = []; this.presets = []; this.notice = ''; this.error = ''; this.oauthLinks = {}; this.stdioAvailable = false; this.closeImport()
      this.load(); return false
    },
    scheduleOAuthPoll() {
      clearTimeout(this._oauthTimer)
      if (this._alive && this.connections.some(c => c.oauthStatus?.pending)) this._oauthTimer = setTimeout(() => {
        if (!this.checkIdentity()) return
        if (this.busy) this.scheduleOAuthPoll()
        else this.load(true)
      }, 2000)
    },
    async load(silent = false) {
      const owner = this._owner, version = ++this._loadVersion
      clearTimeout(this._oauthTimer)
      if (!silent) { this.busy = 'load'; this.error = '' }
      try {
        const res = await getMcpConnections()
        if (!this.current(owner) || version !== this._loadVersion) return
        this.scopeToken = res.scopeToken || ''; this.connections = res.connections || []; this.presets = res.presets || []; this.stdioAvailable = res.stdioAvailable === true
        for (const id of Object.keys(this.oauthLinks)) if (!this.connections.some(c => c.id === id && c.oauthStatus?.pending)) delete this.oauthLinks[id]
      } catch (e) { if (this.current(owner) && version === this._loadVersion) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner) && version === this._loadVersion) { if (!silent) this.busy = ''; this.scheduleOAuthPoll() } }
    },
    startAction(action) { ++this._loadVersion; clearTimeout(this._oauthTimer); this.busy = action; this.error = ''; this.notice = '' },
    edit(connection) {
      if (!this.checkIdentity()) return
      this.closeImport(); this.notice = ''; this.error = ''
      const c = connection || {}
      this.draft = { id: c.id, presetId: c.presetId, name: c.name || '', transport: c.transport || 'streamable-http', url: c.url || '', authType: c.authType || (c.presetId || c.configured ? 'bearer' : 'none'), token: '', command: c.command || '', argsText: JSON.stringify(c.args || [], null, 2), cwd: c.cwd || '', timeoutSeconds: c.timeoutSeconds || 60, pairs: (c.transport === 'stdio' ? c.environmentKeys || [] : c.headerNames || []).map(key => ({ key, value: '', saved: true, deleted: false })), oauthClientId: c.oauthClientId || '', oauthClientSecret: '', oauthScopes: (c.oauthScopes || []).join(' ') }
    },
    removePair(index) { const pair = this.draft.pairs[index]; if (pair.saved) pair.deleted = !pair.deleted; else this.draft.pairs.splice(index, 1) },
    async save() {
      if (!this.checkIdentity() || !this.draft || !this.scopeToken) return
      const owner = this._owner
      this.startAction('save')
      try {
        const d = this.draft
        const data = { name: d.name.trim(), transport: d.transport, authType: d.transport === 'stdio' ? 'none' : d.authType }
        const pairs = d.pairs.filter(pair => pair.deleted || pair.value !== '')
        if (pairs.some(pair => !pair.key.trim()) || new Set(pairs.map(pair => pair.key.trim())).size !== pairs.length) throw new Error(this.$t('mcp.invalidFields'))
        const values = Object.fromEntries(pairs.map(pair => [pair.key.trim(), pair.deleted ? null : pair.value]))
        if (d.transport === 'stdio') {
          let args
          try { args = JSON.parse(d.argsText || '[]') } catch { throw new Error(this.$t('mcp.invalidArgs')) }
          if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error(this.$t('mcp.invalidArgs'))
          Object.assign(data, { command: d.command.trim(), args, cwd: d.cwd.trim(), env: values, timeoutSeconds: d.timeoutSeconds })
        } else {
          Object.assign(data, { url: d.url.trim(), headers: values })
          if (d.authType === 'bearer' && d.token.trim()) data.token = d.token.trim()
          if (d.authType === 'oauth2') {
            data.oauthClientId = d.oauthClientId.trim()
            if (d.oauthClientSecret.trim()) data.oauthClientSecret = d.oauthClientSecret.trim()
            data.oauthScopes = d.oauthScopes.trim() ? d.oauthScopes.trim().split(/\s+/) : []
          }
        }
        await saveMcpConnection(d.id, data, this.scopeToken)
        if (!this.current(owner)) return
        this.draft = null
        await this.load()
        if (!this.current(owner)) return
        this.notice = this.$t('mcp.saved'); uni.$emit('awd:mcp-changed')
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) { this.busy = ''; this.scheduleOAuthPoll() } }
    },
    openImport() { if (!this.checkIdentity()) return; this.draft = null; this.importOpen = true; this.notice = ''; this.error = '' },
    closeImport() { this.importOpen = false; this.importJson = ''; this.invalidatePreview(); if (this.$refs.importFile) this.$refs.importFile.value = '' },
    invalidatePreview() { ++this._importVersion; this.importPreview = null; this.selectedIndices = [] },
    async readImportFile(event) {
      if (!this.checkIdentity()) return
      const owner = this._owner, file = event.target.files?.[0]
      this.invalidatePreview(); const version = this._importVersion
      if (!file) return
      this.startAction('file')
      try {
        if (file.size > 512 * 1024) throw new Error(this.$t('mcp.fileTooLarge'))
        const json = await file.text()
        if (this.current(owner) && version === this._importVersion) this.importJson = json
      } catch { if (this.current(owner)) this.error = this.$t(file.size > 512 * 1024 ? 'mcp.fileTooLarge' : 'mcp.fileReadFailed') }
      finally { event.target.value = ''; if (this.current(owner)) { this.busy = ''; this.scheduleOAuthPoll() } }
    },
    async previewImport() {
      if (!this.checkIdentity() || !this.scopeToken || !this.importJson.trim()) return
      const owner = this._owner
      this.invalidatePreview(); const version = this._importVersion
      this.startAction('preview')
      try {
        const res = await previewMcpImport(this.importJson, this.scopeToken)
        if (!this.current(owner) || version !== this._importVersion) return
        this.importPreview = { entries: res.entries || [], errors: res.errors || [] }
        this.selectedIndices = this.importPreview.entries.map(entry => entry.index)
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) { this.busy = ''; this.scheduleOAuthPoll() } }
    },
    async importSelected() {
      if (!this.checkIdentity() || !this.scopeToken || !this.importPreview || !this.selectedIndices.length) return
      const owner = this._owner
      this.startAction('import')
      try {
        await importMcpConnections(this.importJson, this.selectedIndices, this.scopeToken)
        if (!this.current(owner)) return
        this.closeImport(); await this.load()
        if (!this.current(owner)) return
        this.notice = this.$t('mcp.saved'); uni.$emit('awd:mcp-changed')
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) { this.busy = ''; this.scheduleOAuthPoll() } }
    },
    async authorize(connection) {
      if (!this.checkIdentity() || !this.isSaved(connection)) return
      const owner = this._owner
      this.startAction('authorize')
      try {
        const res = await authorizeMcpConnection(connection.id, this.scopeToken)
        if (!this.current(owner)) return
        this.oauthLinks[connection.id] = res.authorizationUrl
        await this.load()
        if (this.current(owner)) await this.openAuthorization(connection)
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) { this.busy = ''; this.scheduleOAuthPoll() } }
    },
    async openAuthorization(connection) {
      if (!this.checkIdentity() || !this.oauthLinks[connection.id]) return
      const owner = this._owner
      try { await openExternalUrlChecked(this.oauthLinks[connection.id]); if (this.current(owner)) this.error = '' }
      catch { if (this.current(owner)) this.error = this.$t('mcp.openFailed') }
    },
    async disconnectOAuth(connection) {
      if (!this.checkIdentity()) return
      const owner = this._owner
      if (connection.oauthStatus?.connected && !(await this.confirm(this.$t('mcp.disconnectNotice')))) return
      if (!this.current(owner)) return
      this.startAction('oauth-disconnect')
      try {
        await disconnectMcpOAuth(connection.id, this.scopeToken)
        if (!this.current(owner)) return
        delete this.oauthLinks[connection.id]; await this.load()
        if (this.current(owner)) uni.$emit('awd:mcp-changed')
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) { this.busy = ''; this.scheduleOAuthPoll() } }
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
      let allowLocalExecution = false
      if (action === 'test') {
        if (!this.canTest(connection)) return
        if (connection.transport === 'stdio' && !connection.localApproved) {
          allowLocalExecution = await this.confirm(this.$t('mcp.localConfirm', { command: this.localCommand(connection) }))
          if (!allowLocalExecution || !this.current(owner)) return
        }
      }
      this.startAction(action)
      try {
        if (action === 'test') await testMcpConnection(connection.id, this.scopeToken, { expectedRevision: connection.revision, ...(allowLocalExecution ? { allowLocalExecution: true } : {}) })
        else if (action === 'delete') await deleteMcpConnection(connection.id, this.scopeToken)
        else await setMcpConnectionEnabled(connection.id, action === 'enable', this.scopeToken)
        if (!this.current(owner)) return
        await this.load()
        if (!this.current(owner)) return
        this.notice = this.$t(action === 'test' ? 'mcp.tested' : 'common.saved'); uni.$emit('awd:mcp-changed')
      } catch (e) { if (this.current(owner)) this.error = e.message || this.$t('common.failed') }
      finally { if (this.current(owner)) { this.busy = ''; this.scheduleOAuthPoll() } }
    },
  },
}
</script>
<style scoped>
.mcp-panel { padding: 24px; color: var(--awd-text); font-size: 14px; line-height: 1.6; min-width: 0; }
.mcp-panel h2 { font-size: 22px; margin: 0 0 12px; }
.mcp-panel h3 { font-size: 16px; margin: 0; overflow-wrap: anywhere; }
.mcp-note, .mcp-url { color: var(--awd-text-2); font-size: 13px; overflow-wrap: anywhere; }
.mcp-url { white-space: pre-wrap; unicode-bidi: isolate; }
.mcp-card, .mcp-editor { padding: 16px; margin-block: 16px; border: 1px solid var(--awd-border); border-radius: 8px; background: var(--awd-surface); min-width: 0; }
.mcp-heading, .mcp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mcp-heading { justify-content: space-between; }
.mcp-panel button { margin: 0; padding: 6px 12px; font-size: 13px; line-height: 1.5; color: var(--awd-text); background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: 6px; cursor: pointer; overflow-wrap: anywhere; }
.mcp-panel button:disabled { opacity: .5; cursor: default; }
.mcp-editor label { display: flex; flex-direction: column; gap: 4px; margin-block: 12px; }
.mcp-editor input, .mcp-editor select, .mcp-editor textarea { box-sizing: border-box; width: 100%; min-width: 0; min-height: 36px; padding: 8px; border: 1px solid var(--awd-border); border-radius: 4px; background: var(--awd-surface); color: var(--awd-text); font: inherit; }
.mcp-editor textarea { resize: vertical; }
.mcp-editor fieldset { min-width: 0; border: 1px solid var(--awd-border); border-radius: 4px; margin-block: 12px; padding: 12px; }
.mcp-editor .mcp-import-entry { flex-direction: row; align-items: flex-start; }
.mcp-import-entry input { width: 18px; height: 18px; min-height: 0; flex-shrink: 0; margin-block-start: 5px; }
.mcp-import-entry span { min-width: 0; overflow-wrap: anywhere; }
.mcp-import-entry .mcp-note, .mcp-import-entry .mcp-url { display: block; }
.mcp-pair { display: flex; flex-wrap: wrap; gap: 6px; margin-block: 8px; }
.mcp-pair input { flex: 1 1 110px; }
.mcp-pair button { flex: 0 0 auto; }
.mcp-pair.is-removed input { text-decoration: line-through; opacity: .5; }
.mcp-error { color: var(--awd-danger); overflow-wrap: anywhere; }
.mcp-panel summary { cursor: pointer; margin-block-start: 12px; }
.mcp-card code { direction: ltr; unicode-bidi: isolate; overflow-wrap: anywhere; }
.mcp-card li p { color: var(--awd-text-2); }
.mcp-panel :is(button, input, select, textarea):focus-visible { outline: var(--awd-focus-width, 2px) solid var(--awd-accent-text); outline-offset: var(--awd-focus-offset, 2px); }
</style>
