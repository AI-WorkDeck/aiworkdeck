// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Packaged voice UI + real host services + native MediaDeviceInfo. Chromium's
// fake microphones replace hardware; project APIs and recording persistence are fixtures.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const loadSource = async file => (await readFile(resolve(root, 'src/utils', file), 'utf8'))
  .replace(/^import .*\n/gm, '').replaceAll('export function ', 'function ')
const business = await loadSource('pluginBusinessServices.js')
const voice = await loadSource('pluginVoiceServices.js')
const hostScript = `
${business}
const api = {
  getTtsVoices: async () => [],
  getPlatformServices: async () => ({ services: [{ service: 'asr', provider: 'local' }] }),
  getMeetingAsrNotice: async () => ({ acknowledged: true }),
  getMeetingRecordings: async () => ({ meetings: [], configured: true, tier: 'local' }),
  probeLocalAsr: async () => ({ ready: true })
};
const host = {};
const componentDownloads = { load: async () => {}, state: { items: [] } };
const showDialog = async () => ({ confirm: true });
const recorder = {
  recorderState: { status: 'idle', projectId: null, seconds: 0, level: 0 },
  isRecordingActive: () => recorder.recorderState.status !== 'idle',
  listAudioInputDevices: async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'),
  startRecording: async (projectId, deviceId) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
    try { window.started = { projectId, deviceId, actualId: stream.getAudioTracks()[0].getSettings().deviceId }; }
    finally { stream.getTracks().forEach(track => track.stop()); window.tracksEnded = stream.getTracks().every(track => track.readyState === 'ended'); }
    Object.assign(recorder.recorderState, { status: 'recording', projectId });
  }
};
${voice}
const options = { projectId: () => 12, permissions: () => ['speech', 'file_read', 'file_write', 'network', 'editor'], isCurrent: () => true, actions: {} };
const service = createPluginVoiceServices(options);
const wrapper = createPluginBusinessServices({ ...options, delegates: { voice: (...args) => service.request(...args) } });
window.frame = document.querySelector('iframe');
frame.onload = () => frame.contentWindow.postMessage({ awd: 1, type: 'init', context: { pluginId: 'voice', projectId: '12', language: 'zh-CN', theme: 'light', themeTokens: { '--awd-surface': '#fff', '--awd-text': '#222', '--awd-text-2': '#666', '--awd-panel-pad-x': '12px', '--awd-panel-fs': '13px' } } }, '*');
addEventListener('message', async event => {
  const msg = event.data;
  if (event.source !== frame.contentWindow || msg?.type !== 'call') return;
  try {
    const result = msg.method === 'services.request'
      ? clonePluginData(await wrapper.request(msg.params.service, msg.params.operation, msg.params.params))
      : msg.method === 'events.subscribe' ? { subscribed: msg.params.events } : {};
    frame.contentWindow.postMessage({ awd: 1, type: 'result', seq: msg.seq, ok: true, result }, '*');
  } catch (error) {
    frame.contentWindow.postMessage({ awd: 1, type: 'result', seq: msg.seq, ok: false, error: { code: error.code, message: error.message } }, '*');
  }
});
frame.src = '/api/plugin-web/voice/index.html';
`
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', mime['.html']); return res.end('<!doctype html><meta charset="utf-8"><iframe sandbox="allow-scripts allow-forms" style="width:320px;height:800px;border:0"></iframe><script src="/host.js"></script>') }
  if (req.url === '/host.js') { res.setHeader('Content-Type', mime['.js']); return res.end(hostScript) }
  if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end() }
  const match = /^\/api\/plugin-web\/voice\/([a-zA-Z0-9_.\/-]+)$/.exec(req.url || '')
  if (!match || match[1].includes('..')) { res.statusCode = 404; return res.end() }
  try {
    const body = await readFile(resolve(root, '../official-plugins/voice/web', match[1]))
    res.setHeader('Content-Type', mime[extname(match[1])] || 'application/octet-stream')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'")
    res.end(body)
  } catch { res.statusCode = 404; res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port)
  const native = await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label, ownKeys: Object.keys(d) })))
  assert.ok(native.length > 1)
  assert.ok(native.every(d => d.label.startsWith('Fake') && d.ownKeys.length === 0), 'must use native fake devices with inherited fields')
  const frame = await (await page.$('iframe')).contentFrame()
  await frame.waitForSelector('.voice-tab')
  await frame.click('.voice-tab:nth-child(2)')
  await frame.waitForSelector('.mr-device-picker .awd-select-trigger')
  assert.equal(await frame.$eval('.awd-select-text', el => el.textContent.trim()), native[0].label)
  await frame.click('.mr-device-picker .awd-select-trigger')
  assert.deepEqual(await frame.$$eval('.awd-select-item-text', els => els.map(el => el.textContent.trim())), native.map(d => d.label))
  await frame.click('.awd-select-item:nth-child(2)')
  assert.equal(await frame.$eval('.awd-select-text', el => el.textContent.trim()), native[1].label)
  await frame.click('.mr-record-btn')
  await page.waitForFunction(() => window.started && window.tracksEnded)
  const started = await page.evaluate(() => window.started)
  assert.deepEqual(started, { projectId: 12, deviceId: native[1].deviceId, actualId: native[1].deviceId })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, nativeDeviceInfo: true, packagedVoiceLabels: true, selectedFakeInput: true, tracksReleased: true }))
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise(done => server.close(done))
}
