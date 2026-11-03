// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// uni-h5-vue 3.4 calls shared.def with three arguments. shared 3.5 explicitly
// defaults writable to false; updateSlots must still be able to assign slots._.
// Keep the security-updated shared dependency and mark only this flag writable.
// If upstream changes this anchor, review its slot lifecycle before removing
// or updating this compatibility patch (dev-board#1679).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultDist = path.join(here, '..', 'node_modules', '@dcloudio', 'uni-h5-vue', 'dist')

export function patchUniH5Slots(distDir = defaultDist) {
  // Validate both files before writing either, including already-patched files.
  const edits = ['vue.runtime.esm.js', 'vue.runtime.cjs.js'].map(name => {
    const file = path.join(distDir, name)
    const source = fs.readFileSync(file, 'utf8')
    const prefix = name.endsWith('.cjs.js') ? 'shared.' : ''
    const before = `${prefix}def(children, "_", type);`
    const after = `${prefix}def(children, "_", type, true);`
    const count = text => source.split(text).length - 1
    if (count(before) + count(after) !== 1) {
      throw new Error(`[patch-uni-h5-slots] ${name}: expected one slot flag anchor; review upstream changes`)
    }
    return { file, source, patched: source.replace(before, after) }
  })
  for (const { file, source, patched } of edits) {
    if (source !== patched) fs.writeFileSync(file, patched)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  patchUniH5Slots()
}
