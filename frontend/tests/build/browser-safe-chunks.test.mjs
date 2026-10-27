// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { rollup } from 'rollup'
import { browserSafeChunks } from '../../scripts/browser-safe-chunks.mjs'

async function build(chunkFileNames) {
  const bundle = await rollup({
    input: 'entry',
    plugins: [{
      name: 'fixture', resolveId: id => id,
      load: id => id === 'entry'
        ? 'export const preview = () => import("docx-preview");'
        : 'export const renderAsync = () => "readable";',
    }, browserSafeChunks()],
  })
  try {
    return (await bundle.generate({ format: 'es', entryFileNames: 'assets/main.js', chunkFileNames })).output
  } finally { await bundle.close() }
}

test('Uni external dependency names emit browser-relative imports without making previews eager', async () => {
  const output = await build(() => 'assets/..-node_modules-docx-preview-dist-[name].[hash].js')
  const entry = output.find(chunk => chunk.isEntry)
  const specifier = entry.code.match(/import\(['"]([^'"]+)['"]\)/)?.[1]
  assert.match(specifier, /^\.\//, 'a sibling beginning ..- is not a browser-relative module specifier')
  assert.equal(entry.imports.length, 0, 'preview remains lazy')
  assert.ok(output.some(chunk => chunk.fileName === path.posix.join('assets', specifier)))
})

test('ordinary chunk names preserve the configured path, hash and function context', async () => {
  const output = await build(chunk => `assets/${chunk.name}.[hash].js`)
  assert.match(output.find(chunk => !chunk.isEntry).fileName, /^assets\/docx-preview\.[\w-]+\.js$/)
})

test('worker directory structure remains intact', async () => {
  const output = await build('workers/nested/[name].js')
  assert.equal(output.find(chunk => !chunk.isEntry).fileName, 'workers/nested/docx-preview.js')
  assert.match(output.find(chunk => chunk.isEntry).code, /import\(['"]\.\.\/workers\/nested\/docx-preview\.js['"]\)/)
})
