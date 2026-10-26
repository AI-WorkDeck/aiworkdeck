// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export async function addPluginImFileToAi(workbench, request) {
  let isEn = false
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('checkba_app_language') === 'en-US') isEn = true
    else if (typeof document !== 'undefined' && document.documentElement?.lang === 'en-US') isEn = true
  } catch (_) { /* ignore */ }
  const switchedMsg = isEn ? 'Project or account switched. Please try again' : '项目或账户已切换，请重试'
  const unavailableMsg = isEn ? 'AI chat is currently unavailable. Please try again' : 'AI 对话暂不可用，请重试'
  const current = () => String(workbench.projectId) === String(request.projectId)
    && (!request.isCurrent || request.isCurrent())
  if (!current()) throw new Error(switchedMsg)
  const chat = await workbench.resolveChatInterface()
  if (!current()) throw new Error(switchedMsg)
  if (!chat || typeof chat.addFile !== 'function') throw new Error(unavailableMsg)
  chat.addFile(request.file)
  return {}
}
