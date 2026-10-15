// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { getPluginAvatarUrl, getPluginGlyphPaths, getPluginRailSvgPaths } from '../../src/config/pluginIcons.js'

test('baoqingtian uses character avatar while project-im, due-diligence, tencent-meeting have distinct SVG glyphs', () => {
  assert.equal(getPluginAvatarUrl('baoqingtian'), '/static/icons/plugin-baoqingtian.png')
  assert.equal(getPluginAvatarUrl('plugin-baoqingtian'), '/static/icons/plugin-baoqingtian.png')
  assert.equal(getPluginAvatarUrl('project-im'), null)

  const imPaths = getPluginGlyphPaths('project-im')
  const ddPaths = getPluginGlyphPaths('due-diligence')
  const tmPaths = getPluginGlyphPaths('tencent-meeting')
  const defaultPaths = getPluginGlyphPaths('unknown-third-party-plugin')

  assert.ok(imPaths.length > 0 && ddPaths.length > 0 && tmPaths.length > 0)
  assert.notDeepEqual(imPaths, ddPaths, 'project-im and due-diligence must not share identical icon paths')
  assert.notDeepEqual(imPaths, defaultPaths, 'project-im must not fall back to default puzzle icon')
  assert.notDeepEqual(ddPaths, defaultPaths, 'due-diligence must not fall back to default puzzle icon')
  assert.notDeepEqual(tmPaths, defaultPaths, 'tencent-meeting must not fall back to default puzzle icon')
  assert.equal(getPluginRailSvgPaths('project-im').length, imPaths.length)
})
