// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const src = readFileSync(new URL('../../src/components/admin/LocalMcpServerToggle.vue', import.meta.url), 'utf8')
const script = src.slice(src.indexOf('<script>') + 8, src.indexOf('</script>')).replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =')
const template = src.slice(0, src.indexOf('<script>'))
const ENDPOINT = 'http://127.0.0.1:5269/mcp'
const notFound = () => Object.assign(new Error('Not Found'), { status: 404 })
async function setup({ local = true, enabled = false } = {}) {
  const copied = []
  const sandbox = {
    getLocalMcpServerStatus: async () => { if (!local) throw notFound(); return { code: 0, enabled, endpoint: ENDPOINT } },
    enableLocalMcpServer: async () => ({ code: 0, enabled: true, endpoint: ENDPOINT, token: 'awdm_secret', claudeCodeCommand: `claude mcp add --transport http aiworkdeck ${ENDPOINT} --header "Authorization: Bearer awdm_secret"` }),
    disableLocalMcpServer: async () => ({ code: 0, enabled: false }),
    copyToClipboard: text => copied.push(text)
  }
  vm.runInNewContext(script, sandbox)
  const c = sandbox.component
  const inst = { ...c.data(), $t: k => k, _alive: true }
  for (const [k, v] of Object.entries(c.methods)) inst[k] = v.bind(inst)
  Object.defineProperty(inst, 'snippets', { get: () => c.computed.snippets.call(inst) })
  await inst.load()
  return { inst, copied }
}
test('enable shows Claude Code command and Codex snippet built from the same endpoint/token', async () => {
  const { inst, copied } = await setup()
  assert.equal(inst.available, true); assert.equal(inst.enabled, false)
  await inst.enable()
  assert.equal(inst.enabled, true)
  const [claude, codex] = inst.snippets
  assert.match(claude.text, /^claude mcp add .*awdm_secret/)
  assert.ok(codex.text.includes(`url = "${ENDPOINT}"`) && codex.text.includes('Bearer awdm_secret'))
  inst.copy(codex.text); assert.deepEqual(copied, [codex.text])
})
test('disable turns status off and drops the one-time token', async () => {
  const { inst } = await setup({ enabled: true })
  assert.equal(inst.enabled, true)
  await inst.enable(); assert.ok(inst.issued)
  await inst.disable()
  assert.equal(inst.enabled, false); assert.equal(inst.issued, null); assert.equal(inst.snippets.length, 0)
})
test('non-local mode (status 404) hides the whole section', async () => {
  const { inst } = await setup({ local: false })
  assert.equal(inst.available, false)
  assert.match(template, /<section v-if="available"/)
})
test('template tokenizes copy and warns about one-time token', () => {
  assert.ok(template.includes("mcp.localWarn") && !/[一-鿿]/.test(template.split('\n').filter(l => !l.trim().startsWith('<!--')).join('\n')))
})
