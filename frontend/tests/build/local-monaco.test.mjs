// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D24: Monaco for the text compare view ships with the app; nothing is loaded from a CDN.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { copyMonaco, localMonaco, MONACO_PUBLIC_DIR } from '../../scripts/local-monaco.mjs'

test('the build copies loader, editor core and base worker — and not the language packs', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'monaco-'))
  try {
    localMonaco().writeBundle({ dir: out })
    const vs = path.join(out, MONACO_PUBLIC_DIR)
    for (const f of ['loader.js', 'editor/editor.main.js', 'editor/editor.main.css', 'base/worker/workerMain.js'])
      assert.ok(fs.existsSync(path.join(vs, f)), f)
    assert.equal(fs.existsSync(path.join(vs, 'basic-languages')), false)
    assert.equal(fs.existsSync(path.join(vs, 'language')), false)
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

test('the compare view loads Monaco from the app, not from a CDN', () => {
  const viewer = fs.readFileSync(new URL('../../src/components/DocDiffViewer.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(viewer, /jsdelivr|https?:\/\/[^'"]*monaco/)
  assert.match(viewer, /new URL\('static\/monaco\/vs', document\.baseURI\)/)
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dependencies['monaco-editor'], '0.45.0', 'pinned to the version the viewer was written for')
})

test('the dist guard fails on remote code loading in JS', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'))
  try {
    fs.mkdirSync(path.join(dist, 'assets'))
    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>')
    fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'i.src="https://cdn.jsdelivr.net/npm/x/loader.js";require.config({paths:{vs:"https://cdn.jsdelivr.net/npm/x"}})')
    const script = new URL('../../scripts/check-dist-egress.mjs', import.meta.url).pathname
    assert.throws(() => execFileSync(process.execPath, [script, dist], { stdio: 'pipe' }), /status 1|Command failed/)
    fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'i.src=new URL("static/monaco/vs/loader.js",document.baseURI).href')
    execFileSync(process.execPath, [script, dist], { stdio: 'pipe' })
  } finally { fs.rmSync(dist, { recursive: true, force: true }) }
})

test('the dev server serves Monaco too (the plugin is not build-only)', async () => {
  const plugin = localMonaco()
  const applies = typeof plugin.apply === 'function' ? plugin.apply({}, { command: 'serve' }) : plugin.apply !== 'build'
  assert.ok(applies, 'apply must include the dev server, otherwise /static/monaco 404s in dev and in Journeys')
  let mount, handler
  plugin.configureServer({ middlewares: { use: (p, fn) => { mount = p; handler = fn } } })
  assert.equal(mount, '/' + MONACO_PUBLIC_DIR)
  const body = await new Promise((resolve, reject) => {
    const chunks = []
    const res = new (require('node:stream').Writable)({ write(c, e, cb) { chunks.push(c); cb() } })
    res.setHeader = () => {}
    res.on('finish', () => resolve(Buffer.concat(chunks).toString('utf8')))
    handler({ url: '/loader.js' }, res, () => reject(new Error('loader.js not served')))
  })
  assert.match(body, /define|require/)
  // a path outside monaco/min/vs is never served
  await new Promise(resolve => handler({ url: '/../../package.json' }, { setHeader() {} }, resolve))
})
