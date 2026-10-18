// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { pluginPlatformRequest, getPluginSettings, savePluginSettings } from '@/services/api.js'
import { openExternalUrl } from '@/utils/externalLink.js'

const handled = new Set(['settings.open', 'settings.get', 'settings.update', 'connections.list', 'connections.connect',
  'connections.disconnect', 'connections.request', 'billing.status', 'billing.checkout', 'mcp.servers', 'mcp.call'])

export function createPluginPlatformServices({ pluginId, projectId, permissions, isCurrent = () => true }) {
  let disposed = false
  const controllers = new Set()
  const current = () => !disposed && isCurrent()
  const value = item => typeof item === 'function' ? item() : item
  const fail = (code, message) => ({ ok: false, error: { code, message } })
  return {
    async request(method, params = {}) {
      if (!handled.has(method)) return null
      if (!current()) return fail('cancelled', 'Plugin context changed')
      const id = value(pluginId)
      const pid = value(projectId)
      const controller = new AbortController()
      controllers.add(controller)
      try {
        let result
        if (method === 'settings.open' || method === 'connections.connect') {
          uni.$emit('awd:plugin-open-settings', { pluginId: id, projectId: pid, connectionId: params.id || params.connectionId })
          result = { opened: true }
        } else if (method.startsWith('settings.')) {
          const response = await getPluginSettings(id, pid)
          if (!current()) return fail('cancelled', 'Plugin context changed')
          const rows = response.settings || response.data?.settings || []
          if (method === 'settings.get') {
            const setting = rows.find(row => row.key === params.key)
            if (!setting) return fail('not_found', 'Setting is not declared')
            if (setting.secret) return fail('permission_denied', 'Credentials are managed by the host')
            result = { key: params.key, value: setting.value == null ? '' : String(setting.value) }
          } else {
            const values = params.values
            if (!values || typeof values !== 'object' || Array.isArray(values)) return fail('invalid_params', 'Settings values are required')
            for (const key of Object.keys(values)) {
              const setting = rows.find(row => row.key === key)
              if (!setting || setting.secret || !['user', 'project'].includes(setting.scope)) {
                return fail('permission_denied', 'Installation settings and credentials must be edited in host settings')
              }
            }
            await savePluginSettings(id, values, pid)
            if (current()) uni.$emit('awd:plugin-settings-changed', { pluginId: id })
            result = {}
          }
        } else {
          if ((method.startsWith('connections.') || method.startsWith('mcp.') || params.connectionId)
              && !(value(permissions) || []).includes('network')) return fail('permission_denied', 'Network permission is required')
          const response = await pluginPlatformRequest(id, method, { ...params, projectId: pid }, controller.signal)
          if (!current()) return fail('cancelled', 'Plugin context changed')
          result = method === 'connections.list' ? { connections: response.connections || [] }
            : method === 'mcp.servers' ? { servers: response.servers || [] }
              : method === 'mcp.call' ? response.result : response.data || {}
          if (method === 'billing.checkout') {
            const url = new URL(result.url)
            if (url.protocol !== 'https:' || url.username || url.password) return fail('invalid_params', 'Invalid checkout URL')
            const confirmed = await new Promise(resolve => uni.showModal({
              title: '打开付款页面 / Open checkout', content: url.hostname,
              success: answer => resolve(!!answer.confirm), fail: () => resolve(false)
            }))
            if (!confirmed || !current()) return fail('cancelled', 'Checkout cancelled')
            openExternalUrl(url.href)
            result = { opened: true }
          }
        }
        return current() ? { ok: true, result } : fail('cancelled', 'Plugin context changed')
      } catch (error) {
        return fail(error?.data?.errorCode || (error?.name === 'AbortError' ? 'cancelled' : 'plugin_service_failed'),
          error?.message || 'Plugin service failed')
      } finally { controllers.delete(controller) }
    },
    dispose() { disposed = true; controllers.forEach(controller => controller.abort()); controllers.clear() }
  }
}
