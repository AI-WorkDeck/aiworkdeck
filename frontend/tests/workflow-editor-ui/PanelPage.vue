<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template><view class="qa-root"><BuiltinWorkflowEditor v-show="shown" :project-id="projectId" :request="request" @close="closed++" /></view></template>
<script>import BuiltinWorkflowEditor from '@/components/BuiltinWorkflowEditor.vue';export default{components:{BuiltinWorkflowEditor},data:()=>({projectId:1,request:{workflowId:'contract-review',versionId:'default'},shown:true,closed:0}),mounted(){window.__workflowQA=this;document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'light'}}</script>
<style>.qa-root{width:100%;height:100vh;background:var(--awd-bg)}</style>
