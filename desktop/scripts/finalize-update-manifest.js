// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Called only after both platform artifacts exist. Keep the existing signed
// manifest and mirror installer paths as the sole distribution channel.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

async function finalize(dir, version, signingKey) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version')
  const key = crypto.createPrivateKey(signingKey)
  const manifestPath = path.join(dir, 'patch', 'manifest.json')
  const bytes = fs.readFileSync(manifestPath)
  const sig = Buffer.from(fs.readFileSync(manifestPath + '.sig', 'utf8').trim(), 'base64')
  if (!crypto.verify(null, bytes, crypto.createPublicKey(key), sig)) throw new Error('Input manifest signature invalid')
  const manifest = JSON.parse(bytes)
  const major = version.split('.').slice(0, 2).join('.')
  const channel = manifest.channels && manifest.channels[major]
  if (!channel || channel.latest !== version) throw new Error('Manifest does not match release')
  const installers = {}
  for (const [platform, suffix] of [['darwin-arm64', '-arm64.dmg'], ['win32', '.exe']]) {
    const names = fs.readdirSync(dir).filter((n) => n.endsWith(suffix) && n.includes(version))
    if (names.length !== 1) throw new Error(`Expected one ${platform} installer`)
    const name = names[0]
    const file = path.join(dir, name)
    // GitHub release uploads and sync-mirror both replace spaces with dots.
    const assetName = name.replace(/ /g, '.')
    const hash = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    installers[platform] = { version, size: fs.statSync(file).size, sha256: hash.digest('hex'), urls: [
      `https://www.aiworkdeck.com/update/desktop/installers/${encodeURIComponent(assetName)}`,
      `https://github.com/AI-WorkDeck/aiworkdeck/releases/download/v${version}/${encodeURIComponent(assetName)}`
    ] }
  }
  channel.installers = installers
  // Two signed views of the same release (0.91.1 finding): the cn mirror serves manifest-cn.json (mirror first)
  // as its manifest.json; the GitHub Release's manifest.json, which intl clients read, lists GitHub first, so
  // intl users no longer download patches from the cn host. Same components, sizes and hashes in both.
  writeSigned(path.join(dir, 'patch', 'manifest-cn.json'), manifest, key)
  writeSigned(manifestPath, githubFirst(manifest), key)
}

function writeSigned(file, manifest, key) {
  const output = Buffer.from(JSON.stringify(manifest, null, 2))
  fs.writeFileSync(file, output)
  fs.writeFileSync(file + '.sig', crypto.sign(null, output, key).toString('base64') + '\n')
}

const GITHUB_HOSTS = new Set(['github.com', 'objects.githubusercontent.com'])
function isGithub(url) {
  try { return GITHUB_HOSTS.has(new URL(url).host) } catch { return false }
}

/** Deep copy with every `urls` list reordered GitHub first (stable; nothing added or removed). */
function githubFirst(value) {
  if (Array.isArray(value)) return value.map(githubFirst)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = k === 'urls' && Array.isArray(v) && v.every((u) => typeof u === 'string')
      ? [...v.filter(isGithub), ...v.filter((u) => !isGithub(u))]
      : githubFirst(v)
  }
  return out
}
if (require.main === module) finalize(process.argv[2], process.argv[3], process.env.UPDATE_SIGNING_KEY).catch((e) => { console.error(e.message); process.exitCode = 1 })
module.exports = { finalize, githubFirst }
