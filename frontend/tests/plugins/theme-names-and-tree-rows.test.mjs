// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D20: theme skins have plain colour names (no third-party director / film / anime names in a
// lawyer product); plugin name == theme name. D19: explorer rows are not zebra-striped.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('../../../official-plugins/', import.meta.url)
const THEMES = ['theme-anime-twilight', 'theme-aurora-glass', 'theme-inkwash-zen']
const BANNED = /shinkai|kataware|anime|新海|逢魔|日漫|アニメ|애니|аниме|أنمي|एनीमे/i

test('theme names and descriptions name colours only, in every locale', () => {
  for (const t of THEMES) {
    const dir = new URL(t + '/l10n/', root)
    const locales = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    assert.equal(locales.length, 20, t)
    for (const f of locales) {
      const j = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'))
      for (const k of ['plugin.name', 'plugin.desc', 'theme.name', 'theme.desc']) {
        assert.ok(j[k], `${t}/${f} ${k}`)
        assert.doesNotMatch(j[k], BANNED, `${t}/${f} ${k}: ${j[k]}`)
      }
      assert.equal(j['plugin.name'], j['theme.name'], `${t}/${f}: plugin and theme names differ`)
    }
    const gallery = fs.readFileSync(new URL(t + '/web/gallery-l10n.js', root), 'utf8')
    assert.doesNotMatch(gallery, BANNED, `${t}: gallery-l10n.js is stale (run scripts/sync-theme-assets.mjs)`)
  }
})

test('explorer rows have no alternating background', () => {
  const tree = fs.readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(tree, /\.tree-item:nth-child\((odd|even)\)/)
  assert.match(tree, /\.tree-item:hover \{\s*background-color: var\(--awd-panel-hover\);/)
})
