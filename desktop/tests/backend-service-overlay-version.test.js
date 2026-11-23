// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const overlay = require('../main/services/overlay')
const backendService = require('../main/services/backend-service')

function stageComponent(ctx, name, files) {
  const dir = path.join(overlay.stagingDir(ctx), name)
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(dir, rel)
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, content)
  }
  return dir
}

function makeCtx(root, extra = {}) {
  return {
    packaged: true,
    projectRoot: path.resolve(__dirname, '../..'),
    resourcesPath: root,
    dataDir: root,
    appVersion: '0.88.1',
    ports: { backend: 5269 },
    ...extra,
  }
}

test('spawnEnv reports active overlay version as AWD_APP_VERSION in packaged mode', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-ovl-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const prev = process.env.AWD_APP_VERSION
  delete process.env.AWD_APP_VERSION
  t.after(() => {
    if (prev !== undefined) process.env.AWD_APP_VERSION = prev
    else delete process.env.AWD_APP_VERSION
  })

  const ctx = makeCtx(root)
  assert.equal(backendService.spawnEnv(ctx).AWD_APP_VERSION, '0.88.1')

  const staged = stageComponent(ctx, 'backend-app', { 'app.jar': 'overlay-jar' })
  overlay.activate(ctx, '0.88.2', { 'backend-app': staged })
  assert.equal(backendService.spawnEnv(ctx).AWD_APP_VERSION, '0.88.2')
})

test('spawnEnv keeps shell version in dev mode even if overlay files exist', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-dev-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const prev = process.env.AWD_APP_VERSION
  delete process.env.AWD_APP_VERSION
  t.after(() => {
    if (prev !== undefined) process.env.AWD_APP_VERSION = prev
    else delete process.env.AWD_APP_VERSION
  })

  const packagedCtx = makeCtx(root, { packaged: true })
  const staged = stageComponent(packagedCtx, 'backend-app', { 'app.jar': 'overlay-jar' })
  overlay.activate(packagedCtx, '0.88.2', { 'backend-app': staged })

  const devCtx = makeCtx(root, { packaged: false })
  assert.equal(backendService.spawnEnv(devCtx).AWD_APP_VERSION, '0.88.1')
})

test('spawnEnv preserves explicit AWD_APP_VERSION override', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-ovr-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const prev = process.env.AWD_APP_VERSION
  process.env.AWD_APP_VERSION = '0.99.0'
  t.after(() => {
    if (prev !== undefined) process.env.AWD_APP_VERSION = prev
    else delete process.env.AWD_APP_VERSION
  })

  const ctx = makeCtx(root)
  assert.equal(backendService.spawnEnv(ctx).AWD_APP_VERSION, '0.99.0')
})
