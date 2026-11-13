// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 「工作记录 › 计费工时」（WorkLogTimeEntries.vue）：工作记录生成草稿工时、补录、提交审核，
// 以及把合伙人的审核结论（退回、核减、不收费）回显给律师。抽真实 <script> 执行，接口打桩。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const SRC = read('../../src/components/userprofile/WorkLogTimeEntries.vue')
const PANEL = read('../../src/components/userprofile/PersonalWorkLogPanel.vue')

function makeVm(api) {
  const script = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
  const body = script.replace(/^import[^\n]*\n/gm, '').replace('export default', 'return')
  // eslint-disable-next-line no-new-func
  const component = new Function('requestLawFirmAction', 'AwdSelect', body)(api, {})
  const vm = { $t: (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k), from: '2026-11-01', to: '2026-11-30' }
  Object.assign(vm, component.data.call(vm))
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  for (const [name, fn] of Object.entries(component.computed)) Object.defineProperty(vm, name, { get: fn.bind(vm) })
  return vm
}

test('every $t key used by the time-entry view exists in zh-CN and en-US', async () => {
  const zh = (await import('../../src/locales/zh-CN/account.js')).default
  const en = (await import('../../src/locales/en-US/account.js')).default
  const keys = new Set([...SRC.matchAll(/\$t\('account\.([A-Za-z]+)'/g), ...PANEL.matchAll(/\$t\('account\.(workLogView[A-Za-z]+)'/g)].map((m) => m[1]))
  for (const m of SRC.matchAll(/'(te[A-Z][A-Za-z]+)'/g)) keys.add(m[1])
  assert.ok(keys.size > 30)
  for (const k of keys) {
    assert.ok(zh[k], `zh-CN account.${k}`)
    assert.ok(en[k], `en-US account.${k}`)
  }
})

test('panel switches between activity and billable time on the same date range', () => {
  assert.match(PANEL, /<WorkLogTimeEntries v-if="view === 'time'" :from="activityFilter.from" :to="activityFilter.to" \/>/)
  assert.match(PANEL, /view: 'activity'/)
})

test('hours are shown without float noise and source/review notes are explained', () => {
  const vm = makeVm(async () => ({}))
  assert.equal(vm.hours(48), '0.8')
  assert.equal(vm.hours(20), '0.33')
  assert.equal(vm.hours(90), '1.5')
  assert.equal(vm.hours(0), '0')
  assert.match(vm.sourceText({ source: 'WORK_RECORD', capturedMinutes: 66 }), /teSourceWorkLog.*"1.1"/)
  const notes = vm.reviewNotes({ audit: [
    { action: 'SUBMIT', actorName: '陈' },
    { action: 'WRITE_DOWN', actorName: '林', reason: '行政性工作', detail: { billedMinutes: { from: 60, to: 30 } } },
    { action: 'RETURN', actorName: '林', reason: '描述笼统' },
    { action: 'NO_CHARGE', actorName: '林' },
  ] })
  assert.equal(notes.length, 3, 'submit is not a review note')
  assert.match(notes[0], /teNoteWrittenDown.*"0.5".*teReasonSuffix.*行政性工作/)
  assert.match(notes[1], /teNoteReturned.*描述笼统/)
})

test('import uses the panel date range; submit refuses unsaved edits and sends only editable selections', async () => {
  const calls = []
  const entries = [
    { id: 1, status: 'DRAFT', minutes: 48, description: '处理：a.docx', billable: true, source: 'WORK_RECORD', capturedMinutes: 48 },
    { id: 2, status: 'SUBMITTED', minutes: 60, description: 'x', billable: true, source: 'MANUAL' },
    { id: 3, status: 'RETURNED', minutes: 60, description: 'y', billable: false, source: 'MANUAL' },
  ]
  const vm = makeVm(async (action, params) => {
    calls.push({ action, params })
    if (action === 'timeSubmit') return { data: { submitted: params.ids.length } }
    return { data: { entries, targets: [{ key: 'p:5', label: '甲项目' }], created: 1, updated: 0, kept: 0 } }
  })
  await vm.importFromWorkLog()
  assert.deepEqual(calls[0], { action: 'timeImport', params: { from: '2026-11-01', to: '2026-11-30' } })
  assert.match(vm.status, /teImported/)
  assert.deepEqual(vm.rows.map((r) => r.editable), [true, false, true])
  assert.equal(vm.summaryText, 'account.teSummary:{"draft":"1.8","submitted":"1","approved":"0"}')

  vm.selected = { 1: true, 2: true, 3: true }
  assert.deepEqual(vm.selectedIds, [1, 3], 'submitted entries cannot be re-submitted')
  vm.edits[1].hours = '1'
  assert.equal(vm.isDirty(vm.rows[0]), true)
  await vm.submitSelected()
  assert.equal(vm.status, 'account.teSaveFirst')
  assert.equal(calls.filter((c) => c.action === 'timeSubmit').length, 0)

  vm.edits[1].hours = '0.8'
  await vm.submitSelected()
  assert.deepEqual(calls.find((c) => c.action === 'timeSubmit').params, { ids: [1, 3] })
})

test('ledger unavailable (team server) shows the backend reason instead of an empty table', async () => {
  const vm = makeVm(async () => { throw new Error('本机收费台账仅在桌面端可用。') })
  await vm.load()
  assert.equal(vm.unavailable, '本机收费台账仅在桌面端可用。')
})

test('a draft can be pointed at a firm cloud matter; the change is saved as a target and cloud submissions are reported', async () => {
  const calls = []
  const entries = [{ id: 7, status: 'DRAFT', minutes: 60, description: 'x', billable: true, source: 'WORK_RECORD', capturedMinutes: 60, projectId: 5 }]
  const targets = [{ key: 'p:5', label: '甲项目' }, { key: 'c:11111111-2222-3333-4444-555555555555', label: '数据合规专项', clientName: '甲公司', cloud: true }]
  const vm = makeVm(async (action, params) => {
    calls.push({ action, params })
    if (action === 'timeSubmit') return { data: { submitted: 1, cloudSubmitted: 1 } }
    return { data: { entries, targets, cloud: { available: true, enabled: true } } }
  })
  await vm.load()
  assert.equal(vm.cloud.enabled, true)
  assert.equal(vm.targetLabels[1], 'account.teCloudTarget:{"title":"数据合规专项","client":"甲公司"}')
  assert.equal(vm.edits[7].target, 'p:5')
  vm.setTarget(7, 1)
  assert.equal(vm.isDirty(vm.rows[0]), true)
  await vm.saveRow(vm.rows[0])
  assert.deepEqual(calls.find((c) => c.action === 'timeSave').params,
    { id: 7, hours: '1', description: 'x', billable: true, target: 'c:11111111-2222-3333-4444-555555555555' })
  vm.selected = { 7: true }
  await vm.submitSelected()
  assert.match(vm.status, /teSubmittedCloud/)
})

test('when the firm has the cloud channel on, the notice is shown in addition to the toolbar and table, not instead of them', () => {
  const tpl = SRC.slice(SRC.indexOf('<template>'), SRC.indexOf('<script>'))
  const note = tpl.indexOf('te-cloud-note')
  const toolbar = tpl.indexOf('te-toolbar')
  assert.ok(note > 0 && toolbar > note)
  // 工具栏所在块不能挂在云端提示的 v-else 分支上（staging 实测：开启云端后补录、提交按钮整块消失）
  const between = tpl.slice(note, toolbar)
  assert.doesNotMatch(between, /<template v-else>/)
  assert.match(between, /<template v-if="!unavailable">/)
})

test('the approved total counts only billable time at the partner\'s approved hours; written-down rows show declared → approved', () => {
  const vm = makeVm(async () => ({ data: {} }))
  vm.entries = [
    { id: 1, status: 'BILLED', minutes: 150, billedMinutes: 120, billable: true, audit: [] }, // 核减 2.5 → 2
    { id: 2, status: 'APPROVED', minutes: 72, billedMinutes: 72, billable: false, audit: [] }, // 标为不收费
    { id: 3, status: 'APPROVED', minutes: 180, billedMinutes: null, billable: true, audit: [] },
    { id: 4, status: 'SUBMITTED', minutes: 60, billable: true, audit: [] },
  ]
  assert.match(vm.summaryText, /"approved":"5"/) // 2 + 3，不含不收费的 1.2 与申报多出的 0.5
  assert.match(vm.summaryText, /"submitted":"1"/)
  const rows = Object.fromEntries(vm.rows.map((r) => [r.id, r]))
  assert.equal(vm.hoursCell(rows[1]), '2.5 → 2')
  assert.equal(vm.hoursCell(rows[2]), '1.2')
  assert.equal(vm.hoursCell(rows[3]), '3')
})

test('status sits under the date so a narrow pane (AI panel open) still shows it; the table scrolls instead of clipping', () => {
  const tpl = SRC.slice(SRC.indexOf('<template>'), SRC.indexOf('<script>'))
  const row = tpl.slice(tpl.indexOf('v-for="r in rows"'))
  const dateCell = row.slice(row.indexOf('tc tc-date'), row.indexOf('tc tc-matter'))
  assert.match(dateCell, /statusText\(r\.status\)/)
  assert.doesNotMatch(tpl, /tc-status/)
  assert.match(SRC, /\.te-row \{[^}]*min-width: max-content;/)
  assert.match(SRC, /\.te-table \{[^}]*overflow-x: auto;/)
})
