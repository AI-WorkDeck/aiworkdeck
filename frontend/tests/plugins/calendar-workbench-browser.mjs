// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Full real H5 workbench and real PluginPane, all API requests intercepted with synthetic fixtures.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localDateKey, addDaysKey } from '../../src/components/calendar/taskUtils.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const base=process.env.CALENDAR_WORKBENCH_BASE||'http://127.0.0.1:5197'
const out=process.env.CALENDAR_WORKBENCH_OUT||'/tmp/calendar-workbench-ui'
await mkdir(out,{recursive:true})
const manifest=JSON.parse(await readFile(resolve(root,'../official-plugins/calendar/manifest.json'),'utf8'))
const projects=[{id:42,name:'日历合成甲项目',userId:7,myRole:'OWNER',projectType:'BLANK'},{id:43,name:'日历合成乙项目',userId:7,myRole:'OWNER',projectType:'BLANK'}]
let enabled=true
const today=localDateKey()
const tasks=[{id:31,projectId:42,projectName:projects[0].name,title:'今天核对起诉材料',dueDate:today,status:'OPEN',type:'TODO',files:[]},
{id:32,projectId:43,projectName:projects[1].name,title:'第五天准备开庭',dueDate:addDaysKey(today,4),status:'OPEN',type:'HEARING',files:[]}]
const browser=await puppeteer.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']})
const page=await browser.newPage(), errors=[], api=[], lifecycle=[]
let phase='initial navigation'
page.on('pageerror',error=>errors.push(error.message))
page.on('framenavigated',frame=>{if(frame===page.mainFrame())lifecycle.push({event:'main-navigation',at:Date.now()})})
page.on('console',message=>{if(message.text().startsWith('[vite]'))lifecycle.push({event:message.text(),at:Date.now()})})
if(process.env.DEBUG_CALENDAR)page.on('console',message=>console.log(message.type(),message.text()))
await page.setViewport({width:1600,height:960})
await page.evaluateOnNewDocument(()=>{if(window!==window.top)return;localStorage.setItem('app_language','zh-CN');localStorage.setItem('awd_app_language','zh-CN');localStorage.setItem('awd_theme','light')})
await page.setRequestInterception(true)
page.on('request',async req=>{
  const url=new URL(req.url()),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS'}
  if(!url.pathname.startsWith('/api/')){
    if(url.origin!==new URL(base).origin&&!['data:','blob:'].includes(url.protocol))return req.abort()
    return req.continue()
  }
  api.push(url.pathname)
  if(req.method()==='OPTIONS')return req.respond({status:204,headers})
  const web=/^\/api\/plugin-web\/calendar\/([a-zA-Z0-9_.\/-]+)$/.exec(url.pathname)
  if(web&&!web[1].includes('..')){
    try{return req.respond({status:200,headers:{...headers,'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'"},contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(web[1])],body:await readFile(resolve(root,'../official-plugins/calendar/web',web[1]))})}catch{return req.respond({status:404,headers,body:''})}
  }
  let body=[]
  if(url.pathname==='/api/projects/42')body=projects[0]
  else if(url.pathname==='/api/projects/my')body=projects
  else if(url.pathname==='/api/auth/me')body={id:7,username:'synthetic',role:'USER'}
  else if(url.pathname==='/api/plugins/list'){body=enabled?[{...manifest,enabled:true}]:[];lifecycle.push({event:'plugin-list',enabled,at:Date.now()})}
  else if(url.pathname==='/api/plugins/market/list')body={plugins:[],accountConnected:false}
  else if(url.pathname==='/api/plugins/bundled')body={plugins:[]}
  else if(url.pathname==='/api/calendar')body={code:0,data:{tasks}}
  else if(url.pathname==='/api/calendar/summary'||url.pathname.endsWith('/tasks/summary'))body={code:0,data:{overdue:0,today:1,week:2}}
  else if(url.pathname.endsWith('/tasks'))body={code:0,data:{tasks:tasks.filter(task=>task.projectId===42)}}
  else if(url.pathname.includes('/license/status'))body={mode:'none',accountConnected:false}
  else if(url.pathname==='/api/account/status')body={connected:false}
  else if(url.pathname.includes('/version/status'))body={enabled:false}
  else if(url.pathname.includes('/profile')||url.pathname.includes('/admin/config'))body={}
  else if(url.pathname.includes('/telemetry/settings'))body={enabled:false}
  return req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify(body)})
})
const rail='.left-rail .rail-btn[title="日程"]'
const clickText=async(frame,selector,text)=>{for(const node of await frame.$$(selector))if((await node.evaluate(el=>el.textContent)).includes(text)){await node.click();return}throw Error('Missing '+selector+' '+text)}
const getPanels=async()=>{
  const sidebarNode=await page.waitForSelector('.sidebar-left iframe'),workspaceNode=await page.waitForSelector('.workbench iframe')
  const sidebar=await sidebarNode.contentFrame(),workspace=await workspaceNode.contentFrame()
  await sidebar.waitForSelector('.calendar-shortcuts');await workspace.waitForSelector('.calendar-main')
  return {sidebar,workspace}
}
try{
  await page.goto(base+'/#/pages/project-overview/project-overview?id=42',{waitUntil:'networkidle0',timeout:90000})
  await page.waitForSelector(rail,{visible:true})
  phase='first rail click'
  await page.click(rail)
  let {sidebar,workspace}=await getPanels()
  await sidebar.waitForSelector('[data-task-id="31"]');await workspace.waitForSelector('.fc-event')
  assert.equal((await page.$$eval('.tab-item',nodes=>nodes.filter(el=>el.textContent.includes('日程')).length)),1)
  assert.equal(await sidebar.$('.fc'),null)
  assert.equal(await sidebar.evaluate(()=>window.awd.context.surface),'sidebar')
  assert.equal(await workspace.evaluate(()=>window.awd.context.surface),'workspace')
  await page.waitForFunction(()=>![...document.querySelectorAll('uni-toast')].some(el=>el.getBoundingClientRect().height>0))
  await page.screenshot({path:out+'/workbench-month.png'})
  phase='sidebar and workspace state propagation'
  await sidebar.select('.shortcut-project','43')
  await workspace.waitForFunction(()=>document.querySelector('.cal-scope-label')?.textContent==='日历合成乙项目')
  await clickText(sidebar,'.shortcut-segments uni-button','5')
  await sidebar.waitForSelector('[data-task-id="32"]')
  const stateBefore=await workspace.evaluate(()=>window.awd.services.request('calendar','workspace'))
  assert.deepEqual(stateBefore.projectIds,['43']);assert.equal(stateBefore.recentDays,5)
  const sidebarState=await sidebar.evaluate(()=>window.awd.services.request('calendar','workspace'))
  assert.equal(sidebarState.revision,stateBefore.revision)
  await sidebar.click('[data-task-id="32"]')
  await workspace.waitForSelector('.task-dialog');await workspace.waitForSelector('.fc-timeGridDay-view')
  assert.equal(await sidebar.$('.task-dialog'),null)
  await workspace.click('.td-close')
  await clickText(workspace,'.cal-seg-btn','年');await workspace.waitForSelector('.cal-year')
  await page.screenshot({path:out+'/workbench-year.png'})
  const yearState=await workspace.evaluate(()=>window.awd.services.request('calendar','workspace'))
  assert.equal(yearState.viewType,'year')
  await sidebar.waitForFunction(async()=>{const state=await window.awd.services.request('calendar','workspace');return state.viewType==='year'})
  await clickText(page,'.tab-item','日程')
  phase='close and reopen workspace'
  const tab=await page.evaluateHandle(()=>[...document.querySelectorAll('.tab-item')].find(el=>el.textContent.includes('日程')))
  await (await tab.$('.tab-close')).click()
  await page.waitForFunction(()=>![...document.querySelectorAll('.tab-item')].some(el=>el.textContent.includes('日程')))
  await sidebar.click('.shortcut-link')
  ;({sidebar,workspace}=await getPanels())
  await workspace.waitForSelector('.cal-year')
  const reopened=await workspace.evaluate(()=>window.awd.services.request('calendar','workspace'))
  assert.deepEqual(reopened.projectIds,['43']);assert.equal(reopened.recentDays,5);assert.equal(reopened.viewType,'year')
  await page.click(rail)
  assert.equal((await page.$$eval('.tab-item',nodes=>nodes.filter(el=>el.textContent.includes('日程')).length)),1)
  await page.click(rail)
  enabled=false
  phase='plugin removal'
  await page.evaluate(()=>uni.$emit('awd:market-changed'))
  await page.waitForSelector(rail,{hidden:true})
  await page.waitForFunction(()=>![...document.querySelectorAll('.tab-item')].some(el=>el.textContent.includes('日程')))
  assert.deepEqual(errors,[])
  const report={passed:true,checks:['real rail opens real sidebar plus singleton workspace','host-authoritative view placement','project and 3/5-day filter propagation','same revision from both sandboxes','sidebar event focuses workspace day and dialog','year state round trip','close and reopen preserves state','repeated rail does not duplicate','plugin removal closes tab and removes rail'],apiRequests:api.length}
  await writeFile(out+'/workbench-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(error){
  await page.screenshot({path:out+'/workbench-failure.png'})
  const dom=await page.evaluate(()=>({rail:[...document.querySelectorAll('.left-rail .rail-btn')].map(el=>el.title),tabs:[...document.querySelectorAll('.tab-item')].map(el=>el.textContent),iframes:document.querySelectorAll('iframe').length}))
  await writeFile(out+'/workbench-failure.json',JSON.stringify({phase,errors,lifecycle,dom,apiRequests:api.length},null,2))
  console.error('PAGE_ERRORS',JSON.stringify(errors));throw error
}
finally{await browser.close()}
