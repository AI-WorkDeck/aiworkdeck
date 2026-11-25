// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D7 guard, run after `npm run build:h5`: the built app must not pull anything from a
// remote host by itself — no remote url() in CSS, no remote <script>/<link> in index.html.
// Remote fetches that a user triggers on purpose live in JS and are covered by PRIVACY.md.
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] || 'dist/build/h5')
const REMOTE = /https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org)[a-z0-9.-]+/gi
const problems = []
const REMOTE_CODE = [
  /\.src\s*=\s*["'`](https?:\/\/[^"'`]+)["'`]/g,
  /import\(\s*["'`](https?:\/\/[^"'`]+)["'`]/g,
  /new (?:Shared)?Worker\(\s*["'`](https?:\/\/[^"'`]+)["'`]/g,
  /paths\s*:\s*\{[^}]{0,80}?["'`](https?:\/\/[^"'`]+)["'`]/g,
]
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (p.endsWith('.js')) {
      // D24: remote *code* loading from JS — a script/worker/module pulled from a CDN at runtime.
      const js = fs.readFileSync(p, 'utf8')
      for (const re of REMOTE_CODE) for (const m of js.matchAll(re)) problems.push(`${path.relative(root, p)}: ${m[0].slice(0, 120)}`)
    }
    else if (p.endsWith('.css')) {
      const css = fs.readFileSync(p, 'utf8')
      for (const m of css.matchAll(/url\(\s*["']?(https?:\/\/[^)"']+)/gi)) if (REMOTE.test(m[1])) problems.push(`${path.relative(root, p)}: url(${m[1]})`), REMOTE.lastIndex = 0
    }
  }
}
if (!fs.existsSync(root)) { console.error(`check-dist-egress: ${root} not found; build first`); process.exit(2) }
walk(root)
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["'](https?:\/\/[^"']+)/gi)) problems.push(`index.html: ${m[1]}`)
if (problems.length) {
  console.error('Remote resources fetched by the built app on its own (D7/D24, legal/PRIVACY.md):\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log('Dist egress check passed: no remote CSS url() or remote <script>/<link> in ' + path.relative(process.cwd(), root))
