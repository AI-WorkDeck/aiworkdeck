#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Gate for white-label builds: fail if the default product's name or domains survive in built output.
// Design: docs/superpowers/specs/2026-11-23-brand-profile-design.md
//
//   node scripts/brand/leak-check.mjs <dir|file.asar|file.jar> [...more] [--max-report 40]
//
// Scans every file (inside .asar and .jar/.zip too) for /work[ -]?deck/i. A hit is allowed only when the text
// around it matches an ALLOW pattern: AGPL attribution and source links, or internal identifiers users never see.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const NEEDLE = /work[ -]?deck/gi
const WINDOW = 120

// A hit is allowed when an ALLOW pattern matches. `cover: true` patterns must overlap the hit itself (internal
// identifiers); the others only need to sit in the ±WINDOW context (line-level legal notices).
export const ALLOW = [
  { why: 'SPDX header', re: /SPDX-FileCopyrightText/ },
  { why: 'AGPL source link', re: /github\.com\/AI-WorkDeck\/[\w./-]*/, cover: true },
  { why: 'AGPL copyright line', re: /BEIJING GONG FU|北京公富/ },
  { why: 'AGPL attribution', re: /AGPL/ },
  { why: 'internal env var', re: /AIWORKDECK_[A-Z_]+/, cover: true },
  { why: 'internal file/dir name', re: /\.?aiworkdeck-(native-editors|complete|cjk-aliases)/, cover: true },
  { why: 'internal css class', re: /workdeck-[\w-]+/, cover: true },
  { why: 'server-side user agent', re: /AIWorkDeck[/-][\w<$.{}-]*|UA_PRODUCT/ },
  { why: 'version store magic bytes', re: /AIWorkDeck version object v1/, cover: true },
  { why: 'maven metadata', re: /<description>|<artifactId>/ },
  { why: 'internal git identity domain', re: /[\w.-]*aiworkdeck\.local/, cover: true },
  { why: 'partner portal host (shared service)', re: /ai-?firm\.aiworkdeck\.com/, cover: true },
  { why: 'mobile push topic', re: /com\.aiworkdeck\.mobile[\w.]*/, cover: true },
]

// Whole files that never reach users: server-deployment profiles bundled in the shared jar.
export const ALLOW_FILES = [/application-(case|cloud)\.yml$/]

export function isAllowed(ctx, hitStart, hitEnd) {
  return ALLOW.find((a) => {
    for (const m of ctx.matchAll(new RegExp(a.re.source, 'g'))) {
      if (!a.cover) return true
      if (m.index < hitEnd && m.index + m[0].length > hitStart) return true
    }
    return false
  })
}

function unpack(file) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-leak-'))
  if (file.endsWith('.asar')) {
    const require = createRequire(import.meta.url)
    let asar
    for (const base of [process.cwd(), path.dirname(fileURLToPath(import.meta.url)) + '/../../desktop']) {
      try { asar = require(require.resolve('@electron/asar', { paths: [base] })); break } catch {}
    }
    if (!asar) throw new Error('@electron/asar not found (run npm ci in desktop/)')
    asar.extractAll(file, out)
  } else {
    execFileSync('unzip', ['-qq', '-o', file, '-d', out])
  }
  return out
}

export function scan(target, findings = [], label = target) {
  const st = fs.statSync(target)
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(target)) scan(path.join(target, e), findings, path.join(label, e))
    return findings
  }
  if (/\.(asar|jar|zip)$/i.test(target)) {
    const dir = unpack(target)
    scan(dir, findings, label + '!')
    fs.rmSync(dir, { recursive: true, force: true })
    return findings
  }
  if (st.size > 200 * 1024 * 1024) return findings
  // latin1 keeps byte offsets; the context window is decoded as utf8 for reports and CJK allow patterns
  const buf = fs.readFileSync(target)
  const text = buf.toString('latin1')
  for (const m of text.matchAll(NEEDLE)) {
    const before = buf.subarray(Math.max(0, m.index - WINDOW), m.index).toString('utf8')
    const ctx = before + buf.subarray(m.index, m.index + m[0].length + WINDOW).toString('utf8')
    const allow = ALLOW_FILES.some((r) => r.test(label)) ? 'server deployment profile' : isAllowed(ctx, before.length, before.length + m[0].length)
    findings.push({ file: label, hit: m[0], ctx: ctx.replace(/\s+/g, ' '), allowed: allow ? (allow.why || allow) : null })
  }
  return findings
}

if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2)
  const mi = args.indexOf('--max-report')
  const max = mi >= 0 ? Number(args.splice(mi, 2)[1]) : 40
  const findings = args.flatMap((t) => scan(path.resolve(t)))
  const leaks = findings.filter((f) => !f.allowed)
  const byWhy = {}
  for (const f of findings.filter((x) => x.allowed)) byWhy[f.allowed] = (byWhy[f.allowed] || 0) + 1
  for (const [why, n] of Object.entries(byWhy)) console.log(`allowed ${String(n).padStart(5)}  ${why}`)
  const byFile = {}
  for (const f of leaks) (byFile[f.file] ||= []).push(f)
  let shown = 0
  for (const [file, list] of Object.entries(byFile)) {
    console.log(`\nLEAK ${list.length}x ${file}`)
    for (const f of list.slice(0, 3)) { if (shown++ < max) console.log(`   …${f.ctx.slice(0, 240)}…`) }
  }
  console.log(`\n${leaks.length} leak(s) in ${Object.keys(byFile).length} file(s); ${findings.length - leaks.length} allowed`)
  process.exit(leaks.length ? 1 : 0)
}
