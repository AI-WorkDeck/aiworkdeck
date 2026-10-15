// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function readSrc(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8')
}

test('AdminPane registers PersonalCaseIntakePanel and exposes case_intake nav tab', () => {
  const adminPane = readSrc('src/components/admin/AdminPane.vue')
  assert.match(adminPane, /PersonalCaseIntakePanel/)
  assert.match(adminPane, /key:\s*'case_intake'/)
  assert.match(adminPane, /account\.tabCaseIntake/)
})

test('PersonalCaseIntakePanel supports intake, conflict clearance, committee review, invoice issue, and finance ledger', () => {
  const panel = readSrc('src/components/userprofile/PersonalCaseIntakePanel.vue')
  assert.match(panel, /conflictPreview/)
  assert.match(panel, /submitIntake/)
  assert.match(panel, /respondClearance/)
  assert.match(panel, /committeeReview/)
  assert.match(panel, /submitInvoice/)
  assert.match(panel, /issueInvoice/)
  assert.match(panel, /buyerName/)
  assert.match(panel, /buyerTaxId/)
  assert.match(panel, /DIGITAL_NORMAL/)
  assert.match(panel, /recordCollection/)
  assert.match(panel, /syncErp/)
  assert.match(panel, /--awd-/)
})

test('TeamPanel includes Law Firm 3D decision-maker dashboard and 6 KPI cards', () => {
  const teamPanel = readSrc('src/components/admin/TeamPanel.vue')
  assert.match(teamPanel, /getLawFirmOverview/)
  assert.match(teamPanel, /requestLawFirmAction/)
  assert.match(teamPanel, /ensureLawFirmPlugin/)
  assert.match(teamPanel, /departments/)
  assert.match(teamPanel, /teamLeads/)
  assert.match(teamPanel, /units/)
  assert.match(teamPanel, /lawfirmKpiActiveMatters/)
  assert.match(teamPanel, /lawfirmKpiPendingClearances/)
  assert.match(teamPanel, /lawfirmKpiContracted/)
  assert.match(teamPanel, /lawfirmKpiBilled/)
  assert.match(teamPanel, /lawfirmKpiCollected/)
  assert.match(teamPanel, /lawfirmKpiCollectionRate/)
})

test('PluginPane, PluginWorkspaceSummary, icons.js, and project-overview wire lawfirm-management integration', () => {
  const icons = readSrc('src/config/icons.js')
  assert.match(icons, /lawfirm:\s*\[/)
  assert.match(icons, /im:\s*\[/)
  assert.match(icons, /baoqingtian:\s*\[/)

  const summary = readSrc('src/components/PluginWorkspaceSummary.vue')
  assert.match(summary, /lawfirm-management/)
  assert.match(summary, /getLawFirmOverview/)
  assert.match(summary, /awd:lawfirm-tab/)

  const pluginPane = readSrc('src/components/PluginPane.vue')
  assert.match(pluginPane, /case\s+'lawfirm\.request'/)
  assert.match(pluginPane, /lawfirm\.navigate/)

  const overview = readSrc('src/pages/project-overview/project-overview.vue')
  assert.match(overview, /awd:open-lawfirm-plugin/)
  assert.match(overview, /handleOpenLawFirmPlugin/)
  assert.match(overview, /lawfirm-management/)
})

test('zh-CN and en-US account and team locales have parity for lawfirm keys', async () => {
  const zhAccount = (await import(path.join(rootDir, 'src/locales/zh-CN/account.js'))).default
  const enAccount = (await import(path.join(rootDir, 'src/locales/en-US/account.js'))).default
  const zhTeam = (await import(path.join(rootDir, 'src/locales/zh-CN/team.js'))).default
  const enTeam = (await import(path.join(rootDir, 'src/locales/en-US/team.js'))).default

  assert.equal(typeof zhAccount.tabCaseIntake, 'string')
  assert.equal(typeof enAccount.tabCaseIntake, 'string')
  assert.equal(typeof zhAccount.caseIssueInvoiceBtn, 'string')
  assert.equal(typeof enAccount.caseIssueInvoiceBtn, 'string')
  assert.equal(typeof zhTeam.lawfirmDashboardTitle, 'string')
  assert.equal(typeof enTeam.lawfirmDashboardTitle, 'string')
  assert.deepEqual(Object.keys(zhAccount).sort(), Object.keys(enAccount).sort())
  assert.deepEqual(Object.keys(zhTeam).sort(), Object.keys(enTeam).sort())
})
