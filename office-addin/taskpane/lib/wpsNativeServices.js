// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from './i18n.js'

// FileSystem/Env belong to the add-in JS root, not WpsApplication's document model.
// Official: /jsapi/addin-api/Application/obj (Application and wps are aliases).
export function wpsNativeServices() {
  for (const getRoot of [() => globalThis.Application, () => globalThis.wps]) {
    try {
      const root = getRoot()
      if (root?.FileSystem && root?.Env) return { fileSystem: root.FileSystem, environment: root.Env }
    } catch (_) { /* Try the documented alias when one root is unavailable. */ }
  }
  return { fileSystem: null, environment: null }
}

export function secureWpsFileId() {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') {
    const id = crypto.randomUUID()
    if (/^[0-9a-f-]{32,36}$/i.test(id)) return id
  }
  if (typeof crypto?.getRandomValues !== 'function') throw new Error(t('fileOperationUnavailable'))
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function createWpsTemporaryPath(services, extension) {
  const fail = () => { throw new Error(t('fileOperationUnavailable')) }
  const { fileSystem: fs, environment } = services || {}
  if (!/^[a-z0-9]{1,8}$/.test(extension) || typeof fs?.Exists !== 'function'
      || typeof environment?.GetTempPath !== 'function') fail()
  const folder = environment.GetTempPath()
  if (!folder) fail()
  const name = secureWpsFileId()
  const path = String(folder).replace(/[\\/]?$/, '/') + 'aiworkdeck-' + name + '.' + extension
  if (fs.Exists(path) !== false) fail()
  return path
}
