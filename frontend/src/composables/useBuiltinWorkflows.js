// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { getBuiltinWorkflows } from '@/services/api.js'
import { t } from '@/i18n'

export function useBuiltinWorkflows(props) {
    const builtinWorkflowStates = ref([])
    const defaultWorkflowCards = computed(() => [
      {
        id: 'contract-review',
        title: t('chat.builtinWorkflowContractTitle'),
        desc: t('chat.builtinWorkflowContractDesc'),
        prompt: t('chat.builtinWorkflowContractPrompt')
      },
      {
        id: 'evidence-linked-report',
        title: t('chat.builtinWorkflowEvidenceTitle'),
        desc: t('chat.builtinWorkflowEvidenceDesc'),
        prompt: t('chat.builtinWorkflowEvidencePrompt')
      },
      {
        id: 'file-organization',
        title: t('chat.builtinWorkflowFileOrgTitle'),
        desc: t('chat.builtinWorkflowFileOrgDesc'),
        prompt: t('chat.builtinWorkflowFileOrgPrompt')
      },
      {
        id: 'legal-opinion-review',
        title: t('chat.builtinWorkflowOpinionTitle'),
        desc: t('chat.builtinWorkflowOpinionDesc'),
        prompt: t('chat.builtinWorkflowOpinionPrompt')
      }
    ])

    const builtinQuickWorkflows = computed(() => {
      const stateMap = new Map((builtinWorkflowStates.value || []).map(s => [s.skillId, s]))
      const sysDefaultName = t('chat.builtinWorkflowSystemDefault')
      return defaultWorkflowCards.value.map(def => {
        const st = stateMap.get(def.id)
        const fallbackVersions = [
          {
            id: 'default',
            name: sysDefaultName,
            systemDefault: true,
            quickPrompt: def.prompt,
            promptTemplate: '',
            output: ''
          }
        ]
        const versions = (st && Array.isArray(st.versions) && st.versions.length)
          ? st.versions
          : fallbackVersions
        const activeVersionId = st?.activeVersionId || 'default'
        const activeIsSystemDefault = st ? !!st.activeIsSystemDefault : activeVersionId === 'default'
        const activeVersionName = st?.activeVersionName || sysDefaultName
        return {
          ...def,
          title: st?.shortName || def.title,
          desc: st?.hint || def.desc,
          prompt: st?.activeQuickPrompt || def.prompt,
          activeVersionId,
          activeVersionName,
          activeIsSystemDefault,
          activeScope: st?.activeScope || 'default',
          versions
        }
      })
    })

    let requestSequence = 0
    const loadBuiltinWorkflowStates = async () => {
      const sequence = ++requestSequence
      const projectId = props.projectId
      try {
        const res = await getBuiltinWorkflows(projectId)
        if (sequence !== requestSequence || projectId !== props.projectId) return
        const list = Array.isArray(res?.workflows) ? res.workflows : (Array.isArray(res?.data?.workflows) ? res.data.workflows : [])
        builtinWorkflowStates.value = list
      } catch (e) {
        console.warn('[ChatInterface] 加载内置工作流版本状态失败:', e)
      }
    }

    watch(() => props.projectId, () => {
      builtinWorkflowStates.value = []
      loadBuiltinWorkflowStates()
    }, { immediate: true })

    onMounted(() => window.addEventListener('awd:builtin-workflows-changed', loadBuiltinWorkflowStates))
    onBeforeUnmount(() => window.removeEventListener('awd:builtin-workflows-changed', loadBuiltinWorkflowStates))
    return { builtinWorkflowStates, builtinQuickWorkflows, loadBuiltinWorkflowStates }
}

export function notifyBuiltinWorkflowsChanged() {
    window.dispatchEvent(new CustomEvent('awd:builtin-workflows-changed'))
}
