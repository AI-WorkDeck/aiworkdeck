// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '../..')

test('Settings About links to the contributor directory on the active website', async () => {
  const source = fs.readFileSync(path.join(root, 'src/components/admin/AdminPane.vue'), 'utf8')
  assert.match(source, /\$t\('admin\.legalContributors'\)/)
  assert.match(source, /openExternalUrl\(`\$\{siteBaseUrl\(\)\}\/contributors`\)/)
  const locales = fs.readdirSync(path.join(root, 'src/locales'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  for (const locale of locales) {
    const moduleUrl = pathToFileURL(path.join(root, 'src/locales', locale, 'admin.js')).href
    const dictionary = (await import(moduleUrl)).default
    assert.equal(typeof dictionary.legalContributors, 'string', locale)
    assert.ok(dictionary.legalContributors.trim(), locale)
  }
})
