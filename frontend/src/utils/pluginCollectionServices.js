// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed collection operations run in the host; credentials and native APIs never enter the iframe.
import {
  getTaskProjectOptions, getProjectTasks, getCalendarTasks, getCalendarSummary,
  getProjectFiles, getProjectMembers, getProjectFavorites, deleteFavorite,
  listClipboard, deleteClipboardItem, getApiBaseUrl, purchaseFeatureSku,
} from '@/services/api.js'
import { createTask, updateTask, deleteTask } from '@/utils/taskStore.js'
import { getSessionId } from '@/utils/auth.js'
import { refreshEntitlements } from '@/composables/useEntitlement.js'
import { t } from '@/i18n'

const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }) }
const id = value => {
  if (!/^[1-9][0-9]*$/.test(String(value))) fail('invalid_params', 'Invalid collection identifier')
  return String(value)
}
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
const tasks = value => value?.data?.tasks || []
const envelope = data => ({ code: 0, data })
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
const writable = project => ['OWNER', 'MANAGER', 'ADMIN', 'PARTICIPANT'].includes(project.myRole)
const modal = options => new Promise(resolve => uni.showModal({ ...options, success: res => resolve(!!res.confirm), fail: () => resolve(false) }))

export function createPluginCollectionServices({ projectId, permissions, isCurrent, openFile, actions = {} }) {
  const favorites = new Map()
  const clipboard = new Map()
  let purchasing = false
  async function request(service, operation, params = {}, signal) {
    const mountedProject = projectId()
    const scoped = mountedProject != null && mountedProject !== '' && Number(mountedProject) > 0
    const required = new Set()
    const check = () => {
      if (signal?.aborted || !isCurrent() || String(projectId()) !== String(mountedProject)) fail('cancelled')
      for (const permission of required) if (!permissions().includes(permission)) fail('permission_denied')
    }
    const need = permission => { required.add(permission); check() }
    const wait = async promise => { const result = await promise; check(); return result }
    const action = async (name, value) => {
      check()
      if (typeof actions[name] !== 'function') fail('unavailable', 'Host action unavailable: ' + name)
      await wait(actions[name](value))
      return { ok: true }
    }
    const visibleProject = async (value, write = false) => {
      const pid = id(value)
      if (scoped && pid !== id(mountedProject)) fail('permission_denied')
      const projects = await wait(getTaskProjectOptions())
      const project = projects.find(p => String(p.id) === pid)
      if (!project || (write && !writable(project))) fail('permission_denied')
      return project
    }
    const filesFor = async pid => {
      need('file_read')
      await visibleProject(pid)
      // Calendar selectors need directory nodes to label paths and hide system subtrees.
      return rows(await wait(getProjectFiles(pid, null, true)))
    }
    const image = async (kind, itemId) => {
      const path = kind === 'favorites' ? '/api/favorites/' + id(itemId) + '/image' : '/api/clipboard/' + id(itemId) + '/file'
      const response = await wait(fetch(getApiBaseUrl() + path, { headers: { 'X-Session-Id': getSessionId() || '' }, signal, redirect: 'error' }))
      if (!response.ok) fail('not_found', 'Image unavailable')
      const limit = 20 * 1024 * 1024
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); fail('quota_exceeded') }
      const reader = response.body?.getReader()
      const chunks = []
      let size = 0
      if (reader) {
        try {
          while (true) {
            const { done, value } = await wait(reader.read())
            if (done) break
            size += value.length
            if (size > limit) fail('quota_exceeded')
            chunks.push(value)
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error }
        finally { reader.releaseLock() }
      } else {
        const value = new Uint8Array(await wait(response.arrayBuffer()))
        size = value.length
        if (size > limit) fail('quota_exceeded')
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      // Clipboard's older backend serves WebP/BMP as octet-stream. Inspect raster
      // signatures so those images still work without accepting SVG/HTML payloads.
      const matches = (signature, offset = 0) => signature.every((value, i) => bytes[offset + i] === value)
      const type = matches([137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png'
        : matches([255, 216, 255]) ? 'image/jpeg'
          : matches([71, 73, 70, 56]) && [55, 57].includes(bytes[4]) && bytes[5] === 97 ? 'image/gif'
            : matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8) ? 'image/webp'
              : matches([66, 77]) ? 'image/bmp' : ''
      if (!type) fail('invalid_data', 'Unsupported image format')
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      return { dataUrl: 'data:' + type + ';base64,' + btoa(binary) }
    }
    check()
    if (!params || typeof params !== 'object' || Array.isArray(params)) fail('invalid_params')
    if (service === 'calendar') {
      need('tasks')
      if (operation === 'workspace') {
        if (typeof actions.calendarWorkspace !== 'function') fail('unavailable')
        return await wait(actions.calendarWorkspace(pick(params, ['patch', 'open', 'focus', 'create'])))
      }
      if (operation === 'projects') {
        const result = await wait(getTaskProjectOptions())
        return scoped ? result.filter(p => String(p.id) === String(mountedProject)) : result
      }
      if (operation === 'list') {
        if (scoped) return await wait(getProjectTasks(mountedProject, pick(params, ['from', 'to'])))
        return await wait(getCalendarTasks(params.from, params.to))
      }
      if (operation === 'projectTasks') {
        await visibleProject(params.projectId)
        return await wait(getProjectTasks(params.projectId, pick(params, ['from', 'to', 'fileId'])))
      }
      if (operation === 'summary') {
        if (!scoped) return await wait(getCalendarSummary())
        // The scoped plugin's taskStore derives its own project summary; no global data is exposed.
        return envelope({})
      }
      if (operation === 'files') return (await filesFor(params.projectId)).map(file => pick(file, ['id', 'name', 'parentId', 'fileType', 'isFolder', 'isDir', 'isDeleted']))
      if (operation === 'members') {
        await visibleProject(params.projectId)
        return envelope(rows(await wait(getProjectMembers(params.projectId))).map(member => pick(member, ['userId', 'username', 'displayName', 'role'])))
      }
      if (operation === 'openProject') {
        await visibleProject(params.projectId)
        return await action('openProject', { projectId: params.projectId })
      }
      if (operation === 'openFile') {
        const files = await filesFor(params.projectId)
        const file = files.find(f => String(f.id) === id(params.fileId) && !f.isFolder && !f.isDir)
        if (!file) fail('not_found')
        if (scoped && openFile) { await wait(openFile(file)); return { ok: true } }
        return await action('openTaskFile', { projectId: params.projectId, fileId: file.id })
      }
      if (!['create', 'update', 'delete'].includes(operation)) fail('unknown_method')
      let pid = params.data?.projectId
      let existingFileIds = []
      if (operation !== 'create') {
        const result = scoped ? await wait(getProjectTasks(mountedProject)) : await wait(getCalendarTasks())
        const task = tasks(result).find(task => String(task.id) === id(params.id))
        if (!task) fail('not_found')
        pid = task.projectId
        existingFileIds = Array.isArray(task.files) && task.files.length ? task.files.map(file => file.fileId) : task.fileId == null ? [] : [task.fileId]
      }
      await visibleProject(pid, true)
      if (operation === 'delete') return envelope(await wait(deleteTask(id(params.id))))
      const body = pick(params.data || {}, ['title', 'dueDate', 'dueTime', 'status', 'type', 'priority', 'notes', 'assigneeId', 'remindBefore', 'fileIds'])
      if (body.fileIds !== undefined) {
        if (!Array.isArray(body.fileIds)) fail('invalid_params')
        const files = await filesFor(pid)
        // Keep existing deleted links when editing an unrelated field. They come
        // from the verified task, never from the iframe's claimed associations.
        if (body.fileIds.some(fid => {
          const fileId = id(fid)
          return !existingFileIds.some(existing => String(existing) === fileId) && !files.some(f => String(f.id) === fileId && !f.isFolder && !f.isDir)
        })) fail('permission_denied')
      }
      check()
      return envelope(operation === 'create'
        ? await wait(createTask({ ...body, projectId: pid }))
        : await wait(updateTask(id(params.id), body)))
    }
    if (service === 'favorites' || service === 'clipboard') {
      const isFavorite = service === 'favorites'
      need(isFavorite ? 'file_read' : 'clipboard')
      if (isFavorite && !scoped) fail('invalid_params', 'Favorites requires a project')
      const cache = isFavorite ? favorites : clipboard
      if (operation === 'list') {
        const query = typeof params.query === 'string' ? params.query.slice(0, 2000) : ''
        const result = isFavorite ? await wait(getProjectFavorites(mountedProject, query, 80)) : await wait(listClipboard(query, 80))
        const items = isFavorite ? rows(result) : Array.isArray(result) ? result : result?.items || rows(result)
        for (const item of items) cache.set((isFavorite ? String(mountedProject) + ':' : '') + String(item.id), item)
        while (cache.size > 1000) cache.delete(cache.keys().next().value)
        // Only metadata and content are transferred. Host paths, URLs with session tokens and HTML stay here.
        const safe = items.map(item => isFavorite
          ? { ...pick(item, ['id', 'title', 'content', 'sourceUrl', 'sourceHost', 'createdAt']), imagePath: item.imagePath ? 'image' : '' }
          : pick(item, ['id', 'type', 'text', 'meta', 'fileName', 'createdAt']))
        return isFavorite ? safe : { items: safe, limited: !!result?.limited, hiddenCount: Number(result?.hiddenCount) || 0 }
      }
      if (!isFavorite && operation === 'account') return await action('openAccount')
      if (!isFavorite && operation === 'purchase') {
        if (purchasing) fail('busy')
        purchasing = true
        try {
          const ok = await wait(modal({ title: t('onboarding.hint.purchaseConfirmTitle'), content: t('onboarding.hint.purchaseConfirmContent'), confirmText: t('onboarding.hint.purchaseConfirmOk') }))
          if (!ok) return { cancelled: true }
          try { await wait(purchaseFeatureSku('feature:clipboard.unlimited')) }
          catch (error) {
            check()
            if (error.reason === 'insufficient_credits') {
              if (await wait(modal({ title: t('onboarding.hint.purchaseFailed'), content: error.message || '', confirmText: t('onboarding.hint.goRecharge') }))) await action('openAccount')
              return { purchased: false }
            }
            if (error.reason !== 'already_owned') throw error
          }
          await wait(refreshEntitlements(true))
          uni.$emit('awd:wallet-refresh')
          uni.$emit('awd:entitlements-changed', { skuId: 'feature:clipboard.unlimited' })
          uni.showToast({ title: t('onboarding.hint.purchaseSuccess'), icon: 'success' })
          return { purchased: true }
        } finally { purchasing = false }
      }
      if (!['image', 'delete', 'copy', 'insert', 'open', 'preview'].includes(operation)) fail('unknown_method')
      const cacheKey = (isFavorite ? String(mountedProject) + ':' : '') + id(params.id)
      const item = cache.get(cacheKey)
      if (!item) fail('not_found', 'Refresh the collection before using this item')
      if (operation === 'image') {
        if (isFavorite ? !item.imagePath : item.type !== 'IMAGE') fail('invalid_params')
        return await image(service, item.id)
      }
      if (operation === 'delete') {
        if (isFavorite) need('file_write')
        await wait(isFavorite ? deleteFavorite(item.id) : deleteClipboardItem(item.id))
        cache.delete(cacheKey)
        uni.$emit(isFavorite ? 'awd:favorites-changed' : 'awd:clipboard-saved', { deletedId: item.id })
        return { ok: true }
      }
      if (operation === 'copy') {
        need('clipboard')
        const text = isFavorite ? item.sourceUrl || item.content || item.title : item.type === 'TEXT' ? item.text : ''
        if (!text) return { ok: false }
        return await action('copyText', String(text).trim())
      }
      if (operation === 'open' && isFavorite) {
        let url
        try { url = new URL(item.sourceUrl) } catch { fail('invalid_params') }
        if (!['http:', 'https:'].includes(url.protocol)) fail('invalid_params')
        return await action('openBrowser', item.sourceUrl)
      }
      if (operation === 'preview' && !isFavorite && item.type === 'IMAGE') return await action('previewImage', (await image(service, item.id)).dataUrl)
      if (operation === 'insert') {
        need('editor')
        const text = isFavorite ? item.content : item.type === 'TEXT' ? item.text : ''
        if ((isFavorite && item.imagePath && !String(text || '').trim()) || (!isFavorite && item.type === 'IMAGE')) {
          return await action('insertContent', { type: 'IMAGE', content: (await image(service, item.id)).dataUrl })
        }
        if (text) return await action('insertContent', { type: 'TEXT', content: text })
        return { ok: false }
      }
      fail('unknown_method')
    }
    fail('unknown_method')
  }
  return { request }
}
