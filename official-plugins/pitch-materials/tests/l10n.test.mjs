// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../l10n/', import.meta.url)
const LOCALES = ['ar-SA', 'de-DE', 'el-GR', 'en-US', 'es-ES', 'fr-FR', 'hi-IN', 'id-ID', 'it-IT', 'ja-JP', 'ko-KR', 'ms-MY', 'nl-NL', 'pt-BR', 'ru-RU', 'th-TH', 'tr-TR', 'vi-VN', 'zh-CN', 'zh-TW']
const load = (name) => JSON.parse(readFileSync(new URL(name + '.json', dir), 'utf8'))
const zh = load('zh-CN')
const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',')

test('all 20 locales exist with the same keys and placeholders as zh-CN', () => {
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort(), LOCALES)
  for (const loc of LOCALES) {
    const d = load(loc)
    assert.deepEqual(Object.keys(d).sort(), Object.keys(zh).sort(), loc)
    for (const k of Object.keys(zh)) {
      assert.equal(vars(d[k]), vars(zh[k]), loc + ' ' + k)
      assert.ok(String(d[k]).trim(), loc + ' ' + k)
    }
  }
})

test('every key the panel uses is defined, including dynamic families', () => {
  const src = readFileSync(new URL('../web/panel.js', import.meta.url), 'utf8') + readFileSync(new URL('../web/pitch-core.js', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8')
  const used = new Set([...src.matchAll(/t\('(panel\.[\w.]+[\w])'/g)].map((m) => m[1]).concat([...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1])))
  const dynamic = {
    'panel.section.': ['credentials', 'lawyers', 'qualifications', 'services', 'quotes'],
    'panel.lib.empty.': ['credentials', 'lawyers', 'qualifications', 'services', 'quotes'],
    'panel.status.': ['pending', 'met', 'partial', 'missing', 'na'],
    'panel.kind.': ['qualification', 'scoring'],
    'panel.quote.kind.': ['fixed', 'hourly'],
    'panel.quote.col.': ['item', 'basis', 'amount'],
    'panel.col.': ['no', 'kind', 'requirement', 'score', 'status', 'evidence', 'gap', 'note', 'source'],
    'panel.err.': ['not_signed_in', 'no_project', 'bad_params', 'bad_action', 'bad_library', 'library_too_large', 'matrix_too_large', 'quote_missing',
      'quote_rate_missing', 'quote_empty', 'bad_amount', 'template_missing', 'template_kind', 'template_too_large', 'template_invalid', 'item_missing', 'quota', 'permission', 'failed']
  }
  for (const [prefix, names] of Object.entries(dynamic)) names.forEach((n) => used.add(prefix + n))
  const fields = { credentials: ['title', 'client', 'clientAlias', 'area', 'year', 'amount', 'role', 'lawyers', 'tags', 'summary'],
    lawyers: ['name', 'title', 'areas', 'since', 'education', 'bio'], qualifications: ['name', 'kind', 'issuer', 'year', 'expires'],
    services: ['title', 'area', 'content'], quotes: ['name', 'note'] }
  for (const [s, keys] of Object.entries(fields)) keys.forEach((k) => used.add('panel.field.' + s + '.' + k))
  for (const k of used) assert.ok(k in zh, 'missing ' + k)
})

test('JAR error codes all have panel messages', () => {
  const java = readFileSync(new URL('../backend/src/main/java/com/aiworkdeck/plugins/pitch/PitchTools.java', import.meta.url), 'utf8')
    + readFileSync(new URL('../backend/src/main/java/com/aiworkdeck/plugins/pitch/Quote.java', import.meta.url), 'utf8')
    + readFileSync(new URL('../backend/src/main/java/com/aiworkdeck/plugins/pitch/Ooxml.java', import.meta.url), 'utf8')
  const codes = new Set([...java.matchAll(/Failure\("([a-z_]+)"/g)].map((m) => m[1]).concat([...java.matchAll(/error\("([a-z_]+)"/g)].map((m) => m[1])))
  for (const c of codes) assert.ok(('panel.err.' + c) in zh, c)
})

test('generated panel-l10n.js matches the l10n files', () => {
  const js = readFileSync(new URL('../web/panel-l10n.js', import.meta.url), 'utf8')
  const data = JSON.parse(js.slice(js.indexOf('=') + 1).trim().replace(/;$/, ''))
  for (const loc of LOCALES) {
    const want = Object.fromEntries(Object.entries(load(loc)).filter(([k]) => k.startsWith('panel.')))
    assert.deepEqual(data[loc], want, loc)
  }
})
