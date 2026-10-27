<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template><BusinessPanel v-if="context" :project-id="Number(context.projectId)" :view-placement="context.viewPlacement || 'workspace'" :prepare-file="prepareFile" :download-artifact="downloadArtifact" @open-file="openFile" @request-file-select="selectFile" @request-active-file="activeFile" @request-scope-select="selectScope" @start-drawing="startDrawing" /></template>
<script>
import BusinessPanel from '@business-panel'
import { applyI18nLocale } from '@/i18n'
export default {
  components: { BusinessPanel },
  data: () => ({ context: null }),
  async mounted() {
    const context = await window.awd.ready()
    applyI18nLocale(context.language)
    this.context = context
    window.awd.events.on('account.changed', () => { this.context = null })
    window.awd.events.on('project.switched', () => { this.context = null })
    window.awd.events.on('files.changed', () => uni.$emit('awd:files-changed', { projectId: context.projectId }))
  },
  methods: {
    prepareFile(fileId) { return window.awd.services.request('sensitive', 'prepare', { fileId }) },
    downloadArtifact(payload) { return window.awd.services.request('sensitive', 'download', payload) },
    selectFile(callback, acknowledge) {
      acknowledge?.()
      window.awd.services.request('sensitive', 'choose', {}, { timeoutMs: 120000 }).then(callback).catch(e => window.awd.ui.toast(e.message))
    },
    activeFile(callback) { window.awd.services.request('sensitive', 'active', {}).then(file => { if (file) callback(file) }) },
    selectScope(callback) { window.awd.services.request('litigation', 'scope', {}, { timeoutMs: 120000 }).then(scope => { if (scope) callback(scope) }) },
    startDrawing({ prompt }) { return window.awd.chat.send(prompt) },
    async openFile(file) {
      const service = { search: 'search', desensitize: 'sensitive', 'litigation-visual': 'litigation' }[__BUSINESS_PLUGIN__]
      await window.awd.services.request(service, 'open', { fileId: file.fileId || file.id })
    },
  },
}
</script>
