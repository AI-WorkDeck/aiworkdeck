// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1869 (lane C's C32 freeze runs, 11-28): with the local backend frozen, the lawyer got two messages
// for one cause - the 交稿 toast and the history pane's own 「读取失败」 toast (one toast slot: the panel's
// could overwrite the 交稿 one) - and the pane kept a generic 「版本记录读取失败」 after the service came back.
// When the pane fails only because the local service is unreachable it stays quiet, names the real cause
// inline, and reloads itself when the service is back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/version/VersionPanel.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>'))
const body = script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'return')
const ready = { data: { enabled: true, working: false, changedCount: 0 } }
const dead = () => Object.assign(new Error('request:fail'), { errMsg: 'request:fail' })

function setup(getStatus) {
  const toasts = []
  const options = new Function('getVersionStatus', 'shouldAcceptResponse', 'checkCloud', 'uni', 'setTimeout',
    'WorkSessionBar', 'VersionTimeline', 'DraftList', 'AdoptConflictDialog', 'CloudSyncBar', body)(
    getStatus, (seq, latest) => seq === latest, async () => ({ data: {} }),
    { showToast: (o) => toasts.push(o.title) }, (fn) => fn(), {}, {}, {}, {}, {})
  const vm = { ...options.data(), projectId: 7, $t: (key) => key, $emit() {} }
  for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
  vm.fetchDrafts = async () => {}
  vm.fetchCloudState = async () => {}
  return { vm, options, toasts }
}

test('a dead local service: the pane shows its error state but adds no second toast', async () => {
  const { vm, toasts } = setup(async () => { throw dead() })
  await vm.refresh()
  assert.equal(vm.loadError, true)
  assert.equal(vm.loadErrorLocal, true)
  assert.deepEqual(toasts, [], 'the status bar and the action already said it; one cause, one message')
})

test('any other read failure still toasts as before', async () => {
  const { vm, toasts } = setup(async () => { throw new Error('数据库读取异常') })
  await vm.refresh()
  assert.equal(vm.loadError, true)
  assert.equal(vm.loadErrorLocal, false)
  assert.deepEqual(toasts, ['version.loadFailedToast'])
})

test('when the local service is back the pane reloads itself', async () => {
  let up = false
  const { vm } = setup(async () => { if (!up) throw dead(); return ready })
  await vm.refresh()
  assert.equal(vm.loadError, true)
  up = true
  await vm.onLocalServiceRecovered()
  assert.equal(vm.loadError, false)
  assert.equal(vm.enabled, true)
})

test('the inline error names the local service, and the pane listens for its recovery', () => {
  assert.match(source, /loadErrorLocal \? \$t\('errors\.localServiceDown'\) : \$t\('version\.loadFailedDesc'\)/)
  assert.match(source, /addEventListener\('awd:local-service-recovered', this\.onLocalServiceRecovered\)/)
  assert.match(source, /removeEventListener\('awd:local-service-recovered', this\.onLocalServiceRecovered\)/)
})
