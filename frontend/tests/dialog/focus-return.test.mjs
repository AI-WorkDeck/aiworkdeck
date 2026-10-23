// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/AwdDialog.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm, '').replace('export default', 'return')

test('dialog returns abandoned focus, but does not steal from a newly opened menu', async () => {
  const options = new Function(body)()
  let returned = 0
  const previous = { isConnected: true, focus: () => returned++ }
  const documentBody = { closest: () => null }
  globalThis.window = { removeEventListener() {} }
  globalThis.document = { body: documentBody, activeElement: documentBody, removeEventListener() {} }
  try {
    options.beforeUnmount.call({ restoreFocusTo: previous })
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(returned, 1)
    document.activeElement = { closest: () => null } // New menuitem owns focus.
    options.beforeUnmount.call({ restoreFocusTo: previous })
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(returned, 1)
  } finally { delete globalThis.window; delete globalThis.document }
})
