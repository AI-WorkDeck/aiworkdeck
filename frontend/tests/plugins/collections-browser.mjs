// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual packaged collection panels and host business bridges, synthetic API/data/actions.
// No real clipboard, account, project, editor, native shell or backend persistence is used.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.env.COLLECTIONS_UI_OUT || '/tmp/plugin-audit-collections-ui'
await mkdir(out, { recursive: true })
const loadSource = async name => (await readFile(resolve(root, 'src/utils', name), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']*'\n/gm, '').replace(/^export /gm, '')
const business = await loadSource('pluginBusinessServices.js')
const collections = await loadSource('pluginCollectionServices.js')
const hostScript = `
const query = new URLSearchParams(location.search), plugin=query.get('plugin')||'calendar', global=query.get('global')==='1';
window.calls=[];window.actions=[];window.subscriptions=[];window.failDelete=false;
window.today=new Date().toLocaleDateString('en-CA');
window.projects=[{id:7,name:'合成甲项目',myRole:'OWNER'},{id:8,name:'合成乙项目',myRole:'PARTICIPANT'}];
window.tasks=[{id:31,projectId:7,projectName:'合成甲项目',title:'已删关联事项',dueDate:today,status:'OPEN',type:'DEADLINE',priority:'NORMAL',files:[{fileId:79,fileName:null}]},{id:32,projectId:8,projectName:'合成乙项目',title:'其他项目事项',dueDate:today,status:'OPEN',type:'MEETING',files:[]}];
window.files=[{id:70,projectId:7,name:'合成合同.docx',parentId:71},{id:71,projectId:7,name:'资料',isFolder:true},{id:72,projectId:7,name:'合成照片.png'},{id:73,projectId:7,name:'__staging_area__',isFolder:true},{id:74,projectId:7,name:'隐藏暂存文件.docx',parentId:73},{id:80,projectId:8,name:'乙项目文件.docx'}];
window.favorites=[{id:11,title:'合成网页',content:'合成正文',sourceUrl:'https://example.invalid/page',sourceHost:'example.invalid'},{id:12,title:'合成图片',content:'',imagePath:'/private/fixture'}];
window.clips=[{id:21,type:'TEXT',text:'合成剪贴板'},{id:22,type:'IMAGE',fileName:'合成图片.png'},{id:23,type:'FILE',fileName:'合成文件.docx'}];
window.hiddenCount=3;
const envelope=data=>({code:0,data}), t=key=>key, getSessionId=()=>'', getApiBaseUrl=()=>location.origin;
const getTaskProjectOptions=async()=>projects;
const getProjectTasks=async pid=>envelope({tasks:tasks.filter(t=>String(t.projectId)===String(pid))});
const getCalendarTasks=async()=>envelope({tasks:tasks.slice()});
const getCalendarSummary=async()=>envelope({today:tasks.length});
const getProjectFiles=async pid=>files.filter(f=>String(f.projectId)===String(pid));
const getProjectMembers=async()=>envelope([{userId:2,displayName:'合成成员',role:'PARTICIPANT'}]);
const getProjectFavorites=async(pid,query)=>{calls.push(['favorites-list',query]);return favorites.filter(f=>(f.content+f.title).includes(query));};
const listClipboard=async query=>{calls.push(['clipboard-list',query]);return {items:clips.filter(f=>(f.text||f.fileName||'').includes(query)),limited:true,hiddenCount};};
const deleteFavorite=async id=>{calls.push(['favorite-delete',id]);if(failDelete)throw Error('synthetic delete failure');favorites=favorites.filter(f=>String(f.id)!==String(id));};
const deleteClipboardItem=async id=>{calls.push(['clipboard-delete',id]);if(failDelete)throw Error('synthetic delete failure');clips=clips.filter(f=>String(f.id)!==String(id));};
const createTask=async body=>{calls.push(['create',body]);const task={...body,id:33,files:(body.fileIds||[]).map(fileId=>({fileId,fileName:files.find(f=>String(f.id)===String(fileId))?.name||null}))};tasks.push(task);return task;};
const updateTask=async(id,body)=>{calls.push(['update',id,body]);const task=tasks.find(t=>String(t.id)===String(id));Object.assign(task,body);if(body.fileIds)task.files=body.fileIds.map(fileId=>({fileId,fileName:files.find(f=>String(f.id)===String(fileId))?.name||null}));return task;};
const deleteTask=async id=>{calls.push(['delete',id]);tasks=tasks.filter(t=>String(t.id)!==String(id));return null;};
const purchaseFeatureSku=async sku=>{calls.push(['purchase',sku]);hiddenCount=0;},refreshEntitlements=async()=>{};
const uni={$emit:(name,data)=>{const event={'awd:favorites-changed':'favorites.changed','awd:clipboard-saved':'clipboard.changed','awd:entitlements-changed':'clipboard.changed'}[name];if(event)sendEvent(event,data);},showToast:()=>{},showModal:({success})=>success({confirm:true})};
const createPluginCollectionServices=(()=>{${collections};return createPluginCollectionServices})();
const {createPluginBusinessServices,clonePluginData}=(()=>{${business};return {createPluginBusinessServices,clonePluginData}})();
window.sendEvent=(event,data={})=>frame.contentWindow.postMessage({awd:1,type:'event',event,data},'*');
const options={projectId:()=>global?null:7,permissions:()=>['tasks','file_read','file_write','clipboard','editor'],isCurrent:()=>true,listFiles:async()=>(await getProjectFiles(7)).filter(f=>!f.isFolder).map(f=>({id:f.id,name:f.name,path:f.name,fileType:f.fileType})),openFile:file=>actions.push(['openFile',file.id]),actions:Object.fromEntries(['copyText','insertContent','previewImage','openBrowser','openProject','openTaskFile','openAccount'].map(name=>[name,value=>actions.push([name,value])]))};
const service=createPluginCollectionServices(options), wrapper=createPluginBusinessServices({...options,delegates:Object.fromEntries(['calendar','favorites','clipboard'].map(name=>[name,(...args)=>service.request(name,...args)]))});
window.frame=document.querySelector('iframe');
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{pluginId:plugin,projectId:global?null:'7',language:'zh-CN',theme:'light',themeTokens:{'--awd-switch-width':'38px','--awd-switch-track-height':'22px','--awd-switch-knob-size':'18px','--awd-panel-row-h':'28px','--awd-control-height':'32px','--awd-accent':'#285d52','--awd-text-on-accent':'#fff','--awd-overlay':'#0005','--awd-bg':'#f1efe7','--awd-surface':'#fff','--awd-surface-2':'#f5f4ef','--awd-text':'#222','--awd-text-2':'#666','--awd-text-3':'#888','--awd-border':'#ccc','--awd-space-1':'4px','--awd-space-2':'8px','--awd-space-3':'12px','--awd-space-4':'16px','--awd-panel-fs':'13px','--awd-panel-fs-meta':'11px','--awd-panel-pad-x':'12px','--awd-font-size-body':'13px','--awd-accent-text':'#285d52','--awd-radius-sm':'4px','--awd-radius-md':'8px','--awd-radius-lg':'12px'}}},'*');
addEventListener('message',async e=>{const m=e.data;if(e.source!==frame.contentWindow||m?.type!=='call')return;try{let result={};if(m.method==='events.subscribe'){subscriptions.push(...m.params.events);result={subscribed:m.params.events};}if(m.method==='services.request'){calls.push(['request',m.params.service,m.params.operation,m.params.params]);result=clonePluginData(await wrapper.request(m.params.service,m.params.operation,m.params.params));}frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:true,result},'*');}catch(error){frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:false,error:{code:error.code,message:error.message}},'*');}});
frame.src='/plugin/'+plugin+'/index.html';`
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9zsAAAAASUVORK5CYII=','base64')
const server=createServer(async(req,res)=>{
  if(req.url.startsWith('/?')||req.url==='/'){res.setHeader('Content-Type',mime['.html']);return res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe sandbox="allow-scripts allow-forms" style="width:1100px;height:900px;border:0"></iframe><script src="/host.js"></script>')}
  if(req.url==='/host.js'){res.setHeader('Content-Type',mime['.js']);return res.end(hostScript)}
  if(/^\/api\/(favorites\/\d+\/image|clipboard\/\d+\/file)$/.test(req.url)){res.setHeader('Content-Type','image/png');return res.end(png)}
  if(req.url==='/favicon.ico'){res.statusCode=204;return res.end()}
  const match=/^\/plugin\/(calendar|favorites|clipboard)\/([a-zA-Z0-9_.\/-]+)$/.exec(req.url||'')
  if(!match||match[2].includes('..')){res.statusCode=404;return res.end()}
  try{res.setHeader('Content-Type',mime[extname(match[2])]||'application/octet-stream');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'");res.end(await readFile(resolve(root,'../official-plugins',match[1],'web',match[2])))}catch{res.statusCode=404;res.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser
try{
  browser=await puppeteer.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']})
  const page=await browser.newPage();await page.setViewport({width:1200,height:1000});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});if(process.env.DEBUG_COLLECTIONS)page.on('console',m=>console.log('BROWSER',m.text()));
  const checks=[]
  const open=async(plugin,global=false)=>{await page.goto('http://127.0.0.1:'+server.address().port+'/?plugin='+plugin+'&global='+(global?1:0));return (await page.$('iframe')).contentFrame()}
  const clickText=async(frame,selector,text)=>{const els=await frame.$$(selector);for(const el of els){if((await el.evaluate(e=>e.textContent)).includes(text)){await el.click();return}}throw Error('Missing '+selector+': '+text)}
  const fill=async(frame,selector,value)=>{await frame.focus(selector);await frame.$eval(selector,el=>el.select());await page.keyboard.sendCharacter(value)}
  let frame=await open('calendar');await frame.waitForSelector('.fc-event');
  assert.match(await frame.$eval('body',e=>e.textContent),/已删关联事项/);assert.doesNotMatch(await frame.$eval('body',e=>e.textContent),/其他项目事项/);
  await clickText(frame,'.fc-event','已删关联事项');await frame.waitForSelector('.task-dialog');
  assert.match(await frame.$eval('.td-file-chip.is-missing',e=>e.textContent),/删除|不存在/);
  await fill(frame,'.td-title-input textarea','编辑已删关联');await frame.click('.td-btn-primary');
  await frame.waitForSelector('.task-dialog',{hidden:true,timeout:5000});
  assert.deepEqual(await page.evaluate(()=>calls.filter(c=>c[0]==='update').at(-1)[2].fileIds),[79]);assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='update').at(-1)[2].title),'编辑已删关联');checks.push('calendar edit retains deleted link');
  // File picker, assignee, create, plain text input and immediate save.
  await frame.click('.fc-day-today .fc-daygrid-day-top');await frame.waitForSelector('.task-dialog');await fill(frame,'.td-title-input textarea','合成新事项');
  await frame.click('.td-add-file');await frame.waitForSelector('.picker-file');
  assert.deepEqual(await frame.$$eval('.picker-file',els=>els.map(e=>e.textContent.trim())),['合成合同.docx资料','合成照片.png']);
  await frame.type('.picker-search input','合同');await frame.waitForFunction(()=>document.querySelectorAll('.picker-file').length===1);await frame.click('.picker-file');
  await frame.click('.td-btn-primary');await frame.waitForSelector('.task-dialog',{hidden:true});
  const created=await page.evaluate(()=>calls.find(c=>c[0]==='create')[1]);assert.equal(created.title,'合成新事项');assert.deepEqual(created.fileIds,[70]);checks.push('calendar create and nested-file search/select');
  await clickText(frame,'.fc-event','合成新事项');await frame.waitForSelector('.task-dialog');await frame.click('.td-file-name');await page.waitForFunction(()=>actions.some(a=>a[0]==='openFile'));checks.push('calendar open selected file');
  await page.evaluate(()=>sendEvent('calendar.changed'));await page.waitForFunction(()=>subscriptions.includes('calendar.changed'));
  frame=await open('calendar',true);await frame.waitForSelector('.fc-event');assert.match(await frame.$eval('body',e=>e.textContent),/其他项目事项/);await clickText(frame,'.fc-event','其他项目事项');await frame.waitForSelector('.task-dialog');await clickText(frame,'.td-btn-link','进入项目');await page.waitForFunction(()=>actions.some(a=>a[0]==='openProject'&&a[1].projectId===8));checks.push('calendar global projects and navigation');
  frame=await open('favorites');await frame.waitForSelector('.fav-card');assert.equal((await frame.$$('.fav-card')).length,2);await frame.waitForSelector('#fav-12 image, #fav-12 uni-image');
  await frame.click('#fav-11 .favo-btn:nth-child(1)');await frame.click('#fav-11 .favo-btn:nth-child(2)');await frame.click('#fav-11 .header-right > .favo-btn:last-child');await page.waitForFunction(()=>actions.length===3);
  assert.deepEqual(await page.evaluate(()=>actions),[['insertContent',{type:'TEXT',content:'合成正文'}],['copyText','https://example.invalid/page'],['openBrowser','https://example.invalid/page']]);
  await frame.click('#fav-12 .favo-btn');await page.waitForFunction(()=>actions.some(a=>a[0]==='insertContent'&&a[1].type==='IMAGE'));checks.push('favorites text/image/copy/source');
  await fill(frame,'.collection-search input','网页');await page.waitForFunction(()=>calls.some(c=>c[0]==='favorites-list'&&c[1]==='网页'));await frame.waitForSelector('.loading',{hidden:true});await frame.waitForFunction(()=>document.querySelectorAll('.fav-card').length===1);await frame.click('#fav-11 .danger');await frame.click('.pop-btn.danger');await frame.waitForSelector('.fav-card',{hidden:true});checks.push('favorites search/delete/live refresh');
  frame=await open('clipboard',true);await frame.waitForSelector('.clip-card');assert.equal((await frame.$$('.clip-card')).length,3);assert.match(await frame.$eval('body',e=>e.textContent),/3/);
  await frame.click('.clip-card:nth-child(1) .cli-btn');await frame.click('.clip-card:nth-child(1) .cli-btn:nth-child(2)');await frame.waitForSelector('.clip-card:nth-child(2) uni-image');await frame.click('.clip-card:nth-child(2) uni-image');await page.waitForFunction(()=>actions.length===3);
  assert.equal(await page.evaluate(()=>actions[0][1].content),'合成剪贴板');assert.equal(await page.evaluate(()=>actions[1][1]),'合成剪贴板');assert.equal(await page.evaluate(()=>actions[2][0]),'previewImage');checks.push('clipboard global list/text/image preview');await frame.click('.unlock-hint-link');await page.waitForFunction(()=>actions.some(a=>a[0]==='openAccount'));await frame.click('.unlock-hint-buy');await frame.waitForSelector('.unlock-hint',{hidden:true});assert.equal(await page.evaluate(()=>calls.find(c=>c[0]==='purchase')[1]),'feature:clipboard.unlimited');checks.push('clipboard account and synthetic confirmed unlock refresh');
  await page.evaluate(()=>{clips.unshift({id:24,type:'TEXT',text:'新增合成内容'});sendEvent('clipboard.changed')});await frame.waitForFunction(()=>document.querySelectorAll('.clip-card').length===4);
  await fill(frame,'.collection-search input','新增');await page.waitForFunction(()=>calls.some(c=>c[0]==='clipboard-list'&&c[1]==='新增'));await frame.waitForSelector('.loading',{hidden:true});await frame.waitForFunction(()=>document.querySelectorAll('.clip-card').length===1);await frame.click('.cli-btn.danger');await frame.click('.pop-btn.danger');await frame.waitForSelector('.clip-card',{hidden:true});checks.push('clipboard search/delete/live refresh');
  await page.screenshot({path:out+'/clipboard.png'});
  frame=await open('calendar');await frame.waitForSelector('.fc-event');
  await clickText(frame,'.cal-seg-btn','列表');await frame.waitForSelector('.fc-listMonth-view');
  await clickText(frame,'.cal-seg-btn','周');await frame.waitForSelector('.fc-timeGridWeek-view');
  await clickText(frame,'.cal-seg-btn','月');await frame.waitForSelector('.fc-dayGridMonth-view');
  const period=await frame.$eval('.cal-period',e=>e.textContent);await frame.click('.cal-nav-btn');await frame.waitForFunction(period=>document.querySelector('.cal-period').textContent!==period,{},period);await frame.click('.cal-today-btn');await frame.waitForSelector('.fc-event');
  await frame.click('.cal-filter-btn');await frame.waitForSelector('.cal-filter-pop');await clickText(frame,'.fp-chip','开庭');await frame.waitForFunction(()=>document.querySelectorAll('.fc-event').length===0);await frame.click('.fp-reset');await frame.click('.cal-filter-mask');await frame.waitForSelector('.fc-event');checks.push('calendar month/week/list/today and type filter');
  const tomorrow=await page.evaluate(()=>{const d=new Date(today+'T12:00:00');d.setDate(d.getDate()+1);return d.toLocaleDateString('en-CA')});
  const from=await (await frame.$('.fc-event')).boundingBox(),to=await (await frame.$('.fc-daygrid-day[data-date="'+tomorrow+'"]')).boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:15});await page.mouse.up();await page.waitForFunction(date=>tasks[0].dueDate===date,{},tomorrow);checks.push('calendar native mouse drag reschedules');
  await clickText(frame,'.fc-event','已删关联事项');await frame.waitForSelector('.task-dialog');await fill(frame,'.td-title-input textarea','修订 @');await frame.waitForSelector('.mp-item');await frame.waitForFunction(()=>{const images=[...document.querySelectorAll('.mp-icon img')];return images.length>=2&&images.every(image=>image.complete&&image.naturalWidth>0)},{timeout:5000});checks.push('calendar bundled file/folder mention icons');await fill(frame,'.td-title-input textarea','修订 @合成');await frame.waitForSelector('.mp-item');await clickText(frame,'.mp-item','合成成员');await frame.click('.td-btn-primary');await frame.waitForSelector('.task-dialog',{hidden:true});assert.equal(await page.evaluate(()=>calls.filter(c=>c[0]==='update').at(-1)[2].assigneeId),2);checks.push('calendar member mention');
  await frame.click('.task-row[data-task-id="31"] .tr-check');await page.waitForFunction(()=>tasks[0].status==='DONE');await frame.click('.cal-filter-btn');await frame.waitForSelector('.fp-row .awd-switch');await frame.click('.fp-row .awd-switch');await frame.waitForFunction(()=>document.querySelectorAll('.fc-event').length===0);await frame.click('.fp-row .awd-switch');await frame.click('.cal-filter-mask');await frame.waitForSelector('.fc-event');
  await clickText(frame,'.fc-event','修订');await frame.waitForSelector('.task-dialog');await frame.click('.td-btn-danger');await frame.waitForSelector('.uni-modal__btn_primary',{visible:true});await frame.click('.uni-modal__btn_primary');try{await frame.waitForSelector('.task-dialog',{hidden:true,timeout:5000})}catch(error){await (await page.$('iframe')).screenshot({path:out+'/calendar-delete-failed.png'});console.log('DELETE DIAG',await page.evaluate(()=>calls.slice(-8)),await frame.$eval('.uni-modal__btn_primary',el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:hit?.outerHTML,modalLayer:getComputedStyle(el.closest('uni-modal')).zIndex,dialogLayer:getComputedStyle(document.querySelector('.task-dialog-mask')).zIndex}}));throw error}await page.waitForFunction(()=>calls.some(c=>c[0]==='delete'));checks.push('calendar status/include-completed/delete');
  frame=await open('calendar');await frame.waitForSelector('.fc-event');
  for(const width of [260,320,420]){
    await page.$eval('iframe',(el,width)=>{el.style.width=width+'px';el.style.height='720px'},width);await frame.waitForFunction(width=>innerWidth===width,{},width);
    await clickText(frame,'.fc-event','已删关联事项');await frame.waitForSelector('.task-dialog');
    assert.equal(await frame.$eval('.task-dialog',el=>el.scrollWidth<=el.clientWidth+1),true,'narrow calendar dialog must retain visible save/cancel actions');
    assert.equal(await frame.$eval('.td-btn-primary',el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),true);
    assert.ok(await frame.$eval('input[type=date]',el=>el.getBoundingClientRect().width)>=180);
    await (await page.$('iframe')).screenshot({path:out+'/calendar-'+width+'.png'});await frame.click('.td-btn-primary');await frame.waitForSelector('.task-dialog',{hidden:true});
  }
  checks.push('calendar visible date/save controls and real save at 260/320/420px');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,boundaries:'real packaged iframe + real collection/business services; synthetic API, taskStore operations, editor and host actions; no Electron/native clipboard/account or real backend'}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done))}
