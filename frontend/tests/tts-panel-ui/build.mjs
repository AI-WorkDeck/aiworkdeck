// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readFile, writeFile, mkdtemp, symlink, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

export const here = dirname(fileURLToPath(import.meta.url))
export const frontend = resolve(here, '../..')
const header = '// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors\n// SPDX-License-Identifier: AGPL-3.0-or-later\n'

export async function buildHarness(output) {
  await mkdir(output, { recursive: true })
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'tts-1339-uni-')))
  const src = join(workspace, 'src')
  const dist = join(workspace, 'dist')
  await mkdir(join(src, 'pages/tts'), { recursive: true })
  // Uni owns the @ alias. Symlink the real production modules into the isolated input tree.
  for (const directory of ['components', 'utils', 'config', 'locales']) await symlink(join(frontend, 'src', directory), join(src, directory), 'dir')
  await mkdir(join(src, 'services'))
  for (const [target, fixture] of [['api.js', 'api.js'], ['host.js', 'host.js'], ['componentDownloads.js', 'host.js']]) {
    await writeFile(join(src, 'services', target), await readFile(join(here, fixture), 'utf8'))
  }
  await symlink(join(frontend, 'node_modules'), join(workspace, 'node_modules'), 'dir')
  const packageJson = JSON.parse(await readFile(join(frontend, 'package.json'), 'utf8'))
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ type: 'module', dependencies: packageJson.dependencies, devDependencies: packageJson.devDependencies }))
  await writeFile(join(workspace, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>')
  await writeFile(join(src, 'pages.json'), JSON.stringify({ pages: [{ path: 'pages/tts/index', style: { navigationStyle: 'custom' } }], globalStyle: { navigationStyle: 'custom', rpxCalcMaxDeviceWidth: 0 } }))
  await writeFile(join(src, 'manifest.json'), JSON.stringify({ name: 'TTS panel isolated QA', appid: '__UNI__TTS_QA', versionName: '1.0.0', h5: { router: { mode: 'hash' } } }))
  const source = await readFile(join(frontend, 'src/App.vue'), 'utf8')
  const style = source.slice(source.indexOf('<style>'))
  await writeFile(join(src, 'App.vue'), '<script>export default {}</script>\n' + style)
  await writeFile(join(src, 'pages/tts/index.vue'), await readFile(join(here, 'PanelPage.vue'), 'utf8'))
  await writeFile(join(src, 'main.js'), header + `import ${JSON.stringify(join(here, 'instrument.js'))};
import { createSSRApp } from 'vue';
import { createI18n } from 'vue-i18n';
import App from './App.vue';
import zh from '@/locales/zh-CN/panels.js';
import en from '@/locales/en-US/panels.js';
const locale = new URLSearchParams(location.search).get('lang') || 'zh-CN';
export function createApp() { const app = createSSRApp(App); app.use(createI18n({ legacy:true,locale,messages:{'zh-CN':{panels:zh},'en-US':{panels:en}} })); return {app}; }
`)
  const aliases = [
    { find: '@/services/api.js', replacement: join(here, 'api.js') },
    { find: '@/services/host.js', replacement: join(here, 'host.js') },
    { find: '@/services/componentDownloads.js', replacement: join(here, 'host.js') },
    { find: '@', replacement: join(frontend, 'src') }
  ]
  await writeFile(join(workspace, 'vite.config.mjs'), header + `import uni from '@dcloudio/vite-plugin-uni';
export default { root: ${JSON.stringify(workspace)}, base:'./',plugins:[uni.default ? uni.default() : uni()],resolve:{alias:${JSON.stringify(aliases)}},build:{outDir:${JSON.stringify(dist)},emptyOutDir:true} };
`)
  const buildLog = []
  const child = spawn(process.execPath, [join(frontend, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'), 'build', '-p', 'h5', '--config', join(workspace, 'vite.config.mjs')], {
    cwd: workspace, env: { ...process.env, UNI_INPUT_DIR: src, UNI_OUTPUT_DIR: dist, UNI_PLATFORM: 'h5' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', data => buildLog.push(data.toString()))
  child.stderr.on('data', data => buildLog.push(data.toString()))
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  await writeFile(join(output, 'uni-build.log'), buildLog.join(''))
  if (code !== 0) throw new Error(`Uni H5 harness build failed (${code}); see ${join(output, 'uni-build.log')}`)
  const hashes = {}
  for (const path of ['src/components/EasyVoicePane.vue', 'src/components/AwdSelect.vue', 'src/App.vue']) hashes[path] = createHash('sha256').update(await readFile(join(frontend, path))).digest('hex')
  await writeFile(join(output, 'build.json'), JSON.stringify({ workspace, dist, compiler: '@dcloudio/vite-plugin-uni', hashes }, null, 2))
  return { workspace, dist, hashes }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await buildHarness(resolve(process.argv[2] || '/tmp/tts-1339-ui')))
