// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export function browserSafeChunks() {
  return {
    name: 'browser-safe-chunks',
    outputOptions(options) {
      const original = options.chunkFileNames
      if (!original) return
      return {
        ...options,
        chunkFileNames(chunk) {
          const name = typeof original === 'function' ? original(chunk) : original
          // Uni flattens ../node_modules into ..-node_modules. Rollup treats that
          // leading .. as a parent path and omits ./, producing a bare browser import.
          // Preserve every other name, including the workers directory hierarchy.
          return name.replace(/(^|\/)(\.\.[^/]+)/g, '$1chunk-$2')
        },
      }
    },
  }
}
