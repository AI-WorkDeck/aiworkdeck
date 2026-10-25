// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated visual experiment, deliberately not imported by the product entry point.
const {app,BrowserWindow,ipcMain,screen,clipboard}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {exportWithInlineRevisions}=require('./review-export.cjs');
const {createReviewUndo}=require('./review-undo.cjs');
const {REVIEW_BATCH_SIZE,hydrateReviewBatch,requireReviewDetails}=require('./review-hydration.cjs');
const config=JSON.parse(fs.readFileSync(process.env.AWD_PROTOTYPE_CONFIG,'utf8'));
for(const key of ['home','appData','userData','sessionData','temp','logs','crashDumps']){
 const p=path.join(config.run,key);fs.mkdirSync(p,{recursive:true});app.setPath(key,p);
}
const env={HOME:path.join(config.run,'home'),TMPDIR:path.join(config.run,'temp'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',SAL_LOK_OPTIONS:'unipoll'};
const events=[];const mark=(name,data={})=>{events.push({at:Date.now(),name,...data});fs.writeFileSync(path.join(config.run,'events.json'),JSON.stringify(events,null,2))};
let data,engine,unoClient,authority,authorityReady,backend,seq=0,view,selected,closing=false,dirty=false,mutationVersion=0,savePromise=null,restoreSelection=null,authorityIsReady=false,documentLocked=false;
const initialCallbacks=new Map();
let reviewIdentity=null;
const {verifyReviewTarget}=require('./review-match.cjs');
// CAPI edits and multi-call UNO reads share the same native model. Keep a whole
// operation together so a revision cannot be deleted while UNO is reading it.
let nativeQueue=Promise.resolve();
function nativeTask(work){const result=nativeQueue.then(work);nativeQueue=result.catch(()=>{});return result}
const emit=event=>{if(view&&!view.isDestroyed())view.webContents.send('prototype:event',event)};
function channel(cmd,args,framed,extraEnv={}){
 const log=fs.openSync(path.join(config.run,framed?'engine.log':extraEnv.PYTHONHOME?'uno.log':'data.log'),'w');
 const proc=spawn(cmd,args,{cwd:config.run,env:{...env,...extraEnv},stdio:['pipe','pipe',log]});fs.closeSync(log);
 let buffer=Buffer.alloc(0),pending=new Map(),resolveReady,rejectReady,uncertain=false;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});
 const accept=(head,bytes)=>{
  if(head.type==='phase'){mark('engine-phase',head);return}
  if(head.type==='engine-ready'){mark('engine-ready',head);resolveReady(head);return}
  if(head.type==='callback'){if([1,2,3,4,5,13].includes(head.callbackType))initialCallbacks.set(head.callbackType,head);emit(head);return}
  const id=framed?head.reqId:head.id;
  if(id==null){if(head.type==='fatal')rejectReady(Error(head.error));return}
  const slot=pending.get(id);if(!slot)return;pending.delete(id);clearTimeout(slot.timer);
  if(head.outcomeUnknown)uncertain=true;
  if(head.error||head.success===false)slot.reject(Error(JSON.stringify(head)));
  else slot.resolve(framed?{...head,bytes}:head.result);
 };
 proc.stdout.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  while(true){
   if(framed){
    if(buffer.length<8)return;
    const h=buffer.readUInt32LE(0),b=buffer.readUInt32LE(4);
    if(!h||h+b>64*1024*1024){proc.kill();return}
    if(buffer.length<8+h+b)return;
    const head=JSON.parse(buffer.subarray(8,8+h)),bytes=buffer.subarray(8+h,8+h+b);buffer=buffer.subarray(8+h+b);accept(head,bytes);
   }else{const end=buffer.indexOf(10);if(end<0)return;const head=JSON.parse(buffer.subarray(0,end));buffer=buffer.subarray(end+1);accept(head)}
  }
 });
 const fail=error=>{rejectReady(error);for(const p of pending.values()){clearTimeout(p.timer);p.reject(error)}pending.clear()};
 proc.on('error',fail);proc.on('exit',(code,signal)=>{mark(framed?'engine-exit':'data-exit',{code,signal});fail(Error('Child exited '+code))});
 if(!framed)resolveReady();
 const call=(method,params={},bytes=Buffer.alloc(0))=>new Promise((resolve,reject)=>{
  if(uncertain&&method!=='shutdown'){reject(Error('先前操作结果未知；当前会话已锁定'));return}
  const id=++seq,head=Buffer.from(JSON.stringify(framed?{reqId:id,action:method,...params}:{id,method,params}));
  const timer=setTimeout(()=>{pending.delete(id);uncertain=true;reject(Error('Operation outcome unknown; do not retry or overwrite this session'))},45000);pending.set(id,{resolve,reject,timer});
  if(framed){const sizes=Buffer.alloc(8);sizes.writeUInt32LE(head.length);sizes.writeUInt32LE(bytes.length,4);proc.stdin.write(Buffer.concat([sizes,head,bytes]))}
  else proc.stdin.write(Buffer.concat([head,Buffer.from('\n')]));
 });
 return {proc,call,ready};
}
async function paint(viewport={}){
 if(!engine||!selected)throw Error('尚未打开文档');
 const scale=screen.getDisplayMatching(view.getBounds()).scaleFactor;
 const cssWidth=Number(viewport.width)||800,cssHeight=Number(viewport.height)||800;
 const width=Math.min(2048,Math.round(cssWidth*scale)),height=Math.min(2048,Math.round(cssHeight*scale));
 const widthTwips=selected.widthTwips,yTwips=Math.max(0,Math.round(Number(viewport.yTwips)||0));
 const heightTwips=Math.round(widthTwips*cssHeight/cssWidth);
 await engine.call('set_viewport',{documentEpoch:selected.documentEpoch,width:cssWidth,height:cssHeight,widthTwips,heightTwips,xTwips:0,yTwips});
 const tile=await engine.call('paint',{documentEpoch:selected.documentEpoch,width,height,xTwips:0,yTwips,widthTwips,heightTwips});
 if(!tile.pixelsChanged)throw Error('Engine returned an empty pixel buffer');
 const pixels=Buffer.from(tile.bytes);
 if(tile.tileMode===1)for(let i=0;i<pixels.length;i+=4){const b=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=b}
 mark('paint-returned',{changedBytes:tile.changedBytes});
 return {pixels:new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength),width,height,widthTwips,heightTwips,yTwips,documentEpoch:selected.documentEpoch};
}
async function startEngine(){
 if(engine)return;
 const profile=path.join(config.run,'lo-profile');fs.mkdirSync(profile,{recursive:true});
 mark('engine-spawn');
 engine=channel(config.worker,[config.runtime,pathToFileURL(profile).href,config.run],true);await engine.ready;
}
async function startUno(){
 if(unoClient||!config.unoRuntime||!config.unoHost)return;
 const bridge=await engine.call('start_urp',{documentEpoch:selected.documentEpoch});
 const pythonHome=path.join(config.unoRuntime,'Frameworks/LibreOfficePython.framework/Versions/3.12');
 unoClient=channel(config.unoHost,[path.join(pythonHome,'LibreOfficePython'),path.join(__dirname,'../native-lok/review_uno.py'),'--port',String(bridge.port)],false,{
  PYTHONHOME:pythonHome,PYTHONPATH:path.join(config.unoRuntime,'Resources')+':'+path.join(config.unoRuntime,'Frameworks'),
  URE_BOOTSTRAP:'vnd.sun.star.pathname:'+path.join(config.unoRuntime,'Resources/fundamentalrc'),
  PYTHONDONTWRITEBYTECODE:'1',PYTHONPYCACHEPREFIX:path.join(config.run,'python-cache')
 });
}
async function reviewCall(method,params={}){
 await startUno();if(!unoClient)throw Error('需要原生审阅连接');
 return unoClient.call(method,{documentUrl:pathToFileURL(selected.physicalPath).href,...params});
}
async function setTracking(enabled,initialize=false){
 if(typeof enabled!=='boolean')throw Error('enabled must be a boolean');
 const identity=selected,documentUrl=pathToFileURL(identity.physicalPath).href;
 identity.trackingReady=false;
 await startUno();if(!unoClient)throw Error('需要原生修订连接');
 if(selected!==identity)throw Error('STALE_DOCUMENT');
 const result=await unoClient.call('tracking',{documentUrl,enabled,...(initialize?{initialize:true}:{})});
 if(selected!==identity)throw Error('STALE_DOCUMENT');
 if(result.enabled!==enabled||typeof result.changed!=='boolean'||typeof result.modified!=='boolean'
   ||(initialize&&result.modified)||(!initialize&&result.changed&&!result.modified))throw Error('修订跟踪状态未确认');
 identity.recordChanges=result.enabled;identity.trackingReady=true;
 if(!initialize&&result.changed){dirty=true;mutationVersion++}
 return {...result,documentEpoch:identity.documentEpoch};
}
const reviewUndo=createReviewUndo({view:params=>reviewCall('view',params),
 undoState:()=>reviewCall('undo_state'),undoStep:(kind,expected)=>reviewCall('undo_step',{kind,expected})});
async function reviewSnapshot(){
 const summary=await engine.call('review_snapshot',{documentEpoch:selected.documentEpoch});
 reviewIdentity={...summary,hydratedCount:0,batchSize:REVIEW_BATCH_SIZE,
  items:summary.items.map(item=>({...item,textAvailable:false,text:null}))};
 return reviewIdentity;
}
async function reviewBatch(params){
 const identity=reviewIdentity;
 try{return await hydrateReviewBatch(params,{
  getIdentity:()=>reviewIdentity,
  getDocument:()=>selected&&({documentEpoch:selected.documentEpoch,documentUrl:pathToFileURL(selected.physicalPath).href}),
  snapshot:documentEpoch=>engine.call('review_snapshot',{documentEpoch}),
  details:async payload=>{await startUno();if(!unoClient)throw Error('需要原生审阅连接');return unoClient.call('snapshot_batch',payload)}
 })}catch(error){
  if(error.message.includes('STALE_REVIEW_BATCH')&&reviewIdentity===identity)reviewIdentity=null;
  throw error;
 }
}
async function verifyReviewCard(params){
 // The worker bumps refreshEpoch on ordinary input, so the card's epoch is stale
 // by design. Re-establish identity against a fresh CAPI snapshot plus one
 // targeted UNO detail read, then dispatch with the fresh epoch.
 requireReviewDetails(reviewIdentity,params.revisionId);
 return verifyReviewTarget(params,{reviewIdentity,documentEpoch:selected.documentEpoch,
  documentUrl:pathToFileURL(selected.physicalPath).href,
  startUno:async()=>{await startUno();return unoClient},
  engineCall:(method,p)=>engine.call(method,p),unoCall:(method,p)=>unoClient.call(method,p)});
}
async function openDocument(ids){
 if(selected)throw Error('请先保存并关闭当前文档');
 mark('click-open');
 let file;
 if(authority){
  await authorityReady;
  file=await authority.readFile(ids.projectId,ids.fileId);
  const physicalPath=path.join(config.run,'opened-document.docx');
  fs.writeFileSync(physicalPath,Buffer.from(file.bytes));file={...file,physicalPath};
 }else file=await data.call('files.read',ids);
 mark('document-read');
 await startEngine();
 initialCallbacks.clear();reviewIdentity=null;
 const model=await engine.call('open',{path:file.physicalPath});
 selected={...ids,...file,...model,trackingReady:false};reviewUndo.reset();dirty=false;documentLocked=false;mark('model-loaded');
 try{await setTracking(true,true);mark('tracking-ready')}
 catch(error){
  // No input has been accepted yet. Never expose a model whose default could
  // not be confirmed; retain the failure if the native close also fails.
  try{await closeDocument()}catch(closeError){throw new AggregateError([error,closeError],'修订初始化失败，文档未进入可编辑状态')}
  throw error;
 }
 return {documentEpoch:selected.documentEpoch,viewId:model.viewId,widthTwips:model.widthTwips,heightTwips:model.heightTwips,trackingReady:true,recordChanges:selected.recordChanges,historyAvailable:!!authority,initialCallbacks:[...initialCallbacks.values()].filter(event=>event.documentEpoch===model.documentEpoch)};
}
async function closeDocument(){
 if(!selected)return;
 if(savePromise)await savePromise;
 if(dirty)throw Error('文档仍有未保存修改');
 await engine.call('close',{documentEpoch:selected.documentEpoch});selected=null;reviewIdentity=null;reviewUndo.reset();emit({type:'document-closed'});
}
async function saveDocument(){
 if(savePromise)return savePromise;
 if(!selected)throw Error('尚未打开文档');
 if(!selected.trackingReady)throw Error('修订跟踪状态未确认，已暂停编辑');
 reviewUndo.assertSafe();
 const identity=selected,saveVersion=mutationVersion;
 savePromise=(async()=>{
  const target=path.join(config.run,'native-export.docx');
  await startUno();if(!unoClient)throw Error('保存前需要核验原生修订显示状态');
  const bytes=await exportWithInlineRevisions(
   params=>unoClient.call('view',{documentUrl:pathToFileURL(identity.physicalPath).href,...params}),
   async()=>{await engine.call('save',{documentEpoch:identity.documentEpoch,path:target});return fs.readFileSync(target)}
  );
  if(authority)await authority.saveFile(identity.projectId,identity.fileId,bytes);
  else {
   const saved=await data.call('files.save',{projectId:identity.projectId,fileId:identity.fileId,expectedGeneration:identity.generation,contentBase64:bytes.toString('base64')});
   identity.generation=saved.generation;
  }
  dirty=mutationVersion!==saveVersion;mark('saved',{dirty});return {saved:true,dirty};
 })();
 try{return await savePromise}finally{savePromise=null}
}
const flushWaiters=new Map();
function flushRenderer(){
 if(!selected)return Promise.resolve(true);
 return new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{flushWaiters.delete(id);reject(Error('保存确认未完成，保留当前文档'))},180000);
  flushWaiters.set(id,{resolve,reject,timer});view.webContents.send('prototype:flush',id);
 });
}
ipcMain.on('prototype:flushed',(event,id,success,error)=>{
 if(event.sender!==view?.webContents)return;
 const pending=flushWaiters.get(id);if(!pending)return;flushWaiters.delete(id);clearTimeout(pending.timer);
 if(success){documentLocked=true;pending.resolve(true)}else pending.reject(Error(error||'保存失败'));
});
function handle(name,handler){
 ipcMain.handle('prototype:'+name,(event,...args)=>{
  if(event.sender!==view?.webContents||event.senderFrame!==view.webContents.mainFrame)throw Error('Unexpected sender');
  return handler(...args);
 });
}
app.whenReady().then(async()=>{
 if(!config.unoHost||!config.unoRuntime)throw Error('原生编辑实验需要显式配置 unoHost 和 unoRuntime，以核验审阅和保存');
 view=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 view.setContentSize(1280,900);
 if(config.authority){
  const {createJavaAuthority}=require('../local-data/compatibility/java-authority.cjs');
  const a=config.authority;
  const log=fs.openSync(path.join(config.run,'backend.log'),'w');
  backend=spawn(a.java,['-jar',a.jar],{cwd:config.run,env:{...env,...a.env},stdio:['ignore',log,log]});fs.closeSync(log);
  authority=createJavaAuthority({baseUrl:a.baseUrl,cacheDirectory:path.join(config.run,'project-cache'),profileId:a.profileId,expectedBuild:a.build,headers:a.headers,editor:{
   flush:()=>flushRenderer(),
   close:async({operationId})=>{restoreSelection=selected&&{projectId:selected.projectId,fileId:selected.fileId};await nativeTask(closeDocument);return {ok:true,operationId,closed:true}},
   reload:async({operationId})=>{if(!restoreSelection)throw Error('Missing restore selection');const model=await nativeTask(()=>openDocument(restoreSelection));emit({type:'document-opened',model});restoreSelection=null;return {ok:true,operationId}},
   abort:async()=>false
  }});
  authorityReady=authority.ready({timeoutMs:90000}).then(()=>{authorityIsReady=true;mark('authority-ready');emit({type:'authority-ready'});return true});
  authorityReady.catch(error=>emit({type:'authority-error',error:error.message}));
 }else{
  data=channel(config.dataBinary,['--profile',config.profile],false);await data.call('health');mark('data-ready');
 }
 handle('list',async()=>{
  if(authority){const cached=await authority.cachedSnapshot();if(cached&&!authorityIsReady)return cached;await authorityReady;return authority.snapshot()}
  const projects=await data.call('projects.list');
  return {source:'authority',projects:await Promise.all(projects.map(async project=>{
   const files=await data.call('files.list',{projectId:project.id});
   const nodes=new Map(files.map(file=>[file.id,{...file,children:[]}])),roots=[];
   for(const file of files){
    const node=nodes.get(file.id);
    if(file.parentId==null)roots.push(node);
    else {const parent=nodes.get(file.parentId);if(!parent?.isFolder)throw Error('项目目录关系不完整');parent.children.push(node)}
   }
   return {...project,files:roots};
  }))};
 });
 handle('write-clipboard',text=>{if(typeof text!=='string'||Buffer.byteLength(text)>8*1024*1024)throw Error('Invalid clipboard text');clipboard.writeText(text);return {written:true}});
 handle('open',ids=>nativeTask(()=>openDocument(ids)));handle('close',()=>nativeTask(closeDocument));handle('paint',viewport=>nativeTask(()=>paint(viewport)));handle('save',()=>nativeTask(saveDocument));
 const allowed=new Set(['set_viewport','input_text','input_key','input_mouse','input_barrier','review_snapshot','review_batch','review_goto','review_resolve','review_view','review_tracking','selected_text','selection_text','command']);
 handle('action',(action,params={})=>nativeTask(async()=>{
  if(!selected||!allowed.has(action))throw Error('Unsupported editor action');
  if(!selected.trackingReady)throw Error('修订跟踪状态未确认，已暂停编辑');
  reviewUndo.assertSafe();
  if(documentLocked&&['input_text','input_key','input_mouse','review_resolve','review_goto','command','review_view','review_tracking'].includes(action))throw Error('文档正在保存或恢复，请稍候');
  if(params.documentEpoch!==selected.documentEpoch)throw Error('STALE_DOCUMENT');
  if(action==='command'&&!['.uno:Undo','.uno:Redo'].includes(params.command))throw Error('Unsupported toolbar command');
  if(['input_text','input_key','command'].includes(action)){dirty=true;mutationVersion++}
  if(action==='command')return reviewUndo.step(params.command==='.uno:Undo'?'undo':'redo');
  if(action==='review_snapshot')return reviewSnapshot();
  if(action==='review_batch')return reviewBatch(params);
  if(action==='review_tracking')return setTracking(params.enabled);
  if(action==='review_view'){
   await startUno();if(!unoClient)throw Error('需要原生审阅连接');
   const result=await unoClient.call('view',{documentUrl:pathToFileURL(selected.physicalPath).href,mode:params.mode,refresh:true});
   const snapshot=await engine.call('review_snapshot',{documentEpoch:selected.documentEpoch});
   selected.widthTwips=snapshot.widthTwips;selected.heightTwips=snapshot.heightTwips;
   return {...result,...snapshot};
  }
  if(action==='review_goto'||action==='review_resolve'){
   if(action==='review_resolve'&&!['accept','reject'].includes(params.decision))throw Error('INVALID_REVIEW_DECISION');
   // Re-establish identity after the inline detour: switching layout can move
   // revision ranges and callbacks can invalidate the previous CAPI epoch.
   const run=async()=>{
    const verified=await verifyReviewCard(params);
    if(action==='review_resolve'){dirty=true;mutationVersion++}
    const result=await engine.call(action,{...params,refreshEpoch:verified.refreshEpoch});
    if(action==='review_goto')return {...result,rects:verified.rects,...await unoClient.call('verify_location',{documentUrl:pathToFileURL(selected.physicalPath).href,identifier:verified.identifier})};
    return result;
   };
   return action==='review_resolve'?reviewUndo.resolve(run):run();
  }
  const key=Number(params.keyCode)&0xFFF;
  const potentialEdit=action==='input_text'||(action==='input_key'&&params.eventType===0
   &&!(key>=1024&&key<=1031)&&key!==1281&&key!==1285
   &&!(key===512&&(Number(params.keyCode)&(0x2000|0x8000))));
  return potentialEdit?reviewUndo.edit(()=>engine.call(action,params)):engine.call(action,params);
 }));
 handle('history',async()=>{if(!authority||!selected)throw Error('版本记录仅用于接续旧项目的实验');return authority.history(selected.projectId,selected.fileId)});
 handle('create-version',async title=>{if(!authority||!selected)throw Error('没有版本服务');try{return await authority.createVersion(selected.projectId,{title})}finally{documentLocked=false}});
 handle('restore',async ref=>{if(!authority||!selected)throw Error('没有版本服务');try{return await authority.restore(selected.projectId,{ref})}finally{documentLocked=false}});
 ipcMain.on('prototype:painted',(event,kind)=>{if(event.sender===view.webContents)mark(kind)});
 await view.loadFile(path.join(__dirname,'index.html'));view.show();
}).catch(error=>{mark('fatal',{error:error.stack});app.quit()});
app.on('browser-window-created',(_,window)=>window.on('close',event=>{if(!closing){event.preventDefault();app.quit()}}));
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
 if(closing)return;event.preventDefault();closing=true;
 (async()=>{
  try{await flushRenderer()}catch(error){closing=false;mark('quit-blocked',{error:error.message});emit({type:'save-error',error:error.message});return}
  if(engine&&engine.proc.exitCode===null)await nativeTask(()=>engine.call('shutdown')).catch(()=>{});
  if(data)data.proc.stdin.end();
  if(unoClient)unoClient.proc.stdin.end();
  if(backend&&backend.exitCode===null){
   try{await fetch(config.authority.baseUrl+'/api/desktop/shutdown',{method:'POST',headers:config.authority.headers})}catch{}
   await new Promise(resolve=>{if(backend.exitCode!==null)return resolve();const timer=setTimeout(resolve,55000);backend.once('exit',()=>{clearTimeout(timer);resolve()})});
   if(backend.exitCode===null){closing=false;emit({type:'save-error',error:'后台尚未退出，保留窗口'});return}
  }
  for(const child of [engine?.proc,data?.proc,unoClient?.proc].filter(Boolean)){
   if(child.exitCode===null)await new Promise(resolve=>{const timeout=setTimeout(()=>{child.kill();resolve()},5000);child.once('exit',()=>{clearTimeout(timeout);resolve()})});
  }
  app.quit();
 })();
});
setInterval(()=>{if(fs.existsSync(path.join(config.run,'quit')))app.quit()},100).unref();
