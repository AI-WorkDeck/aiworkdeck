// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 插件工具权限升级的重新授权提示。规则与闸都在后端（PluginToolApprovals / ToolRegistry）：
// 升级的工具在批准前对 Agent、面板直调与对外 MCP 一律不可用；这里只负责把变更讲清楚、收下用户的批准。
// /api/plugins/list 的 pendingToolChanges 每条 {name, label, kind, reasons, before, after}，
// 批准时原样带回 toolApprovalToken（用户查看期间插件又变了，后端拒绝并要求重看）。

import { t } from '@/i18n'
import { approvePluginToolChanges } from '@/services/api.js'

const ACCESS_KEYS = { read: 'market.toolAccessRead', write: 'market.toolAccessWrite', destructive: 'market.toolAccessDestructive' }

function accessLabel(access) {
  return t(ACCESS_KEYS[access] || 'market.toolAccessUnknown')
}

/** 一条变更 → 一行可读说明，例如「demo_delete：权限 只读 → 可删除数据；不再先征求确认」 */
export function describeToolChange(change) {
  const before = change.before || {}
  const after = change.after || {}
  const remote = change.kind === 'mcp'
  const parts = (change.reasons || []).map(reason => {
    switch (reason) {
      case 'new': return remote ? t('market.toolChangeNewRemote') : t('market.toolChangeNew', { access: accessLabel(after.access) })
      case 'access': return t('market.toolChangeAccess', { from: accessLabel(before.access), to: accessLabel(after.access) })
      case 'confirm': return t('market.toolChangeConfirm')
      case 'mcp': return remote ? t('market.toolChangeRemoteServer') : t('market.toolChangeMcp')
      case 'handler': return t('market.toolChangeHandler')
      case 'schema': return t('market.toolChangeSchema')
      default: return reason
    }
  })
  return `${change.label || change.name}: ${parts.join(t('market.listSeparator'))}`
}

export function pendingToolChanges(plugin) {
  return Array.isArray(plugin?.pendingToolChanges) ? plugin.pendingToolChanges : []
}

/**
 * 弹出批准提示；用户批准则提交并返回 true。不批准返回 false（工具保持不可用，插件其余功能照常）。
 * 提交失败（含「插件又变了」）抛出，调用方提示后重新拉列表。
 */
export async function promptToolApproval(plugin, displayName) {
  const changes = pendingToolChanges(plugin)
  if (!changes.length || !plugin.toolApprovalToken) return false
  const ok = await new Promise(resolve => {
    uni.showModal({
      title: t('market.toolApprovalTitle'),
      content: t('market.toolApprovalContent', {
        name: displayName || plugin.name || plugin.id,
        changes: changes.map(c => '• ' + describeToolChange(c)).join('\n'),
      }),
      confirmText: t('market.toolApprovalApprove'),
      cancelText: t('market.toolApprovalLater'),
      success: r => resolve(!!r.confirm),
      fail: () => resolve(false),
    })
  })
  if (!ok) return false
  await approvePluginToolChanges(plugin.id, plugin.toolApprovalToken)
  return true
}
