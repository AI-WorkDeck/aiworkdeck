// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run from frontend: node tests/dd-workflow/client-responsive-fixture.mjs
// Actual SFC templates, state and scoped styles; transport uses synthetic data only.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileStyleAsync } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import zh from '../../src/locales/zh-CN/ddWorkflow.js'
const require = createRequire(import.meta.url)
const components = ['DdClientChecklist', 'DdClientWorkspace']
const compiled = await Promise.all(components.map(async name => {
  const { descriptor } = parse(readFileSync(new URL(`../../src/components/dd/${name}.vue`, import.meta.url), 'utf8'))
  const id = `data-v-${name.toLowerCase()}`
  const style = await compileStyleAsync({ source: descriptor.styles[0].content, filename: `${name}.vue`, id, scoped: true, preprocessLang: 'scss' })
  if (style.errors.length) throw style.errors[0]
  const script = descriptor.script.content.replace(/^import .*$/gm, '').replace('export default', `const ${name} =`)
  const render = compile(descriptor.template.content, { mode: 'function', prefixIdentifiers: true, isCustomElement: tag => ['checkbox', 'checkbox-group', 'progress'].includes(tag) }).code
  return { style: style.code, script: `${script}\n${name}.render = new Function('Vue', ${JSON.stringify(render)})(Vue); ${name}.__scopeId = '${id}';` }
}))
const globalStyle = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1]
const fixture = `
const rows = [{ id: 7, title: '营业执照与完整登记信息', status: 'PENDING', exampleFileId: 1, description: Array.from({length: 12}, (_, i) => (i + 1) + '. 请提供清晰完整的材料，包含正本、副本及全部变更页。不得裁剪登记机关印章。').join('\\n') + '\\n要求末尾：请核对全部页码。' }, { id: 8, title: '财务报表', status: 'PENDING', description: '提供最近三个年度的报表。' }];
window.fixture = { uploads: [], completed: false, finish: null };
const ddClientRead = async (scope, path) => path === '/projects' ? [{id: 1, name: '合成尽调清单', status: 'PUBLISHED'}, {id: 2, name: '另一份清单', status: 'PUBLISHED'}] : path.startsWith('/requests/') ? {request: {id: scope.requestId, name: '合成尽调清单', status: 'PUBLISHED'}, items: rows, submissionsByItem: window.fixture.completed ? {7: {reviewStatus: 'UPLOADED'}} : {}} : [];
const ddClientUpload = (scope, itemId, files, key, consent, progress) => { window.fixture.uploads.push({scope, itemId, count: files.length, key}); progress(45); return new Promise(resolve => { window.fixture.finish = () => { window.fixture.completed = true; progress(100); resolve() } }) };
const ddClientWrite = async () => ({}), ddClientDownload = async () => {};
const listDdClientConnections = async () => [{id:'synthetic-a',projectId:10,name:'合成客户项目'}, {id:'synthetic-b',projectId:11,name:'另一个合成项目'}];
const ddNotificationPermission = () => 'granted', ddClientIdentity = () => 'synthetic', isClientPortalBuild = () => true;
const pollDdClientNotifications = async () => ({notifications:[]});
${compiled.map(x => x.script).join('\n')}
const app = Vue.createApp(DdClientWorkspace);
const messages = {ddWorkflow: ${JSON.stringify(zh)}};
app.config.globalProperties.$t = (path, params = {}) => { let text = path.split('.').reduce((value, part) => value?.[part], messages) || path; return String(text).replace(/\\{(\\w+)\\}/g, (_, key) => params[key] ?? key) };
window.fixture.workspace = app.mount('#app');
`
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Client materials synthetic fixture</title><style>${globalStyle}\n${compiled.map(x => x.style).join('\n')}\nhtml,body,#app{margin:0;height:100%;font-family:system-ui,sans-serif}*{box-sizing:border-box}</style><div id="app"></div><script src="/vue.js"></script><script>${fixture}</script></html>`
createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.statusCode = 204; res.end(); return }
  if (req.url === '/vue.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(require.resolve('vue/dist/vue.global.js'))); return }
  if (req.url !== '/') { res.statusCode = 404; res.end(); return }
  res.setHeader('Content-Type', 'text/html'); res.end(html)
}).listen(4175, '127.0.0.1', () => console.log('Synthetic client fixture: http://127.0.0.1:4175'))
