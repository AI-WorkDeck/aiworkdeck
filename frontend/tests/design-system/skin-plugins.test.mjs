// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const read = f => readFileSync(resolve(root, f), 'utf8')
const themeSource = read('frontend/src/utils/appTheme.js')

const OFFICIAL_SKIN_PLUGINS = [
  { id: 'theme-inkwash-zen', themeId: 'inkwash-zen', file: 'official-plugins/theme-inkwash-zen/themes/inkwash-zen.json' },
  { id: 'theme-anime-twilight', themeId: 'anime-twilight', file: 'official-plugins/theme-anime-twilight/themes/anime-twilight.json' },
  { id: 'theme-aurora-glass', themeId: 'aurora-glass', file: 'official-plugins/theme-aurora-glass/themes/aurora-glass.json' },
]

function luminance(hex) {
  const rgb = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}

function contrast(a, b) {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test('all 3 official skin plugins declare valid manifest, i18n, and WCAG-compliant light/dark palettes', () => {
  for (const spec of OFFICIAL_SKIN_PLUGINS) {
    const manifest = JSON.parse(read(`official-plugins/${spec.id}/manifest.json`))
    assert.equal(manifest.id, spec.id)
    assert.ok(Array.isArray(manifest.contributes?.themes), `${spec.id} contributes.themes`)
    assert.equal(manifest.contributes.themes[0].id, spec.themeId)

    const zh = JSON.parse(read(`official-plugins/${spec.id}/l10n/zh-CN.json`))
    const en = JSON.parse(read(`official-plugins/${spec.id}/l10n/en-US.json`))
    assert.ok(zh['theme.name'] && en['theme.name'], `${spec.id} i18n theme.name`)

    const skin = JSON.parse(read(spec.file))
    for (const mode of ['light', 'dark']) {
      const roles = skin.roles[mode]
      assert.ok(roles, `${spec.id} missing roles.${mode}`)
      assert.ok(contrast(roles.text, roles.bg) >= 4.5, `${spec.id} ${mode} text vs bg contrast < 4.5`)
      assert.ok(contrast(roles.text, roles.surface) >= 4.5, `${spec.id} ${mode} text vs surface contrast < 4.5`)
      assert.ok(contrast(roles['text-2'], roles.surface) >= 4.5, `${spec.id} ${mode} text-2 vs surface contrast < 4.5`)
      assert.ok(contrast(roles['border-strong'], roles.surface) >= 3.0, `${spec.id} ${mode} border-strong vs surface contrast < 3.0`)
      assert.ok(contrast(roles.accent, roles.surface) >= 3.0, `${spec.id} ${mode} accent vs surface contrast < 3.0`)
    }
  }
})

test('setActiveSkin and setThemeMode apply and clear skin CSS variables on documentElement', async () => {
  const mod = await import('data:text/javascript;base64,' + Buffer.from(themeSource).toString('base64'))
  const { setActiveSkin, getActiveSkinRef, setThemeMode } = mod

  const attrs = {}
  const styles = {}
  const storage = {}
  const oldWindow = globalThis.window
  const oldDoc = globalThis.document
  const oldUni = globalThis.uni

  globalThis.uni = {
    getStorageSync: k => (k in storage ? storage[k] : ''),
    setStorageSync: (k, v) => { storage[k] = String(v) },
    removeStorageSync: k => { delete storage[k] },
    $emit() {},
  }
  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    dispatchEvent() {},
  }
  globalThis.document = {
    documentElement: {
      style: {
        colorScheme: '',
        setProperty: (k, v) => { styles[k] = v },
        removeProperty: k => { delete styles[k] },
      },
      setAttribute: (k, v) => { attrs[k] = v },
      removeAttribute: k => { delete attrs[k] },
    },
  }

  try {
    const inkwash = JSON.parse(read('official-plugins/theme-inkwash-zen/themes/inkwash-zen.json'))
    setThemeMode('light')
    setActiveSkin({
      ref: 'theme-inkwash-zen:inkwash-zen',
      lightTokens: {
        bg: inkwash.roles.light.bg,
        accent: inkwash.roles.light.accent,
      },
      darkTokens: {
        bg: inkwash.roles.dark.bg,
        accent: inkwash.roles.dark.accent,
      },
      fonts: inkwash.fonts,
      effects: inkwash.effects,
    })

    assert.equal(getActiveSkinRef(), 'theme-inkwash-zen:inkwash-zen')
    assert.equal(attrs['data-skin'], 'theme-inkwash-zen:inkwash-zen')
    assert.equal(attrs['data-skin-pulse'], 'ink-ripple')
    assert.equal(attrs['data-skin-texture'], 'xuan-paper')
    assert.equal(styles['--awd-bg'], '#F4F1EA')
    assert.equal(styles['--awd-accent'], '#5B4B7A')
    assert.ok(styles['--awd-font-serif'].includes('Source Han Serif SC'))

    // Switch to dark mode -> skin dark variables should automatically apply
    setThemeMode('dark')
    assert.equal(styles['--awd-bg'], '#141312')
    assert.equal(styles['--awd-accent'], '#7E6BA3')

    // Reset to default skin -> inline overrides and data-skin attributes are cleared
    setActiveSkin(null)
    assert.equal(getActiveSkinRef(), '')
    assert.equal(attrs['data-skin'], undefined)
    assert.equal(attrs['data-skin-pulse'], undefined)
    assert.equal(styles['--awd-bg'], undefined)
    assert.equal(styles['--awd-font-serif'], undefined)
  } finally {
    globalThis.window = oldWindow
    globalThis.document = oldDoc
    globalThis.uni = oldUni
  }
})
