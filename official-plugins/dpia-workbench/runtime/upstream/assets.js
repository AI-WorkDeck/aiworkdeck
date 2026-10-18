import {readFileSync,existsSync,lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {join,extname,basename} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {publish} from './store.js';
import {safeFile,hash} from './results.js';
const MIME={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',txt:'text/plain',md:'text/markdown'};
export class Assets {
 constructor(store){this.store=store;this.maxFile=20_000_000;this.maxCase=100_000_000;}
 python(){const configured=process.env.DSH_DPIA_DOCUMENT_PYTHON;if(configured)return configured;const runtime=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');return existsSync(runtime)?runtime:this.store.python;}
 import(input){
  const filename=input.filename,kind=typeof filename==='string'?extname(filename).slice(1).toLowerCase():'';
  if(!MIME[kind]||filename!==basename(filename)||filename.length>240||/[\\\0]/.test(filename))throw Error('UNSUPPORTED_FILE');
  if(typeof input.base64!=='string'||input.base64.length>Math.ceil(this.maxFile/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw Error('FILE_TOO_LARGE_OR_INVALID');
  const data=Buffer.from(input.base64,'base64');if(!data.length||data.length>this.maxFile||data.toString('base64')!==input.base64)throw Error('FILE_TOO_LARGE_OR_INVALID');
  const s=this.store.state(input.id);if(input.version!==s.version)throw Error('STALE_VERSION');
  if(input.questionId)this.store.resultObject(input.id,'questions',input.questionId);
  const digest=hash(data),duplicate=(s.assets||[]).find(a=>a.sha256===digest);
  if(duplicate)return {...this.store.view(input.id),importNotice:'已有相同内容的材料：'+duplicate.filename};
  if((s.assets||[]).reduce((n,a)=>n+a.bytes,0)+data.length>this.maxCase)throw Error('CASE_FILE_LIMIT');
  if(input.replacesSourceId&&!s.evidence.some(e=>e.id===input.replacesSourceId))throw Error('SOURCE_NOT_FOUND');
  const id='FILE-'+randomUUID(),dir=join(this.store.dir(s.id),'originals');
  try{mkdirSync(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}if(lstatSync(dir).isSymbolicLink()||realpathSync(dir)!==dir)throw Error('UNSAFE_PATH');
  const path=join(dir,id+'.'+kind);publish(path,data);
  const extraction=spawnSync(this.python(),[fileURLToPath(new URL('./asset-extract.py',import.meta.url)),path,kind],{encoding:'utf8',timeout:30000,maxBuffer:8_000_000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  let parsed;try{parsed=JSON.parse(extraction.stdout);}catch{parsed={status:'blocked',warnings:['提取程序不可用或失败；原件已保留，可更换可读材料或核对文档环境'],text:'',parts:0};}
  const asset={purpose:input.purpose==='template'?'template':'evidence',questionId:input.questionId||null,id,filename,kind,path,sha256:digest,bytes:data.length,source:input.source||filename,date:input.date||new Date().toISOString(),status:parsed.status,warnings:parsed.warnings,parts:parsed.parts,createdAt:new Date().toISOString(),replacesSourceId:input.replacesSourceId||null};
  if(parsed.text){const sourceId='SRC-'+randomUUID(),textPath=join(this.store.dir(s.id),'evidence',sourceId+'.txt');
   const parent=join(this.store.dir(s.id),'evidence');if(lstatSync(parent).isSymbolicLink()||realpathSync(parent)!==parent)throw Error('UNSAFE_PATH');
   const content=`原始文件：${filename}\n原件 SHA-256：${digest}\n提取状态：${parsed.status}\n提取限制：${parsed.warnings.join('；')||'未检测到结构限制，仍需事实核对'}\n\n${parsed.text}`;
   publish(textPath,content);asset.extracted={purpose:asset.purpose,attachmentToQuestion:asset.questionId,id:sourceId,title:filename,locator:'原件逐段 / 逐单元格 / 逐页提取',path:textPath,sha256:hash(content),status:'reported',assetId:id,createdAt:asset.createdAt};
  }
  return this.store.mutate(input,state=>{state.assets??=[];state.assets.push(asset);if(asset.status==='ready')this.attach(state,asset);this.store.event(state,'asset_import',{assetId:id,status:asset.status,sha256:digest});});
 }
 attach(state,asset){if(!asset.extracted)throw Error('EMPTY_EXTRACTION');if(!state.evidence.some(e=>e.id===asset.extracted.id))state.evidence.push(asset.extracted);if(asset.replacesSourceId){state.withdrawnSourceIds??=[];if(!state.withdrawnSourceIds.includes(asset.replacesSourceId))state.withdrawnSourceIds.push(asset.replacesSourceId);}}
 accept(input){return this.store.mutate(input,s=>{const a=s.assets?.find(a=>a.id===input.assetId);if(!a||a.status!=='needs_review'||!a.extracted)throw Error('EXTRACTION_NOT_REVIEWABLE');if(typeof input.reviewNote!=='string'||!input.reviewNote.trim())throw Error('INVALID_TEXT');a.status='accepted_with_limits';this.attach(s,a);this.store.event(s,'extraction_review',{assetId:a.id,note:input.reviewNote.slice(0,2000),warnings:a.warnings});});}
 get(input,download=false){const a=this.store.state(input.id).assets?.find(a=>a.id===input.assetId);if(!a)throw Error('ASSET_NOT_FOUND');const original=readFileSync(safeFile(this.store.dir(input.id),a.path,this.maxFile));if(hash(original)!==a.sha256)throw Error('SOURCE_DIGEST_MISMATCH');if(download)return {filename:a.filename,mime:MIME[a.kind],base64:original.toString('base64')};const text=a.extracted?readFileSync(safeFile(this.store.dir(input.id),a.extracted.path,2_100_000),'utf8'):'';if(a.extracted&&hash(text)!==a.extracted.sha256)throw Error('SOURCE_DIGEST_MISMATCH');return {asset:a,text};}
}
