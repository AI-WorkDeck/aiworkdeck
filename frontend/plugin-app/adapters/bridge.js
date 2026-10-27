// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Vue reactive arrays/objects cannot be structured-cloned by postMessage. Copy
// data, preserving binary values; never serialize AbortSignal from call options.
export function plain(value) {
  if (value == null || typeof value !== 'object') return value
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) return value
  if (Array.isArray(value)) return value.map(plain)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plain(child)]))
}
export const request = (service, operation, params = {}, options) => window.awd.services.request(service, operation, plain(params), options)
