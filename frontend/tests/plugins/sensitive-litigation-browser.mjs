// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real packaged Uni panels, SDK, PluginPane business wiring and scope callbacks.
// Project files, processing APIs and picker controls are synthetic; no account,
// customer document, external engine, paid model or installed client is touched.
import { createServer } from 'node:http'
import { readFile, mkdir, mkdtemp, readdir } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import workbenchMessages from '../../src/locales/zh-CN/workbench.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.env.BUSINESS_AUDIT_UI_OUT || await mkdtemp(resolve(tmpdir(), 'awd-business-audit-'))
await mkdir(out, { recursive: true })
console.log('Browser evidence:', out)
const pluginSource = await readFile(resolve(root, 'src/components/PluginPane.vue'), 'utf8')
const workspaceSource = await readFile(resolve(root, 'src/pages/project-overview/project-overview.vue'), 'utf8')
function method(source, name) {
  const matches = [...source.matchAll(new RegExp(`\\n    (?:async )?${name}\\([^\\n]*\\) \\{`, 'g'))]
  assert.equal(matches.length, 1, `${name} has one effective definition; do not test a shadowed method`)
  const start = matches[0]
  return source.slice(start.index, source.indexOf('\n    },', start.index) + 6)
}
const host = `<!doctype html><meta charset="UTF-8"><body style="margin:0">
<iframe id="plugin" sandbox="allow-scripts allow-forms" style="width:320px;height:1100px;border:0"></iframe>
<button id="pick">选择合成文件</button><button id="cancel">取消选择</button>
<aside id="existing-chat" data-conversation="existing-chat">保留现有对话</aside>
<script type="module">
import { createPluginBusinessServices, clonePluginData } from '/business-services.js';
const pluginId=new URL(location.href).searchParams.get('plugin');
const scopeMessages=${JSON.stringify(Object.fromEntries(['folderScopeLabel','folderScopeDesc','fileScopeDesc'].map(key=>['workbench.'+key,workbenchMessages[key]])))};
const frame=document.querySelector('iframe');window.frame=frame;window.calls=[];window.opened=[];window.events=[];window.prompts=[];window.saved=[];
window.files=[{id:1,name:'合成材料.txt',fileType:'txt',filePath:'synthetic/合成材料.txt'},{id:2,name:'合成材料.pdf',fileType:'pdf',filePath:'synthetic/合成材料.pdf'},
{id:3,name:'合成材料.md',fileType:'md',filePath:'synthetic/合成材料.md'},{id:4,name:'合成材料.docx',fileType:'docx',filePath:'synthetic/合成材料.docx'},
{id:5,name:'卷宗 A',fileType:'folder',isFolder:true},{id:61,name:'合成关系.drawio',filePath:'synthetic/合成关系.drawio'},
{id:62,name:'合成关系.svg',filePath:'synthetic/合成关系.svg'}];
window.diagrams=[{folderId:60,name:'合成关系',drawioFileId:61,svgFileId:62,mapFileId:63,layout:'relation_tree',mode:'奇川风',formats:['drawio','svg','png']}];
window.packState='not_installed';window.pickId=1;window.failPreview=false;window.changed=false;window.failRestyle=false;window.generation={phase:'idle'};window.failGenerationStatus=false;window.failGenerationStart=false;
const uni={ $emit(name,data){events.push({name,data});if(name==='awd:open-evidence-target')opened.push(data.fileId)},showToast({title}){events.push({name:'toast',title})} };
const getSensitiveOptions=async()=>[{value:'CHINESE_NAME',label:'姓名'},{value:'PHONE',label:'电话'},{value:'ADDRESS',label:'地址'}];
const previewSensitiveFile=async p=>{calls.push({operation:'preview',params:p});if(failPreview)throw Error('合成预览失败');return {text:'联系人 [[姓名1_demo]]，电话 [[电话1_demo]]',counts:{CHINESE_NAME:1,PHONE:1},suspects:{},warnings:[]}};
const desensitizeFile=async p=>{calls.push({operation:'redact',params:p});const file={id:10,name:'脱敏副本.txt',fileType:'txt',filePath:'synthetic/redacted.txt'};files.push(file);return {file,recoveryKit:'AWD-RECOVERY-1:synthetic-encrypted-map',counts:{CHINESE_NAME:1,PHONE:1},warnings:[]}};
const restoreSensitiveFile=async p=>{calls.push({operation:'restore',params:p});const file={id:11,name:'复敏副本.txt',fileType:'txt',filePath:'synthetic/restored.txt'};files.push(file);return {file,counts:{CHINESE_NAME:1,PHONE:1},warnings:[]}};
const getLitigationVisualStatus=async()=>({available:packState==='ready',graphviz:true,timelineAvailable:true,reason:packState==='ready'?'':'合成引擎待安装'});
const getLitigationDiagrams=async()=>diagrams;
const getFileDetail=async(projectId,fileId)=>files.find(file=>String(file.id)===String(fileId));
const getLitigationKickoffPrompt=async (id,p)=>{calls.push({operation:'kickoff',params:p});return {prompt:'诉讼可视化：'+p.scope+'；'+p.diagramHint}};
const restyleLitigationDiagram=async(id,folderId,mode,confirmOverwrite)=>{calls.push({operation:'restyle',id,folderId,mode,confirmOverwrite});if(failRestyle)throw Error('合成换风格失败');diagrams[0].mode=mode;return {ok:true}};
const packStatus=async()=>({status:{state:packState,bytesDownloaded:50,bytesTotal:100}});
const packInstall=async()=>{calls.push({operation:'packInstall'});packState='downloading';setTimeout(()=>{packState='ready'},30);return {}};
const searchProjectContent=async()=>({}),getProjectTags=async()=>[];
const createPluginVoiceServices=()=>({}),createPluginCollectionServices=()=>({}),createPluginInsightServices=()=>({});
const wsMethods={${['pluginBusinessActions','handleDesensitizeActiveFile','handleDesensitizeSelectFile','handleFilePickerCancel','handleLitigationScopeSelect','handleFilePickerConfirm','handleLitigationOpenFile'].map(n=>method(workspaceSource,n)).join(',')}};
window.workspace={focusedPane:'left',activeFileLeft:files[0],activeFileRight:null,leftFiles:[files[0]],getPluginActiveEditor:()=>null,projectId:42,showAiPanel:false,aiPanelMounted:false,chatId:'existing-chat',openFile:file=>opened.push(file.id),resolveChatInterface:()=>{throw Error('Unexpected chat panel access')},
  $t:(key,p)=>{let text=scopeMessages[key]||key;for(const [name,value] of Object.entries(p||{}))text=text.split('{'+name+'}').join(String(value));return text},prepareSensitiveFile:async id=>{saved.push(id);const result=changed;changed=false;return result}};
for(const [name,fn] of Object.entries(wsMethods))workspace[name]=fn.bind(workspace);
// Only the task runner is synthetic. SDK, PluginPane, named service and the
// workspace action below are production implementations, including permissions.
workspace.requestLitigationGeneration=async(operation,params)=>{
  calls.push({operation,params});
  if(operation==='generation' && failGenerationStatus)throw Error('合成状态连接中断');
  if(operation==='generate'){
    if(failGenerationStart)throw Error('合成启动失败，请重试');
    generation={taskId:'task-'+params.clientRequestId,phase:'running',startedAt:Date.now(),message:'正在核对材料中的事件和日期'};
  }
  if(operation==='answer'){
    if(params.taskId!==generation.taskId||params.questionKey!==generation.question?.key)throw Error('Unexpected question answer');
    generation={...generation,phase:'running',question:null,message:'正在根据你的选择生成图表'};
  }
  if(operation==='stop')generation={...generation,phase:'stopping',message:'已发送停止请求，正在等待确认'};
  if(operation==='continue')generation={...generation,phase:'running'};
  return structuredClone(generation);
};
window.finishDrawing=async()=>{
  files.push({id:81,name:'已生成合成图.drawio',filePath:'synthetic/generated.drawio'});
  diagrams.push({folderId:80,name:'已生成合成图',drawioFileId:81,layout:'graphviz_relation',formats:['drawio','svg','png']});
  await workspace.handleLitigationOpenFile({fileId:81});
  generation={...generation,phase:'completed',question:null,resultFileId:81,message:'图表已写入项目'};
};
const hostMethods={${['businessServices','handleCall'].map(n=>method(pluginSource,n)).join(',')}};
window.mounted={sessionGeneration:1,projectId:42,businessActions:workspace.pluginBusinessActions(),activeEditor:()=>null,
 effectivePermissions:()=>['file_read','file_write','ai'],listProjectFiles:async()=>files,$emit:(name,data)=>{if(name==='kickoff')prompts.push(data.prompt)}};
for(const [name,fn] of Object.entries(hostMethods))mounted[name]=fn.bind(mounted);
document.querySelector('#pick').onclick=()=>{workspace.handleFilePickerConfirm(files.find(f=>f.id===pickId));workspace.showFilePicker=false};
document.querySelector('#cancel').onclick=()=>{workspace.handleFilePickerCancel();workspace.showFilePicker=false};
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{pluginId,projectId:'42',language:'zh-CN',theme:'light',themeTokens:{'--awd-surface':'#fcfbf7','--awd-bg':'#f1efe7','--awd-text':'#2b2a26','--awd-text-2':'#6b675c','--awd-text-3':'#888','--awd-panel-text':'#2b2a26','--awd-panel-text-2':'#6b675c','--awd-panel-pad-x':'10px','--awd-panel-gap':'8px','--awd-panel-gap-lg':'12px','--awd-panel-sec-h':'28px','--awd-panel-fs':'12px','--awd-panel-fs-meta':'11px','--awd-panel-fs-sec':'12px','--awd-panel-row-h':'32px','--awd-panel-radius':'6px','--awd-panel-border':'#bbb','--awd-border':'#bbb','--awd-panel-accent':'#285d52','--awd-panel-hover':'#e9e6dc','--awd-control-height':'32px'}}},'*');
addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.data?.type!=='call')return;const m=e.data;try{
const reply=m.method==='events.subscribe'?{ok:true,result:{subscribed:m.params.events}}:await mounted.handleCall(m.method,m.params);
frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,...reply},'*');
}catch(err){frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:false,error:{code:'failed',message:err.message}},'*')}});
frame.src='/plugin/'+pluginId+'/index.html';
</script>`
const server = createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end() }
  if (req.url?.startsWith('/?')) { res.setHeader('Content-Type', 'text/html;charset=UTF-8'); return res.end(host) }
  if (req.url === '/business-services.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(await readFile(resolve(root, 'src/utils/pluginBusinessServices.js'))) }
  const match = /^\/plugin\/(desensitize|litigation-visual)\/([a-zA-Z0-9_.\/-]+)$/.exec(req.url || '')
  if (!match || match[2].includes('..')) { res.statusCode = 404; return res.end() }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(match[2])] || 'application/octet-stream')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'")
    res.end(await readFile(resolve(root, '../official-plugins', match[1], 'web', match[2])))
  } catch { res.statusCode = 404; res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser, page
const checks = []
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 1200 })
  const errors = []
  page.on('pageerror', e => errors.push(e.stack || e.message))
  const session = await page.createCDPSession()
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out })
  const goto = async plugin => {
    await page.goto('http://127.0.0.1:' + server.address().port + '/?plugin=' + plugin)
    return (await page.$('#plugin')).contentFrame()
  }
  const clickText = async (frame, selector, text) => {
    const elements = await frame.$$(selector)
    for (const element of elements) {
      if ((await element.evaluate(el => el.textContent.trim())) === text) { await element.click(); return }
    }
    throw Error('Missing control: ' + text)
  }
  let frame = await goto('desensitize')
  await frame.waitForSelector('.desensitize-pane')
  for (const id of [2, 3, 4, 1]) {
    await page.evaluate(id => { workspace.activeFileLeft = files.find(f => f.id === id) }, id)
    await clickText(frame, 'uni-button', '导入当前')
    await frame.waitForFunction(name => document.querySelector('.path-display')?.textContent === name, {}, ['合成材料.txt','合成材料.pdf','合成材料.md','合成材料.docx'][id - 1])
  }
  checks.push('active PDF/Markdown/DOCX/text import with no LOWA executor')
  console.log('Passed active document import')
  await clickText(frame, 'uni-button', '浏览')
  await page.waitForFunction(() => workspace.showFilePicker === true)
  await page.click('#cancel')
  assert.equal(await frame.$eval('.path-display', el => el.textContent), '合成材料.txt')
  await clickText(frame, 'uni-button', '浏览')
  await page.waitForFunction(() => workspace.showFilePicker === true)
  await page.click('#pick')
  await clickText(frame, 'uni-button', '预览脱敏结果')
  await frame.waitForSelector('.preview-text')
  assert.match(await frame.$eval('.preview-text', el => el.textContent), /\[\[姓名1_demo\]\]/)
  assert.equal(await page.evaluate(() => calls.at(-1).params.password), undefined)
  await frame.type('.password-input input', 'synthetic-password', { delay: 20 })
  await frame.waitForFunction(() => !Array.from(document.querySelectorAll('uni-button')).find(el => el.textContent.trim() === '生成脱敏文件')?.getAttribute('disabled'))
  await clickText(frame, 'uni-button', '生成脱敏文件')
  await page.waitForFunction(() => opened.includes(10))
  let download
  for (let attempt = 0; attempt < 100 && !download; attempt++) {
    download = (await readdir(out)).find(name => name.endsWith('.awd-recovery'))
    if (!download) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(download, 'recovery artifact downloads through the real host action')
  assert.match(download, /^合成材料-复敏-/)
  assert.equal(await readFile(resolve(out, download), 'utf8'), 'AWD-RECOVERY-1:synthetic-encrypted-map')
  assert.equal(await frame.$('.password-input'), null)
  await clickText(frame, 'uni-button', '复敏这份结果')
  await frame.waitForFunction(() => document.querySelector('.path-display')?.textContent === '脱敏副本.txt')
  assert.equal(await frame.$eval('.password-input input', el => el.value), '')
  await frame.type('.password-input input', 'synthetic-password', { delay: 20 })
  await clickText(frame, 'uni-button', '生成复敏文件')
  await page.waitForFunction(() => opened.includes(11))
  assert.equal(await page.evaluate(() => calls.find(c => c.operation === 'restore').params.fileId), 10)
  checks.push('picker cancel/select', 'preview/create/open', 'real recovery download bytes', 'restore selected output/password reset')
  console.log('Passed redaction, recovery artifact and restoration')
  const choosingKit = page.waitForFileChooser()
  await clickText(frame, 'uni-button', '已使用本次生成的加密映射')
  await (await choosingKit).accept([resolve(out, download)])
  await frame.waitForFunction(name => Array.from(document.querySelectorAll('uni-button')).some(el => el.textContent.trim() === name), {}, download)
  await clickText(frame, 'uni-button', '脱敏')
  await page.evaluate(() => { failPreview = true })
  await clickText(frame, 'uni-button', '预览脱敏结果')
  await frame.waitForFunction(() => document.querySelector('.error-text')?.textContent === '合成预览失败')
  assert.equal(await frame.$('.preview-text'), null)
  await page.evaluate(() => { failPreview = false })
  await clickText(frame, 'uni-button', '预览脱敏结果')
  await frame.waitForSelector('.preview-text')
  await frame.type('.password-input input', 'synthetic-password', { delay: 20 })
  const redactions = await page.evaluate(() => calls.filter(c => c.operation === 'redact').length)
  await page.evaluate(() => { changed = true })
  await clickText(frame, 'uni-button', '生成脱敏文件')
  await frame.waitForFunction(() => document.querySelector('.error-text')?.textContent.includes('重新预览'))
  assert.equal(await frame.$('.preview-text'), null)
  assert.equal(await page.evaluate(() => calls.filter(c => c.operation === 'redact').length), redactions)
  checks.push('real file chooser imports recovery artifact', 'preview failure/retry', 'editor save changes require fresh preview')
  await (await page.$('#plugin')).screenshot({ path: resolve(out, 'sensitive.png') })

  frame = await goto('litigation-visual')
  await frame.waitForSelector('.lv-pack-retry')
  await frame.click('.lv-pack-retry')
  await frame.waitForFunction(() => !document.querySelector('.lv-pack-bar'))
  await frame.waitForSelector('.lv-row')
  await frame.click('.lv-field')
  await page.waitForFunction(() => workspace.showFilePicker === true)
  await page.evaluate(() => { pickId = 5 })
  await page.click('#pick')
  await frame.waitForFunction(() => document.querySelector('.lv-field-value')?.textContent.includes('卷宗 A'))
  await frame.click('.lv-field')
  await page.waitForFunction(() => workspace.showFilePicker === true)
  await page.click('#cancel')
  await page.waitForFunction(() => workspace.litigationScopeCallback === null)
  // Wait for the cancellation reply to cross the iframe before asserting scope.
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.match(await frame.$eval('.lv-field-value', el => el.textContent), /卷宗 A/)
  await frame.click('.lv-kind')
  await frame.click('.lv-row-head')
  await page.waitForFunction(() => opened.includes(61))
  await clickText(frame, '.lv-link', '看母版')
  await page.waitForFunction(() => opened.includes(62))
  await clickText(frame, '.lv-mode', '白描')
  await frame.waitForSelector('.uni-modal__btn_default')
  await frame.click('.uni-modal__btn_default')
  await frame.waitForSelector('.uni-modal', { hidden: true })
  assert.equal(await page.evaluate(() => calls.filter(c => c.operation === 'restyle').length), 0)
  await clickText(frame, '.lv-mode', '白描')
  await frame.waitForSelector('.uni-modal__btn_primary', { visible: true })
  const confirmBounds = await frame.$eval('.uni-modal__btn_primary', el => { const r = el.getBoundingClientRect(); return {left:r.left,right:r.right,width:innerWidth} })
  assert.ok(confirmBounds.left >= 0 && confirmBounds.right <= confirmBounds.width, 'restyle confirmation fits the 320px plugin iframe')
  await (await page.$('#plugin')).screenshot({ path: resolve(out, 'litigation-confirm-320.png') })
  await frame.click('.uni-modal__btn_primary')
  await page.waitForFunction(() => calls.some(c => c.operation === 'restyle' && c.mode === '白描' && c.confirmOverwrite))
  await frame.waitForFunction(() => document.querySelector('.lv-mode.active')?.textContent === '白描')
  assert.deepEqual(await page.evaluate(() => events.filter(e => e.name.startsWith('awd:litviz')).map(e => e.name)), ['awd:litviz-restyling','awd:litviz-restyled'])
  await page.evaluate(() => { diagrams.push({folderId:70,name:'新增合成图',svgFileId:62});frame.contentWindow.postMessage({awd:1,type:'event',event:'files.changed',data:{}},'*') })
  await frame.waitForFunction(() => document.querySelectorAll('.lv-row').length === 2)
  checks.push('pack readiness/install poll', 'scope folder/cancel retention', 'editable/master open', 'restyle cancel/confirm/events', 'gallery file-change refresh')
  await frame.waitForSelector('.uni-toast', { hidden: true })
  // A real native keyboard activation must cross the actual workspace action.
  await frame.focus('.lv-btn.primary')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => calls.filter(c => c.operation === 'generate').length === 1)
  assert.match(await page.evaluate(() => calls.find(c => c.operation === 'generate').params.scope), /folderId=5/)
  assert.equal(await page.evaluate(() => calls.find(c => c.operation === 'generate').params.diagramHint), '事实经过时间轴')
  await frame.waitForFunction(() => document.querySelector('.lv-generation-title')?.textContent === '正在读取材料并出图')
  assert.equal(await frame.$eval('.lv-btn.primary', el => el.disabled), true)
  assert.equal(await frame.$eval('.lv-field', el => el.disabled), true)
  await page.evaluate(() => { generation.startedAt=Date.now()-46000 })
  await frame.waitForFunction(() => document.querySelector('.lv-generation')?.textContent.includes('材料较多时可能需要更久'))
  assert.equal(await page.evaluate(() => calls.filter(c => c.operation === 'generate').length), 1)
  assert.deepEqual(await page.evaluate(() => ({ prompts, show:workspace.showAiPanel, mounted:workspace.aiPanelMounted, id:workspace.chatId, text:document.querySelector('#existing-chat').textContent })),
    {prompts:[],show:false,mounted:false,id:'existing-chat',text:'保留现有对话'})
  checks.push('keyboard generate through real SDK/PluginPane/business/workspace action', 'acknowledgment and slow progress remain busy', 'existing AI panel untouched')
  await page.evaluate(() => { failGenerationStatus=true })
  await frame.waitForFunction(() => document.querySelector('.lv-generation-error')?.textContent.includes('合成状态连接中断'))
  assert.equal(await frame.$eval('.lv-btn.primary', el => el.disabled), true)
  await page.evaluate(() => { failGenerationStatus=false })
  await frame.waitForSelector('.lv-generation-error', { hidden: true })
  await page.evaluate(() => { generation={...generation,phase:'paused',message:'等待继续出图'} })
  await frame.waitForFunction(() => document.querySelector('.lv-generation-title')?.textContent === '出图已暂停')
  await clickText(frame, '.lv-generation .lv-btn', '继续出图')
  await page.waitForFunction(() => calls.some(c => c.operation === 'continue'))
  checks.push('status interruption remains visible and recovers', 'paused task continues from the panel')

  await page.evaluate(() => {
    generation={...generation,phase:'waiting',message:'请核对材料中的日期和重点。',question:{key:'q-1',text:'是否采用原始日期，并将保证期间作为重点？',options:['采用原始日期','保证期间作为重点'],descriptions:['按所选材料记载的日期出图','不推断材料未记载的起止日期'],multiSelect:true}};
    frame.style.width='260px';
  })
  await frame.waitForSelector('.lv-question-option')
  const assertQuestionFits = async theme => {
    const metrics = await frame.evaluate(() => ({
      width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
      controls:[...document.querySelectorAll('.lv-question-option,.lv-answer-input,.lv-question .lv-btn')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}),
      optionColor:getComputedStyle(document.querySelector('.lv-question-option')).color,
      optionBackground:getComputedStyle(document.querySelector('.lv-question-option')).backgroundColor,
    }))
    assert.equal(metrics.width, 260)
    assert.ok(metrics.scrollWidth <= 260, theme+' panel has no horizontal overflow')
    for (const rect of metrics.controls) assert.ok(rect.left>=0 && rect.right<=260 && rect.width>0, theme+' question controls fit')
    assert.notEqual(metrics.optionColor, metrics.optionBackground)
    return metrics
  }
  await assertQuestionFits('light')
  await (await page.$('#plugin')).screenshot({ path: resolve(out, 'litigation-question-light-260.png') })
  await page.evaluate(() => frame.contentWindow.postMessage({awd:1,type:'theme',theme:'dark',tokens:{'--awd-surface':'#202723','--awd-bg':'#151c18','--awd-text':'#f4f1e8','--awd-text-2':'#d0d7cf','--awd-text-3':'#b0bab0','--awd-panel-text':'#f4f1e8','--awd-panel-text-2':'#d0d7cf','--awd-panel-text-3':'#b0bab0','--awd-panel-text-4':'#a3b1a5','--awd-panel-border':'#58695e','--awd-border':'#58695e','--awd-panel-accent':'#9ac8ad','--awd-accent-wash':'#314638','--awd-accent-hover':'#badcc7','--awd-text-on-accent':'#102519','--awd-danger':'#e6a6a6','--awd-danger-soft':'#4a2424'}},'*'))
  await frame.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  const darkMetrics=await assertQuestionFits('dark')
  assert.equal(darkMetrics.optionColor,'rgb(244, 241, 232)')
  await frame.focus('.lv-question-option')
  // Establish keyboard modality with real traversal; programmatic focus after
  // a pointer click correctly does not activate :focus-visible in Chromium.
  await page.keyboard.press('Tab')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  assert.equal(await frame.$eval('.lv-question-option', el=>getComputedStyle(el).outlineStyle), 'solid')
  await page.keyboard.press('Space')
  await frame.waitForFunction(() => document.querySelector('.lv-question-option')?.getAttribute('aria-pressed') === 'true')
  await (await frame.$$('.lv-question-option'))[1].click()
  await frame.type('.lv-answer-input', '保留材料原文，不推断缺失日期')
  await (await page.$('#plugin')).screenshot({ path: resolve(out, 'litigation-question-dark-260.png') })
  await clickText(frame, '.lv-question .lv-btn', '按以上选择继续')
  await page.waitForFunction(() => calls.some(c => c.operation === 'answer'))
  assert.deepEqual(await page.evaluate(() => calls.find(c => c.operation === 'answer').params.answer), {selected:['采用原始日期','保证期间作为重点'],other:'保留材料原文，不推断缺失日期'})
  await frame.waitForSelector('.lv-question', {hidden:true})
  checks.push('260px light/dark controls and visible keyboard focus', 'in-panel multi-choice and immediate free-text answer')

  // No usable file means visible failure; a retry keeps its submission ID.
  await page.evaluate(() => { generation={...generation,phase:'failed',message:'未生成可用的图表，请重试'} })
  await frame.waitForFunction(() => document.querySelector('.lv-generation')?.textContent.includes('未生成可用的图表，请重试'))
  assert.equal(await frame.$eval('.lv-btn.primary',el=>el.disabled),false)
  assert.equal(await page.evaluate(() => opened.includes(81)),false)
  await frame.click('.lv-btn.primary')
  await page.waitForFunction(() => calls.filter(c => c.operation === 'generate').length === 2)
  assert.equal(await page.evaluate(() => calls.filter(c=>c.operation==='generate')[0].params.clientRequestId),await page.evaluate(() => calls.filter(c=>c.operation==='generate')[1].params.clientRequestId))
  await page.evaluate(() => finishDrawing())
  await frame.waitForFunction(() => document.querySelector('.lv-generation-title')?.textContent === '图表已生成')
  await frame.waitForFunction(() => document.querySelectorAll('.lv-row').length === 3)
  assert.equal(await page.evaluate(() => opened.includes(81)),true)
  checks.push('visible no-file failure and retry', 'successful status refreshes gallery and opens generated file through workbench handler')

  await page.evaluate(() => { failGenerationStart=true })
  await frame.click('.lv-btn.primary')
  await frame.waitForFunction(() => document.querySelector('.lv-generation-error')?.textContent.includes('合成启动失败，请重试'))
  await page.evaluate(() => { failGenerationStart=false })
  await frame.click('.lv-btn.primary')
  await frame.waitForFunction(() => document.querySelector('.lv-generation-title')?.textContent === '正在读取材料并出图')
  assert.equal(await page.evaluate(() => calls.filter(c=>c.operation==='generate').at(-2).params.clientRequestId), await page.evaluate(() => calls.filter(c=>c.operation==='generate').at(-1).params.clientRequestId), 'retry after a completed task keeps the failed start identity')
  await clickText(frame,'.lv-generation-stop','停止出图')
  await frame.waitForFunction(() => document.querySelector('.lv-generation-title')?.textContent === '正在请求停止')
  assert.equal(await frame.$eval('.lv-btn.primary',el=>el.disabled),true)
  await page.evaluate(() => { generation={...generation,phase:'cancelled',message:'已停止，现有文件保留'} })
  await frame.waitForFunction(() => document.querySelector('.lv-generation-title')?.textContent === '已停止出图')
  assert.equal(await frame.$eval('.lv-btn.primary',el=>el.disabled),false)
  assert.deepEqual(await page.evaluate(() => ({ prompts, show:workspace.showAiPanel, mounted:workspace.aiPanelMounted, id:workspace.chatId })), {prompts:[],show:false,mounted:false,id:'existing-chat'})
  checks.push('persistent start rejection and retry', 'stop stays pending until confirmed', 'AI panel unchanged across complete journey')
  await (await page.$('#plugin')).screenshot({ path: resolve(out, 'litigation-cancelled-dark-260.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks, output: out, limitations: ['synthetic task runner, backend and file picker; real business bridge and workspace actions', 'no real drawing engine or paid AI', 'no installed Electron client'] }))
} catch (error) {
  await page?.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)) }
