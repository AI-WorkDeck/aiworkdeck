// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated visual experiment, deliberately not imported by the product entry point.
const {app,BrowserWindow,ipcMain,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const config=JSON.parse(fs.readFileSync(process.env.AWD_PROTOTYPE_CONFIG,'utf8'));
for(const key of ['home','appData','userData','sessionData','temp','logs','crashDumps']){
 const p=path.join(config.run,key);fs.mkdirSync(p,{recursive:true});app.setPath(key,p);
}
const env={HOME:path.join(config.run,'home'),TMPDIR:path.join(config.run,'temp'),PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'en_US.UTF-8',SAL_LOK_OPTIONS:'unipoll'};
const events=[];const mark=(name,data={})=>{events.push({at:Date.now(),name,...data});fs.writeFileSync(path.join(config.run,'events.json'),JSON.stringify(events,null,2))};
let data,engine,seq=0,view,selected,closing=false;
function channel(cmd,args,framed){
 const log=fs.openSync(path.join(config.run,framed?'engine.log':'data.log'),'w');
 const proc=spawn(cmd,args,{cwd:config.run,env,stdio:['pipe','pipe',log]});fs.closeSync(log);
 let buffer=Buffer.alloc(0),pending=new Map(),resolveReady,rejectReady;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject});
 const accept=(head,bytes)=>{
  if(head.type==='engine-ready'){mark('engine-ready',head);resolveReady(head);return}
  const id=framed?head.reqId:head.id;
  if(id==null){if(head.type==='fatal')rejectReady(Error(head.error));return}
  const slot=pending.get(id);if(!slot)return;pending.delete(id);clearTimeout(slot.timer);
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
  const id=++seq,head=Buffer.from(JSON.stringify(framed?{reqId:id,action:method,...params}:{id,method,params}));
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Operation outcome unknown; restart prototype'))},45000);pending.set(id,{resolve,reject,timer});
  if(framed){const sizes=Buffer.alloc(8);sizes.writeUInt32LE(head.length);sizes.writeUInt32LE(bytes.length,4);proc.stdin.write(Buffer.concat([sizes,head,bytes]))}
  else proc.stdin.write(Buffer.concat([head,Buffer.from('\n')]));
 });
 return {proc,call,ready};
}
async function paint(){
 const scale=screen.getDisplayMatching(view.getBounds()).scaleFactor;
 const width=Math.round(800*scale),height=Math.round(900*scale);
 const tile=await engine.call('paint',{width,height,xTwips:0,yTwips:0,widthTwips:11906,heightTwips:13395});
 if(!tile.pixelsChanged)throw Error('Engine returned an empty pixel buffer');
 const pixels=Buffer.from(tile.bytes);
 if(tile.tileMode===1)for(let i=0;i<pixels.length;i+=4){const b=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=b}
 mark('paint-returned',{changedBytes:tile.changedBytes});return {pixels:new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength),width,height};
}
app.whenReady().then(async()=>{
 data=channel(config.dataBinary,['--profile',config.profile],false);
 await data.call('health');mark('data-ready');
 view=new BrowserWindow({width:1280,height:900,show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 view.setContentSize(1280,900);
 ipcMain.handle('prototype:list',async()=>{const projects=await data.call('projects.list');return Promise.all(projects.map(async p=>({...p,files:await data.call('files.list',{projectId:p.id})}))) });
 ipcMain.handle('prototype:open',async(_,ids)=>{
  if(engine)throw Error('This experiment opens one document per process');
  mark('click-open');selected={...ids,...await data.call('files.read',ids)};
  const profile=path.join(config.run,'lo-profile');fs.mkdirSync(profile);
  engine=channel(config.worker,[config.runtime,new URL('file://'+profile).href,config.run],true);await engine.ready;
  await engine.call('open',{path:selected.physicalPath});mark('model-loaded');return paint();
 });
 ipcMain.handle('prototype:save',async(_,text)=>{
  if(!engine||!selected)throw Error('Open a file first');
  if(text)await engine.call('paste',{},Buffer.from(text));
  const target=path.join(config.run,'native-export.docx');await engine.call('save',{path:target});
  const saved=await data.call('files.save',{projectId:selected.projectId,fileId:selected.fileId,expectedGeneration:selected.generation,contentBase64:fs.readFileSync(target).toString('base64')});
  selected.generation=saved.generation;mark('saved');return paint();
 });
 ipcMain.on('prototype:painted',(_,kind)=>mark(kind));
 await view.loadFile(path.join(__dirname,'index.html'));view.show();
}).catch(error=>{mark('fatal',{error:error.stack});app.quit()});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
 if(closing)return;event.preventDefault();closing=true;
 (async()=>{
  if(engine&&engine.proc.exitCode===null)await engine.call('shutdown').catch(()=>{});
  if(data)data.proc.stdin.end();
  for(const child of [engine?.proc,data?.proc].filter(Boolean)){
   if(child.exitCode===null)await new Promise(resolve=>{const timeout=setTimeout(()=>{child.kill();resolve()},5000);child.once('exit',()=>{clearTimeout(timeout);resolve()})});
  }
  app.quit();
 })();
});
setInterval(()=>{if(fs.existsSync(path.join(config.run,'quit')))app.quit()},100).unref();
