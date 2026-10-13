// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export async function addPluginImFileToAi(workbench, request) {
  const current = () => String(workbench.projectId) === String(request.projectId)
    && (!request.isCurrent || request.isCurrent())
  if (!current()) throw new Error('项目或账户已切换，请重试')
  const chat = await workbench.resolveChatInterface()
  if (!current()) throw new Error('项目或账户已切换，请重试')
  if (!chat || typeof chat.addFile !== 'function') throw new Error('AI 对话暂不可用，请重试')
  chat.addFile(request.file)
  return {}
}
