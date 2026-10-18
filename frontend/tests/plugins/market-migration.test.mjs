// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/MarketSidebarPanel.vue', import.meta.url), 'utf8')
const start = source.indexOf('    installedRows() {') + '    installedRows() {'.length
const end = source.indexOf('\n    },', start)
const compute = new Function('isPanelSkill', 'isVoiceGroupMember', 'ICONS', 'CATEGORY_GLYPHS', 'ACTIVATION_STATE', source.slice(start, end))
test('voice has only one plugin switch; AI skills stay separate after uninstall too', () => {
  for (const plugins of [[{ id: 'voice', name: 'Voice', enabled: false }], []]) {
    const rows = compute.call({ plugins, skills: [{ id: 'text-to-speech', enabled: true }, { id: 'meeting-recorder', enabled: true }], searchText: '', $t: value => value }, () => true, id => ['text-to-speech', 'meeting-recorder'].includes(id), {}, {}, {})
    assert.equal(rows.filter(row => row.kind === 'plugin' || row.panel).length, plugins.length)
    assert.equal(rows.filter(row => row.kind === 'skill' && !row.panel).length, 2)
    assert.equal(rows.some(row => row.group), false)
  }
})
