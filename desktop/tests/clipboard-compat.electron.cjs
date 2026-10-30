// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run only on disposable GitHub-hosted runners: this test replaces and clears the OS clipboard.
const fs = require('node:fs')
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !process.env.RUNNER_TEMP || !fs.statSync(process.env.RUNNER_TEMP, { throwIfNoEntry: false })?.isDirectory()) {
  console.error('Refusing clipboard smoke outside a disposable GitHub-hosted runner (GITHUB_ACTIONS, RUNNER_ENVIRONMENT, RUNNER_TEMP required).')
  process.exit(1)
}

const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { app, clipboard, ClipboardItem, nativeImage } = require('electron')
const { createClipboardPoller, IMAGE_RECHECK_TICKS } = require('../main/clipboard-watch')
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'awd-clipboard-compat-'))
for (const key of ['home', 'appData', 'userData', 'sessionData', 'documents', 'downloads', 'desktop', 'music', 'pictures', 'videos', 'logs', 'crashDumps', 'temp']) {
  const folder = path.join(root, key)
  fs.mkdirSync(folder)
  app.setPath(key, folder)
}
const evidence = { root, platform: process.platform, versions: { ...process.versions },
  api: 'clipboard.write(ClipboardItem/Blob) → clipboard.read() → production createClipboardPoller/nativeImage', nativeTypes: {}, checks: [] }
let finished = false
let touchedClipboard = false
let poller
const finish = error => {
  if (finished) return
  finished = true
  clearTimeout(deadline)
  poller?.cancel()
  try { if (touchedClipboard) clipboard.clear() } catch (cleanupError) { error ||= cleanupError }
  evidence.passed = !error
  if (error) evidence.error = error.stack || String(error)
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
  app.exit(error ? 1 : 0)
}
const deadline = setTimeout(() => finish(new Error('Clipboard compatibility smoke timed out after 30 seconds')), 30000)
process.on('uncaughtException', finish)
process.on('unhandledRejection', finish)
const mark = name => evidence.checks.push(name)
const readItems = async label => {
  const items = await clipboard.read()
  evidence.nativeTypes[label] = [...new Set(items.flatMap(item => item.types))]
  return items
}

app.whenReady().then(async () => {
  assert.equal(process.versions.electron, require('../package.json').devDependencies.electron)
  assert.equal(app.commandLine.hasSwitch('no-sandbox'), false)
  assert.ok(['darwin', 'win32'].includes(process.platform), 'Only the supported desktop CI platforms are covered')
  touchedClipboard = true
  clipboard.clear()
  const captured = []
  let fingerprint = ''
  // Do not inject decodeImage: production must decode the real OS Blob via nativeImage.
  poller = createClipboardPoller({ clipboard,
    fingerprint: { get: () => fingerprint, set: value => { fingerprint = value } },
    onImage: value => captured.push({ type: 'image', value }),
    onFile: value => captured.push({ type: 'file', value }),
    onText: value => captured.push({ type: 'text', value }) })

  await clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['Priming fixture'], { type: 'text/plain' }) })])
  await poller.tick(true)
  assert.deepEqual(captured, [])
  const text = 'Synthetic clipboard text 中文 45'
  await clipboard.write([new ClipboardItem({ 'text/plain': new Blob([`  ${text}  `], { type: 'text/plain' }) })])
  await readItems('text')
  await poller.tick(false)
  await poller.tick(false)
  assert.deepEqual(captured, [{ type: 'text', value: text }])
  mark('real text Blob → production trim/emit, initial priming and duplicate suppression')

  const sourceImage = nativeImage.createFromBitmap(Buffer.from([
    0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
  ]), { width: 2, height: 2 })
  assert.equal(sourceImage.isEmpty(), false)
  await clipboard.write([new ClipboardItem({
    'image/png': new Blob([new Uint8Array(sourceImage.toPNG())], { type: 'image/png' }),
    'text/plain': 'Image fallback text must not be captured',
  })])
  await readItems('image')
  await poller.tick(false)
  for (let i = 0; i <= IMAGE_RECHECK_TICKS; i++) await poller.tick(false)
  assert.equal(captured.length, 2)
  assert.equal(captured[1].type, 'image')
  const decoded = nativeImage.createFromDataURL(captured[1].value)
  assert.equal(decoded.isEmpty(), false)
  assert.deepEqual(decoded.getSize(), { width: 2, height: 2 })
  assert.deepEqual(decoded.toBitmap(), sourceImage.toBitmap())
  mark('real PNG Blob → production nativeImage decode/data URL, image priority and duplicate suppression')

  const file = path.join(root, '合成 file #45.txt')
  fs.writeFileSync(file, 'Synthetic file clipboard fixture\n')
  await clipboard.write([new ClipboardItem({ 'text/uri-list': new Blob([pathToFileURL(file).href + '\r\n'], { type: 'text/uri-list' }) })])
  const fileItems = await readItems('file')
  const fileItem = fileItems.find(item => item.types.includes('text/uri-list'))
  assert.ok(fileItem, 'Native file references must roundtrip as text/uri-list')
  const fileBlob = await fileItem.getType('text/uri-list')
  const uris = (await fileBlob.text()).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  assert.deepEqual(uris.map(uri => fileURLToPath(uri)), [file])
  mark('native file reference roundtrip (macOS NSFilenamesPboardType / Windows CF_HDROP)')
  await poller.tick(false)
  await poller.tick(false)
  if (process.platform === 'darwin') {
    assert.deepEqual(captured.slice(2), [{ type: 'file', value: file }])
    evidence.fileCapture = 'passed: production macOS file capture and duplicate suppression'
    mark(evidence.fileCapture)
  } else {
    assert.equal(captured.some(item => item.type === 'file'), false)
    evidence.fileCapture = 'unsupported: production file capture is macOS-only; Windows native URI roundtrip was verified separately'
  }
  finish()
}).catch(finish)
