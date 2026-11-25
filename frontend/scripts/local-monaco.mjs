// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D24: the text compare view (DocDiffViewer) used to load Monaco from cdn.jsdelivr.net at runtime —
// an undeclared third-party script, and broken offline / behind a firm firewall. Ship the
// AMD build of the pinned monaco-editor dependency with the app instead: only the loader, the
// editor core and base (worker) are copied (~5.7 MB); plaintext needs no language packs.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

export const MONACO_PUBLIC_DIR = 'static/monaco/vs'
const PARTS = ['loader.js', 'editor', 'base']

function monacoRoot() {
  const require = createRequire(import.meta.url)
  return path.join(path.dirname(require.resolve('monaco-editor/package.json')), 'min', 'vs')
}

export function copyMonaco(outDir) {
  const src = monacoRoot()
  const dest = path.join(outDir, MONACO_PUBLIC_DIR)
  for (const part of PARTS) fs.cpSync(path.join(src, part), path.join(dest, part), { recursive: true })
  return dest
}

export function localMonaco() {
  return {
    name: 'local-monaco',
    apply: 'build',
    writeBundle(options) {
      if (options && options.dir) copyMonaco(options.dir)
    },
    configureServer(server) {
      const src = monacoRoot()
      server.middlewares.use('/' + MONACO_PUBLIC_DIR, (req, res, next) => {
        const file = path.join(src, decodeURIComponent((req.url || '').split('?')[0]))
        if (!file.startsWith(src) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next()
        res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}
