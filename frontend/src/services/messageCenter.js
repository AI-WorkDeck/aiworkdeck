// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import api, { getApiBaseUrl, getCloudAccountGeneration } from '@/services/api.js'
import { getSessionId } from '@/utils/auth.js'

export const messageCenterIdentity = () => `${getApiBaseUrl()}:${getSessionId() || ''}:${getCloudAccountGeneration()}`

export async function messageCenterRequest(action, params = {}, projectId = null) {
  const identity = messageCenterIdentity()
  const result = await api.request({ url: '/api/message-center/action', method: 'POST',
    data: { action, params, ...(projectId ? { projectId } : {}) }, logBody: false, accountPrompt: false, timeout: 120000 })
  if (identity !== messageCenterIdentity()) { const error = new Error('Account changed'); error.stale = true; throw error }
  return result && typeof result.code !== 'undefined' ? result.data : result
}

export const messageCenterIm = (action, params = {}, projectId = null) => messageCenterRequest('im', { action, params }, projectId)
