// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/utils/externalLink.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replaceAll('export function', 'function').replaceAll('export async function', 'async function')
function opener(host = {}, window = {}) {
  return new Function('host', 'window', source + '\nreturn typeof openExternalUrlChecked === "function" ? openExternalUrlChecked : openExternalUrl')(host, window)
}
test('checked checkout/OAuth opening rejects blocked browser windows', async () => {
  await assert.rejects(Promise.resolve().then(() => opener({}, { open: () => null })('https://service.example/plans')), /blocked|阻止/)
})
test('checked opening waits for Electron and propagates its failure', async () => {
  let finish; const pending = new Promise(resolve => { finish = resolve })
  let finished = false
  const request = opener({ shell: { openExternal: () => pending } })('https://service.example/authorize').then(() => { finished = true })
  await new Promise(r => setImmediate(r)); assert.equal(finished, false)
  finish(); await request; assert.equal(finished, true)
  await assert.rejects(opener({ shell: { openExternal: async () => { throw Error('no browser') } } })('https://service.example/plans'), /no browser/)
})
test('checked opening refuses credential URLs and non-HTTPS schemes', async () => {
  let opened = 0; const open = opener({}, { open: () => { opened++; return {} } })
  for (const url of ['https://user:secret@service.example', 'javascript:alert(1)', 'http://service.example']) await assert.rejects(Promise.resolve().then(() => open(url)))
  assert.equal(opened, 0)
})
test('checked opening rejects Electron IPC structured failure result', async () => {
  await assert.rejects(opener({ shell: { openExternal: async () => ({ ok: false, message: 'system rejected browser' }) } })('https://service.example/plans'), /system rejected browser/)
})
test('successful browser opening detaches opener before navigating', async () => {
  const states = []
  const tab = { opener: {}, location: { replace(url) { states.push({ url, opener: tab.opener }) } } }
  await opener({}, { open: () => tab })('https://service.example/plans')
  assert.deepEqual(states, [{ url: 'https://service.example/plans', opener: null }])
})
