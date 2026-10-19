// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Local test manifest, signed with an ephemeral TEST key; never a production feed.
// This process does not start, quit, update, or alter any application.
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

function signedManifest(installer) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const bytes = Buffer.from(JSON.stringify({
    schema: 1,
    latestMajor: '0.66',
    channels: {
      '0.65': { latest: '0.65.0', components: [] },
      '0.66': { latest: '0.66.0', components: [], installers: { 'darwin-arm64': installer } }
    }
  }) + '\n')
  const signature = sign(null, bytes, privateKey)
  assert(verify(null, bytes, publicKey, signature))
  return { bytes, signature: Buffer.from(signature.toString('base64') + '\n'),
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }) }
}

if (process.argv.includes('--self-test')) {
  const fixture = signedManifest({ version: '0.66.0', sha256: 'a'.repeat(64), size: 1, urls: ['http://127.0.0.1/example.dmg'] })
  assert.equal(JSON.parse(fixture.bytes).channels['0.66'].installers['darwin-arm64'].version, '0.66.0')
  assert(verify(null, fixture.bytes, fixture.publicKey, Buffer.from(fixture.signature.toString().trim(), 'base64')))
  assert.equal(verify(null, Buffer.concat([fixture.bytes, Buffer.from(' ')]), fixture.publicKey,
    Buffer.from(fixture.signature.toString().trim(), 'base64')), false)
  console.log('PASS: schema, ephemeral Ed25519 signature, tamper rejection; no server or application started')
} else if (process.argv.includes('--help')) {
  console.log('node mac-update-feed.mjs --dmg /absolute/candidate.dmg --sha256 VERIFIED_SHA256 --out /absolute/NEW/private/fixture-dir [--port 0]')
  console.log('Serves only 127.0.0.1. Output config.json contains the two official CHECKBA update overrides. This is a TEST signer, not the production signer.')
} else {
  await serve()
}

async function serve() {
  const args = {}
  const allowed = new Set(['--dmg', '--sha256', '--out', '--port'])
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]
    assert(allowed.has(key) && process.argv[i + 1] && args[key] === undefined, `Invalid argument: ${key}`)
    args[key] = process.argv[i + 1]
  }
  assert(path.isAbsolute(args['--dmg'] || '') && /\.dmg$/i.test(args['--dmg']), '--dmg must be an absolute DMG path')
  assert(/^[a-f\d]{64}$/i.test(args['--sha256'] || ''), '--sha256 must be independently verified')
  assert(path.isAbsolute(args['--out'] || ''), '--out must be a new absolute directory')
  const port = Number(args['--port'] || 0)
  assert(Number.isInteger(port) && port >= 0 && port <= 65535, 'Invalid port')
  const file = await open(args['--dmg'], 'r')
  const initial = await file.stat()
  assert(initial.isFile() && initial.size > 0 && initial.size <= 4 * 1024 ** 3, 'Invalid installer file/size')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream('', { fd: file.fd, start: 0, autoClose: false })) hash.update(chunk)
  const sha256 = hash.digest('hex')
  assert.equal(sha256, args['--sha256'].toLowerCase(), 'Candidate SHA256 mismatch')
  // mkdir without recursive refuses an existing directory, including a symlink.
  await mkdir(args['--out'], { mode: 0o700 })
  const token = randomBytes(24).toString('hex')
  const routes = { manifest: `/${token}/manifest.json`, signature: `/${token}/manifest.json.sig`, dmg: `/${token}/candidate-0.66.0.dmg` }
  let fixture
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return }
      if (!fixture) { response.writeHead(503).end(); return }
      let body
      let type
      if (request.url === routes.manifest) { body = fixture.bytes; type = 'application/json' }
      else if (request.url === routes.signature) { body = fixture.signature; type = 'text/plain' }
      else if (request.url === routes.dmg) {
        const current = await file.stat()
        assert.equal(current.size, initial.size, 'Candidate changed')
        assert.equal(current.mtimeMs, initial.mtimeMs, 'Candidate changed')
        assert.equal(current.ctimeMs, initial.ctimeMs, 'Candidate changed')
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': initial.size, 'Cache-Control': 'no-store' })
        if (request.method === 'HEAD') { response.end(); return }
        await pipeline(createReadStream('', { fd: file.fd, start: 0, end: initial.size - 1, autoClose: false }), response)
        return
      } else { response.writeHead(404).end(); return }
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' })
      response.end(request.method === 'HEAD' ? undefined : body)
    } catch (error) {
      if (!response.headersSent) response.writeHead(500).end()
      else response.destroy()
      console.error(`Feed request failed: ${error.message}`)
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  fixture = signedManifest({ version: '0.66.0', sha256, size: initial.size, urls: [origin + routes.dmg] })
  const publicKeyFile = path.join(args['--out'], 'TEST-public-key.pem')
  const config = {
    fixtureOnly: true,
    productionSignature: false,
    baseline: '0.65.0', candidate: '0.66.0', platform: 'darwin-arm64', sha256, size: initial.size,
    env: { CHECKBA_UPDATE_MANIFEST_URL: origin + routes.manifest, CHECKBA_UPDATE_PUBKEY_FILE: publicKeyFile },
    nativeIsolation: 'Before using this feed in an app, isolate the macOS user launchd domain and Foundation caches; Electron app.setPath alone does not isolate ShipIt.',
    quitMode: 'Ordinary quit; do not call quitAndInstall. Reopen only through the guarded QA launcher.'
  }
  for (const [name, bytes] of [
    ['TEST-public-key.pem', fixture.publicKey], ['manifest.json', fixture.bytes],
    ['manifest.json.sig', fixture.signature], ['config.json', JSON.stringify(config, null, 2) + '\n']
  ]) await writeFile(path.join(args['--out'], name), bytes, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ ready: true, fixtureOnly: true, configFile: path.join(args['--out'], 'config.json'), sha256, size: initial.size }))
  const shutdown = () => {
    server.close(async () => { await file.close(); process.exit(0) })
    server.closeAllConnections()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
