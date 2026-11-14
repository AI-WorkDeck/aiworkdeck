// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 插件名与工作台（左栏/插件广场标签 workbench.pluginLabels.projectIm）同一叫法，避免同一功能两种译名。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const repo = new URL('../../../', import.meta.url)

test('plugin name in every locale matches the workbench label', () => {
  for (const file of readdirSync(new URL('l10n/', root)).filter((n) => n.endsWith('.json'))) {
    const locale = file.slice(0, -5)
    const name = JSON.parse(readFileSync(new URL('l10n/' + file, root), 'utf8'))['plugin.name']
    const workbench = readFileSync(new URL(`frontend/src/locales/${locale}/workbench.js`, repo), 'utf8')
    const m = workbench.match(/projectIm["']?\s*:\s*(["'])(.*?)\1/)
    assert.ok(m, locale + ': workbench label missing')
    assert.equal(name, m[2], locale)
  }
})

test('the panel English copy uses the same name', () => {
  const panel = readFileSync(new URL('web/panel.js', root), 'utf8')
  assert.ok(!panel.includes('Project Messaging'))
  assert.ok(panel.includes('Project Chat'))
})

test('the Chinese name is 项目沟通 everywhere (manifest, plugin l10n, workbench)', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))
  assert.equal(manifest.name, '项目沟通')
  assert.equal(JSON.parse(readFileSync(new URL('l10n/zh-CN.json', root), 'utf8'))['plugin.name'], '项目沟通')
})

test('the host English fallback uses the same English name', () => {
  const host = readFileSync(new URL('backend/src/main/java/com/checkba/service/ai/PluginService.java', repo), 'utf8')
  const block = host.slice(host.indexOf('Map.entry("project-im", Map.ofEntries('))
  const m = block.match(/Map\.entry\("plugin\.name", "([^"]*)"\)/)
  const en = JSON.parse(readFileSync(new URL('l10n/en-US.json', root), 'utf8'))['plugin.name']
  assert.equal(m[1], en)
  assert.ok(!block.slice(0, 600).includes('Project Messaging'))
})
