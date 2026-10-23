// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Packaged opaque iframes, real service/clone/download-manager code, synthetic
// API fixtures. The postMessage host below is a test adapter, not PluginPane.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
async function source(file) { return (await readFile(resolve(root, file), 'utf8')).replace(/^import .*\n/gm, '').replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ').replaceAll('export const ', 'const ') }
const [business, voice, insight, optional, manager, tabs, wav] = await Promise.all([
  'src/utils/pluginBusinessServices.js', 'src/utils/pluginVoiceServices.js', 'src/utils/pluginInsightServices.js',
  'src/composables/useOptionalComponents.js', 'src/composables/useComponentDownloads.js',
  'src/pages/project-overview/insightEntityTab.js', 'src/utils/ttsWav.js',
].map(source))
const hostScript = `
const kind = new URL(location.href).searchParams.get('kind') || 'voice';
const ready = new URL(location.href).searchParams.has('ready');
window.calls = []; window.toasts = []; window.listCount = 0;
window.row = {id:71,title:'合成会议',status:'RECORDING',durationMs:10000,createdAt:'2026-01-01T10:00:00',audioFileId:72};
window.context = {docFileId:null,docName:'',canWrite:true,cursorContext:null};
window.standard = {id:4,name:'合成标准',version:1,confirmedVersion:null,position:'甲方',jurisdiction:'中国',rules:[{id:'r1',title:'付款期限',instruction:'核对合成期限'}]};
const entity = {id:31,kind:'DOC',name:'合成依据',hasDetail:true,retrievalStatus:'FOUND',mentions:[{quote:'合成依据'}]};
const {readPcmWav} = (() => { ${wav}; return {readPcmWav} })();
const {createOptionalComponentsController,overallPercentOf} = (()=>{${optional};return {createOptionalComponentsController,overallPercentOf}})();
const {createComponentDownloadManager} = (()=>{${manager};return {createComponentDownloadManager}})();
let progress;
const componentDownloads = createComponentDownloadManager({
  optionalComponents:async()=>({components:[{packId:'kokoro-runtime',installed:true,modelId:'kokoro-models',service:'kokoro-service'}]}),
  modelStatus:async()=>({components:[{id:'kokoro-models',state:ready?'installed':'absent'}]}),
  onModelProgress:callback=>{progress=callback;return()=>{}},
  modelDownload:async()=>{progress({id:'kokoro-models',phase:'error',message:'synthetic model failure'})},
  ensureService:async()=>({ok:true}),
});
const host = {model:{status:async()=>({components:[{id:'kokoro-models',state:ready?'installed':'absent'}]})},services:{ensure:async()=>({ok:true})}};
const showDialog = async ({content})=>{calls.push(['confirm',content]);return {confirm:true}};
const requireAccount=async()=>true, confirmPaidTranscription=async()=>{calls.push(['paid']);return true},getAuthHeaders=()=>({});
const api = {
 getTtsVoices:async()=>ready?[{voiceId:'synthetic',name:'合成音色'}]:[],
 generateTtsAudio:async(params,options)=>{calls.push(['synthesize',params]);return (await fetch('/fixture.wav',{signal:options.signal})).arrayBuffer()},
 getPlatformServices:async()=>({services:[{service:'asr',provider:'local'}]}),
 getMeetingAsrNotice:async()=>({acknowledged:true}),probeLocalAsr:async()=>({ready:true,status:'READY'}),
 getMeetingRecordings:async()=>{listCount++;return {meetings:row?[{...row}]:[],configured:true,tier:'local'}},
 getMeetingRecording:async()=>({...row}),
 transcribeMeetingRecording:async id=>{calls.push(['transcribe',id]);row.status='TRANSCRIBING';return {...row}},
 deleteMeetingRecording:async id=>{calls.push(['delete',id]);window.row=null;return {}},
};
const recorder = {
 recorderState:{status:'recording',projectId:12,meetingId:71,seconds:10,level:0},
 isRecordingActive:()=>recorder.recorderState.status!=='idle',
 listAudioInputDevices:async()=>(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'),
};
window.externalStop = ()=>{recorder.recorderState.status='idle';recorder.recorderState.projectId=null;row.status='RECORDED';frame.contentWindow.postMessage({awd:1,type:'event',event:'speech.stopped',data:{}},'*')};
const getDocInsight=async()=>({code:0,data:{run:{id:1,status:'DONE'},entities:[entity],findings:[]}});
const getDocInsightEntity=async()=>({code:0,data:{detail:{source:'project-file',fileId:20,fileName:'合成依据.docx'}}});
const refreshDocInsightEntity=async()=>({}),parseDocInsight=async()=>({});
const reviews={listReviewStandards:async()=>[{...standard}],saveReviewStandard:async(_pid,data)=>{window.standard={...data,id:4,version:2,confirmedVersion:null};calls.push(['save',data]);return {...standard}},confirmReviewStandard:async(_pid,id,version)=>{standard.confirmedVersion=version;calls.push(['confirmStandard',id,version]);return {...standard}},getContractReview:async()=>({run:null})};
const {insightEntityTabMethods}=(()=>{${tabs};return {insightEntityTabMethods}})();
window.workbench={leftFiles:[{id:10}],rightFiles:[],activeFileIdLeft:10,splitMode:false,focusedPane:'left',$refs:{fileTree:{allFiles:[{id:20,name:'合成依据.docx'}]}},closeInsightHoverCard(){},triggerWorkbenchResize(){},$nextTick:fn=>fn(),openFile(file){calls.push(['open',file.id,this.focusedPane])},...insightEntityTabMethods};
const {createPluginVoiceServices}=(()=>{${voice};return {createPluginVoiceServices}})();
const {createPluginInsightServices}=(()=>{${insight};return {createPluginInsightServices}})();
const {createPluginBusinessServices,clonePluginData}=(()=>{${business};return {createPluginBusinessServices,clonePluginData}})();
const options={projectId:()=>12,permissions:()=>['speech','file_read','file_write','network','editor'],isCurrent:()=>true,listFiles:async()=>[{id:20}],actions:{
 insightContext:()=>context,insightEntities:()=>{},insightOpenDoc:payload=>workbench.openInsightDocFile(payload),
 importVoiceText:async()=>({fileId:10,text:'这是合成朗读内容。'}),highlightVoice:payload=>calls.push(['highlight',payload]),clearVoiceHighlight:()=>{},
 download:payload=>{readPcmWav(payload.content);calls.push(['download',payload.content.byteLength])},
}};
const service=kind==='voice'?createPluginVoiceServices(options):createPluginInsightServices(options);
const wrapper=createPluginBusinessServices({...options,delegates:{[kind]:(...args)=>service.request(...args)}});
window.frame=document.querySelector('iframe');
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{pluginId:kind,projectId:'12',language:'zh-CN',theme:'light',themeTokens:{'--awd-surface':'#fff','--awd-text':'#222','--awd-text-2':'#666','--awd-panel-fs':'13px','--awd-font-size-body':'13px','--awd-panel-pad-x':'12px','--awd-border':'#ddd','--awd-accent':'#286158'}}},'*');
addEventListener('message',async event=>{
 const msg=event.data;if(event.source!==frame.contentWindow||msg?.type!=='call')return;
 try{const result=msg.method==='services.request'?clonePluginData(await wrapper.request(msg.params.service,msg.params.operation,msg.params.params)):msg.method==='events.subscribe'?{subscribed:msg.params.events}:msg.method==='ui.toast'?toasts.push(msg.params):{};
 frame.contentWindow.postMessage({awd:1,type:'result',seq:msg.seq,ok:true,result},'*')}
 catch(error){frame.contentWindow.postMessage({awd:1,type:'result',seq:msg.seq,ok:false,error:{code:error.code,message:error.message}},'*')}
});
frame.src='/api/plugin-web/'+kind+'/index.html';
`
const pcm = Buffer.alloc(44 + 48000)
pcm.write('RIFF'); pcm.writeUInt32LE(pcm.length - 8,4); pcm.write('WAVEfmt ',8); pcm.writeUInt32LE(16,16); pcm.writeUInt16LE(1,20); pcm.writeUInt16LE(1,22); pcm.writeUInt32LE(24000,24); pcm.writeUInt32LE(48000,28); pcm.writeUInt16LE(2,32); pcm.writeUInt16LE(16,34); pcm.write('data',36); pcm.writeUInt32LE(pcm.length-44,40)
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'}
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/?')){res.setHeader('Content-Type',mime['.html']);return res.end('<!doctype html><meta charset="utf-8"><iframe sandbox="allow-scripts allow-forms" style="width:320px;height:800px;border:0"></iframe><script src="/host.js"></script>')}
 if(req.url==='/host.js'){res.setHeader('Content-Type',mime['.js']);return res.end(hostScript)}
 if(req.url==='/fixture.wav'){res.setHeader('Content-Type','audio/wav');return res.end(pcm)}
 if(req.url==='/favicon.ico'){res.statusCode=204;return res.end()}
 const match=/^\/api\/plugin-web\/(voice|insight)\/([a-zA-Z0-9_.\/-]+)$/.exec(req.url||'')
 if(!match||match[2].includes('..')){res.statusCode=404;return res.end()}
 try{res.setHeader('Content-Type',mime[extname(match[2])]||'application/octet-stream');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src blob: data:; connect-src 'none'");res.end(await readFile(resolve(root,'../official-plugins',match[1],'web',match[2])))}catch{res.statusCode=404;res.end()}
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser
const mode=process.argv[2]||'all'
try{
 browser=await puppeteer.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']})
 async function open(kind,ready=false){const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?kind='+kind+(ready?'&ready=1':''));const frame=await(await page.$('iframe')).contentFrame();return{page,frame,errors}}
 async function visible(frame,selector){return frame.$eval(selector,el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})}
 if(mode==='all'||mode==='voice'){
  const {page,frame,errors}=await open('voice');await frame.waitForSelector('.ev-gate-btn.primary');await frame.click('.ev-gate-btn.primary');
  await frame.waitForFunction(()=>document.body.textContent.includes('synthetic model failure'));
  assert.equal((await page.evaluate(()=>toasts)).some(t=>JSON.stringify(t).includes('成功')),false);
  await frame.click('.voice-tab:nth-child(2)');await frame.waitForSelector('.mr-item-delete');
  await frame.click('.mr-item-delete');await frame.waitForSelector('.mr-dialog-content');
  assert.equal(await visible(frame,'.mr-dialog-btn.cancel'),true);assert.equal(await visible(frame,'.mr-dialog-btn.confirm'),true);
  await frame.click('.mr-dialog-btn.cancel');assert.equal(await frame.$('.mr-dialog-content'),null);
  const before=await page.evaluate(()=>listCount);await page.evaluate(()=>externalStop());
  await page.waitForFunction(n=>listCount>n,{},before);
  await frame.waitForFunction(()=>document.querySelector('.mr-status')?.textContent.trim()==='未转写');
  await frame.click('.mr-item-head');await frame.waitForSelector('.mr-section .mr-btn.primary');await frame.click('.mr-section .mr-btn.primary');await page.waitForFunction(()=>calls.some(c=>c[0]==='transcribe'));assert.equal(await page.evaluate(()=>calls.some(c=>c[0]==='paid')),true);
  await frame.click('.mr-item-delete');await frame.click('.mr-dialog-btn.confirm');await page.waitForFunction(()=>calls.some(c=>c[0]==='delete'));
  assert.deepEqual(errors,[]);console.log('PASS voice: actual manager failure, 320px delete cancel/confirm, external-stop refresh');await page.close();
 }
 if(mode==='all'||mode==='tts'){
  const {page,frame,errors}=await open('voice',true);await frame.waitForSelector('.mini-btn');await frame.click('.mini-btn');
  await frame.waitForFunction(()=>document.querySelector('.action-area .workdeck-btn')?.getAttribute('aria-disabled') === 'false');await frame.click('.action-area .workdeck-btn');
  await frame.waitForFunction(()=>document.querySelector('.download-link')&&document.querySelector('.download-link').getAttribute('aria-disabled') === 'false');
  await frame.click('.download-link');await page.waitForFunction(()=>calls.some(c=>c[0]==='download'));
  assert.equal(await page.evaluate(()=>calls.find(c=>c[0]==='synthesize')[1].rate),1);
  await page.waitForFunction(()=>calls.some(c=>c[0]==='highlight'&&c[1].fileId===10));
  assert.deepEqual(errors,[]);console.log('PASS voice: import, native Audio/blob playback, real PCM WAV export bridge');await page.close();
 }
 if(mode==='all'||mode==='insight'){
  const {page,frame,errors}=await open('insight');await frame.waitForSelector('.ip-tab');await frame.click('.ip-tab:nth-child(3)');await frame.waitForSelector('.cr-choice');
  assert.equal(await frame.$('.cr-error'),null);await frame.click('.cr-choice');await frame.waitForSelector('.cr-input input');
  const name=await frame.$('.cr-input input');await name.click({clickCount:3});await name.type('合成标准修订');
  await frame.$eval('.cr-actions',el=>el.scrollIntoView());assert.equal(await visible(frame,'.cr-actions .cr-button:nth-child(1)'),true);assert.equal(await visible(frame,'.cr-actions .cr-button:nth-child(2)'),true);
  await frame.click('.cr-actions .cr-button:nth-child(1)');await page.waitForFunction(()=>calls.some(c=>c[0]==='save'));
  await frame.click('.cr-actions .cr-button:nth-child(2)');await page.waitForFunction(()=>calls.some(c=>c[0]==='confirmStandard'));
  await page.evaluate(()=>{context={...context,docFileId:10,docName:'合成正文.docx'}});
  await frame.click('.ip-tab:nth-child(1)');await frame.waitForSelector('.ip-row-top');await frame.click('.ip-row-top');await frame.waitForSelector('.ip-link');await frame.click('.ip-link');
  await page.waitForFunction(()=>calls.some(c=>c[0]==='open'));assert.deepEqual(await page.evaluate(()=>calls.find(c=>c[0]==='open')),['open',20,'right']);assert.equal(await page.evaluate(()=>workbench.activeFileIdLeft),10);
  assert.deepEqual(errors,[]);console.log('PASS insight: no-document standards, 320px save/confirm, actual host right-pane method');await page.close();
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done))}
