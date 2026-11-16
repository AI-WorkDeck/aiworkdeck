// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 英文 QA 2026-11-14 第 9 条：正式发行版里「允许装未签名能力包」默认关，开发态/源码构建默认开。
// 发行版标记 = 官方 CI 打包时经 extraMetadata 写进 package.json 的 awdReleaseBuild；
// 桌面壳只在「打包态 + 有标记」时给后端注入 AWD_RELEASE_BUILD。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/desktop-build.yml'), 'utf8')
const pkgPath = require.resolve('../package.json')
const backend = require('../main/services/backend-service.js')

test('every CI electron-builder invocation stamps the release marker', () => {
  const calls = workflow.split('\n').filter(l => /npx electron-builder\b/.test(l) && !l.trim().startsWith('#'))
  assert.ok(calls.length >= 3, 'expected the mac, windows and windows-arm64 builder calls')
  for (const line of calls) assert.match(line, /-c\.extraMetadata\.awdReleaseBuild=true\b/, line.trim())
})

test('the source tree package.json never carries the marker (source builds keep developer mode on)', () => {
  assert.equal(JSON.parse(fs.readFileSync(pkgPath, 'utf8')).awdReleaseBuild, undefined)
  assert.equal(backend.isReleaseBuild(), false)
})

test('backend gets AWD_RELEASE_BUILD only when packaged and stamped', () => {
  const pkg = require(pkgPath)
  const ctx = (packaged) => ({ packaged, ports: { backend: 5269 }, resourcesPath: '/nonexistent/res', projectRoot: '/nonexistent/src' })
  const saved = process.env.AWD_RELEASE_BUILD
  delete process.env.AWD_RELEASE_BUILD
  try {
    for (const marker of [true, 'true']) {
      pkg.awdReleaseBuild = marker
      assert.equal(backend.spawnEnv(ctx(true)).AWD_RELEASE_BUILD, 'true', 'packaged + marker ' + JSON.stringify(marker))
      assert.equal(backend.spawnEnv(ctx(false)).AWD_RELEASE_BUILD, undefined, 'dev run never claims to be a release')
    }
    delete pkg.awdReleaseBuild
    assert.equal(backend.spawnEnv(ctx(true)).AWD_RELEASE_BUILD, undefined, 'locally packaged source build')
  } finally {
    delete pkg.awdReleaseBuild
    if (saved !== undefined) process.env.AWD_RELEASE_BUILD = saved
  }
})
