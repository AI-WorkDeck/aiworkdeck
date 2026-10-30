// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { getCurrentInstance, onBeforeUnmount } from 'vue'
import { useAgentStream } from './useAgentStream.js'
import { createLitigationGeneration } from '@/utils/litigationGeneration.mjs'
import { getCurrentUser } from '@/utils/auth.js'
import { t } from '@/i18n'
import { getApiBaseUrl, getCloudAccountGeneration, getAccountStatus, getPlugins, getSkills,
  getLitigationKickoffPrompt, getLitigationDiagrams, issueAgentConversation, getAiHistory,
  fetchAiModels, getAgentInbox } from '@/services/api.js'


export function useLitigationGeneration() {
  const vm = getCurrentInstance().proxy
  const stream = useAgentStream()
  const text = key => t('panels.litTask' + key[0].toUpperCase() + key.slice(1))
  let controller = null
  let owner = null
  let initializing = null
  let checkingAccess = false
  let lastAccessCheck = 0
  let alive = true
  const identity = () => JSON.stringify([getApiBaseUrl(), getCurrentUser()?.id, vm.projectId, getCloudAccountGeneration()])
  const rows = res => Array.isArray(res) ? res : res?.data || []
  const authorize = async () => {
    if (!vm.canWriteProject) throw Object.assign(new Error(text('disabled')), { code: 'litigation_disabled' })
    const [plugins, skills] = await Promise.all([getPlugins(), getSkills()])
    const plugin = rows(plugins).find(p => p.id === 'litigation-visual')
    const skill = rows(skills).find(s => s.id === 'litigation-visual')
    if (!plugin?.enabled || plugin.revokedReason || plugin.incompatibleReason
      || !['file_read', 'file_write', 'ai'].every(p => plugin.permissions?.includes(p))
      || !skill?.enabled || skill.available === false) throw Object.assign(new Error(text('disabled')), { code: 'litigation_disabled' })
  }
  const ensure = async () => {
    if (owner && owner !== identity()) { controller?.dispose(); controller = null; owner = null }
    if (controller) return controller
    if (initializing) return initializing
    const captured = identity()
    initializing = (async () => {
      const account = await getAccountStatus()
      if (!alive || identity() !== captured) throw new Error(text('contextChanged'))
      owner = captured
      const projectId = Number(vm.projectId)
      // Account identity only, never the local session token or a platform key.
      const key = `awd_litviz_task:${JSON.stringify([getApiBaseUrl(), getCurrentUser()?.id, projectId,
        account.accountId || account.username || 'local'])}`
      controller = createLitigationGeneration({ stream, isCurrent: () => alive && identity() === captured,
        storage: { load: () => uni.getStorageSync(key) || null, save: value => uni.setStorageSync(key, value) },
        text, openFile: fileId => vm.handleLitigationOpenFile({ fileId }),
        changed: () => uni.$emit('awd:files-changed', { projectId }),
        api: { projectId, authorize, inbox: getAgentInbox,
          kickoff: input => getLitigationKickoffPrompt(projectId, input),
          issue: conversationId => issueAgentConversation(projectId, 'litigation-visual', conversationId),
          diagrams: () => getLitigationDiagrams(projectId),
          history: async conversationId => {
            const response = await getAiHistory({ projectId, conversationId, limit: 50 })
            return Array.isArray(response) ? response : response?.messages || []
          },
          model: async () => {
            const catalog = await fetchAiModels()
            const selected = uni.getStorageSync('ai_selected_model')
            if (!selected || selected === 'auto') return 'auto'
            if (catalog.models?.some(m => m.id === selected)) return selected
            // A removed paid model is not silently replaced with another model.
            throw new Error(text('modelUnavailable'))
          },
        },
      })
      return controller
    })().finally(() => { initializing = null })
    return initializing
  }
  // Keep observing while the sidebar shows another plugin. This is also the
  // revocation path when disabling the plugin destroys its iframe.
  const timer = setInterval(async () => {
    if (!controller || checkingAccess) return
    if (identity() !== owner) { controller.dispose(); controller = null; owner = null; return }
    const capturedController = controller
    const capturedOwner = owner
    checkingAccess = true
    try {
      const snapshot = await capturedController.observe()
      if (controller !== capturedController || identity() !== capturedOwner) return
      if (['starting', 'running', 'waiting', 'paused'].includes(snapshot.phase) && Date.now() - lastAccessCheck > 5000) {
        lastAccessCheck = Date.now()
        try { await authorize() } catch (error) {
          if (error.code === 'litigation_disabled' && controller === capturedController && identity() === capturedOwner) {
            await capturedController.revoke(error.message)
          }
        }
      }
    } catch { /* The panel retains its last state and exposes refresh failures. */ }
    finally { checkingAccess = false }
  }, 1000)
  onBeforeUnmount(() => { controller?.dispose(); alive = false; clearInterval(timer) })
  return async (operation, params) => (await ensure()).request(operation, params)
}
