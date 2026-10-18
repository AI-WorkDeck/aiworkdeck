#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sdkDir = path.join(repo, 'sdk/plugin-sdk')
const schema = JSON.parse(await fs.readFile(path.join(sdkDir, 'manifest.schema.json'), 'utf8'))
const MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 200
const excludedName = /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.npmrc|node_modules|\.DS_Store|\.awd-(?:dev|bundled|service-trust)(?:-.*)?|credentials(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|api[-_]?key(?:\..*)?|service[-_]?account(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keystore|zip))$/i

// Deliberately validates the keywords used by our bundled schema, not arbitrary remote schemas.
export function validateSchema(value, rule = schema, location = '$') {
  if (rule.$ref) rule = schema.$defs[rule.$ref.split('/').at(-1)]
  const errors = []
  const fail = message => errors.push(location + ': ' + message)
  if (Object.hasOwn(rule, 'const') && value !== rule.const) fail('expected ' + rule.const)
  if (rule.oneOf && rule.oneOf.filter(choice => validateSchema(value, choice, location).length === 0).length !== 1) fail('must match exactly one declared variant')
  if (rule.enum && !rule.enum.includes(value)) fail('expected one of ' + rule.enum.join(', '))
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (rule.type && actual !== rule.type) { fail('expected ' + rule.type); return errors }
  if (typeof value === 'string') {
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail('invalid format')
    if (rule.minLength != null && value.length < rule.minLength) fail('too short')
    if (rule.maxLength != null && value.length > rule.maxLength) fail('too long')
  }
  if (Array.isArray(value)) {
    if (rule.minItems != null && value.length < rule.minItems) fail('too few items')
    if (rule.maxItems != null && value.length > rule.maxItems) fail('too many items')
    if (rule.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) fail('duplicate items')
    if (rule.items) value.forEach((v, i) => errors.push(...validateSchema(v, rule.items, location + '[' + i + ']')))
  } else if (actual === 'object') {
    for (const name of rule.required || []) if (!Object.hasOwn(value, name)) fail('missing ' + name)
    if (rule.minProperties != null && Object.keys(value).length < rule.minProperties) fail('too few properties')
    if (rule.maxProperties != null && Object.keys(value).length > rule.maxProperties) fail('too many properties')
    for (const [name, item] of Object.entries(value)) {
      if (rule.propertyNames) errors.push(...validateSchema(name, rule.propertyNames, location + '.' + name))
      if (Object.hasOwn(rule.properties || {}, name)) errors.push(...validateSchema(item, rule.properties[name], location + '.' + name))
      else if (rule.additionalProperties === false) fail('unknown field ' + name)
      else if (typeof rule.additionalProperties === 'object') errors.push(...validateSchema(item, rule.additionalProperties, location + '.' + name))
    }
  }
  return errors
}

function safeRelative(name) {
  return typeof name === 'string' && name.length > 0 && !path.posix.isAbsolute(name)
    && !/[\\\u0000-\u001f%?#:]/.test(name) && !name.split('/').some(p => !p || p === '.' || p === '..')
}
function httpsUrl(value, label) {
  let u
  try { u = new URL(value) } catch { throw new Error(label + ': invalid URL') }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error(label + ': use HTTPS without credentials or fragment')
  return u
}
function uniqueIds(items, name) {
  const ids = items.map(item => item.id ?? item.key)
  if (new Set(ids).size !== ids.length) throw new Error(name + ': duplicate id/key')
}

export async function validatePlugin(directory) {
  const root = path.resolve(directory)
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Plugin root must not be a symlink')
  const files = [], excluded = []
  let total = 0
  async function walk(relative = '') {
    for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? relative + '/' + entry.name : entry.name
      if (excludedName.test(entry.name)) { excluded.push(name); continue }
      if (!safeRelative(name)) throw new Error('Unsafe package path: ' + name)
      const stat = await fs.lstat(path.join(root, name))
      if (stat.isSymbolicLink()) throw new Error('Symlinks are not packaged: ' + name)
      if (stat.isDirectory()) { await walk(name); continue }
      if (!stat.isFile()) throw new Error('Not a regular file: ' + name)
      if (stat.size > 5 * 1024 * 1024 || total + stat.size > MAX_BYTES || files.length >= MAX_FILES) throw new Error('Package exceeds dev limits (200 files, 5 MB/file, 20 MB total)')
      const data = await fs.readFile(path.join(root, name))
      if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(data.toString('utf8'))) throw new Error('Private key content in ' + name)
      total += data.length
      files.push({ name, data })
    }
  }
  await walk()
  const manifestFile = files.find(f => f.name === 'manifest.json')
  if (!manifestFile) throw new Error('manifest.json is required at package root')
  let manifest
  try { manifest = JSON.parse(manifestFile.data.toString('utf8')) } catch { throw new Error('manifest.json: invalid JSON') }
  const errors = validateSchema(manifest)
  if (errors.length) throw new Error(errors.join('\n'))
  const names = new Set(files.map(f => f.name))
  const requireFile = (name, web = false) => {
    if (!safeRelative(name) || (web && !name.startsWith('web/')) || !names.has(name)) throw new Error('Missing or unsafe declared file: ' + name)
  }
  if (manifest.frontendEntry) requireFile(manifest.frontendEntry, true)
  const c = manifest.contributes || {}
  if (!manifest.frontendEntry && !Object.values(c).some(v => Array.isArray(v) && v.length)) throw new Error('Declare frontendEntry or a contribution')
  for (const group of ['templates', 'styleProfiles']) for (const item of c[group] || []) requireFile(item.file)
  for (const name of manifest.backendJars || []) requireFile(name)
  for (const group of ['views', 'connections', 'mcpServers']) uniqueIds(c[group] || [], group)
  uniqueIds(manifest.settings || [], 'settings')
  for (const setting of manifest.settings || []) {
    if (setting.secret && setting.default != null && setting.default !== '') throw new Error('Secret setting defaults must be empty: ' + setting.key)
    if (setting.type === 'select' && !setting.options?.length) throw new Error('Select setting requires options: ' + setting.key)
  }
  if (new Set((c.views || []).map(view => view.placement)).size !== (c.views || []).length) throw new Error('Only one view per placement is supported')
  for (const view of c.views || []) {
    requireFile(view.entry, true)
    if (view.placement !== 'sidebar' && (view.defaultDock || view.allowedDocks)) throw new Error('Dock options only apply to sidebar views: ' + view.id)
    if (view.defaultDock && view.allowedDocks && !view.allowedDocks.includes(view.defaultDock)) throw new Error('defaultDock must be in allowedDocks: ' + view.id)
  }
  if (c.connections?.length && !manifest.permissions?.includes('network')) throw new Error('connections require network permission')
  for (const connection of c.connections || []) {
    const origin = httpsUrl(connection.baseUrl, connection.id + '.baseUrl')
    if (origin.pathname !== '/' || origin.search) throw new Error('Connection baseUrl must be an origin: ' + connection.id)
    if (connection.auth.type === 'oauth2') for (const field of ['authorizationUrl', 'tokenUrl', 'clientId']) {
      if (!connection.auth[field]) throw new Error('OAuth requires ' + field + ': ' + connection.id)
    }
    for (const field of ['authorizationUrl', 'tokenUrl']) if (connection.auth[field]) httpsUrl(connection.auth[field], field)
    for (const [operation, declaration] of Object.entries(connection.operations)) {
      const pathname = declaration.path
      if (!pathname.startsWith('/') || (pathname !== '/' && !safeRelative(pathname.slice(1)))) throw new Error('Unsafe operation path: ' + connection.id + '.' + operation)
      if (new URL(pathname, connection.baseUrl).origin !== new URL(connection.baseUrl).origin) throw new Error('Operation must remain same-origin')
    }
    if (connection.billing?.statusOperation && !Object.hasOwn(connection.operations, connection.billing.statusOperation)) throw new Error('Unknown billing statusOperation: ' + connection.id)
    if (connection.billing?.checkoutUrl) httpsUrl(connection.billing.checkoutUrl, 'checkoutUrl')
  }
  if (c.mcpServers?.length && !manifest.permissions?.includes('network')) throw new Error('mcpServers require network permission')
  for (const server of c.mcpServers || []) {
    const endpoint = httpsUrl(server.url, server.id + '.url')
    if (endpoint.search) throw new Error('MCP endpoint cannot have a query: ' + server.id)
    if (server.credentialKey && !(manifest.settings || []).some(setting => setting.key === server.credentialKey && setting.secret && (!setting.scope || setting.scope === 'installation'))) throw new Error('MCP credentialKey must name an installation secret setting: ' + server.id)
    if (server.connectionId) {
      const connection = (c.connections || []).find(item => item.id === server.connectionId)
      if (!connection || new URL(connection.baseUrl).origin !== endpoint.origin) throw new Error('MCP connectionId must name a connection at the same origin: ' + server.id)
    }
    const names = server.tools.map(tool => tool.name)
    if (new Set(names).size !== names.length) throw new Error('Duplicate MCP tool name: ' + server.id)
    for (const tool of server.tools) {
      if (!tool.description.trim()) throw new Error('MCP tool description must not be blank: ' + tool.name)
      validateMcpInputSchema(tool.inputSchema)
    }
  }
  return { root, manifest, files, excluded, bytes: total }
}

// Match PluginMcpSchema's supported subset; unsupported constraints must not be silently dropped.
export function validateMcpInputSchema(value, depth = 0) {
  if (depth > 8) throw new Error('MCP inputSchema exceeds nesting depth 8')
  const errors = validateSchema(value, schema.$defs[depth === 0 ? 'mcpObjectSchema' : 'mcpSchema'], 'inputSchema')
  if (errors.length) throw new Error(errors.join('\n'))
  if (value.type === 'object') {
    for (const key of value.required || []) if (!Object.hasOwn(value.properties || {}, key)) throw new Error('MCP inputSchema required key is undeclared: ' + key)
    for (const child of Object.values(value.properties || {})) validateMcpInputSchema(child, depth + 1)
  } else if (value.type === 'array') validateMcpInputSchema(value.items, depth + 1)
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
// ZIP STORE records: portable, deterministic, no shell/archive utility or new dependency.
export function zipFiles(files) {
  const local = [], central = []
  let offset = 0, centralSize = 0
  for (const { name, data } of files) {
    if (!safeRelative(name)) throw new Error('Unsafe ZIP entry: ' + name)
    const encoded = Buffer.from(name)
    const checksum = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(33, 12); header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(encoded.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(checksum, 16)
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(encoded.length, 28); directory.writeUInt32LE(offset, 42)
    local.push(header, encoded, data); central.push(directory, encoded)
    offset += header.length + encoded.length + data.length
    centralSize += directory.length + encoded.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

export async function initPlugin(directory, id) {
  if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(id)) throw new Error('Use a lowercase plugin id of 2–50 letters, digits or hyphens')
  await fs.mkdir(directory) // Never overwrite an existing project.
  await fs.mkdir(path.join(directory, 'web'))
  const manifest = { $schema: './manifest.schema.json', id, name: id, version: '0.1.0', permissions: [], frontendEntry: 'web/index.html', tools: [], backendJars: [] }
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await fs.copyFile(path.join(sdkDir, 'manifest.schema.json'), path.join(directory, 'manifest.schema.json'))
  for (const file of ['awd-plugin-sdk.js', 'awd-plugin-sdk.d.ts']) await fs.copyFile(path.join(sdkDir, file), path.join(directory, 'web', file))
  await fs.writeFile(path.join(directory, 'web/index.html'), '<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->\n<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + id + '</title><style>body{font:13px system-ui;color:var(--awd-text,#222);background:var(--awd-surface,#fff)}</style><h1>' + id + '</h1><p id="status">等待宿主…</p><script src="awd-plugin-sdk.js"></script><script>awd.ready().then(function(ctx){document.getElementById("status").textContent="已连接宿主："+ctx.pluginId;});</script></html>\n')
  return { id, directory: path.resolve(directory), installed: false }
}

function parseArgs(args) {
  const positionals = [], options = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      if (!['id', 'out', 'endpoint', 'project-id', 'folder-id', 'price-cents'].includes(key)) throw new Error('Unknown option: --' + key)
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Value required: --' + key)
      if (Object.hasOwn(options, key)) throw new Error('Duplicate option: --' + key)
      options[key] = args[++i]
    } else positionals.push(args[i])
  }
  return { positionals, options }
}
function positiveId(value, name) {
  if (!/^[1-9]\d*$/.test(value || '') || !Number.isSafeInteger(Number(value))) throw new Error(name + ' must be a positive integer')
  return Number(value)
}
async function jsonRequest(url, init) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) })
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.error || (result?.code != null && result.code !== 0)) {
    // Only print known codes, never arbitrary response text that might echo credentials.
    const hints = {
      developer_not_approved: 'Complete the application and review in the website developer portal.',
      developer_approval_required: 'Complete the application and review in the website developer portal.',
      developer_permissions_required: 'Update the requested permissions in the developer portal and wait for review.',
      invalid_plugin_token: 'Create or renew the submission token in the website developer portal.',
      developer_required: 'Complete your profile in the website developer portal.',
      unauthorized: 'Create or renew the submission token in the website developer portal.',
      version_not_newer: 'Check submissions first, then increment manifest.version for a new submission.',
      id_taken: 'This plugin ID belongs to another account. Choose a different ID.',
      manifest_invalid: 'Run validate and check the manifest against the published schema.',
    }
    const code = Object.hasOwn(hints, result?.error || '') ? result.error : null
    throw new Error('Server rejected request (HTTP ' + response.status + ')' + (code ? ': ' + code + '. ' + hints[code] : '; inspect the authenticated host or developer portal before retrying.'))
  }
  if (!result || typeof result !== 'object') throw new Error('Unexpected response; verify status in the developer portal before retrying')
  return result
}
function submissionHeaders(env) {
  if (env.AWD_PLUGIN_TOKEN != null) {
    if (!/^\S+$/.test(env.AWD_PLUGIN_TOKEN)) throw new Error('Invalid submission token')
    return { Authorization: 'Bearer ' + env.AWD_PLUGIN_TOKEN }
  }
  // Compatibility for existing automation; new developers should use scoped tokens.
  if (!env.AWD_PLUGIN_SESSION_COOKIE) throw new Error('Set AWD_PLUGIN_TOKEN from the website developer portal (legacy AWD_PLUGIN_SESSION_COOKIE is also supported)')
  if (/[\r\n]/.test(env.AWD_PLUGIN_SESSION_COOKIE)) throw new Error('Invalid session cookie')
  return { Cookie: env.AWD_PLUGIN_SESSION_COOKIE }
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const command = args.shift()
  if (!command || command === 'help' || command === '--help') return { usage: 'node scripts/plugin-dev.mjs init <dir> --id <id> | validate <dir> | package <dir> --out <zip> | status <dir> | install --endpoint <loopback-origin> --project-id <N> --folder-id <N> | status --endpoint <loopback-origin> --project-id <N> | submit <dir> --endpoint <HTTPS-submit-URL> | submissions --endpoint <HTTPS-submit-URL>', credentials: 'AWD_SESSION_ID for explicit local host commands; AWD_PLUGIN_TOKEN from the developer portal for submit/submissions. No network for init/validate/package/local status.' }
  const { positionals, options } = parseArgs(args)
  if (positionals.length > 1) throw new Error('Only one source directory is accepted')
  if (command === 'init') {
    if (!positionals[0] || !options.id) throw new Error('init requires directory and --id')
    return initPlugin(positionals[0], options.id)
  }
  if (command === 'submissions') {
    if (positionals.length) throw new Error('submissions takes an endpoint, not a source directory')
    const endpoint = httpsUrl(options.endpoint, 'submissions endpoint')
    const response = await jsonRequest(endpoint, { method: 'GET', headers: submissionHeaders(env) })
    if (!Array.isArray(response.plugins)) throw new Error('Unexpected submissions response; inspect the website developer portal')
    return { plugins: response.plugins.map(({ id, version, status }) => ({ id, version, status })) }
  }
  if (['dev', 'install'].includes(command) || (command === 'status' && options.endpoint)) {
    if (positionals.length) throw new Error('Host installation takes project/folder IDs, not a local directory. Import your source into the host project first.')
    const endpoint = new URL(options.endpoint || '')
    if (!['http:', 'https:'].includes(endpoint.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('Host endpoint must be an explicit loopback origin')
    if (env.AWD_SESSION_ID && /[\r\n]/.test(env.AWD_SESSION_ID)) throw new Error('Invalid host session')
    const projectId = positiveId(options['project-id'], 'project-id')
    const status = command === 'status'
    const body = status ? undefined : JSON.stringify({ projectId, folderId: positiveId(options['folder-id'], 'folder-id') })
    const headers = { 'Content-Type': 'application/json' }
    if (env.AWD_SESSION_ID) headers['X-Session-Id'] = env.AWD_SESSION_ID
    // Local-mode hosts already authorize loopback calls. Other hosts still enforce login.
    return jsonRequest(new URL(status ? '/api/plugins/dev/status?projectId=' + projectId : '/api/plugins/dev/install', endpoint), { method: status ? 'GET' : 'POST', headers, body })
  }
  if (!['validate', 'package', 'status', 'submit'].includes(command)) throw new Error('Unknown command: ' + command)
  if (!positionals[0]) throw new Error(command + ' requires a source directory')
  const checked = await validatePlugin(positionals[0])
  const result = { id: checked.manifest.id, version: checked.manifest.version, files: checked.files.length, bytes: checked.bytes, excluded: checked.excluded }
  if (command === 'validate' || command === 'status') return { ...result, valid: true, installation: 'not queried' }
  if (command === 'submit' && !/^\d+\.\d+\.\d+$/.test(result.version)) throw new Error('Marketplace submission requires an x.y.z version without prerelease or build suffixes')
  const zip = zipFiles(checked.files)
  if (command === 'package') {
    if (!options.out?.endsWith('.zip')) throw new Error('package requires --out <file.zip>')
    await fs.writeFile(options.out, zip, { flag: 'wx' })
    return { ...result, archive: path.resolve(options.out), archiveBytes: zip.length, uploaded: false }
  }
  if (!options.endpoint) throw new Error('submit requires an explicit HTTPS submission endpoint')
  const endpoint = httpsUrl(options.endpoint, 'submit endpoint')
  const headers = submissionHeaders(env)
  const form = new FormData()
  form.append('file', new Blob([zip], { type: 'application/zip' }), result.id + '-' + result.version + '.zip')
  if (options['price-cents'] != null) {
    if (!/^\d+$/.test(options['price-cents']) || Number(options['price-cents']) > 199900) throw new Error('price-cents must be 0–199900')
    form.append('priceCents', options['price-cents'])
  }
  const response = await jsonRequest(endpoint, { method: 'POST', headers, body: form })
  if (!response.plugin?.id || !response.plugin?.status) throw new Error('Unexpected submission response; verify status in the website developer portal before retrying')
  return { id: response.plugin.id, version: response.plugin.version, status: response.plugin.status, published: false }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result, null, 2)), error => { console.error(error.message); process.exitCode = 1 })
}
