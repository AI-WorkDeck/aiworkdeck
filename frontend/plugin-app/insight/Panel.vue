<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <InsightPane v-if="context" :project-id="projectId" :doc-file-id="context.docFileId" :doc-name="context.docName" :get-executor="executor" :can-write="context.canWrite" :prepare-document="prepare" :cursor-context="context.cursorContext" @entities="entities" @open-url="openUrl" @open-settings="settings" @open-hover="hover" @open-doc-file="openDoc" />
</template>
<script>
import InsightPane from '@/components/InsightPane.vue'
import { insight } from './api.js'
export default {
  components: { InsightPane }, props: { projectId: [String, Number] },
  data: () => ({ context: null }),
  mounted() {
    const refresh = async () => { try { const data = await insight('context'); if (!this._gone && JSON.stringify(data) !== JSON.stringify(this.context)) this.context = data } catch {} }
    refresh(); this._timer = setInterval(refresh, 500)
  },
  beforeUnmount() { this._gone = true; clearInterval(this._timer) },
  methods: {
    executor() { const docFileId = this.context?.docFileId; return (action, params) => insight('execute', { docFileId, action, params }) },
    prepare: docFileId => insight('prepare', { docFileId }),
    entities: payload => insight('entities', payload),
    openUrl: url => insight('openUrl', { url }),
    settings: () => insight('openSettings'),
    hover: payload => insight('openHover', { payload }),
    openDoc: payload => insight('openDoc', { fileId: payload.fileId || payload.id }),
  },
}
</script>
