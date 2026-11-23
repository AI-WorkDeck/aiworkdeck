// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// node --test scripts/brand/brand.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyBrand, genericRules, rewriteText, overrideKeys, loadBrand } from './apply.mjs'
import { scan } from './leak-check.mjs'

// Fixture licensee; real brand folders live in each licensee's private repo.
const BRANDS = fs.mkdtempSync(path.join(os.tmpdir(), 'brands-'))
fs.mkdirSync(path.join(BRANDS, 'example'))
fs.writeFileSync(path.join(BRANDS, 'example/brand.json'), JSON.stringify({
  id: 'example', name: 'Example Docs', domain: 'example.test', packageName: 'example-desktop',
  appId: 'test.example.desktop', dataDirName: '.exampledocs', supportEmail: 'support@example.test', copyright: 'x',
  replace: [{ name: 'never-present', from: 'string-that-does-not-exist', to: 'y' }],
}))
const { brand } = loadBrand('example', BRANDS)
const rw = (text) => rewriteText(text, [], genericRules(brand), {})

test('rewrites name, hosts, support email and data dir', () => {
  assert.equal(rw("title: 'AI WorkDeck 更新已就绪'"), "title: 'Example Docs 更新已就绪'")
  assert.equal(rw('Ihre AI-WorkDeck-Projekte'), 'Ihre Example Docs-Projekte')
  assert.equal(rw('https://www.aiworkdeck.com/api/registry'), 'https://www.example.test/api/registry')
  assert.equal(rw('https://addin.workdeck.ai'), 'https://addin.example.test')
  assert.equal(rw('mail hi@aiworkdeck.com'), 'mail support@example.test')
  assert.equal(rw('落盘于 ~/.aiworkdeck，可卸载'), '落盘于 ~/.exampledocs，可卸载')
  assert.equal(rw('${user.home}/.aiworkdeck/local'), '${user.home}/.exampledocs/local')
})

test('leaves AGPL attribution, partner-portal hosts and internal contracts alone', () => {
  for (const line of [
    '// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors',
    "  legalCopyright: '版权所有 2026 北京公富信息技术有限公司及 AI WorkDeck 贡献者',",
    '  "portalSourceNotice": "本服務基於開源軟體 AI WorkDeck（AGPL-3.0），原始碼：",',
    "const SOURCE_URL = 'https://github.com/AI-WorkDeck/aiworkdeck'",
    '    public static final String UA_PRODUCT = "AIWorkDeck";',
    '    private static final byte[] MAGIC = "\\0AIWorkDeck version object v1\\n".getBytes();',
    '"ai-firm.aiworkdeck.com", "aifirm.aiworkdeck.com"',
    'const MARKER = \'.aiworkdeck-complete\'',
  ]) assert.equal(rw(line), line, line)
})

test('key overrides work for quoted and unquoted locale keys', () => {
  const hits = {}
  const o = { legalTrademark: { 'zh-TW': '台', en: 'EN' } }
  assert.equal(overrideKeys('frontend/src/locales/zh-TW/admin.js', '  "legalTrademark": "x「y」",', o, hits), '  "legalTrademark": "台",')
  assert.equal(overrideKeys('frontend/src/locales/en-US/admin.js', "  legalTrademark: 'it\\'s x',", o, hits), "  legalTrademark: 'EN',")
  assert.equal(overrideKeys('frontend/src/other.js', '  legalTrademark: "x",', o, hits), '  legalTrademark: "x",')
  assert.equal(hits['keyOverrides.legalTrademark'], 2)
})

test('the default brand is a no-op', () => {
  const r = applyBrand({ id: 'aiworkdeck', root: os.tmpdir(), log: () => {}, brandsDir: path.join(import.meta.dirname, '../../brands') })
  assert.deepEqual(r.changed, [])
})

test('a rule that matches nothing fails the run (stale rules must not ship silently)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-apply-'))
  fs.mkdirSync(path.join(root, 'desktop'), { recursive: true })
  fs.writeFileSync(path.join(root, 'desktop/package.json'), JSON.stringify({ name: 'x', build: { dmg: {}, nsis: {} } }))
  assert.throws(() => applyBrand({ id: 'example', root, dryRun: true, log: () => {}, brandsDir: BRANDS }), /matched nothing/)
})

test('leak check flags the old name but allows notices and internal identifiers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-leak-'))
  fs.writeFileSync(path.join(dir, 'a.js'), 'const t = "Welcome to AI WorkDeck"')
  fs.writeFileSync(path.join(dir, 'b.js'), 'x="Copyright 2026 BEIJING GONG FU INFORMATION TECHNOLOGY LIMITED and AI WorkDeck contributors"')
  fs.writeFileSync(path.join(dir, 'c.js'), 'process.env.AIWORKDECK_DESKTOP_DEV')
  const f = scan(dir)
  assert.deepEqual(f.filter((x) => !x.allowed).map((x) => path.basename(x.file)), ['a.js'])
})
