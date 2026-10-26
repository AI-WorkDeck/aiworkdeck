// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Uni H5 component build. Default fixtures simulate the executor; NAV_REAL=1
// additionally runs the same controls against the actual LOWA engine and synthetic Office files.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer-core'), JSZip = require('jszip')
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = resolve(frontend, '../output/office-navigation')
const workspace = join(output, 'uni-harness'), source = join(workspace, 'src'), dist = join(workspace, 'dist')
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const lowaDist = process.env.LOWA_DIST_DIR || join(frontend, 'dist/zetaoffice')
const engine = process.env.LOWA_ENGINE_DIR || join(lowaDist, 'lowa')
await mkdir(join(source, 'pages/navigation'), { recursive: true })
for (const [from, to] of [[join(frontend, 'node_modules'), join(workspace, 'node_modules')], [join(frontend, 'src/components'), join(source, 'components')], [join(frontend, 'src/locales'), join(source, 'locales')]]) {
  if (!existsSync(to)) await symlink(from, to, 'dir')
}
await writeFile(join(workspace, 'package.json'), await readFile(join(frontend, 'package.json')))
await writeFile(join(workspace, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>')
await writeFile(join(source, 'pages.json'), JSON.stringify({ pages: [{ path: 'pages/navigation/index', style: { navigationStyle: 'custom' } }], globalStyle: { navigationStyle: 'custom', rpxCalcMaxDeviceWidth: 0 } }))
await writeFile(join(source, 'manifest.json'), JSON.stringify({ name: 'Office navigation isolated QA', appid: '__UNI__OFFICE_NAV_QA', versionName: '1.0.0', h5: { router: { mode: 'hash' } } }))
const appSource = await readFile(join(frontend, 'src/App.vue'), 'utf8')
await writeFile(join(source, 'App.vue'), '<script>export default {}</script>\n' + appSource.slice(appSource.indexOf('<style>')))
await writeFile(join(source, 'main.js'), `import { createSSRApp } from 'vue'; import { createI18n } from 'vue-i18n'; import App from './App.vue'; import zh from '@/locales/zh-CN/editor.js'; export function createApp(){const app=createSSRApp(App);app.use(createI18n({legacy:true,locale:'zh-CN',messages:{'zh-CN':{editor:zh}}}));return {app};}`)
await writeFile(join(source, 'pages/navigation/index.vue'), `<template>
<view class="qa-shell"><view class="qa-title">AI WorkDeck <text>合成材料 · 导航验收</text></view><view class="qa-toolbar">{{ kind === 'impress' ? '幻灯片与版式　　插入　　形状与排列　　备注' : '数字格式　　单元格与行列　　数据　　插入' }}</view>
<view class="qa-body"><OfficeNavigation v-if="ready && kind === 'impress'" ref="nav" :executor="executor" :kind="kind" :refresh-key="refreshKey" :content-key="contentKey" :active="true" :writable="writable" @navigate="navigated" />
<iframe v-if="real" ref="engine" class="qa-engine" src="/engine/editor.html?verify=1&lowa=/lowa/"></iframe>
<view v-else class="qa-document"><view v-if="kind === 'impress'" class="qa-slide"><text class="qa-eyebrow">年度经营计划</text><text class="qa-slide-title">{{ activeId === 1 ? '把目标变成共同的行动' : '从关键事项开始' }}</text><text>合成演示内容，用于核对缩略图与导航布局。</text></view><view v-else class="qa-table"><view class="qa-table-heading">{{ activeId }}</view><view v-for="row in 12" :key="row" class="qa-row"><text>{{ row }}</text><text>项目 {{ row }}</text><text>待核对</text><text>—</text></view></view></view></view>
<OfficeNavigation v-if="ready && kind === 'calc'" ref="nav" :executor="executor" :kind="kind" :refresh-key="refreshKey" :content-key="contentKey" :active="true" :writable="writable" @navigate="navigated" @add-sheet="added++" />
</view></template>
<script>
import OfficeNavigation from '@/components/OfficeNavigation.vue'
const query=new URLSearchParams(location.search)
const real=query.get('real')==='1', kind=query.get('kind')||'impress'
const sheets=Array.from({length:60},(_,i)=>({id:i===0?'项目总览':i===1?'预算明细':'工作表 '+(i+1),name:i===0?'项目总览':i===1?'预算明细':'工作表 '+(i+1)}))
const slides=Array.from({length:12},(_,i)=>({id:i+1,name:'演示内容 '+(i+1),width:320,height:180}))
export default{components:{OfficeNavigation},data(){return {kind,real,ready:!real,activeId:kind==='calc'?sheets[0].id:1,refreshKey:0,contentKey:0,writable:true,added:0,requests:[],executor:{executeCommand:(...args)=>this.execute(...args)}}},mounted(){window.qa=this;if(real)this.boot()},methods:{async boot(){const frame=this.$refs.engine;const start=Date.now();while(!frame.contentWindow?.__loExecutor){if(Date.now()-start>240000)throw new Error('engine boot timeout');await new Promise(r=>setTimeout(r,100))}const doc=await fetch('/fixture.'+(kind==='calc'?'xlsx':'pptx')).then(r=>r.arrayBuffer());await frame.contentWindow.__loExecutor.executeCommand('load_document',{name:'qa.'+(kind==='calc'?'xlsx':'pptx'),bytes:Array.from(new Uint8Array(doc))});await frame.contentWindow.__loExecutor.executeCommand('set_chrome',{menubar:false,statusbar:false,toolbars:false,sheetTabs:false});const d=frame.contentDocument;d.querySelectorAll('#verify,#vlog').forEach(x=>x.style.display='none');this.ready=true},async execute(action,params={}){this.requests.push({action,params});if(real)return this.$refs.engine.contentWindow.__loExecutor.executeCommand(action,params);if(action==='office_get_navigation')return {success:true,kind,documentSeq:1,activeId:this.activeId,items:kind==='calc'?sheets:slides};if(action==='office_activate_item'){this.activeId=params.id;return {success:true,documentSeq:1}}if(action==='slide_get_thumbnail'){const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#fcfbf7';x.fillRect(0,0,320,180);x.fillStyle='#2e5a50';x.fillRect(0,0,9,180);x.font='bold 22px sans-serif';x.fillText(params.slideNumber===1?'把目标变成共同的行动':'从关键事项开始',24,65);x.fillStyle='#6b675c';x.font='12px sans-serif';x.fillText('合成演示内容 · '+params.slideNumber,24,112);const blob=await new Promise(r=>c.toBlob(r));return {success:true,documentSeq:1,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))}}throw new Error('Unknown '+action)},async navigated(){if(real){const r=await this.execute('office_get_navigation');this.activeId=r.activeId}this.refreshKey++}}}
</script>
<style>
.qa-shell{height:100vh;display:flex;flex-direction:column;background:var(--awd-bg);color:var(--awd-text);font-family:var(--awd-font-sans)}.qa-title{height:42px;display:flex;align-items:center;gap:24px;padding:0 18px;border-bottom:1px solid var(--awd-border);font-size:14px;font-weight:600}.qa-title text{font-size:11px;font-weight:400;color:var(--awd-text-2)}.qa-toolbar{height:38px;padding:0 16px;display:flex;align-items:center;border-bottom:1px solid var(--awd-border);font-size:12px;white-space:nowrap;overflow:hidden;background:var(--awd-surface)}.qa-body{display:flex;flex:1;min-height:0}.qa-document{min-width:0;flex:1;display:flex;align-items:center;justify-content:center;padding:32px;overflow:hidden}.qa-slide{box-sizing:border-box;width:100%;aspect-ratio:16/9;background:#fcfbf7;color:#2b2a26;padding:32px;display:flex;flex-direction:column;justify-content:center;gap:18px;border-left:8px solid #2e5a50;box-shadow:var(--awd-shadow-md)}.qa-eyebrow{font-size:12px;color:#6b675c}.qa-slide-title{font-size:clamp(18px,3vw,36px);font-weight:600;color:#2e5a50}.qa-slide>text:last-child{font-size:12px}.qa-table{align-self:stretch;flex:1;background:var(--awd-surface);font-size:12px}.qa-table-heading{height:28px;padding-left:12px;display:flex;align-items:center;border-bottom:1px solid var(--awd-border);font-weight:600}.qa-row{height:30px;display:grid;grid-template-columns:32px 1fr 1fr 1fr}.qa-row text{padding:6px;border-right:1px solid var(--awd-border);border-bottom:1px solid var(--awd-border)}.qa-engine{border:0;flex:1;min-width:0;height:100%}
</style>`)
await writeFile(join(workspace, 'vite.config.mjs'), `import uni from '@dcloudio/vite-plugin-uni';export default {root:${JSON.stringify(workspace)},base:'./',plugins:[uni.default?uni.default():uni()],build:{outDir:${JSON.stringify(dist)},emptyOutDir:true}}`)
const chunks = []
const build = spawn(process.execPath, [join(frontend, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'), 'build', '-p', 'h5', '--config', join(workspace, 'vite.config.mjs')], { cwd:workspace, env:{...process.env,UNI_INPUT_DIR:source,UNI_OUTPUT_DIR:dist,UNI_PLATFORM:'h5'},stdio:['ignore','pipe','pipe'] })
build.stdout.on('data',b=>chunks.push(b.toString()));build.stderr.on('data',b=>chunks.push(b.toString()))
const buildCode=await new Promise((r,j)=>{build.on('exit',r);build.on('error',j)})
await writeFile(join(output,'navigation-uni-build.log'),chunks.join(''))
assert.equal(buildCode,0,'Uni component compilation')
const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
let sheets='',relations='',types=''
for(let i=1;i<=60;i++){const name=i===1?'项目总览':i===2?'预算明细':'工作表 '+i;sheets+=`<sheet name="${name}" sheetId="${i}" r:id="rId${i}"/>`;relations+=`<Relationship Id="rId${i}" Type="${rel}/worksheet" Target="worksheets/sheet${i}.xml"/>`;types+=`<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;zip.file(`xl/worksheets/sheet${i}.xml`,`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>合成数据 ${i}</t></is></c></row></sheetData></worksheet>`)}
zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${types}</Types>`);zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets}</sheets></workbook>`);zip.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}</Relationships>`)
const xlsx=await zip.generateAsync({type:'nodebuffer'})
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.ttf':'font/ttf','.ttc':'font/collection','.otf':'font/otf'}
const enc=existsSync(join(engine,'.encodings.json'))?JSON.parse(readFileSync(join(engine,'.encodings.json'),'utf8')):{}
const server=createServer(async(req,res)=>{try{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cache-Control','no-store');const pathname=decodeURIComponent(req.url.split('?')[0]);if(pathname==='/fixture.xlsx'){res.end(xlsx);return}if(pathname==='/fixture.pptx'){res.end(await readFile(join(frontend,'tests/lowa-e2e/fixtures/impress-smoke.pptx')));return}const isEngine=pathname.startsWith('/lowa/');let file=isEngine?join(engine,pathname.slice(6)):pathname.startsWith('/engine/')?join(lowaDist,pathname.slice(8)):join(dist,pathname==='/'?'index.html':pathname.slice(1));if(pathname.startsWith('/engine/cjk')&&!existsSync(file))file=join(dirname(engine),pathname.slice(8));res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');if(isEngine&&enc[file.split('/').at(-1)])res.setHeader('Content-Encoding',enc[file.split('/').at(-1)]);res.end(await readFile(file))}catch(e){res.statusCode=404;res.end('Not found')}})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await puppeteer.launch({executablePath:chrome,headless:true,defaultViewport:{width:1080,height:760},args:['--disable-dev-shm-usage']})
const reports=[]
try{
 for(const real of process.env.NAV_REAL==='1'?[false,true]:[false])for(const kind of ['impress','calc']){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/?kind=${kind}&real=${real?1:0}`)
  await page.waitForSelector('.office-nav-item',{timeout:240000})
  const prefix=(real?'real':'synthetic')+'-'+kind
  // Uni compiles <button> to UNI-BUTTON, whose Enter/Space defaults differ
  // from a native HTML button. Assert actual keyboard input and one activation.
  assert.equal(await page.$eval('.office-nav-item',e=>e.tagName),'UNI-BUTTON')
  for(const key of ['Enter','Space']){
   await page.click('.office-nav-item:first-child')
   await page.waitForFunction(()=>document.querySelector('.office-nav-item:first-child').getAttribute('aria-selected')==='true' && !window.qa.$refs.nav._switching)
   const count=await page.evaluate(()=>window.qa.requests.filter(r=>r.action==='office_activate_item').length)
   await page.focus('.office-nav-item:nth-child(2)')
   await page.keyboard.press(key)
   await page.waitForFunction(()=>document.querySelector('.office-nav-item:nth-child(2)').getAttribute('aria-selected')==='true' && !window.qa.$refs.nav._switching)
   assert.equal(await page.evaluate(()=>window.qa.requests.filter(r=>r.action==='office_activate_item').length),count+1,`${key} must activate the unselected tab exactly once`)
  }
  await page.focus('.office-nav-item:nth-child(2)');await page.keyboard.press('Home')
  await page.waitForFunction(()=>document.querySelector('.office-nav-item:first-child').getAttribute('aria-selected')==='true' && !window.qa.$refs.nav._switching)
  if(kind==='impress'){
   await page.waitForFunction(()=>document.querySelector('.office-nav-preview img')?.naturalWidth>0,{timeout:30000})
   const before=await page.evaluate(()=>window.qa.activeId);await page.click('.office-nav-item:nth-child(2)');await page.waitForFunction(()=>window.qa.activeId===2,{timeout:10000});assert.notEqual(before,2)
   await page.focus('.office-nav-item:nth-child(2)');await page.keyboard.press('Home');await page.waitForFunction(()=>window.qa.activeId===1)
   assert.ok(await page.$eval('.office-nav-preview img',e=>e.naturalWidth>=240))
  }else{
   assert.equal(await page.$$eval('.office-nav-item',items=>items.length),60)
   if(real)assert.equal(await page.evaluate(async()=> (await window.qa.execute('set_chrome',{})).visible.sheetTabs),false,'native sheet tabs must be hidden when custom tabs are shown')
   await page.click('.office-nav-item:nth-child(2)');await page.waitForFunction(()=>window.qa.activeId==='预算明细')
   await page.focus('.office-nav-item:nth-child(2)');await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>window.qa.activeId==='工作表 3')
   await page.keyboard.press('End');await page.waitForFunction(()=>window.qa.activeId==='工作表 60')
   assert.ok(await page.$eval('.office-nav-list',e=>e.scrollLeft>0))
   assert.ok(await page.$eval('.office-nav.calc',e=>e.getBoundingClientRect().bottom>=innerHeight-1))
   if(!real){
    // The fixture records the parent's add-sheet event; no document mutation is
    // simulated here. Tab must reach the action, not merely programmatic focus.
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('office-nav-add')),true,'Tab reaches the add-sheet action')
    assert.deepEqual(await page.$eval('.office-nav-add',e=>({role:e.getAttribute('role'),tabIndex:e.tabIndex})),{role:'button',tabIndex:0})
    for(const [index,key] of ['Enter','Space'].entries()){
     await page.keyboard.press(key)
     await page.waitForFunction(count=>window.qa.added===count,{},index+1)
    }
   }
   await page.evaluate(()=>window.qa.writable=false);await page.waitForFunction(()=>!document.querySelector('.office-nav-add'));await page.focus('.office-nav-item.selected');await page.keyboard.press('Home');await page.waitForFunction(()=>window.qa.activeId==='项目总览')
  }
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('theme-dark',theme==='dark');if(window.qa.real)window.qa.$refs.engine.contentWindow.postMessage({__lo:'lo-relay',type:'set-theme',theme},location.origin)},theme)
   if(real)await new Promise(r=>setTimeout(r,1000))
   await page.screenshot({path:join(output,`${prefix}-${theme}.png`)})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  }
  await page.setViewport({width:420,height:680});if(real)await new Promise(r=>setTimeout(r,1500));await page.screenshot({path:join(output,`${prefix}-narrow-dark.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  assert.deepEqual(errors,[])
  reports.push({kind,real,passed:true,requests:await page.evaluate(()=>window.qa.requests.length)})
  await page.close()
 }
 await writeFile(join(output,'navigation-browser-results.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2))
}finally{await browser.close();await new Promise(r=>server.close(r))}
