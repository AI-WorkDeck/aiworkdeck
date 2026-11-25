// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Called only after both platform artifacts exist. Keep the existing signed
// manifest and mirror installer paths as the sole distribution channel.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// White-label editions pass their own installer locations: releaseBase (…/releases/download/), mirrorBase (a
// directory URL, or '' for none) and, optionally, the fixed asset name each installer is published under
// (names: { 'darwin-arm64': …, win32: … }). Defaults are AI WorkDeck's mirror, GitHub release and file names.
const DEFAULT_BASES = { mirrorBase: 'https://www.aiworkdeck.com/update/desktop/installers/', releaseBase: 'https://github.com/AI-WorkDeck/aiworkdeck/releases/download/' }
async function finalize(dir, version, signingKey, bases = {}) {
  const { mirrorBase, releaseBase, names: assetNames = {} } = { ...DEFAULT_BASES, ...bases }
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
    const assetName = assetNames[platform] || name.replace(/ /g, '.')
    const hash = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    installers[platform] = { version, size: fs.statSync(file).size, sha256: hash.digest('hex'), urls: [
      ...(mirrorBase ? [`${mirrorBase}${encodeURIComponent(assetName)}`] : []),
      `${releaseBase}v${version}/${encodeURIComponent(assetName)}`
    ] }
  }
  channel.installers = installers
  const output = Buffer.from(JSON.stringify(manifest, null, 2))
  fs.writeFileSync(manifestPath, output)
  fs.writeFileSync(manifestPath + '.sig', crypto.sign(null, output, key).toString('base64') + '\n')
}
// CLI: finalize-update-manifest.js <dir> <version> [--release-base <url>] [--mirror-base <url|none>]
//      [--names darwin-arm64=<asset>,win32=<asset>]
if (require.main === module) {
  const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
  const bases = {}
  if (opt('--release-base')) bases.releaseBase = opt('--release-base')
  if (opt('--mirror-base')) bases.mirrorBase = opt('--mirror-base') === 'none' ? '' : opt('--mirror-base')
  if (opt('--names')) bases.names = Object.fromEntries(opt('--names').split(',').map((kv) => kv.split('=')))
  finalize(process.argv[2], process.argv[3], process.env.UPDATE_SIGNING_KEY, bases).catch((e) => { console.error(e.message); process.exitCode = 1 })
}
module.exports = { finalize }
