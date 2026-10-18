// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/config/leftSidebarPlugins.js', import.meta.url), 'utf8')
const body = source.replace(/^import .*$/gm, '').replace(/^export /gm, '')
  + '\nreturn { LEFT_SIDEBAR_PLUGINS, filterPluginsByEnabledSkills, isPanelSkill, migrateLeftPaneKey }'
const { LEFT_SIDEBAR_PLUGINS, filterPluginsByEnabledSkills, isPanelSkill, migrateLeftPaneKey } = new Function('t', body)(key => key)

test('Tencent Meeting has one installed-plugin entry instead of a duplicate skill-owned sidebar', () => {
  assert.equal(LEFT_SIDEBAR_PLUGINS.some(plugin => plugin.key === 'tmeet'), false)
  for (const skills of [new Set(['tencent-meeting']), new Set()]) {
    assert.equal(filterPluginsByEnabledSkills(LEFT_SIDEBAR_PLUGINS, skills).some(plugin => plugin.key === 'tmeet'), false)
  }
  assert.equal(isPanelSkill('tencent-meeting'), false)
})

test('stored Tencent Meeting pane selection migrates to its real plugin identity', () => {
  assert.equal(migrateLeftPaneKey('tmeet'), 'plugin-tencent-meeting')
  assert.equal(migrateLeftPaneKey('plugin-tencent-meeting'), 'plugin-tencent-meeting')
})

test('the installed Tencent Meeting package provides the view, tool and skill', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../official-plugins/tencent-meeting/manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.id, 'tencent-meeting')
  assert.equal(manifest.frontendEntry, 'web/index.html')
  assert.ok(manifest.tools.some(tool => tool.name === 'tencent_meeting_action'))
  assert.ok(manifest.skills.includes('skill'))
})
