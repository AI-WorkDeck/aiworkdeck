// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { request } from '../adapters/bridge.js'
export const perform = (operation, params = {}, options) => request('clipboard', operation, params, options)
export const subscribe = callback => window.awd.events.on('clipboard.changed', callback)
export const listClipboard = query => perform('list', { query })
export const deleteClipboardItem = id => perform('delete', { id })
