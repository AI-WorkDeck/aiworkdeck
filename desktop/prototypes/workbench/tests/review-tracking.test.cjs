// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Execute the real host with synthetic child transports. No Electron/native process.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {createRequire}=require('node:module');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function harness(options={}){
 const main=path.join(__dirname,'../main.cjs'),localRequire=createRequire(main),handlers=new Map(),calls=[],events=[];
 const config={run:'/isolated/run',profile:'/isolated/data',worker:'worker',dataBinary:'data',runtime:'/candidate/Frameworks',unoHost:'uno',unoRuntime:'/uno-runtime'};
 let epoch=0,tracking=true,view,trackingHandler;
 const sender={};sender.mainFrame={};sender.send=(_name,event)=>events.push(event);
 class Window{constructor(){view=this;this.webContents=sender}setContentSize(){}isDestroyed(){return false}getBounds(){return {}}async loadFile(){}show(){}}
 const electron={app:{setPath(){},whenReady:()=>Promise.resolve(),on(){},quit(){}},BrowserWindow:Window,
  ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on(){}},screen:{getDisplayMatching:()=>({scaleFactor:1})},clipboard:{writeText(){}}};
 function spawn(command){
  const p=new EventEmitter();p.stdout=new EventEmitter();p.exitCode=null;p.kill=()=>{};
  const send=(q,result)=>{
   if(command!=='worker'){p.stdout.emit('data',Buffer.from(JSON.stringify({id:q.id,result})+'\n'));return}
   const head=Buffer.from(JSON.stringify({type:'result',success:true,reqId:q.reqId,...result})),size=Buffer.alloc(8);size.writeUInt32LE(head.length);p.stdout.emit('data',Buffer.concat([size,head]));
  };
  p.stdin={end(){},write(bytes){
   const q=JSON.parse(command==='worker'?bytes.subarray(8,8+bytes.readUInt32LE(0)).toString():bytes.toString());
   const method=q.action||q.method,params=command==='worker'?q:q.params;calls.push({command,method,params});
   Promise.resolve().then(async()=>{
    let result={};
    if(command==='data'&&method==='files.read')result={physicalPath:'/isolated/run/document-'+params.fileId+'.docx',generation:1,contentBase64:Buffer.from('readonly-docx').toString('base64'),canWrite:true,...options.file};
    if(command==='worker'&&method==='open')result={documentEpoch:++epoch,viewId:0,widthTwips:12000,heightTwips:15000,readOnly:params.readOnly===true,...options.model};
    if(method==='start_urp')result={port:12345};
    if(method==='tracking'){
     if(trackingHandler)result=await trackingHandler(params);
     else{const changed=tracking!==params.enabled;tracking=params.enabled;result={enabled:tracking,changed,modified:!params.initialize&&changed}}
    }
    if(method==='tracking_state')result={enabled:tracking,modified:false};
    if(method==='view')result={mode:params.mode||'all'};
    if(method==='review_snapshot')result={documentEpoch:epoch,refreshEpoch:1,widthTwips:12000,heightTwips:15000,items:[]};
    if(method==='files.save')result={generation:2};
    send(q,result);
   }).catch(error=>{p.stdout.emit('data',Buffer.from(JSON.stringify({id:q.id,error:error.message})+'\n'))});
  }};
  if(command==='worker')queueMicrotask(()=>{
   const head=Buffer.from(JSON.stringify({type:'engine-ready'})),size=Buffer.alloc(8);size.writeUInt32LE(head.length);p.stdout.emit('data',Buffer.concat([size,head]));
  });
  return p;
 }
 const fakeFs={readFileSync:p=>p==='/config'?JSON.stringify(config):Buffer.from('saved-docx'),writeFileSync(){},mkdirSync(){},openSync:()=>1,closeSync(){},existsSync:()=>false};
 vm.runInNewContext(fs.readFileSync(main,'utf8'),{require:name=>name==='electron'?electron:name==='node:fs'?fakeFs:name==='node:child_process'?{spawn}:localRequire(name),
  __dirname:path.dirname(main),process:{env:{AWD_PROTOTYPE_CONFIG:'/config'}},Buffer,console,setTimeout,clearTimeout,queueMicrotask,setInterval:()=>({unref(){}})});
 await turn();assert.ok(view);assert.ok(handlers.has('prototype:open'));
 const invoke=(name,...args)=>handlers.get('prototype:'+name)({sender,senderFrame:sender.mainFrame},...args);
 return {calls,events,invoke,setTrackingHandler:fn=>{trackingHandler=fn},getTracking:()=>tracking,
  open:fileId=>invoke('open',{projectId:1,fileId:fileId||1}),
  action:(action,params={})=>invoke('action',action,{documentEpoch:epoch,...params})};
}

test('open waits for verified default tracking before queued input can run',async()=>{
 const h=await harness(),gate=deferred();h.setTrackingHandler(()=>gate.promise);
 const opened=h.open();await turn();
 assert.equal(h.calls.filter(c=>c.method==='tracking').length,1);
 const input=h.action('input_text',{text:'tracked',inputSeq:1});await turn();
 assert.equal(h.calls.some(c=>c.method==='input_text'),false);
 gate.resolve({enabled:true,changed:true,modified:false});
 const model=await opened;await input;
 assert.equal(model.trackingReady,true);assert.equal(model.recordChanges,true);
 assert.deepEqual(h.calls.find(c=>c.method==='tracking').params,{documentUrl:pathToFileURL('/isolated/run/document-1.docx').href,enabled:true,initialize:true});
});

test('read-only files open a temporary model, permit reading and never enter a write path',async()=>{
 const h=await harness({file:{canWrite:false}}),model=await h.open();
 assert.equal(model.readOnly,true);
 assert.equal(h.calls.find(c=>c.method==='open').params.readOnly,true);
 assert.equal(h.calls.some(c=>c.method==='tracking'),false);
 assert.equal(h.calls.filter(c=>c.method==='tracking_state').length,1);
 for(const [action,params] of [['input_text',{text:'blocked'}],['input_key',{eventType:0,keyCode:1286}],['input_key',{eventType:0,keyCode:513|0x2000}],['command',{command:'.uno:Undo'}],['review_resolve',{decision:'accept'}],['review_tracking',{enabled:false}]]){
  await assert.rejects(h.action(action,params),/只读/);
 }
 await assert.rejects(h.invoke('save'),/只读/);
 await h.action('review_snapshot');
 await h.action('input_key',{eventType:0,keyCode:1027,charCode:0,inputSeq:1});
 await h.action('review_view',{mode:'final'});
 await h.invoke('close');
 assert.equal(h.calls.some(c=>c.method==='files.save'||c.method==='save'||c.method==='input_text'||c.method==='command'),false);
});

test('missing data permission and an unconfirmed native read-only model fail before editable publication',async()=>{
 const missing=await harness({file:{canWrite:undefined}});
 await assert.rejects(missing.open(),/权限/);
 assert.equal(missing.calls.some(c=>c.method==='open'),false);
 const wrong=await harness({file:{canWrite:false},model:{readOnly:false}});
 await assert.rejects(wrong.open(),/只读/);
 assert.equal(wrong.calls.filter(c=>c.method==='close').length,1);
 assert.equal(wrong.calls.some(c=>c.method==='tracking'),false);
 const hiddenPath=await harness({file:{canWrite:false,physicalPath:undefined}});
 await hiddenPath.open();
 assert.equal(hiddenPath.calls.find(c=>c.method==='open').params.path,path.join('/isolated/run','readonly-document.docx'));
 await hiddenPath.invoke('close');
});

test('failed or mismatched initialization closes the undisclosed model and blocks input/save',async()=>{
 for(const answer of [()=>Promise.reject(Error('tracking failed')),()=>({enabled:false,changed:false,modified:false}),()=>({enabled:true,changed:true,modified:true})]){
  const h=await harness();h.setTrackingHandler(answer);
  await assert.rejects(h.open(),/tracking|修订/);
  await assert.rejects(h.action('input_text',{text:'must not enter'}));await assert.rejects(h.invoke('save'));
  assert.equal(h.calls.some(c=>c.method==='input_text'),false);assert.equal(h.calls.some(c=>c.method==='save'),false);
  assert.equal(h.calls.filter(c=>c.method==='close').length,1);
 }
});

test('initial configuration does not dirty the host; a user toggle requires saving',async()=>{
 const h=await harness();await h.open();await h.invoke('close');
 await h.open(2);const result=await h.action('review_tracking',{enabled:false});
 assert.equal(result.enabled,false);assert.equal(result.documentEpoch,2);
 await assert.rejects(h.invoke('close'),/未保存/);
 const tracking=h.calls.filter(c=>c.method==='tracking');
 assert.equal(tracking.at(-1).params.documentUrl,pathToFileURL('/isolated/run/document-2.docx').href);
 assert.equal(tracking.at(-1).params.initialize,undefined);
 await h.invoke('save');await h.invoke('close');
});

test('invalid booleans and old epochs cannot change tracking or reset modified',async()=>{
 const h=await harness();await h.open();
 for(const enabled of [undefined,null,0,1,'false',[],{}])await assert.rejects(h.action('review_tracking',{enabled}),/boolean/);
 await assert.rejects(h.action('review_tracking',{enabled:false,documentEpoch:0}),/STALE_DOCUMENT/);
 assert.equal(h.calls.filter(c=>c.method==='tracking').length,1);
 await h.action('review_tracking',{enabled:false,initialize:true,documentUrl:'file:///other.docx'});
 const params=h.calls.filter(c=>c.method==='tracking').at(-1).params;
 assert.equal(params.documentUrl,pathToFileURL('/isolated/run/document-1.docx').href);assert.equal(params.initialize,undefined);
});

test('display changes do not alter tracking, and a failed toggle locks further edits',async()=>{
 const h=await harness();await h.open();await h.action('review_tracking',{enabled:false});
 await h.action('review_view',{mode:'final'});await h.action('review_view',{mode:'all'});
 assert.equal(h.getTracking(),false);assert.equal(h.calls.filter(c=>c.method==='tracking').length,2);
 h.setTrackingHandler(()=>({enabled:false,changed:false,modified:true}));
 await assert.rejects(h.action('review_tracking',{enabled:true}),/tracking|修订/);
 await assert.rejects(h.action('input_text',{text:'must not enter'}),/tracking|修订/);
 assert.equal(h.calls.some(c=>c.method==='input_text'),false);
});
