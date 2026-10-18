import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { skillDir } from './store.js';
import { WorkbenchStore } from './workbench.js';
import { Runner } from './runner.js';

export const name='dpia-workbench';
export const inject=['connection','skills','sessionController','workspaceController'];
export function makeRoute(store){return {path:'/api/dpia.workbench',methods:['POST'],requestBody:'buffered',async fetch(request){
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return new Response('JSON required',{status:415});
 const reader=request.body?.getReader();let size=0,chunks=[];
 if(reader){for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>28_000_000){await reader.cancel();return new Response('Too large',{status:413});}chunks.push(value);}}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return new Response('Invalid JSON',{status:400});}
 if(size>256000&&body?.payload?.action!=='importAsset')return new Response('Too large',{status:413});
 if(body?.type!=='client-request'||body.method!=='dpia.workbench'||typeof body.rpcId!=='string'||body.rpcId.length>200)return new Response('Invalid envelope',{status:400});
 let result;try{result={ok:true,value:await store.run(body.payload)};}catch(e){const safe=/^[A-Z_]+$/.test(e.message)?e.message:'STORAGE_OR_SKILL_ERROR';result={ok:false,error:{code:'dpia/'+safe,message:safe,details:{}}};}
 return Response.json({type:'server-response',rpcId:body.rpcId,result},{headers:{'cache-control':'no-store'}});
}};}
export function apply(ctx){
 const root=process.env.DSH_DPIA_DATA_DIR||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'dpia-workbench');
 const store=new WorkbenchStore(root);
 // Shared /api exact routes inherit Connection's authenticated operator boundary,
 // including the Desktop-owned carrier and browser Host/Origin/cookie checks.
 ctx.connection.fetch.register(makeRoute(new Runner(store,ctx.sessionController,ctx.workspaceController)));
 const path=join(skillDir,'SKILL.md'),raw=readFileSync(path,'utf8');
 const description=raw.match(/^description:\s*(.+)$/m)?.[1]||'GDPR DPIA 产品评估';
 ctx.skills.register({name:'assess-product-dpia',description,content:raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''),path,source:'bundled',resourceBase:{kind:'directory',path:skillDir}});
}
