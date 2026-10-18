// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { initPlugin, validatePlugin, validateSchema, validateMcpInputSchema, main } from '../plugin-dev.mjs'
const script = fileURLToPath(new URL('../plugin-dev.mjs', import.meta.url))
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'awd-plugin-cli-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'example')
  await initPlugin(dir, 'test-plugin')
  return { root, dir, manifest: path.join(dir, 'manifest.json') }
}
async function editManifest(file, edit) {
  const m = JSON.parse(await fs.readFile(file, 'utf8')); edit(m)
  await fs.writeFile(file, JSON.stringify(m))
}

test('CLI creates and validates source then produces independently readable real ZIP with credentials excluded', async t => {
  const { root, dir } = await fixture(t)
  await fs.writeFile(path.join(dir, '.env'), 'TOKEN=fixture-only')
  await fs.writeFile(path.join(dir, 'credentials.json'), '{"token":"fixture-only"}')
  await fs.writeFile(path.join(dir, 'web/中文.txt'), 'round-trip')
  const zip = path.join(root, 'plugin.zip')
  const result = JSON.parse(execFileSync(process.execPath, [script, 'package', dir, '--out', zip], { encoding: 'utf8' }))
  assert.equal(result.uploaded, false); assert.deepEqual(result.excluded, ['.env', 'credentials.json'])
  const output = execFileSync('python3', ['-c', 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({"names":z.namelist(),"text":z.read("web/中文.txt").decode()}))', zip], { encoding: 'utf8' })
  const unpacked = JSON.parse(output)
  assert.equal(unpacked.text, 'round-trip'); assert.ok(unpacked.names.includes('manifest.json')); assert.ok(!unpacked.names.includes('.env'))
  await assert.rejects(main(['package', dir, '--out', zip]), /EEXIST/)
  await assert.rejects(initPlugin(dir, 'test-plugin'), /EEXIST/)
})

test('unknown permissions and malformed nested declarations fail before package output', async t => {
  const { dir, manifest } = await fixture(t)
  await editManifest(manifest, m => { m.permissions = ['superuser'] })
  await assert.rejects(validatePlugin(dir), /permissions\[0\]/)
  await editManifest(manifest, m => { m.permissions = []; m.contributes = { views: [{ id: 'main', entry: '../outside.html' }] } })
  await assert.rejects(validatePlugin(dir), /missing name|invalid format/)
  await editManifest(manifest, m => { delete m.contributes; m.settings = [{ key: 'api', type: 'string', label: 'API', secret: true, default: 'secret-value' }] })
  await assert.rejects(validatePlugin(dir), /Secret setting defaults/)
})

test('symlinks, declared path escape and private key material are refused', async t => {
  const { root, dir, manifest } = await fixture(t)
  await fs.writeFile(path.join(root, 'outside.html'), 'outside')
  await fs.symlink(path.join(root, 'outside.html'), path.join(dir, 'web/link.html'))
  await assert.rejects(validatePlugin(dir), /Symlinks/)
  await fs.unlink(path.join(dir, 'web/link.html'))
  await editManifest(manifest, m => { m.frontendEntry = 'web/../../outside.html' })
  await assert.rejects(validatePlugin(dir), /invalid format|unsafe/)
  await editManifest(manifest, m => { m.frontendEntry = 'web/index.html' })
  await fs.writeFile(path.join(dir, 'oops.txt'), '-----BEGIN PRIVATE KEY-----\nfixture\n')
  await assert.rejects(validatePlugin(dir), /Private key/)
})

test('connections require network, fixed same-origin paths, declared billing operation and complete OAuth', async t => {
  const { dir, manifest } = await fixture(t)
  const connection = { id: 'provider', label: 'Provider', baseUrl: 'https://provider.example.invalid', auth: { type: 'bearer' }, operations: { status: { path: '/v1/status', method: 'GET' } }, billing: { statusOperation: 'status', checkoutUrl: 'https://provider.example.invalid/plans' } }
  await editManifest(manifest, m => { m.contributes = { connections: [connection] } })
  await assert.rejects(validatePlugin(dir), /network permission/)
  await editManifest(manifest, m => { m.permissions = ['network'] })
  await validatePlugin(dir)
  await editManifest(manifest, m => { m.contributes.connections[0].operations.status.path = '//evil.example.invalid' })
  await assert.rejects(validatePlugin(dir), /invalid format|Unsafe operation/)
  await editManifest(manifest, m => { m.contributes.connections[0] = { ...connection, auth: { type: 'oauth2' } } })
  await assert.rejects(validatePlugin(dir), /OAuth requires|declared variant/)
  await editManifest(manifest, m => { m.contributes.connections[0] = { ...connection, billing: { statusOperation: 'missing', checkoutUrl: 'https://provider.example.invalid/plans' } } })
  await assert.rejects(validatePlugin(dir), /Unknown billing/)
})

test('install/dev/status use actual loopback existing host APIs only on explicit invocation', async t => {
  const calls = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    calls.push({ url: req.url, method: req.method, session: req.headers['x-session-id'], body })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.includes('status') ? { code: 0, items: [] } : { code: 0, id: 'test-plugin' }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const endpoint = 'http://127.0.0.1:' + server.address().port
  const args = ['--endpoint', endpoint, '--project-id', '7', '--folder-id', '9']
  const env = { AWD_SESSION_ID: 'synthetic-session' }
  await assert.rejects(main(['install', ...args], {}), /AWD_SESSION_ID/)
  assert.equal(calls.length, 0)
  await main(['install', ...args], env); await main(['dev', ...args], env)
  await main(['status', '--endpoint', endpoint, '--project-id', '7'], env)
  assert.deepEqual(calls.map(x => x.url), ['/api/plugins/dev/install', '/api/plugins/dev/install', '/api/plugins/dev/status?projectId=7'])
  assert.deepEqual(JSON.parse(calls[0].body), { projectId: 7, folderId: 9 })
  assert.equal(calls[0].session, 'synthetic-session')
  await assert.rejects(main(['install', '--endpoint', 'https://public.example.invalid', '--project-id', '7', '--folder-id', '9'], env), /loopback/)
})

test('submit requires explicit HTTPS endpoint/cookie, uses multipart ZIP and preserves pending state', async t => {
  const { dir } = await fixture(t)
  let uploads = 0
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    uploads++
    assert.equal(String(url), 'https://portal.example.invalid/api/plugins')
    assert.equal(request.headers.Cookie, 'session=synthetic-fixture')
    assert.equal(request.redirect, 'error')
    const zip = Buffer.from(await request.body.get('file').arrayBuffer())
    assert.equal(zip.readUInt32LE(0), 0x04034b50)
    return new Response(JSON.stringify({ plugin: { id: 'test-plugin', version: '0.1.0', status: 'pending' } }))
  })
  const env = { AWD_PLUGIN_SESSION_COOKIE: 'session=synthetic-fixture' }
  await main(['validate', dir], env); assert.equal(uploads, 0)
  await assert.rejects(main(['submit', dir], env), /explicit HTTPS/)
  await assert.rejects(main(['submit', dir, '--endpoint', 'https://portal.example.invalid/api/plugins'], {}), /AWD_PLUGIN_SESSION_COOKIE/)
  const result = await main(['submit', dir, '--endpoint', 'https://portal.example.invalid/api/plugins'], env)
  assert.equal(result.status, 'pending'); assert.equal(result.published, false); assert.equal(uploads, 1)
})

test('schema patterns accept semantic versions and web entry paths, reject malformed values', () => {
  const base = { id: 'test-plugin', name: 'Test', version: '1.0.0', minHostVersion: '0.31.2', frontendEntry: 'web/index.html', permissions: ['speech', 'tasks', 'clipboard'] }
  assert.deepEqual(validateSchema(base), [])
  assert.deepEqual(validateSchema({ ...base, version: '1.2.3-rc.1+build.2' }), [])
  for (const version of ['1x0x0', '1.0', String.raw`\d.\d.\d`]) assert.ok(validateSchema({ ...base, version }).length)
  for (const frontendEntry of ['web/../outside.html', 'web/indexXhtml', String.raw`web\index.html`]) assert.ok(validateSchema({ ...base, frontendEntry }).length)
})

test('view and connection identifiers, origin and operations follow Java runtime contract', async t => {
  const { dir, manifest } = await fixture(t)
  const connection = { id: 'service', label: 'Service', baseUrl: 'https://provider.example.invalid', auth: { type: 'none' }, operations: { query: { path: '/v1/query', method: 'POST' } } }
  await editManifest(manifest, m => { m.permissions = ['network']; m.contributes = { connections: [connection], views: [{ id: 'main', name: 'Main', entry: 'web/index.html', scope: 'global', placement: 'workspace' }] } })
  await validatePlugin(dir)
  for (const baseUrl of ['https://provider.example.invalid/api', 'https://provider.example.invalid?token=x']) {
    await editManifest(manifest, m => { m.contributes.connections[0].baseUrl = baseUrl })
    await assert.rejects(validatePlugin(dir), /baseUrl must be an origin/)
  }
  await editManifest(manifest, m => { m.contributes.connections[0] = connection; m.contributes.views[0].id = 'Main_View' })
  await assert.rejects(validatePlugin(dir), /invalid format/)
  await editManifest(manifest, m => { m.contributes.views[0].id = 'main'; m.contributes.connections[0].id = 'Service' })
  await assert.rejects(validatePlugin(dir), /invalid format/)
  await editManifest(manifest, m => { m.contributes.connections[0] = connection; m.contributes.connections[0].operations.query.path = '/v1/query.json' })
  await assert.rejects(validatePlugin(dir), /invalid format/)
  await editManifest(manifest, m => { m.contributes.connections[0] = structuredClone(connection); m.contributes.connections[0].operations.query.path = '/v1/query'; m.contributes.views.push({ ...m.contributes.views[0], id: 'other' }) })
  await assert.rejects(validatePlugin(dir), /one view per placement/)
})

test('MCP manifest validates declared tools and installation secret or same-origin connection', async t => {
  const { dir, manifest } = await fixture(t)
  const server = { id: 'research', transport: 'streamable-http', url: 'https://research.example.invalid/mcp', credentialKey: 'apiKey', tools: [{ name: 'search', description: 'Search records', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'], additionalProperties: false } }] }
  await editManifest(manifest, m => { m.permissions = ['network']; m.settings = [{ key: 'apiKey', type: 'string', label: 'API key', secret: true, scope: 'installation' }]; m.contributes = { mcpServers: [server] } })
  await validatePlugin(dir)
  await editManifest(manifest, m => { m.settings[0].scope = 'user' })
  await assert.rejects(validatePlugin(dir), /installation secret/)
  await editManifest(manifest, m => { m.settings[0].scope = 'installation'; m.contributes.mcpServers[0].url += '?token=x' })
  await assert.rejects(validatePlugin(dir), /cannot have a query/)
  await editManifest(manifest, m => { m.contributes.mcpServers[0] = { ...server, connectionId: 'research-account' }; delete m.contributes.mcpServers[0].credentialKey })
  await assert.rejects(validatePlugin(dir), /same origin/)
  await editManifest(manifest, m => { m.contributes.connections = [{ id: 'research-account', label: 'Research', baseUrl: 'https://research.example.invalid', auth: { type: 'bearer' }, operations: { status: { path: '/status', method: 'GET' } } }] })
  await validatePlugin(dir)
  await editManifest(manifest, m => { m.contributes.mcpServers[0].tools.push(m.contributes.mcpServers[0].tools[0]) })
  await assert.rejects(validatePlugin(dir), /Duplicate MCP tool/)
})

test('MCP schema subset rejects unsupported constraints, undeclared required keys and excessive depth', () => {
  assert.doesNotThrow(() => validateMcpInputSchema({ type: 'object', properties: { entries: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', enum: ['a', 'b'] } } } } } }))
  for (const value of [
    { type: 'object', properties: { x: { type: 'string', pattern: '.*' } } },
    { type: 'object', properties: { x: { type: 'number', minimum: 0 } } },
    { type: 'object', required: ['missing'] },
    { type: 'object', properties: { x: { type: 'array' } } },
    { type: 'object', properties: { 'bad.name': { type: 'string' } } },
    { type: 'object', properties: { x: { type: 'null' } } },
  ]) assert.throws(() => validateMcpInputSchema(value))
  let nested = { type: 'string' }
  for (let i = 0; i < 9; i++) nested = { type: 'array', items: nested }
  assert.throws(() => validateMcpInputSchema({ type: 'object', properties: { nested } }), /nesting depth/)
})

test('packaging excludes development provenance and service-trust markers', async t => {
  const { dir } = await fixture(t)
  await fs.writeFile(path.join(dir, '.awd-dev'), 'fixture')
  await fs.writeFile(path.join(dir, '.awd-service-trust'), 'fixture')
  await fs.writeFile(path.join(dir, '.awd-service-trust-fixture.tmp'), 'fixture')
  const checked = await validatePlugin(dir)
  assert.deepEqual(checked.excluded, ['.awd-dev', '.awd-service-trust', '.awd-service-trust-fixture.tmp'])
  assert.ok(checked.files.every(file => !file.name.startsWith('.awd-')))
})
