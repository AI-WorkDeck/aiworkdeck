// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Two real packaged sandboxed panels; synthetic authenticated APIs and workbench actions.
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.env.CALENDAR_UI_OUT || '/tmp/calendar-workspace-ui'
await mkdir(out, { recursive: true })
const source = async path => (await readFile(resolve(root, path), 'utf8')).replace(/^import[\s\S]*?from '[^']*'\n/gm, '').replace(/^export /gm, '')
const [state, utils, tabs, collections, business] = await Promise.all([
  source('src/components/calendar/workspaceState.js'), source('src/components/calendar/taskUtils.js'),
  source('src/pages/project-overview/calendarTab.js'), source('src/utils/pluginCollectionServices.js'), source('src/utils/pluginBusinessServices.js'),
])
const script = `
${utils}
${state}
${tabs}
const createPluginCollectionServices=(()=>{${collections};return createPluginCollectionServices})();
const {createPluginBusinessServices,clonePluginData}=(()=>{${business};return {createPluginBusinessServices,clonePluginData}})();
window.calls=[];window.failList=false;window.failProjects=false;window.delayList=false;
const today=localDateKey(), envelope=data=>({code:0,data}), t=key=>key;
window.projects=[{id:7,name:'合成甲项目',myRole:'OWNER'},{id:8,name:'合成乙项目',myRole:'PARTICIPANT'}];
window.tasks=[
{id:31,projectId:7,projectName:'合成甲项目',title:'今天准备材料',dueDate:today,status:'OPEN',type:'TODO',files:[{fileId:70,fileName:'合成合同.docx'}]},
{id:32,projectId:8,projectName:'合成乙项目',title:'乙项目会面',dueDate:today,status:'OPEN',type:'MEETING'},
{id:33,projectId:7,projectName:'合成甲项目',title:'第三天提交文件',dueDate:addDaysKey(today,2),status:'OPEN',type:'DEADLINE'},
{id:34,projectId:7,projectName:'合成甲项目',title:'第五天出庭',dueDate:addDaysKey(today,4),status:'OPEN',type:'HEARING'},
{id:35,projectId:7,projectName:'合成甲项目',title:'逾期补材料',dueDate:addDaysKey(today,-1),status:'OPEN',type:'TODO'}];
const getTaskProjectOptions=async()=>{if(failProjects)throw Error('synthetic project failure');return projects;};
const getCalendarTasks=async()=>{if(delayList)await new Promise(resolve=>window.releaseList=resolve);if(failList)throw Error('synthetic list failure');return envelope({tasks:tasks.slice()});};
const getProjectTasks=async pid=>envelope({tasks:tasks.filter(t=>String(t.projectId)===String(pid))});
const getCalendarSummary=async()=>envelope({today:2});
const getProjectFiles=async pid=>[{id:70,name:'合成合同.docx',projectId:7}].filter(file=>String(file.projectId)===String(pid));
const getProjectMembers=async()=>envelope([]);
const createTask=async body=>{const task={...body,id:40,projectName:'合成甲项目',files:[]};tasks.push(task);calls.push(['create',body]);sendEvent('calendar.changed');return task;};
const updateTask=async(id,body)=>{const task=tasks.find(t=>String(t.id)===String(id));Object.assign(task,body);calls.push(['update',id,body]);sendEvent('calendar.changed');return task;};
const deleteTask=async id=>{tasks=tasks.filter(t=>String(t.id)!==String(id));calls.push(['delete',id]);sendEvent('calendar.changed');};
window.framesList=[...document.querySelectorAll('iframe')];
window.sendEvent=(event,data={})=>framesList.forEach(frame=>frame.contentWindow.postMessage({awd:1,type:'event',event,data},'*'));
const uni={$emit:(_event,data)=>sendEvent('sidebar.command',data),showToast(){},showModal:({success})=>success({confirm:true})};
window.workbench={hasProject:true,projectId:7,$nextTick:callback=>setTimeout(callback,0),openPluginTab:id=>calls.push(['open',id]),...calendarTabMethods};
const options={projectId:()=>null,permissions:()=>['tasks','file_read'],isCurrent:()=>true,actions:{calendarWorkspace:params=>workbench.calendarWorkspace(params),openTaskFile:payload=>calls.push(['openFile',payload]),openProject:payload=>calls.push(['openProject',payload])}};
const service=createPluginCollectionServices(options), wrapper=createPluginBusinessServices({...options,delegates:{calendar:(...args)=>service.request('calendar',...args)}});
const tokens={'--awd-accent':'#285d52','--awd-accent-text':'#285d52','--awd-accent-soft':'#e5eeeb','--awd-accent-wash':'#f0f5f3','--awd-text-on-accent':'#fff','--awd-overlay':'#0005','--awd-bg':'#f1efe7','--awd-surface':'#fff','--awd-surface-2':'#f5f4ef','--awd-text':'#222','--awd-text-2':'#666','--awd-text-3':'#888','--awd-text-4':'#aaa','--awd-border':'#ddd9cd','--awd-border-subtle':'#e9e5db','--awd-mint':'#8abcab','--awd-info-soft':'#e6eff7','--awd-info-text':'#336288','--awd-danger-soft':'#f7e7e3','--awd-hover-bg':'#f3f2ec','--awd-danger-text':'#a33','--awd-danger-bg':'#fff0ed','--awd-space-1':'4px','--awd-space-2':'8px','--awd-space-3':'12px','--awd-space-4':'16px','--awd-panel-fs':'13px','--awd-panel-fs-meta':'11px','--awd-panel-pad-x':'12px','--awd-font-size-body':'13px','--awd-radius-sm':'4px','--awd-radius-md':'8px','--awd-radius-lg':'12px','--awd-radius-dialog':'12px','--awd-switch-width':'38px','--awd-switch-track-height':'22px','--awd-switch-knob-size':'18px','--awd-panel-row-h':'28px','--awd-control-height':'32px'};
framesList.forEach(frame=>{frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{pluginId:'calendar',projectId:null,surface:frame.id,language:new URLSearchParams(location.search).get('lang')||'zh-CN',theme:'light',themeTokens:tokens}},'*');frame.src='/plugin/index.html';});
addEventListener('message',async event=>{const frame=framesList.find(f=>f.contentWindow===event.source),m=event.data;if(!frame||m?.type!=='call')return;try{let result={};if(m.method==='events.subscribe')result={subscribed:m.params.events};if(m.method==='services.request')result=clonePluginData(await wrapper.request(m.params.service,m.params.operation,m.params.params));frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:true,result},'*');}catch(error){frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:false,error:{code:error.code,message:error.message}},'*');}});
`
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}
const server=createServer(async(req,res)=>{
  if(req.url==='/'||req.url.startsWith('/?')){res.setHeader('Content-Type',types['.html']);return res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;height:900px;background:#f1efe7;gap:1px"><iframe id="sidebar" sandbox="allow-scripts allow-forms" style="width:280px;height:100%;border:0;flex:none"></iframe><iframe id="workspace" sandbox="allow-scripts allow-forms" style="flex:1;min-width:0;height:100%;border:0"></iframe><script src="/host.js"></script>')}
  if(req.url==='/host.js'){res.setHeader('Content-Type',types['.js']);return res.end(script)}
  if(req.url==='/favicon.ico'){res.statusCode=204;return res.end()}
  const match=/^\/plugin\/([a-zA-Z0-9_./-]+)$/.exec(req.url||'')
  if(!match||match[1].includes('..')){res.statusCode=404;return res.end()}
  try{res.setHeader('Content-Type',types[extname(match[1])]||'application/octet-stream');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'");res.end(await readFile(resolve(root,'../official-plugins/calendar/web',match[1])))}catch{res.statusCode=404;res.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser
try {
  browser=await puppeteer.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']})
  const page=await browser.newPage();await page.setViewport({width:1600,height:900})
  const errors=[];page.on('pageerror',error=>errors.push(error.message));if(process.env.DEBUG_CALENDAR)page.on('console',message=>console.log(message.type(),message.text()))
  await page.goto('http://127.0.0.1:'+server.address().port)
  const sidebar=await (await page.$('#sidebar')).contentFrame(),workspace=await(await page.$('#workspace')).contentFrame()
  await sidebar.waitForSelector('.calendar-shortcuts .task-row');await workspace.waitForSelector('.fc-event')
  assert.equal(await sidebar.$('.fc'),null,'sidebar must not render any FullCalendar')
  const verifySidebarAlignment = async (sidebar) => {
    // Measure real uni-button text, including the native H5 wrapper and inherited line height.
    for (const width of [220, 280, 340]) {
      await page.$eval('#sidebar', (el, width) => { el.style.width = width + 'px' }, width)
      const alignment = await sidebar.$$eval('.shortcut-primary, .shortcut-link, .shortcut-segments uni-button', buttons => buttons.map(button => {
        const box = button.getBoundingClientRect(), range = document.createRange()
        range.selectNodeContents(button)
        const text = range.getBoundingClientRect()
        return { text: button.textContent, dx: Math.abs((box.left + box.right - text.left - text.right) / 2), dy: Math.abs((box.top + box.bottom - text.top - text.bottom) / 2) }
      }))
      for (const item of alignment) {
        assert.ok(item.dx < 2, `${width}px ${item.text}: horizontally centered (${item.dx})`)
        assert.ok(item.dy < 2, `${width}px ${item.text}: vertically centered (${item.dy})`)
      }
    }
    await page.$eval('#sidebar', el => { el.style.width = '280px' })
  }
  await verifySidebarAlignment(sidebar)

  assert.equal(await workspace.$('.calendar-sidebar'),null,'workspace must devote width to calendar')
  assert.equal(await sidebar.$eval('.calendar-shortcuts',el=>el.scrollWidth<=el.clientWidth),true)
  await page.screenshot({path:out+'/initial.png'})
  const clickText=async(frame,selector,text)=>{for(const el of await frame.$$(selector))if((await el.evaluate(el=>el.textContent)).includes(text)){await el.click();return}throw Error('Missing '+selector+' '+text)}
  await workspace.click('.cal-filter-btn')
  await clickText(workspace,'.fp-option','合成甲项目')
  await clickText(workspace,'.fp-option','合成乙项目')
  await page.waitForFunction(()=>workbench.calendarWorkspaceState.projectIds.length===2)
  await sidebar.waitForFunction(()=>document.querySelector('.shortcut-project')?.selectedOptions[0]?.textContent==='合成甲项目 · 合成乙项目')
  assert.equal(await sidebar.$eval('.shortcut-project',el=>el.selectedOptions[0].disabled),true)
  assert.deepEqual(await page.evaluate(()=>workbench.calendarWorkspaceState.projectIds),['7','8'])
  await workspace.click('.cal-filter-mask')
  await page.screenshot({path:out+'/multiple-projects.png'})
  await sidebar.select('.shortcut-project','')
  await workspace.waitForFunction(()=>document.querySelector('.cal-scope-label')?.textContent==='全部项目')
  assert.deepEqual(await page.evaluate(()=>workbench.calendarWorkspaceState.projectIds),[])
  assert.equal(await sidebar.$eval('.shortcut-project',el=>el.selectedOptions[0].textContent),'全部项目')
  await sidebar.select('.shortcut-project','7')
  await workspace.waitForFunction(()=>!document.querySelector('.calendar-main').textContent.includes('乙项目会面'))
  await workspace.waitForFunction(()=>document.querySelector('.cal-scope-label')?.textContent==='合成甲项目')
  assert.equal(await sidebar.$eval('.shortcut-project',el=>el.selectedOptions[0].textContent),'合成甲项目')
  assert.equal(await page.evaluate(()=>workbench.calendarWorkspaceState.projectIds[0]),'7')
  assert.match(await sidebar.$eval('.shortcut-list',el=>el.textContent),/第三天提交文件/)
  assert.doesNotMatch(await sidebar.$eval('.shortcut-list',el=>el.textContent),/第五天出庭/)
  await clickText(sidebar,'.shortcut-segments uni-button','5')
  await sidebar.waitForFunction(()=>document.querySelector('.shortcut-list').textContent.includes('第五天出庭'))
  await sidebar.click('[data-task-id="34"]')
  await workspace.waitForSelector('.task-dialog')
  assert.equal(await sidebar.$('.task-dialog'),null,'editor opens only in the workspace')
  await workspace.waitForSelector('.fc-timeGridDay-view')
  assert.match(await workspace.$eval('.td-title-input',el=>el.textContent||el.querySelector('textarea')?.value||''),/第五天出庭/)
  await workspace.click('.td-close')
  await clickText(workspace,'.cal-seg-btn','年')
  await workspace.waitForSelector('.cal-year-month')
  assert.equal((await workspace.$$('.cal-year-month')).length,12)
  await page.screenshot({path:out+'/year.png'})
  await workspace.click('.cal-year-day.has-events')
  await workspace.waitForSelector('.fc-timeGridDay-view')
  assert.equal(await page.evaluate(()=>workbench.calendarWorkspaceState.viewType),'timeGridDay')
  await sidebar.click('.shortcut-primary')
  await workspace.waitForSelector('.task-dialog')
  await workspace.focus('.td-title-input textarea');await page.keyboard.sendCharacter('合成新事项')
  await workspace.$eval('input[type=date]',(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))},await page.evaluate(()=>today))
  await workspace.click('.td-btn-primary')
  await page.waitForFunction(()=>calls.some(call=>call[0]==='create'))
  assert.equal(await page.evaluate(()=>calls.find(call=>call[0]==='create')[1].projectId),'7')
  await workspace.waitForSelector('.task-dialog',{hidden:true})
  await sidebar.waitForSelector('[data-task-id="40"]')
  await sidebar.click('[data-task-id="40"] .tr-check')
  await sidebar.waitForSelector('[data-task-id="40"]',{hidden:true})
  await page.evaluate(()=>{failList=true;sendEvent('calendar.changed')})
  await sidebar.waitForFunction(()=>document.querySelector('.shortcut-empty')?.textContent.includes('重新加载'))
  await page.evaluate(()=>{failList=false})
  await sidebar.click('.shortcut-empty uni-button')
  await sidebar.waitForSelector('[data-task-id="31"]')
  await sidebar.click('[data-task-id="31"] .tr-chip-file')
  await page.waitForFunction(()=>calls.some(call=>call[0]==='openFile'))
  await page.evaluate(()=>sendEvent('sidebar.command',{pluginId:'calendar',command:'calendar-file',fileId:70,name:'合成合同.docx'}))
  await sidebar.waitForSelector('.shortcut-file');await workspace.waitForSelector('.cal-file-scope')
  await workspace.click('.cal-file-scope uni-button')
  await sidebar.waitForSelector('.shortcut-file',{hidden:true});await workspace.waitForSelector('.cal-file-scope',{hidden:true})
  assert.equal(await page.evaluate(()=>workbench.calendarWorkspaceState.fileId),'')
  for(const width of [220,260,320]){
    await page.$eval('#sidebar',(el,width)=>el.style.width=width+'px',width)
    await sidebar.waitForFunction(width=>innerWidth===width,{},width)
    assert.equal(await sidebar.$eval('.calendar-shortcuts',el=>el.scrollWidth<=el.clientWidth),true)
  }
  await page.screenshot({path:out+'/narrow.png'})
  for (const [language, heading, year] of [['en-US','Coming up','Year'],['de-DE','Demnächst','Jahr'],['ar-SA','المهام القادمة','سنة']]) {
    await page.goto('http://127.0.0.1:'+server.address().port+'/?lang='+language)
    const translatedSidebar=await(await page.$('#sidebar')).contentFrame(),translatedWorkspace=await(await page.$('#workspace')).contentFrame()
    await translatedSidebar.waitForSelector('.calendar-shortcuts .task-row');await translatedWorkspace.waitForSelector('.fc-event')
    await verifySidebarAlignment(translatedSidebar)
    assert.match(await translatedSidebar.$eval('.shortcut-upcoming-head',el=>el.textContent),new RegExp(heading))
    await clickText(translatedWorkspace,'.cal-seg-btn',year);await translatedWorkspace.waitForSelector('.cal-year')
    assert.equal(await translatedWorkspace.$eval('.calendar-pane',el=>el.getAttribute('dir')),language==='ar-SA'?'rtl':'ltr')
  }
  assert.deepEqual(errors,[])
  const report={passed:true,checks:['separate sidebar/workspace','central multi-project selection labels sidebar then resets to all/single','project filter sync','3/5 day boundary','task focus and day view','12-month year and date navigation','sidebar create / complete and refresh','persistent failure and retry','associated file navigation and shared filter clear','220/260/320px sidebar','centered buttons at 220/280/340px in Chinese, English, German and Arabic','packaged translations and RTL'],screenshots:['initial.png','multiple-projects.png','year.png','narrow.png']}
  await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} finally { await browser?.close();await new Promise(done=>server.close(done)) }
