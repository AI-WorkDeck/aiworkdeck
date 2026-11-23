#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Second half of brand.json bundledPlugins (the first is apply.mjs): put each listed plugin into the shape of a
// marketplace package inside official-plugins/<id>, so packaging ships it as is — web/awd-plugin-sdk.js from
// sdk/plugin-sdk and the manifest's backendJars built from <id>/backend (needs backend/plugin-api installed).
//
//   node scripts/brand/stage-bundled-plugins.mjs --brand <id> [--root <tree>]

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadBrand } from './apply.mjs'

export function stageBundledPlugins({ root, bundled, build = (pom) => execSync(`mvn -B -q -DskipTests -f "${pom}" package`, { stdio: 'inherit' }), log = console.log }) {
  for (const id of bundled) {
    const dir = path.join(root, 'official-plugins', id)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    if (fs.existsSync(path.join(dir, 'web'))) fs.copyFileSync(path.join(root, 'sdk/plugin-sdk/awd-plugin-sdk.js'), path.join(dir, 'web/awd-plugin-sdk.js'))
    const jars = manifest.backendJars || []
    if (jars.length) build(path.join(dir, 'backend/pom.xml'))
    for (const jar of jars) {
      const built = path.join(dir, 'backend/target', path.basename(jar))
      if (!fs.existsSync(built)) throw new Error(`${id}: ${jar} was not built`)
      fs.copyFileSync(built, path.join(dir, jar))
    }
    log(`staged ${id} ${manifest.version} (${jars.length} jar)`)
  }
}

if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
  const root = path.resolve(arg('--root') || path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'))
  const { brand } = loadBrand(arg('--brand') || 'aiworkdeck', path.join(root, 'brands'))
  try { stageBundledPlugins({ root, bundled: brand.bundledPlugins || [] }) }
  catch (e) { console.error(e.message); process.exit(1) }
}
