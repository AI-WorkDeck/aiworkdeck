// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which JS/TS test files does CI actually run? (dev-board#1840)
// Follows every workflow run-step -> npm scripts (recursively) -> node/mocha/vitest arguments -> concrete files.
// A test file no workflow reaches is an orphan, unless test-reachability-exclusions.json names it with a reason.
// Used by desktop/tests/test-reachability.test.js; `node scripts/ci/test-reachability.mjs` prints the report.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const TEST_GLOB = '**/*.{test,spec}.{mjs,cjs,js,ts}'
const IGNORED = /(^|\/)(node_modules|dist|build|\.git)\//

export function reachability(repo) {
  const yaml = createRequire(path.join(repo, 'desktop/package.json'))('js-yaml')
  const all = new Set(fs.globSync(TEST_GLOB, { cwd: repo }).filter((f) => !IGNORED.test(f)))
  const covered = new Set()
  const mark = (f) => { f = path.normalize(f); if (all.has(f)) covered.add(f) }
  const testsUnder = (dir, patterns = [TEST_GLOB]) => {
    for (const p of patterns) for (const f of fs.globSync(path.join(dir, p), { cwd: repo })) if (!IGNORED.test(f)) mark(f)
  }
  const scripts = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(repo, dir, 'package.json'), 'utf8')).scripts || {} } catch { return {} } }
  const vitestIncludes = (dir) => {
    for (const name of ['vitest.config.ts', 'vitest.config.mjs', 'vitest.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.js']) {
      try {
        const src = fs.readFileSync(path.join(repo, dir, name), 'utf8')
        const m = src.match(/include:\s*\[([^\]]+)\]/)
        if (m) return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1])
      } catch { /* next */ }
    }
    return [TEST_GLOB]
  }

  function expand(cmd, cwd, depth = 0, seen = new Set()) {
    if (depth > 8) return
    for (const part of cmd.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean)) {
      let m
      if ((m = part.match(/^(?:cd|pushd)\s+(\S+)/))) { cwd = path.normalize(path.join(cwd, m[1].replace(/["']/g, ''))); continue }
      if ((m = part.match(/\bnpm\s+(?:--prefix\s+(\S+)\s+)?(?:run(?:-script)?\s+(\S+)|(test)\b)/))) {
        const dir = m[1] ? path.normalize(path.join(cwd, m[1])) : cwd
        const name = m[2] || m[3]
        if (seen.has(dir + '::' + name)) continue
        seen.add(dir + '::' + name)
        const s = scripts(dir)[name]
        if (s) expand(s, dir, depth + 1, seen)
        continue
      }
      if (!/\b(node|mocha|vitest|npx|tsx|c8)\b/.test(part)) continue
      const args = (part.match(/"[^"]+"|'[^']+'|\S+/g) || []).map((a) => a.replace(/^["']|["']$/g, ''))
      const paths = args.filter((a) => !a.startsWith('-') && /[/*.]/.test(a) && !/^\w+=/.test(a))
      let hit = false
      for (const a of paths) {
        const rel = path.normalize(path.join(cwd, a))
        if (a.includes('*')) { for (const f of fs.globSync(rel, { cwd: repo })) { mark(f); hit = true } }
        else if (fs.existsSync(path.join(repo, rel))) {
          hit = true
          if (fs.statSync(path.join(repo, rel)).isDirectory()) testsUnder(rel)
          else mark(rel)
        }
      }
      // Runners invoked without file arguments discover tests themselves.
      if (!hit && /\bvitest\b/.test(part)) testsUnder(cwd, vitestIncludes(cwd))
      else if (!hit && /\bnode\b.*--test\b/.test(part)) testsUnder(cwd, ['**/*.test.{mjs,cjs,js}', '**/test-*.{mjs,cjs,js}', '**/*_test.{mjs,cjs,js}', 'test/**/*.{mjs,cjs,js}'])
    }
  }

  for (const wf of fs.globSync('.github/workflows/*.{yml,yaml}', { cwd: repo })) {
    const doc = yaml.load(fs.readFileSync(path.join(repo, wf), 'utf8')) || {}
    for (const job of Object.values(doc.jobs || {})) {
      const jobDir = job.defaults?.run?.['working-directory'] || '.'
      for (const st of job.steps || []) if (st.run) expand(st.run, path.normalize(st['working-directory'] || jobDir))
    }
  }

  const exclusions = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/ci/test-reachability-exclusions.json'), 'utf8'))
  const excludedBy = new Map()
  for (const [pattern, reason] of Object.entries(exclusions)) {
    if (!String(reason).trim()) throw new Error(`exclusion without a reason: ${pattern}`)
    for (const f of fs.globSync(pattern, { cwd: repo })) excludedBy.set(path.normalize(f), pattern)
  }
  const orphans = [...all].filter((f) => !covered.has(f) && !excludedBy.has(f)).sort()
  // An exclusion is stale when it matches nothing, or only files CI already runs.
  const stale = Object.keys(exclusions).filter((p) => {
    const files = fs.globSync(p, { cwd: repo }).map((f) => path.normalize(f))
    return files.length === 0 || files.every((f) => covered.has(f))
  })
  return { total: all.size, covered: covered.size, excluded: excludedBy.size, orphans, stale }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  console.log(JSON.stringify(reachability(repo), null, 1))
}
