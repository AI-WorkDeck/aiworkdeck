// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Venture AI 律师端: locales, the manifest contract, and the panel-only tool names the desk calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const manifest = JSON.parse(read('manifest.json'))
const LOCALES = ['ar-SA', 'de-DE', 'el-GR', 'en-US', 'es-ES', 'fr-FR', 'hi-IN', 'id-ID', 'it-IT', 'ja-JP', 'ko-KR', 'ms-MY', 'nl-NL', 'pt-BR', 'ru-RU', 'th-TH', 'tr-TR', 'vi-VN', 'zh-CN', 'zh-TW']
const load = (loc) => JSON.parse(read(`l10n/${loc}.json`))
const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',')

test('all 20 locales have the same keys and placeholders', () => {
  assert.deepEqual(readdirSync(new URL('l10n/', root)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort(), LOCALES)
  const zh = load('zh-CN')
  for (const loc of LOCALES) {
    const d = load(loc)
    assert.deepEqual(Object.keys(d).sort(), Object.keys(zh).sort(), loc)
    for (const k of Object.keys(zh)) { assert.equal(vars(d[k]), vars(zh[k]), `${loc} ${k}`); assert.ok(String(d[k]).trim(), `${loc} ${k}`) }
  }
})

test('every panel key the code uses is defined', () => {
  const zh = load('zh-CN')
  const src = ['web/matters.js', 'web/panel.js', 'web/card.js'].map(read).join('\n')
  const used = new Set([...src.matchAll(/\bt\('([\w.]+[\w])'/g)].map((m) => 'panel.m.' + m[1]).filter((k) => !k.startsWith('panel.m.panel.')))
  const missing = [...used].filter((k) => !(k in zh) && !(k.replace('panel.m.', 'panel.') in zh))
  assert.deepEqual(missing, [])
})

test('the lawyer finalises; the wording never says the lawyer signs', () => {
  for (const loc of ['zh-CN', 'zh-TW']) {
    for (const [k, v] of Object.entries(load(loc))) assert.doesNotMatch(String(v), /签署|簽署|签发|簽發/, `${loc} ${k}`)
  }
})

test('manifest: unique panel-only tools, the JAR it declares, views, connection and operation cap', () => {
  assert.equal(manifest.id, 'aifirm-partner')
  assert.deepEqual(manifest.tools.map((t) => t.name), ['aifirmPartnerPutDocx', 'aifirmPartnerReadDocx'])
  assert.ok(manifest.tools.every((t) => t.agent === false), 'tools are for the panel only, never the AI chat')
  assert.deepEqual(manifest.backendJars, [`aifirm-partner-${manifest.version}.jar`])
  const pom = read('backend/pom.xml')
  assert.ok(pom.includes(`<artifactId>aifirm-partner</artifactId><version>${manifest.version}</version>`), 'pom version = manifest version')
  const views = manifest.contributes.views
  assert.deepEqual(views.map((v) => [v.placement, v.scope]), [['workspace', 'global'], ['sidebar', 'global']])
  const conn = manifest.contributes.connections[0]
  assert.equal(conn.baseUrl, 'https://ai-firm.aiworkdeck.com')
  assert.ok(Object.keys(conn.operations).length <= 30, 'the host caps a connection at 30 operations')
  const desk = read('web/matters.js')
  for (const t of manifest.tools) assert.ok(desk.includes(`'${t.name}'`), t.name)
  const firm = read('web/firm.js')
  assert.match(firm, /"offices":\["sv","tw"\]/)
})
