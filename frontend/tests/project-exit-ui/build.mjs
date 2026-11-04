// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { build } from 'esbuild'
const root = fileURLToPath(new URL('../../', import.meta.url))
const out = '/tmp/awd-project-exit-ui-1685'
mkdirSync(out, { recursive: true })
const { descriptor } = parse(readFileSync(root + 'src/components/version/ProjectExitDialog.vue', 'utf8'))
const source = descriptor.script.content.replace(/import[^\n]+\n/g, '').replace('export default', 'const component =')
const render = compile(descriptor.template.content, { mode: 'module' }).code.replace('export function render', 'function render')
await build({ stdin: { contents: `
import { createApp } from 'vue';
import { inspectExitProject, commitExitProjects } from './src/utils/projectExitState.js';
import messages from './src/locales/zh-CN/version.js';
const done = new Set(); window.commits = []; window.exitResult = null;
const getMyProjects = async () => ({data: [{id:1,name:'项目一：已经完成并保留历史的文件'}, {id:2,name:'项目二：这是一个非常长的项目名称用于确认窄窗口下不会挤掉勾选框和操作按钮以及状态说明'}]});
const getVersionExitStatus = async id => ({data: {enabled:true,working:!done.has(id),changedCount:done.has(id)?0:id+2,canCommit:!done.has(id)}});
const endWorkSession = async id => {window.commits.push(id); if(id===2 && !window.allowSecond) throw Error('synthetic failure'); done.add(id);return {data:{sha:'receipt',notice:''}}};
${source}
${render}
component.render = render;
const app=createApp(component,{isCurrent:()=>true,onClose:value=>{window.exitResult=value}});
app.config.globalProperties.$t=(key,args)=> {let text=key.startsWith('version.') ? messages[key.slice(8)] : ({'common.cancel':'取消','common.retry':'重试'}[key] || key);return args?text.replace('{count}',args.count):text};
app.mount('#app');`, resolveDir: root }, bundle: true, format: 'esm', outfile: out + '/app.js', define: { __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } })
writeFileSync(out + '/index.html', `<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--awd-overlay:#0006;--awd-surface:#fcfbf7;--awd-text:#383832;--awd-border:#dddacf}*{box-sizing:border-box}body{font-family:system-ui;margin:0}${descriptor.styles.map(s=>s.content).join('\n')}</style><div id="app"></div><script type="module" src="app.js"></script></html>`)
console.log(out)
