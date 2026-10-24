// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const status=document.querySelector('#status'),canvas=document.querySelector('#document');
async function draw(tile){
 const bytes=new Uint8ClampedArray(tile.pixels);
 canvas.width=tile.width;canvas.height=tile.height;
 canvas.getContext('2d').putImageData(new ImageData(bytes,tile.width,tile.height),0,0);
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));window.prototype.painted('body-visible');
}
(async()=>{
 const projects=await window.prototype.list(),list=document.querySelector('#projects');list.textContent='';
 for(const project of projects){const title=document.createElement('strong');title.textContent=project.name;list.append(title);
  for(const file of project.files){const button=document.createElement('button');button.textContent=file.name;button.dataset.fileId=file.id;list.append(button);button.onclick=async()=>{
   button.disabled=true;status.textContent='加载正文…';
   try{await draw(await window.prototype.open({projectId:project.id,fileId:file.id}));document.querySelector('#save').disabled=false;status.textContent='正文已绘制'}catch(e){status.textContent=e.message}
  }}
 }
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));window.prototype.painted('projects-visible');
})().catch(e=>{status.textContent=e.message});
document.querySelector('#save').onclick=async()=>{
 const button=document.querySelector('#save');button.disabled=true;
 try{await draw(await window.prototype.save(document.querySelector('#input').value));status.textContent='已写入 SQLite 样板中的原文件';document.querySelector('#input').value='';button.disabled=false}catch(e){status.textContent=e.message}
};
