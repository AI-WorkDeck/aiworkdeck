// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const api=window.prototype,status=document.querySelector('#status'),canvas=document.querySelector('#document');
const viewport=document.querySelector('#viewport'),layer=document.querySelector('#document-layer');
let model=null,current=null,input=null,snapshot=null,painting=false,paintAgain=false,paintTimer,opening=false,firstPaint=false,mounting=Promise.resolve();
const message=error=>{status.textContent=error.message||String(error)};
const request=(action,params={})=>api.action(action,{documentEpoch:model.documentEpoch,...params});
const size=()=>{
 const width=Math.min(800,viewport.clientWidth),height=viewport.clientHeight,scale=width/model.widthTwips;
 return {width,height,cssWidth:width,cssHeight:height,scale,xTwips:0,yTwips:Math.round(viewport.scrollTop/scale),widthTwips:model.widthTwips,heightTwips:Math.round(height/scale)};
};
async function paint(){
 if(!model)return;
 if(painting){paintAgain=true;return}
 painting=true;const epoch=model.documentEpoch;
 try{
  const metrics=size(),tile=await api.paint(metrics);
  if(!model||epoch!==model.documentEpoch)return;
  layer.style.width=metrics.width+'px';layer.style.height=Math.max(viewport.clientHeight,model.heightTwips*metrics.scale)+'px';
  canvas.style.top=(tile.yTwips*metrics.scale)+'px';canvas.style.width=metrics.width+'px';canvas.style.height=metrics.height+'px';
  canvas.width=tile.width;canvas.height=tile.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(tile.pixels),tile.width,tile.height),0,0);
  input?.viewportChanged?.();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(!firstPaint){firstPaint=true;api.painted('body-visible');status.textContent='正文已绘制'}
 }catch(error){message(error)}finally{painting=false;if(paintAgain){paintAgain=false;schedulePaint()}}
}
function schedulePaint(){clearTimeout(paintTimer);paintTimer=setTimeout(paint,35)}
async function flush(){
 if(!model)return;
 await input.flush();const saved=await api.save();status.textContent=saved.dirty?'待保存':'已保存';if(saved.dirty)throw Error('保存期间有新输入，请完成后再试');
}
api.onFlush(async()=>{if(input)await input.suspend();try{await flush()}catch(error){input?.resume();throw error}});
function controls(enabled){for(const id of ['save','undo','redo','view-mode'])document.getElementById(id).disabled=!enabled;document.querySelector('#show-history').disabled=!enabled||!model?.historyAvailable}
async function activate(ids){
 if(opening)return;opening=true;controls(false);
 try{
  if(model){await input.suspend();await flush();await api.close();model=null}
  status.textContent='加载正文…';current=ids;await mountModel(await api.open(ids));
 }catch(error){input?.resume();message(error)}finally{opening=false;controls(!!model)}
}
async function mountModel(next){
 model=next;firstPaint=false;viewport.scrollTop=0;canvas.width=1;canvas.height=1;
 const factory=window.AWDDocumentInput?.createDocumentInput||window.createDocumentInput;
 if(!factory)throw Error('文档输入组件未加载');
 input=factory({canvas,request,viewport:size,writeClipboard:api.writeClipboard,onSave:()=>flush().catch(message),onError:message,onChanged:()=>{status.textContent='待保存';schedulePaint()},onEnsureVisible:rect=>{if(rect.y*size().scale<viewport.scrollTop||rect.y*size().scale>viewport.scrollTop+viewport.clientHeight-40)viewport.scrollTop=Math.max(0,rect.y*size().scale-80)}});
 input.setDocument(model);for(const event of model.initialCallbacks||[])input.handleCallback(event);await paint();controls(true);
 refreshReview().catch(message);
}
async function projects(){
 const result=await api.list(),list=document.querySelector('#projects');list.textContent='';
 document.querySelector('#notice').textContent=result.source==='cache'?'正在核对上次的项目列表…':'';
 for(const project of result.projects){
  const title=document.createElement('strong');title.textContent=project.name;list.append(title);
  for(const file of project.files||[]){
   if(file.isDirectory||file.directory||file.fileType==='folder')continue;
   const button=document.createElement('button');button.textContent=file.name;button.dataset.fileId=file.id;
   button.onclick=()=>activate({projectId:project.id,fileId:file.id});list.append(button);
  }
 }
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));api.painted('projects-visible');
}
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
function firstRect(item){const r=item.rects?.[0];return Array.isArray(r)?{x:r[0],y:r[1],width:r[2],height:r[3]}:r}
async function refreshReview(){
 if(!model)return;
 const epoch=model.documentEpoch,result=await request('review_snapshot');if(!model||epoch!==model.documentEpoch)return;
 snapshot=result;const list=document.querySelector('#revision-items');list.textContent='';
 document.querySelector('#revision-count').textContent=result.items.length+' 处修订';
 for(const item of result.items){
  const card=element('article',undefined,'item');card.dataset.revisionId=item.revisionId;
  card.append(element('div',(item.type==='Insert'?'插入':item.type==='Delete'?'删除':item.type)+' · '+item.author,'meta'));
  card.append(element('p',item.textAvailable?item.text:item.description));
  if(!item.textAvailable)card.append(element('small','修订摘要'));
  const actions=element('div',undefined,'actions');
  for(const [label,action]of [['定位','goto'],['接受','accept'],['拒绝','reject']]){
   const button=element('button',label);button.onclick=async()=>{
    try{
     await input.flush();
     const params={refreshEpoch:result.refreshEpoch,revisionId:item.revisionId};
     await request(action==='goto'?'review_goto':'review_resolve',action==='goto'?params:{...params,decision:action});
     if(action==='goto'){
      const rect=firstRect(item);if(rect)viewport.scrollTop=Math.max(0,rect.y*size().scale-80);
      document.querySelector('.item.active')?.classList.remove('active');card.classList.add('active');
     }else{status.textContent='待保存';await refreshReview()}
     await paint();
    }catch(error){message(error)}
   };actions.append(button);
  }
  card.append(actions);list.append(card);
 }
 api.painted('review-ready');
}
async function history(){
 if(!model?.historyAvailable)return;
 const result=await api.history(),list=document.querySelector('#version-items');list.textContent='';
 for(const entry of result.entries||result.versions||result.timeline||result||[]){
  const card=element('article',undefined,'item'),ref=entry.sha||entry.commitId||entry.id;
  card.append(element('p',entry.title||entry.message||ref));card.append(element('small',entry.authorName||entry.author||''));
  const restore=element('button','恢复此版本');restore.onclick=async()=>{
   if(!window.confirm('保存当前内容，然后恢复这个版本？'))return;
   try{controls(false);await input.suspend();await api.restore(ref);await mounting;status.textContent='版本已恢复';await history()}catch(error){message(error)}finally{input?.resume();controls(!!model)}
  };card.append(restore);list.append(card);
 }
}
document.querySelector('#save').onclick=()=>flush().catch(message);
for(const [id,command]of [['undo','.uno:Undo'],['redo','.uno:Redo']])document.getElementById(id).onclick=async()=>{try{await input.flush();await request('command',{command,arguments:'{}'});status.textContent='待保存';await paint();await refreshReview()}catch(error){message(error)}};
document.querySelector('#view-mode').onchange=async event=>{try{await input.flush();const next=await request('review_view',{mode:event.target.value});if(next.widthTwips)model.widthTwips=next.widthTwips;if(next.heightTwips)model.heightTwips=next.heightTwips;await paint();await refreshReview()}catch(error){message(error)}};
document.querySelector('#show-revisions').onclick=()=>{document.querySelector('#revisions').hidden=false;document.querySelector('#versions').hidden=true};
document.querySelector('#show-history').onclick=()=>{document.querySelector('#revisions').hidden=true;document.querySelector('#versions').hidden=false;history().catch(message)};
document.querySelector('#create-version').onclick=async()=>{try{await api.createVersion(document.querySelector('#version-title').value);await history();status.textContent='版本已保存'}catch(error){message(error)}finally{input?.resume()}};
api.onEvent(event=>{
 if(event.type==='callback'&&model&&event.documentEpoch===model.documentEpoch){
  input?.handleCallback?.(event);
  if(event.callbackType===0)schedulePaint();
  if(event.callbackType===13){const dimensions=String(event.payload).split(',').map(Number);if(dimensions.length===2&&dimensions.every(Number.isFinite)){model.widthTwips=dimensions[0];model.heightTwips=dimensions[1];schedulePaint()}}
 }else if(event.type==='document-closed'){input?.dispose();input=null;model=null;controls(false)}
 else if(event.type==='document-opened'){mounting=mountModel(event.model);mounting.catch(message)}
 else if(event.type==='authority-ready'){projects().catch(message)}
 else if(event.error)message(event.error);
});
viewport.addEventListener('scroll',()=>{input?.viewportChanged?.();schedulePaint()});
window.addEventListener('resize',schedulePaint);
projects().catch(message);
