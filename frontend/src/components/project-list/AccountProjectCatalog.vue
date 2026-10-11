<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="account-catalog">
    <view class="catalog-heading">
      <text>{{ $t('projects.accountCatalog') }}</text>
      <button class="catalog-action" :disabled="loading" @tap="load">{{ $t('projects.catalogRefresh') }}</button>
    </view>
    <text v-if="loadError" class="catalog-note" role="status">{{ loadError }}</text>
    <text v-else-if="!catalog.length && !loading" class="catalog-note">{{ $t('projects.catalogAllLocal') }}</text>
    <view v-for="project in remoteProjects" :key="project.projectUid" class="catalog-project">
      <view class="catalog-project-entry">
      <button class="catalog-project-name" :class="{ 'is-selected': selected?.projectUid === project.projectUid }" :title="project.name + ' · ' + locationHelp(project)" role="button" tabindex="0" @tap="open(project)" @keydown.enter.prevent="open(project)" @keydown.space.prevent="open(project)">
        <text class="catalog-project-title">{{ project.name }}</text><text class="catalog-note catalog-location">{{ availabilityText(project) }}</text>
      </button>
      <button v-if="project.localProjectId && (project.locations || []).length > 1" class="catalog-action catalog-other-locations" role="button" tabindex="0" :title="$t('projects.catalogOtherLocations')" :aria-label="$t('projects.catalogOtherLocations')" :disabled="importing" @tap="openLocations(project)" @keydown.enter.prevent="openLocations(project)" @keydown.space.prevent="openLocations(project)"><text aria-hidden="true">⋯</text></button>
      </view>
      <view v-if="selected?.projectUid === project.projectUid" class="catalog-files">
        <view class="catalog-heading">
          <button class="catalog-action" :disabled="importing" @tap="openLocations(project)">{{ $t('projects.catalogRefresh') }}</button>
          <button class="catalog-action" :disabled="importing" @tap="close">{{ $t('common.close') }}</button>
        </view>
        <text v-if="error" class="catalog-note" role="status">{{ error }}</text>
        <text v-if="listing" class="catalog-note" role="status">{{ $t('projects.catalogLoadingFiles') }}</text>
        <text v-if="incomplete" class="catalog-note">{{ $t('projects.catalogIncomplete') }}</text>
        <text v-if="!listing && !files.length && !error" class="catalog-note">{{ $t('projects.catalogNoFiles') }}</text>
        <template v-if="files.length">
          <text class="catalog-note">{{ $t('projects.catalogDestination') }}</text>
          <select v-model="targetId" class="catalog-destination" :disabled="importing" :aria-label="$t('projects.catalogDestination')">
            <option value="">{{ $t('projects.catalogChooseLocal') }}</option>
            <option v-for="p in localProjects" :value="String(p.id)" :key="p.id">{{ p.name }}</option>
          </select>
        </template>
        <text v-if="importing" class="catalog-note" role="status">{{ $t('projects.catalogWorking') }}</text>
        <view v-for="file in files" :key="file.uid || [file.deviceId,file.projectKey,file.id].join(':')" class="catalog-file">
          <view><text>{{ file.path || file.name }}</text><text class="catalog-note">{{ (file.source === 'cloud' || file.source === 'backup') ? $t('projects.catalogCloud') : file.deviceName || $t('projects.catalogOtherDevice') }}</text></view>
          <button class="catalog-action" :disabled="file.isFolder || importing || !targetId || (file.source === 'desktop' && !file.online)" @tap="download(file)" @keydown.enter.prevent="download(file)" @keydown.space.prevent="download(file)">{{ $t('projects.catalogImport') }}</button>
        </view>
      </view>
    </view>
  </view>
</template>
<script>
import { getAccountProjectCatalog, requestAccountCatalog, importAccountCatalogFile } from '@/services/api.js'
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))
export default {
  name: 'AccountProjectCatalog',
  props: { localProjects: { type: Array, default: () => [] }, currentProjectId: { type: [String, Number], default: null } },
  emits: ['imported', 'open-project'],
  data() { return { catalog: [], selected: null, files: [], loading: false, listing: false, importing: false, loadError: '', error: '', incomplete: false, targetId: '', generation: 0 } },
  computed: { remoteProjects() { return this.catalog } },
  mounted() { this.targetId = this.currentProjectId ? String(this.currentProjectId) : ''; this.load() },
  beforeUnmount() { this.generation++ },
  methods: {
    async load() {
      if (this.loading) return
      this.loading = true; this.loadError = ''
      try { this.catalog = await getAccountProjectCatalog() } catch (e) { this.loadError = e.message }
      finally { this.loading = false }
    },
    availabilityText(p) {
      if (Number.isSafeInteger(Number(p.localProjectId)) && Number(p.localProjectId) > 0) return this.$t('projects.catalogAvailabilityLocal')
      if ((p.locations || []).some(l => l.kind === 'cloud')) return this.$t('projects.catalogAvailabilityCloud')
      return this.$t((p.locations || []).some(l => l.online) ? 'projects.catalogAvailabilityRemote' : 'projects.catalogAvailabilityWaiting')
    },
    locationsText(p) {
      if (Number.isSafeInteger(Number(p.localProjectId)) && Number(p.localProjectId) > 0) return this.$t('projects.catalogThisComputer')
      return (p.locations || []).map(l => l.kind === 'cloud'
        ? this.$t('projects.catalogCloud')
        : this.$t(l.online ? 'projects.catalogDeviceAvailable' : 'projects.catalogDeviceUnavailable', { device: l.deviceName || this.$t('projects.catalogOtherDevice') })).join(' / ')
    },
    locationHelp(p) {
      return (p.locations || []).map(l => l.kind === 'desktop' && !l.online && !p.localProjectId
        ? this.$t('projects.catalogDeviceUnavailableHelp', { device: l.deviceName || this.$t('projects.catalogOtherDevice') })
        : this.locationsText({ ...p, locations: [l] })).join(' / ')
    },
    request(method, path, body, scope = this.selected?.accountScope) {
      return requestAccountCatalog(method, path, body, scope)
    },
    close() {
      if (this.importing) return
      this.generation++; this.selected = null; this.listing = false; this.error = ''; this.files = []
    },
    async poll(id, wanted, scope = this.selected?.accountScope, generation = this.generation) {
      for (let i = 0; i < 90; i++) {
        if (generation !== this.generation) throw new Error(this.$t('projects.catalogCancelled'))
        const response = await this.request('GET', `/api/mobile/transfer/${id}`, undefined, scope)
        if (generation !== this.generation) throw new Error(this.$t('projects.catalogCancelled'))
        const transfer = response.transfer
        if (transfer.status === wanted || (wanted === 'STAGED' && transfer.status === 'DELIVERED')) return transfer
        if (['FAILED', 'EXPIRED'].includes(transfer.status)) throw new Error(transfer.error || this.$t('projects.catalogFailed'))
        await pause(1500)
      }
      throw new Error(this.$t('projects.catalogPending'))
    },
    async open(project) {
      if (this.importing) return
      if (Number.isSafeInteger(Number(project.localProjectId)) && Number(project.localProjectId) > 0) {
        this.close()
        this.$emit('open-project', Number(project.localProjectId))
        return
      }
      return this.openLocations(project)
    },
    async openLocations(project) {
      if (this.importing) return
      const generation = ++this.generation
      const current = () => generation === this.generation
      const request = (method, path, body) => this.request(method, path, body, project.accountScope)
      this.selected = project; this.files = []; this.listing = true; this.error = ''; this.incomplete = false
      try {
        const snapshot = await request('GET', `/api/mobile/catalog/${project.projectUid}/files`)
        if (!current()) return
        const entries = new Map()
        for (const file of snapshot.files || []) entries.set(file.uid || `${file.deviceId}:${file.projectKey}:${file.id}`, file)
        const desktopLocations = (project.locations || []).filter(l => l.kind === 'desktop')
        const incomplete = new Map(desktopLocations.map(l => [`${l.deviceId}:${l.key}`, snapshot.truncated]))
        this.files = [...entries.values()]
        for (const location of desktopLocations.filter(l => l.online)) {
          if (!current()) return
          const route = `${location.deviceId}:${location.key}`
          try {
            const created = await request('POST', '/api/mobile/transfer/list', { deviceId: location.deviceId, projectKey: location.key, requestId: crypto.randomUUID() })
            if (!current()) return
            const listing = await this.poll(created.id, 'DONE', project.accountScope, generation)
            if (!current()) return
            incomplete.set(route, !!listing.truncated)
            for (const [key, entry] of entries) if (entry.source === 'desktop' && `${entry.deviceId}:${entry.projectKey}` === route) entries.delete(key)
            for (const file of listing.files || []) {
              const key = file.uid || `${route}:${file.id}`
              if (entries.get(key)?.source === 'cloud') continue
              entries.set(key, { ...file, source: 'desktop', deviceId: location.deviceId, deviceName: location.deviceName, projectKey: location.key, online: true })
            }
          } catch (e) { if (!current()) return; incomplete.set(route, true); this.error = e.message }
          this.files = [...entries.values()]
        }
        this.incomplete = [...incomplete.values()].some(Boolean)
        this.files = [...entries.values()]
      } catch (e) { if (current()) this.error = e.message }
      finally { if (current()) this.listing = false }
    },
    async download(file) {
      if (file.isFolder || this.importing || !this.selected || !this.targetId || (file.source === 'desktop' && !file.online)) return
      // Stop stale LIST replies before importing; keep the selected project stable until it finishes.
      this.generation++; this.listing = false
      this.importing = true; this.error = ''
      try {
        const body = { accountScope: this.selected.accountScope, targetProjectId: Number(this.targetId), projectUid: this.selected.projectUid, fileUid: file.uid }
        if (file.source === 'desktop') {
          const key = `awd-catalog-pull:${this.selected.accountScope}:${this.selected.projectUid}:${file.deviceId}:${file.projectKey}:${file.id}`
          let transfer = uni.getStorageSync(key)
          if (!transfer) {
            const quote = await this.request('GET', `/api/mobile/transfer/quote?bytes=${file.size || 0}`)
            const confirmed = await new Promise(resolve => uni.showModal({ title: this.$t('projects.catalogImport'), content: this.$t('projects.catalogQuote', { credits: quote.credits }), success: result => resolve(result.confirm), fail: () => resolve(false) }))
            if (!confirmed) return
            transfer = { requestId: crypto.randomUUID() }; uni.setStorageSync(key, transfer)
          }
          if (!transfer.id) {
            const created = await this.request('POST', '/api/mobile/transfer/pull', { deviceId: file.deviceId, projectKey: file.projectKey, remoteFileId: file.id, fileName: file.name, fileSize: file.size, requestId: transfer.requestId })
            transfer.id = created.id; uni.setStorageSync(key, transfer)
          }
          await this.poll(transfer.id, 'STAGED'); body.transferId = transfer.id
          const result = await importAccountCatalogFile(body)
          uni.removeStorageSync(key); this.$emit('imported', result)
        } else {
          this.$emit('imported', await importAccountCatalogFile(body))
        }
        uni.showToast({ title: this.$t('projects.catalogSaved'), icon: 'success' })
      } catch (e) { this.error = e.message }
      finally { this.importing = false }
    },
  },
}
</script>
<style scoped>
.account-catalog { margin: var(--awd-space-2) 0; border-top: 1px solid var(--awd-panel-border); color: var(--awd-panel-text); }
.catalog-heading,.catalog-file { display: flex; align-items: center; justify-content: space-between; gap: var(--awd-space-2); }
.catalog-heading { min-height: var(--awd-control-height); font-size: var(--awd-panel-fs-sec); color: var(--awd-panel-text-2); }
.catalog-note { display: block; font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-text-2); line-height: var(--awd-line-height-ui); overflow-wrap: anywhere; }
.catalog-project-entry { display: flex; align-items: center; }
.catalog-other-locations { font-size: var(--awd-panel-fs-meta); color: var(--awd-panel-accent); }
.catalog-project { min-width: 0; border-bottom: 1px solid var(--awd-panel-border); }
.catalog-project-name,.catalog-action { margin: 0; min-height: var(--awd-control-height); border: 0; border-radius: var(--awd-radius-sm); background: transparent; font-size: var(--awd-font-size-body); color: var(--awd-panel-text); text-align: left; padding: var(--awd-space-1) var(--awd-space-2); line-height: var(--awd-line-height-ui); cursor: pointer; }
.catalog-project-name::after,.catalog-action::after { border: 0; }
.catalog-project-name { display: flex; align-items: center; gap: var(--awd-space-1); flex: 1; min-width: 0; width: 100%; font-weight: 500; white-space: normal; overflow-wrap: anywhere; }
.catalog-project-name:hover,.catalog-action:hover { background: var(--awd-panel-hover); }
.catalog-project-name.is-selected { background: var(--awd-accent-wash); }
.catalog-project-name:focus-visible,.catalog-action:focus-visible,.catalog-destination:focus-visible { outline: var(--awd-focus-width) solid var(--awd-accent); outline-offset: calc(-1 * var(--awd-focus-offset)); }
.catalog-action { flex-shrink: 0; font-size: var(--awd-panel-fs); }
.catalog-action:disabled { cursor: default; opacity: 0.5; }
.catalog-project-title { min-width: 0; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.catalog-location { flex-shrink: 0; white-space: nowrap; font-weight: 400; }
.catalog-other-locations { width: var(--awd-control-height); padding: 0; text-align: center; }
.catalog-files { padding: 0 var(--awd-space-2) var(--awd-space-2); border-top: 1px solid var(--awd-panel-border); }
.catalog-file { padding: var(--awd-space-1) 0; font-size: var(--awd-font-size-body); overflow-wrap: anywhere; }
.catalog-file > view { min-width: 0; }
.catalog-destination { width: 100%; min-height: var(--awd-control-height); margin: var(--awd-space-2) 0; border: 1px solid var(--awd-panel-border); border-radius: var(--awd-radius-sm); background: var(--awd-surface); color: var(--awd-panel-text); font-size: var(--awd-font-size-body); }
</style>
