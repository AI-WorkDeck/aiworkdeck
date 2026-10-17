// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '../..')
const output = resolve(process.argv[2] || '/tmp/tts-1337-benchmark/ui')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'tts-browser-profile-'))
const cache = await mkdtemp(join(tmpdir(), 'tts-vite-cache-'))
const appSource = await readFile(join(frontend, 'src/App.vue'), 'utf8')
const tokenCss = [...appSource.matchAll(/(?:html(?:\s*,\s*html\[data-theme='light'\])?)\s*\{([^}]+)\}/g)]
  .map(match => `:root { ${[...match[1].matchAll(/--awd-[\w-]+\s*:[^;]+;/g)].map(item => item[0]).join('\n')} }`).join('\n')

function wav(duration) {
  const sampleRate = 24000
  const count = Math.round(sampleRate * duration)
  const data = Buffer.alloc(44 + count * 2)
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28)
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / sampleRate) * 500), 44 + i * 2)
  return data
}

const server = await createServer({
  configFile: false, root: here, cacheDir: cache, logLevel: 'error',
  resolve: { alias: [
    { find: '@/services/api.js', replacement: join(here, 'api.js') },
    { find: '@/services/host.js', replacement: join(here, 'host.js') },
    { find: '@/services/componentDownloads.js', replacement: join(here, 'host.js') },
    { find: '@', replacement: join(frontend, 'src') }
  ] },
  plugins: [{
    name: 'isolated-uni-compatibility', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/EasyVoicePane.vue')) return
      // Uni tags/events only; do not alter the script, reader, or audio implementation.
      return code.replace(/<template>([\s\S]*?)<\/template>\s*\n\s*<script>/, (_, template) =>
        '<template>' + template.replace(/@tap(?=[.\s=])/g, '@click').replace(/(<\/?)(scroll-view|view|text)(?=[\s>])/g, (_, open, tag) => open + (tag === 'text' ? 'span' : 'div')) + '</template>\n<script>')
    },
    resolveId(id) { if (id === 'virtual:app-tokens.css') return '\0app-tokens.css' },
    load(id) { if (id === '\0app-tokens.css') return tokenCss },
    configureServer(vite) {
      vite.middlewares.use('/test-audio', async (req, res) => {
        let body = ''
        for await (const chunk of req) body += chunk
        const config = JSON.parse(body)
        await new Promise(resolve => setTimeout(resolve, config.delay))
        if (res.destroyed) return
        res.statusCode = config.fail ? 503 : 200
        res.setHeader('Content-Type', config.fail ? 'text/plain' : 'audio/wav')
        res.end(config.fail ? 'Controlled test failure' : wav(config.duration))
      })
    }
  }, vue()],
  server: { host: '127.0.0.1', port: 0, fs: { allow: [frontend] }, proxy: {
    '/kokoro': { target: 'http://127.0.0.1:18937', rewrite: path => path.replace(/^\/kokoro/, '') }
  } }
})

const result = {
  scope: 'Real EasyVoicePane, real reader/WAV utilities and HTMLAudioElement; minimal Uni DOM adapters; isolated Vite HTTP adapter bypasses Java, auth, installed Electron and download bridges.',
  upstream: 'http://127.0.0.1:18937', startedAt: new Date().toISOString(),
  coldClaim: process.env.KOKORO_COLD === '1' ? 'Caller confirms this service has not synthesized since process start; corroborate with service logs.' : 'First measurement only; model cold state is unconfirmed.',
  checks: {}, realMeasurements: [], errors: [], passed: false
}
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const url = `http://127.0.0.1:${address.port}`
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, userDataDir: profile, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 380, height: 840, deviceScaleFactor: 1 })
  page.on('pageerror', error => result.errors.push(String(error)))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const target = request.url()
    // Guard against accidental real backend/profile traffic if imports change.
    if (/^(blob:|data:)/.test(target) || target.startsWith(url + '/')) request.continue()
    else { result.errors.push(`Blocked unexpected request: ${target}`); request.abort() }
  })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const wait = async expression => {
    const handle = await page.waitForFunction(expression, { timeout: 120000 })
    await handle.dispose()
  }
  const snapshot = () => page.evaluate(() => window.__harness.snapshot())
  async function reset(config) {
    await page.goto(url, { waitUntil: 'networkidle0' })
    await wait(() => window.__harness?.pane()?.voicesLoaded && window.__harness.pane().selectedVoiceId)
    await page.evaluate(config => { window.__testConfig = { ...window.__testConfig, ...config } }, config)
  }
  async function start(text) {
    await page.$eval('textarea', (element, text) => { element.value = text; element.dispatchEvent(new Event('input', { bubbles: true })) }, text)
    await page.click('.action-area button')
  }
  const material = '这是第一段合成验收材料。第二段检查暂停和恢复是否保持当前位置。第三段验证字幕没有漏字。第四段确认完整音频可以下载。'

  await reset({ mode: 'synthetic' })
  await start(material)
  await wait(() => window.__harness.pane().reading.status === 'playing')
  const first = await snapshot()
  result.checks.firstSnapshot = first
  result.checks.firstRequests = await page.evaluate(() => window.__audit.requests)
  assert(first.generated < first.segments.length, 'First playback must precede final synthesis')
  assert.equal(first.activeText, first.segments[first.currentIndex], 'Visible active subtitle must match playing segment')
  result.checks.progressive = { ...first, events: await page.evaluate(() => window.__audit.audioEvents.slice()) }
  const requestsBeforeRate = await page.evaluate(() => window.__audit.requests.length)
  await page.$eval('input[type=range]', element => { element.value = '150'; element.dispatchEvent(new Event('input', { bubbles: true })) })
  const rated = await snapshot()
  assert.equal(rated.audio.playbackRate, 1.5)
  assert.equal(await page.evaluate(() => window.__audit.requests.length), requestsBeforeRate)
  result.checks.rate = { playbackRate: rated.audio.playbackRate, requestsBeforeRate, requestsAfterRate: requestsBeforeRate }
  await page.click('.play-btn')
  const pauseBefore = await page.evaluate(() => ({ time: window.__audit.audios.at(-1).currentTime, playingEvents: window.__audit.audioEvents.filter(e => e.name === 'playing').length }))
  await sleep(350)
  assert(Math.abs(await page.evaluate(() => window.__audit.audios.at(-1).currentTime) - pauseBefore.time) < 0.05, 'Paused audio clock moved')
  await wait(() => !window.__harness.pane().reading.generating)
  assert.equal((await snapshot()).status, 'paused')
  assert.equal(await page.evaluate(() => window.__audit.audioEvents.filter(e => e.name === 'playing').length), pauseBefore.playingEvents)
  result.checks.pause = { currentTime: pauseBefore.time, snapshotAfterGeneration: await snapshot(), noAutoResume: true }
  const decoded = await page.evaluate(() => window.__harness.decodeExport())
  assert.equal((await snapshot()).segments.join(''), material)
  assert.equal(decoded.duration, 8)
  const filesBefore = await readdir(output)
  await page.click('.download-link')
  let downloaded
  for (let i = 0; i < 100; i++) {
    downloaded = (await readdir(output)).find(name => name.endsWith('.wav') && !filesBefore.includes(name))
    if (downloaded) break
    await sleep(50)
  }
  assert(downloaded, 'Download button did not produce a WAV file')
  const downloadBytes = await readFile(join(output, downloaded))
  assert.equal(downloadBytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(downloadBytes.length, (await snapshot()).exportBytes)
  result.checks.export = { ...decoded, file: downloaded, bytes: downloadBytes.length, transcriptExact: true }
  await page.click('.play-btn')
  await wait(() => window.__harness.pane().reading.status === 'playing')
  result.checks.resume = { snapshot: await snapshot() }
  // A queued pause event can arrive after synchronous resume has restarted Audio.
  await page.evaluate(() => {
    const reader = window.__harness.pane()._reader
    reader.pause()
    reader.resume()
  })
  await sleep(100)
  assert.equal((await snapshot()).status, 'playing', 'A stale pause event stopped resumed playback')
  result.checks.quickPauseResume = await snapshot()
  await page.screenshot({ path: join(output, 'panel-380.png') })
  await wait(() => window.__harness.pane().reading.status === 'complete')
  result.checks.complete = { events: await page.evaluate(() => window.__audit.audioEvents), requests: await page.evaluate(() => window.__audit.requests) }
  assert.equal(result.checks.complete.requests.length, 4, 'Rate/pause caused extra synthesis')
  assert(result.checks.complete.requests.every(r => r.rate === '1'), 'Playback rate leaked into synthesis')

  for (const action of ['stop', 'unmount']) {
    await reset({ mode: 'synthetic', delays: [30, 1300, 30, 30] })
    await start(material)
    await wait(() => window.__harness.pane().reading.status === 'playing' && window.__audit.requests.length === 2)
    const playingCount = await page.evaluate(() => window.__audit.audioEvents.filter(e => e.name === 'playing').length)
    if (action === 'stop') await page.click('.stop-btn')
    else await page.evaluate(() => window.__harness.unmount())
    await sleep(1500)
    const after = await page.evaluate(() => ({ requests: window.__audit.requests, events: window.__audit.audioEvents, paused: window.__audit.audios.every(audio => audio.paused), rendered: !!document.querySelector('.easy-voice-pane') }))
    assert(after.paused, `${action}: audio remained playing`)
    assert.equal(after.events.filter(e => e.name === 'playing').length, playingCount, `${action}: late playback`)
    assert.equal(after.requests.length, 2, `${action}: generated additional segments`)
    assert.equal(after.requests[1].error, 'AbortError', `${action}: request not aborted`)
    result.checks[action] = after
  }
  await reset({ mode: 'synthetic', failAt: 1, delays: [30, 100] })
  await start(material)
  await wait(() => window.__harness.pane().reading.status === 'error')
  assert.equal((await snapshot()).exportBytes, 0)
  assert(await page.evaluate(() => window.__audit.audios.every(audio => audio.paused)))
  result.checks.failure = { snapshot: await snapshot(), requests: await page.evaluate(() => window.__audit.requests) }

  const realText = '这是本地语音首音测试。后续文字在第一段开始播放后继续合成。'
  // Identical safe synthetic text to the original whole-document baseline (744 characters).
  const longText = '第一条，合作内容。双方应当按照协议约定履行义务，及时提交所需材料。服务事项办理完毕后，按约定核对费用，确认无误后办理结算。\n'.repeat(12)
  assert.equal(longText.length, 744)
  for (const [label, text] of [['first', realText], ['warm', realText], ['warm-long', longText]]) {
    await reset({ mode: 'real' })
    await start(text)
    await wait(() => window.__harness.pane().reading.status === 'playing')
    const atFirst = await snapshot()
    const timing = await page.evaluate(() => ({ firstRequest: window.__audit.requests[0], firstPlaying: window.__audit.audioEvents.find(e => e.name === 'playing') }))
    await wait(() => !window.__harness.pane().reading.generating)
    const audio = await page.evaluate(() => window.__harness.decodeExport())
    assert.equal((await snapshot()).segments.join(''), text)
    assert(atFirst.generated < atFirst.segments.length, 'Real first playback waited for final segment')
    const requests = await page.evaluate(() => window.__audit.requests)
    assert.equal(requests.length, atFirst.segments.length, 'Every segment must have completed synthesis')
    assert(requests.every(request => request.bytes > 44 && !request.error), 'Every segment must have a valid audio response')
    result.realMeasurements.push({ label: label === 'first' && process.env.KOKORO_COLD === '1' ? 'cold' : label,
      chars: text.length,
      firstAudioMs: timing.firstPlaying.time - timing.firstRequest.start, firstSegmentHttpMs: timing.firstRequest.end - timing.firstRequest.start,
      fullGenerationMs: requests.at(-1).end - requests[0].start,
      generatedAtFirstPlaying: atFirst.generated, totalSegments: atFirst.segments.length,
      transcriptExact: true, decoded: audio, requests })
    await page.click('.stop-btn')
  }
  assert.equal(result.errors.length, 0, 'Browser errors or unexpected external requests')
  result.passed = true
} catch (error) {
  result.failure = { message: error.message, stack: error.stack }
  process.exitCode = 1
} finally {
  result.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2))
  result.cleanup = {}
  let cleanupStart = performance.now()
  await browser?.close()
  result.cleanup.browserCloseMs = performance.now() - cleanupStart
  cleanupStart = performance.now()
  await server.close()
  result.cleanup.viteCloseMs = performance.now() - cleanupStart
  cleanupStart = performance.now()
  await rm(profile, { recursive: true, force: true })
  await rm(cache, { recursive: true, force: true })
  result.cleanup.tempRemovalMs = performance.now() - cleanupStart
  result.cleanup.remainingResources = process.getActiveResourcesInfo()
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ passed: result.passed, output, realMeasurements: result.realMeasurements, failure: result.failure }, null, 2))
}
