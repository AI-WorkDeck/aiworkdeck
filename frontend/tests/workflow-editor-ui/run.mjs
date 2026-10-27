// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated real-Uni component acceptance. All API data are synthetic.
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const frontend = fileURLToPath(new URL('../../', import.meta.url));
const {
  buildHarness
} = await import(frontend + '/tests/tts-panel-ui/build.mjs');
const {
  default: puppeteer
} = await import(frontend + '/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js');
const output = resolve(process.argv[2] || '/tmp/awd-workflow-1532-uni');
await mkdir(output, {
  recursive: true
});
const built = await buildHarness(output);
await symlink(join(frontend, 'src/composables'), join(built.workspace, 'src/composables'), 'dir');
const fixture = await readFile(new URL('./PanelPage.vue', import.meta.url), 'utf8');
await writeFile(join(built.workspace, 'src/pages/tts/index.vue'), fixture);
await writeFile(join(built.workspace, 'src/services/api.js'), await readFile(new URL('./api.js', import.meta.url), 'utf8'));
await writeFile(join(built.workspace, 'src/i18n.js'), `import chat from ${JSON.stringify(join(frontend, 'src/locales/zh-CN/chat.js'))};export const t=(key,args={})=>{let text=chat[key.split('.').slice(1).join('.')]||key;for(const [k,v] of Object.entries(args))text=text.replace('{'+k+'}',v);return text};`);
await writeFile(join(built.workspace, 'src/main.js'), `import{createSSRApp}from'vue';import{createI18n}from'vue-i18n';import App from './App.vue';import chat from '@/locales/zh-CN/chat.js';export function createApp(){const app=createSSRApp(App);app.use(createI18n({legacy:true,locale:'zh-CN',messages:{'zh-CN':{chat}}}));return{app}}`);
let config = await readFile(join(built.workspace, 'vite.config.mjs'), 'utf8');
config = config.replaceAll(join(frontend, 'tests/tts-panel-ui/api.js'), join(built.workspace, 'src/services/api.js'));
if (process.env.WORKFLOW_EDITOR_NEGATIVE === 'layout') {
  config = config.replace('plugins:[', `plugins:[{name:'negative-workflow-layout',enforce:'pre',transform(code,id){if(!id.endsWith('/BuiltinWorkflowEditor.vue'))return null;if(!code.includes('@container (max-width: 600px)'))throw Error('Negative layout marker missing');return code.replace('@container (max-width: 600px)','@container (max-width: 1px)');}},`);
}
await writeFile(join(built.workspace, 'vite.config.mjs'), config);
const sourceHashes = {};
for (const file of ['src/components/BuiltinWorkflowEditor.vue', 'src/composables/useBuiltinWorkflows.js', 'src/App.vue']) {
  sourceHashes[file] = createHash('sha256').update(await readFile(join(frontend, file))).digest('hex');
}
await writeFile(join(output, 'build.json'), JSON.stringify({ compiler: '@dcloudio/vite-plugin-uni', sourceHashes, negative: process.env.WORKFLOW_EDITOR_NEGATIVE || null }, null, 2));
const child = spawn(process.execPath, [join(frontend, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'), 'build', '-p', 'h5', '--config', join(built.workspace, 'vite.config.mjs')], {
  cwd: built.workspace,
  env: {
    ...process.env,
    UNI_INPUT_DIR: join(built.workspace, 'src'),
    UNI_OUTPUT_DIR: built.dist,
    UNI_PLATFORM: 'h5'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', d => log += d);
child.stderr.on('data', d => log += d);
const code = await new Promise(r => child.on('exit', r));
await writeFile(join(output, 'uni-build.log'), log);
assert.equal(code, 0, log.slice(-1500));
const server = createServer(async (req, res) => {
  try {
    const path = resolve(built.dist, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!path.startsWith(built.dist + '/')) throw Error();
    const data = await readFile(path);
    res.setHeader('Content-Type', {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css'
    }[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.setRequestInterception(true);
page.on('request', r => r.url().startsWith(origin + '/') || /^(blob:|data:)/.test(r.url()) ? r.continue() : r.respond({
  status: 200,
  body: ''
}));
const results = {
  variants: [],
  checks: [],
  errors
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function load(width, theme) {
  await page.setViewport({
    width,
    height: 800
  });
  await page.goto(origin + '/?theme=' + theme + '#/pages/tts/index', {
    waitUntil: 'networkidle0'
  });
  await page.waitForSelector('.bw-editor-dialog');
}
try {
  for (const width of [320, 600, 1000]) for (const theme of ['light', 'dark']) {
    await load(width, theme);
    const g = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      editor: document.querySelector('.bw-editor-dialog').getBoundingClientRect().toJSON(),
      main: {
        width: document.querySelector('.bw-editor-main').clientWidth,
        scroll: document.querySelector('.bw-editor-main').scrollWidth
      },
      fieldGaps: [...document.querySelectorAll('.bw-field-group')].slice(0, -1).map(group => {
        const next = group.nextElementSibling;
        return next.getBoundingClientRect().top - group.lastElementChild.getBoundingClientRect().bottom;
      }),
      sidebar: document.querySelector('.bw-editor-sidebar').getBoundingClientRect().toJSON()
    }));
    results.variants.push({
      width,
      theme,
      geometry: g
    });
    await page.screenshot({
      path: join(output, `${width}-${theme}.png`)
    });
    assert(g.document <= width + 1);
    assert(g.main.scroll <= g.main.width + 1);
    assert(g.fieldGaps.every(gap => gap >= 8), 'field labels and inputs must not overlap');
  }
  await load(1000, 'light');
  assert.equal(await page.$eval('.bw-input input', el => el.value), '系统默认版');
  await page.click('.bw-sidebar-new-btn');
  const cdp = await page.createCDPSession();
  await page.click('.bw-input input');
  await page.$eval('.bw-input input', el => el.select());
  await cdp.send('Input.insertText', {
    text: '即时保存测试'
  });
  await page.click('.bw-footer-right .awd-btn-primary');
  await page.waitForFunction(() => window.__workflowFixtures.calls.some(c => c[0] === 'save'));
  const saved = await page.evaluate(() => window.__workflowFixtures.calls.find(c => c[0] === 'save')[2]);
  assert.equal(saved.name, '即时保存测试');
  assert.equal(saved.projectId, 1);
  results.checks.push({
    name: 'immediate native name input then save',
    payload: saved
  });
  await load(1000, 'light');
  await page.click('.bw-sidebar-new-btn');
  await page.click('.bw-textarea-code textarea');
  await cdp.send('Input.insertText', {
    text: '追加草稿文本'
  });
  await wait(150);
  const draft = await page.$eval('.bw-textarea-code textarea', e => e.value);
  await page.evaluate(() => window.__workflowQA.shown = false);
  await wait(100);
  await page.evaluate(() => window.__workflowQA.shown = true);
  assert.equal(draft, await page.$eval('.bw-textarea-code textarea', e => e.value));
  results.checks.push({
    name: 'v-show preserves draft',
    pass: true
  });
  await page.evaluate(() => {
    window.__workflowFixtures.delay = 350;
    window.dispatchEvent(new CustomEvent('awd:builtin-workflows-changed'));
  });
  await page.evaluate(() => {
    window.__workflowFixtures.delay = 0;
    window.__workflowQA.projectId = 2;
  });
  await wait(500);
  const projectForm = await page.$eval('.bw-textarea-code textarea', e => e.value);
  const projectVersions = await page.$$eval('.bw-sidebar-item-name', els => els.map(e => e.textContent));
  assert(projectForm.includes('合成规则2') && !projectForm.includes('追加草稿文本'), 'project change must replace the previous project draft');
  assert(projectVersions.includes('合成个人版本2'));
  results.checks.push({
    name: 'project change after old response',
    versions: projectVersions,
    form: projectForm
  });
  await page.screenshot({
    path: join(output, 'project-race.png')
  });
  assert.equal(errors.length, 0);
  results.passed = true;
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.checks, null, 2));
} catch (error) {
  results.failure = error.message;
  throw error;
} finally {
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await rm(built.workspace, {
    recursive: true,
    force: true
  });
}
