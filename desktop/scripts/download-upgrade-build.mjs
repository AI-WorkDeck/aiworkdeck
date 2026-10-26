// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared provenance gate for the disposable Windows/Mac upgrade workflows.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, verify } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = 'AI-WorkDeck/aiworkdeck'
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', timeout: 120000, ...options }).trim()
const api = route => JSON.parse(run('gh', ['api', `repos/${repo}/${route}`]))
export function validateBuild(build, { sha, version, tagSha, sourceVersion }) {
  assert(/^[a-f\d]{40}$/.test(sha) && /^\d+\.\d+\.\d+$/.test(version), 'Invalid expected source/version')
  assert(build.repository.full_name === repo && build.path === '.github/workflows/desktop-build.yml'
    && build.conclusion === 'success' && build.head_sha === sha, 'Requires successful official build from pinned source')
  assert.equal(sourceVersion, version, 'Source package version mismatch')
  assert(build.event === 'workflow_dispatch' || (build.event === 'push'
    && build.head_branch === `v${version}` && tagSha === sha), 'Requires manual build or exact matching release tag/commit')
}
export function signedInstaller(bytes, signature, publicKey, version, platform) {
  assert(verify(null, bytes, publicKey, Buffer.from(signature.trim(), 'base64')), 'Release manifest signature invalid')
  const channel = JSON.parse(bytes).channels?.[version.split('.').slice(0, 2).join('.')]
  assert.equal(channel?.latest, version, 'Release manifest version mismatch')
  const installer = channel.installers?.[platform]
  assert(installer?.version === version && /^[a-f\d]{64}$/.test(installer.sha256)
    && Number.isSafeInteger(installer.size) && installer.size > 0, 'Invalid signed installer metadata')
  const prefix = `https://github.com/${repo}/releases/download/v${version}/`
  const urls = installer.urls.filter(url => url.startsWith(prefix))
  assert.equal(urls.length, 1, 'Expected one signed official release URL')
  const name = decodeURIComponent(urls[0].slice(prefix.length))
  assert(name === path.basename(name) && !name.includes('\\') && name.endsWith(platform === 'win32' ? '.exe' : '-arm64.dmg'), 'Invalid signed asset name')
  return { ...installer, name }
}
export async function verifyInstaller(file, expected) {
  assert.equal(fs.statSync(file).size, expected.size, 'Signed installer size mismatch')
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  const digest = hash.digest('hex')
  assert.equal(digest, expected.sha256, 'Signed installer SHA256 mismatch')
  return digest
}
export async function downloadBuild(kind, platform, root, evidenceDir) {
  assert(['baseline', 'candidate'].includes(kind) && ['darwin-arm64', 'win32'].includes(platform), 'Invalid build selection')
  assert.equal(process.env.GITHUB_REPOSITORY, repo, 'Unexpected repository')
  const id = process.env[`${kind.toUpperCase()}_RUN`]
  const sha = process.env[`${kind.toUpperCase()}_SHA`]
  const version = process.env[`${kind.toUpperCase()}_VERSION`]
  assert(/^\d+$/.test(id || '') && /^[a-f\d]{40}$/.test(sha || '') && /^\d+\.\d+\.\d+$/.test(version || ''), 'Invalid build inputs')
  fs.mkdirSync(evidenceDir, { recursive: true })
  const save = (name, data) => fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(data, null, 2) + '\n')
  save('test-tool-source.json', { commit: run('git', ['rev-parse', 'HEAD']) })
  const build = api(`actions/runs/${id}`)
  let tagSha
  if (build.event === 'push') {
    let object = api(`git/ref/tags/v${version}`).object
    for (let i = 0; object.type === 'tag' && i < 4; i++) object = api(`git/tags/${object.sha}`).object
    assert.equal(object.type, 'commit', 'Release tag must resolve to a commit')
    tagSha = object.sha
  }
  // Read metadata and the production trust key from the exact package source, never an env override.
  run('git', ['fetch', 'origin', sha, '--depth=1'])
  const sourceVersion = JSON.parse(run('git', ['show', `${sha}:desktop/package.json`])).version
  validateBuild(build, { sha, version, tagSha, sourceVersion })
  save(`${kind}-build.json`, Object.fromEntries(['id', 'head_sha', 'head_branch', 'path', 'event', 'conclusion', 'html_url'].map(key => [key, build[key]])))
  const dir = path.join(root, kind)
  fs.mkdirSync(dir) // Refuse stale downloads from an earlier attempt.
  let expected
  if (build.event === 'push') {
    const release = api(`releases/tags/v${version}`)
    assert(release.tag_name === `v${version}` && !release.draft && !release.prerelease, 'Requires published stable release')
    const manifestDir = path.join(dir, 'signed-manifest'); fs.mkdirSync(manifestDir)
    run('gh', ['release', 'download', `v${version}`, '--repo', repo, '--pattern', 'manifest.json', '--pattern', 'manifest.json.sig', '--dir', manifestDir])
    const source = run('git', ['show', `${sha}:desktop/main/services/update-service.js`])
    const key = source.match(/const UPDATE_PUBKEY_PEM = `([^`]+)`/)
    assert(key, 'Pinned source production public key missing')
    expected = signedInstaller(fs.readFileSync(path.join(manifestDir, 'manifest.json')), fs.readFileSync(path.join(manifestDir, 'manifest.json.sig'), 'utf8'), key[1], version, platform)
    assert.equal(release.assets.filter(asset => asset.name === expected.name).length, 1, 'Expected exactly one release installer')
    run('gh', ['release', 'download', `v${version}`, '--repo', repo, '--pattern', expected.name, '--dir', dir], { timeout: 600000 })
    await verifyInstaller(path.join(dir, expected.name), expected)
    save(`${kind}-release-trust.json`, { tag: release.tag_name, tagSha, sourceVersion, productionManifestVerified: true, ...expected })
  } else {
    const name = platform === 'win32' ? 'aiworkdeck-windows-latest' : 'aiworkdeck-macos-latest'
    const artifacts = api(`actions/runs/${id}/artifacts`).artifacts.filter(item => item.name === name && !item.expired)
    assert.equal(artifacts.length, 1, 'Expected exactly one live build artifact')
    save(`${kind}-artifact.json`, artifacts[0])
    run('gh', ['run', 'download', id, '--repo', repo, '--name', name, '--dir', dir], { timeout: 600000 })
  }
  const files = fs.readdirSync(dir).filter(name => name.endsWith(platform === 'win32' ? '.exe' : '.dmg'))
  assert.equal(files.length, 1, 'Expected exactly one installer')
  return path.join(dir, files[0])
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await downloadBuild(process.argv[2], process.argv[3], process.cwd(), path.resolve('evidence'))
}
