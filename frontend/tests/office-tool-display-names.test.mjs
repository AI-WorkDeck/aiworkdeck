// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../src/utils/toolDisplayNames.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/export function /g, 'function ')
const tools = ["office_ppt_add_image", "office_ppt_add_chart", "office_ppt_format_chart", "office_ppt_set_transition", "office_file_create", "office_file_save", "office_file_export_pdf", "office_file_open", "office_ppt_goto", "office_ppt_set_layout", 'office_get_paragraphs', 'office_get_outline', 'office_get_clauses', 'office_replace_nth_match',
  'office_audit_structure', 'office_apply_style_profile', 'office_ppt_table_set_style', 'office_ppt_read_notes', 'office_ppt_write_notes']
const root = new URL('../src/locales/', import.meta.url)
for (const locale of readdirSync(root).filter(name => name.includes('-'))) test(`${locale}: new Office tools use localized name tokens`, async () => {
  const { default: editor } = await import(new URL(locale + '/editor.js', root))
  const realm = vm.createContext({ isEnglish: () => false, t: key => editor.officeToolNames[key.split('.').at(-1)] })
  vm.runInContext(source, realm)
  const addin = await import(new URL('../../office-addin/taskpane/locales/' + locale + '.js', import.meta.url))
  const labels = Object.values(addin).find(value => value && typeof value === 'object')
  const commandKeys = {office_ppt_add_image:'cmdPptAddImage',office_ppt_add_chart:'cmdPptAddChart',office_ppt_format_chart:'cmdPptFormatChart',office_ppt_set_transition:'cmdPptSetTransition'}
  for (const tool of tools) {
    if (commandKeys[tool]) assert.equal(labels[commandKeys[tool]], editor.officeToolNames[tool])
    assert.ok(editor.officeToolNames[tool])
    assert.equal(realm.toolDisplayName(tool + '({})'), editor.officeToolNames[tool])
    assert.notEqual(realm.toolDisplayName(tool), tool)
  }
})
