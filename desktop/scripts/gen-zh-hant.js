// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X-S2: the Electron shell converts its Simplified strings for zh-TW with the SAME table as the
// backend (com.checkba.util.ZhHantConverter). This script derives main/zh-hant-table.json from
// that Java source so the two never drift (tests/zh-hant.test.js checks it is up to date).
//   node desktop/scripts/gen-zh-hant.js            # rewrite the table
const fs = require('fs')
const path = require('path')

const JAVA = path.join(__dirname, '..', '..', 'backend', 'src', 'main', 'java', 'com', 'checkba', 'util', 'ZhHantConverter.java')
const OUT = path.join(__dirname, '..', 'main', 'zh-hant-table.json')

/** Mirror ZhHantConverter's static initialiser: ordered phrases; pairList with put; extraPairs with putIfAbsent. */
function buildTable(javaSource) {
  const phrases = [...javaSource.matchAll(/phrases\.put\("([^"]+)",\s*"([^"]+)"\)/g)].map((m) => [m[1], m[2]])
  const chars = {}
  const pairBlock = /String\[\] pairList = \{([\s\S]*?)\};/.exec(javaSource)
  if (!pairBlock) throw new Error('pairList not found in ZhHantConverter.java')
  for (const m of pairBlock[1].matchAll(/"(.)(.)"/gu)) if (m[1] !== m[2]) chars[m[1]] = m[2]
  const extra = /String extraPairs = "([^"]*)"/.exec(javaSource)
  if (extra) {
    const s = [...extra[1]]
    for (let i = 0; i + 1 < s.length; i += 2) if (!(s[i] in chars)) chars[s[i]] = s[i + 1]
  }
  return { source: 'backend/src/main/java/com/checkba/util/ZhHantConverter.java', phrases, chars }
}

function render(table) {
  return JSON.stringify(table, null, 1) + '\n'
}

if (require.main === module) {
  fs.writeFileSync(OUT, render(buildTable(fs.readFileSync(JAVA, 'utf8'))))
  console.log('wrote', path.relative(process.cwd(), OUT))
}

module.exports = { buildTable, render, JAVA, OUT }
