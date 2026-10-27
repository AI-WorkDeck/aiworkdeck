<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template><view class="portal"><DdClientWorkspace /><footer>AI WorkDeck · <a href="https://github.com/AI-WorkDeck/aiworkdeck" target="_blank" rel="noopener">{{ $t('ddWorkflow.client.sourceCode') }}</a></footer></view></template>
<script>
import DdClientWorkspace from '@/components/dd/DdClientWorkspace.vue'
export default { name: 'ClientPortal', components: { DdClientWorkspace } }
</script>
<style scoped>
.portal{height:100vh;background:var(--awd-bg);display:flex;flex-direction:column}.portal>:first-child{flex:1;min-height:0}footer{padding:10px 18px;color:var(--awd-text-3);font-size:var(--awd-panel-fs-meta);border-top:1px solid var(--awd-border)}a{color:var(--awd-accent-text)}
</style>
