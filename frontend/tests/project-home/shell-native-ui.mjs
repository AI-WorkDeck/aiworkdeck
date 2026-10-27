// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated synthetic Electron shell: actual AccountEntry + overlay state + native browser registry.
// No product backend, user profile, credentials or external network. Run with SHELL_UI_ELECTRON if needed.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { parse } from 'vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import * as sass from 'sass'
import { ICONS } from '../../src/config/icons.js'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-shell-native-'))
const baseline = process.env.SHELL_UI_BASELINE === '1'
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const sfc = baseline ? execFileSync('git', ['show', `${process.env.SHELL_UI_BASELINE_REF || '9121174e1'}:frontend/src/components/account/AccountEntry.vue`], { cwd: path.dirname(root), encoding: 'utf8' }) : read('src/components/account/AccountEntry.vue')
const component = parse(sfc).descriptor
const options = component.script.content.replace(/^import .*$/gm, '').replace('export default', 'return')
const render = compile(component.template.content, { mode: 'function' }).code
const overlay = read('src/utils/overlayState.js').replace(/^import .*$/gm, '').replace(/export /g, '')
const page = read('src/pages/project-overview/project-overview.vue')
const overlayStart = page.indexOf('    desktopOverlayActive(open) {')
const overlayWatcher = page.slice(overlayStart, page.indexOf('\n    },', overlayStart)) + '\n}'
const toggleStart = page.indexOf('    toggleSidebar() {')
const toggle = page.slice(toggleStart, page.indexOf('\n    },', toggleStart)) + '\n}'
const tabRender = compile(`<div class="sidebar-left" :style="{width: sidebarCollapsed ? '0px' : '260px'}"><div v-if="!sidebarCollapsed" class="sidebar-header">资源管理器</div><div v-if="!sidebarCollapsed" style="padding:16px">合成测试项目</div></div>`, { mode: 'function' }).code
const css = sass.compileString(component.styles[0].content).css + sass.compileString(read('src/pages/project-overview/project-overview.scss')).css
const translations = { 'workbench.accountMenu': '账户菜单', 'workbench.settingsTabName': '设置', 'account.logoutBtn': '退出登录', 'calendar.mySchedule': '我的日程', 'workbench.walletMenuLabel': '账户与用量', 'workbench.collapseSidebar': '收起左侧栏' }
fs.copyFileSync(require.resolve('vue/dist/vue.global.js'), path.join(out, 'vue.js'))
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><style>${css}
:root {--awd-radius-sm:4px;--awd-bg:#f1efe6;--awd-surface:#fffdf9;--awd-surface-2:#e4efeb;--awd-text:#262923;--awd-text-2:#63685f;--awd-text-3:#858b80;--awd-border:#d9d8cc;--awd-border-subtle:#e5e4d9;--awd-accent:#2e6056;--awd-accent-text:#2e6056;--awd-text-on-accent:white;--awd-workbench-header-height:37px;}body{margin:0;background:var(--awd-bg);font:14px system-ui}view{display:block}#top{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid var(--awd-border)}#sidebar{display:flex;position:absolute;left:46px;top:49px;height:calc(100vh - 49px)}.sidebar-left{height:100%}#rail{position:absolute;top:80px;left:8px}#account{margin-left:auto}#blank{padding:70px 340px;color:#999}
</style><div id="top">AI WorkDeck · 合成隔离测试<div id="account"></div></div><button id="rail">▣</button><div id="sidebar"></div><div id="blank">原生网页打开时，账户菜单应完整显示。</div>
<script src="./vue.js"></script><script>
const {ref, computed, watch} = Vue;
${overlay}
const ICONS = ${JSON.stringify(ICONS)}; const ACCOUNT_CHANGED_EVENT = 'awd:account-changed';
window.uni = {$on(){},$off(){}};
const entry = (()=>{${options}})(); entry.render = (()=>{${render}})();
const accountApp = Vue.createApp(entry, {loggedIn:true, displayName:'QA 合成账号',walletVisible:true,walletText:'¥100.00',walletTier:'测试'});
accountApp.config.globalProperties.$t = k => (${JSON.stringify(translations)})[k] || k;
const account = accountApp.mount('#account');
const saveSidebarCollapsed = () => {};
const side = Vue.createApp({data:()=>({sidebarCollapsed:false}),methods:{${toggle},$t:k=>(${JSON.stringify(translations)})[k]||k,triggerWorkbenchResize(){}},render:(()=>{${tabRender}})()}).mount('#sidebar');
document.querySelector('#rail').onclick=()=>side.toggleSidebar();
const host = {browser:{setViewsVisible:async({visible})=>window.nativeBridge.visible(visible)}};
const desktopWatcher = ({${overlayWatcher}}).desktopOverlayActive;
watch(globalOverlayActive, active => desktopWatcher.call({isDesktopApp:true,$nextTick:fn=>Vue.nextTick(fn),triggerWorkbenchResize(){}},active), {flush:'sync'});
window.shellTest={account,side,hold:active=>setGlobalOverlay(active,'other-dialog'),unmount:()=>accountApp.unmount()};
</script>`)
fs.writeFileSync(path.join(out, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('nativeBridge',{visible:value=>ipcRenderer.send('visible',value)});`)
fs.writeFileSync(path.join(out, 'main.cjs'), `const {app,BrowserWindow,BrowserView,ipcMain,desktopCapturer}=require('electron');const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const out=__dirname;const profile=path.join(out,'profile');fs.mkdirSync(profile,{recursive:true});
for(const name of ['home','appData','userData','sessionData','temp','documents','downloads','desktop','logs','crashDumps']){const p=path.join(profile,name);fs.mkdirSync(p,{recursive:true});app.setPath(name,p);}
const {createBrowserViewRegistry}=require(${JSON.stringify(path.join(root, '../desktop/main/browser-views.js'))});
app.whenReady().then(async()=>{let win;try{
win=new BrowserWindow({title:'AWD Shell Native QA '+process.pid,width:1100,height:760,show:false,webPreferences:{preload:path.join(out,'preload.cjs'),contextIsolation:true,nodeIntegration:false,partition:'shell-synthetic-'+Date.now()}});
win.webContents.on('console-message',(_,level,message)=>fs.appendFileSync(path.join(out,'renderer.log'),message+'\\n'));
const views=createBrowserViewRegistry({createView:()=>new BrowserView({webPreferences:{partition:'native-synthetic-'+Date.now()}}),getWindow:()=>win});
ipcMain.on('visible',(_,visible)=>views.setAllVisible(visible));
const run=code=>win.webContents.executeJavaScript(code);const pause=()=>new Promise(r=>setTimeout(r,150));
await win.loadFile(path.join(out,'index.html'));
const {view}=views.ensure('foreground');await view.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<body style="background:#dce9f5;font:24px system-ui;padding:36px">原生浏览器合成网页<input id="draft" value="保留输入内容"><script>window.persisted=42</script>'));
const browserX=await run("Math.ceil(document.querySelector('.sidebar-left').getBoundingClientRect().right)");
views.setBounds('foreground',{x:browserX,y:90,width:1100-browserX,height:640});views.attach('foreground');win.showInactive();await new Promise(r=>setTimeout(r,800));
const screenshot=async name=>{fs.writeFileSync(path.join(out,name+'-renderer.png'),(await win.capturePage()).toPNG());for(let attempt=0;attempt<10;attempt++){const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:2200,height:1600}});const own=sources.find(s=>s.name==='AWD Shell Native QA '+process.pid);if(own&&!own.thumbnail.isEmpty()){fs.writeFileSync(path.join(out,name+'.png'),own.thumbnail.toPNG());return;}await new Promise(r=>setTimeout(r,300));}throw new Error('Native window capture unavailable: '+name);};
await screenshot('01-browser');
assert.equal(await run("document.querySelector('.sidebar-collapse-tab')===null"),true);
await run("document.querySelector('#rail').click()");await pause();assert.equal(await run("shellTest.side.sidebarCollapsed"),true);
await run("document.querySelector('#rail').click()");await pause();assert.equal(await run("shellTest.side.sidebarCollapsed"),false);
await run("document.querySelector('.account-entry-btn').dispatchEvent(new Event('tap',{bubbles:true}))");await pause();await screenshot('02-account-open');
if(${baseline}){assert.deepEqual(views._state().attached,['foreground']);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({baselineReproduced:true,out},null,2));}
else{
assert.deepEqual(views._state().attached,[],'menu must detach native foreground');assert.equal(win.getBrowserViews().length,0);
assert.equal(await run("document.querySelector('.avatar-menu').textContent.includes('设置')"),true);
await run("shellTest.hold(true);document.querySelector('.account-entry-mask').dispatchEvent(new Event('tap',{bubbles:true}))");await pause();assert.deepEqual(views._state().attached,[],'second overlay still owns hide');
await run('shellTest.hold(false)');await pause();assert.deepEqual(views._state().attached,['foreground']);assert.equal(win.getBrowserViews()[0],view);assert.equal(await view.webContents.executeJavaScript('window.persisted'),42);
await screenshot('03-browser-restored');
await run("document.querySelector('.account-entry-btn').dispatchEvent(new Event('tap',{bubbles:true}))");await pause();await run('shellTest.unmount()');await pause();assert.deepEqual(views._state().attached,['foreground']);
const paths=Object.fromEntries(['home','userData','sessionData'].map(k=>[k,app.getPath(k)]));for(const value of Object.values(paths))assert.ok(value.startsWith(profile));
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks:['no protruding collapse tab','rail collapses','rail reopens','native view hidden under account','other overlay retained','same browser state restored','unmount restores'],paths,out},null,2));
}views.destroyAll();win.destroy();app.quit();}catch(error){fs.writeFileSync(path.join(out,'failure.txt'),error.stack);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}});`)
const executable = process.env.SHELL_UI_ELECTRON || createRequire(path.join(root, '../desktop/package.json'))('electron')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(executable, [path.join(out, 'main.cjs')], { env, stdio: 'ignore' })
const timeout = setTimeout(() => child.kill(), 45000)
const code = await new Promise(resolve => child.on('exit', resolve)); clearTimeout(timeout)
console.log(`Evidence: ${out}`)
if (code !== 0 || !fs.existsSync(path.join(out, 'result.json'))) throw new Error(fs.existsSync(path.join(out, 'failure.txt')) ? fs.readFileSync(path.join(out, 'failure.txt'), 'utf8') : `Electron exited ${code}`)
console.log(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
