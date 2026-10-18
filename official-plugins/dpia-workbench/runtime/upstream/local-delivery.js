import {readFileSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import {join,relative,basename,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {publish,readJson} from './store.js';
import {safeFile,hash} from './results.js';
import {reportBlocks} from './internal-format.js';
const json=v=>JSON.stringify(v,null,2)+'\n';
const unique=(xs,kind)=>{if(!Array.isArray(xs)||new Set(xs).size!==xs.length||xs.length>200)throw Error('INVALID_ARCHIVE_SELECTION');return xs;};
function directory(root,name){const path=join(root,name);try{mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}if(lstatSync(path).isSymbolicLink()||realpathSync(path)!==path)throw Error('UNSAFE_PATH');return path;}
export class LocalDelivery{
 constructor(store){this.store=store;}
 records(id){return this.store.results.records(id).map(name=>readJson(safeFile(this.store.dir(id),name)));}
 selected(id,sequence){const records=this.records(id),record=sequence===undefined?records.at(-1):records.find(r=>r.sequence===sequence);if(!record)throw Error('RESULT_NOT_FOUND');const bundle=this.store.results.readBundle(id,record);if(bundle.assessment.meta.assessment_id!==record.assessmentId||bundle.assessment.meta.revision_id!==record.revisionId)throw Error('RESULT_REVISION_MISMATCH');return {record,bundle};}
 options(id){const s=this.store.state(id);return {version:s.version,revisions:this.records(id).map(r=>({sequence:r.sequence,revisionId:r.revisionId,inputVersion:r.inputVersion,adoptedAt:r.adoptedAt})),reports:this.store.reports.list(id).filter(r=>r.phase==='ready').map(r=>({requestId:r.requestId,revisionId:r.revisionId,reportType:r.reportType,template:r.template,language:r.language})),sources:s.evidence.map(e=>({id:e.id,title:e.title,withdrawn:s.withdrawnSourceIds?.includes(e.id)||false})),assets:(s.assets||[]).map(a=>({id:a.id,filename:a.filename,bytes:a.bytes,status:a.status,purpose:a.purpose})),notice:'只导出选定材料；报告会携带对应底稿、来源索引、检查记录和版本说明。不包含执行会话、模型配置或其他案件。'};}
 python(args){const p=spawnSync(this.store.python,[fileURLToPath(new URL('./local-delivery.py',import.meta.url))],{input:json(args),encoding:'utf8',timeout:30000,maxBuffer:100000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});let out;try{out=JSON.parse(p.stdout);}catch{throw Error('LOCAL_DELIVERY_UNAVAILABLE');}if(p.error||p.status!==0){const e=Error('LOCAL_DELIVERY_FAILED');e.details=out.error;throw e;}return out;}
 internal(input){
  const {id}=input,s=this.store.state(id);if(input.version!==s.version)throw Error('STALE_VERSION');
  const {record,bundle}=this.selected(id,input.sequence),root=this.store.dir(id);
  // No new reasoning: render only the already-adopted immutable analysis.
  const key=hash(json({manifest:record.manifestDigest,renderer:'local-internal/v1'})),parent=directory(root,'internal-reports'),dir=directory(parent,key);
  try{const old=readJson(safeFile(root,join(dir,'record.json')));return this.readInternal(id,record,old);}catch(e){if(e.code!=='ENOENT')throw e;}
  const paths=Object.fromEntries(Object.entries(record.files).map(([key,f])=>[key,safeFile(root,f.path)]));
  for(const source of bundle.sourceIndex.sources){if(hash(readFileSync(safeFile(root,source.path,25_000_000)))!==source.sha256)throw Error('SOURCE_DIGEST_MISMATCH');}
  const attempt=directory(dir,randomUUID());
  this.python({mode:'internal',paths,out:attempt,conditionalBasis:bundle.audit?.conditional_basis||''});
  const files={};for(const [key,name] of [['report','internal.md'],['audit','internal.audit.json']]){const p=safeFile(root,join(attempt,name));files[key]={path:relative(root,p),sha256:hash(readFileSync(p))};}
  const next={schema:'dpia-local-internal/v1',assessmentId:record.assessmentId,revisionId:record.revisionId,inputVersion:record.inputVersion,resultManifestDigest:record.manifestDigest,createdAt:new Date().toISOString(),files};
  try{publish(join(dir,'record.json'),json(next));}catch(e){if(e.code!=='EEXIST')throw e;return this.readInternal(id,record,readJson(safeFile(root,join(dir,'record.json'))));}
  return this.readInternal(id,record,next);
 }
 readInternal(id,basis,record){
  if(record.schema!=='dpia-local-internal/v1'||record.assessmentId!==basis.assessmentId||record.revisionId!==basis.revisionId||record.resultManifestDigest!==basis.manifestDigest)throw Error('INTERNAL_REPORT_BASIS_MISMATCH');
  const data={};for(const key of ['report','audit']){const f=record.files[key],raw=readFileSync(safeFile(this.store.dir(id),f.path));if(hash(raw)!==f.sha256)throw Error('INTERNAL_REPORT_DIGEST_MISMATCH');data[key]=raw.toString('utf8');}
  const audit=JSON.parse(data.audit);if(audit.assessment_id!==basis.assessmentId||audit.revision_id!==basis.revisionId||audit.report_sha256!==record.files.report.sha256)throw Error('INTERNAL_REPORT_BASIS_MISMATCH');
  return {title:this.store.state(id).title,revisionId:basis.revisionId,inputVersion:basis.inputVersion,content:data.report,blocks:reportBlocks(data.report),sha256:record.files.report.sha256,audit:JSON.parse(data.audit),record,local:true};
 }
 report(id,sequence){const {record,bundle}=this.selected(id,sequence),key=hash(json({manifest:record.manifestDigest,renderer:'local-internal/v1'}));try{return this.readInternal(id,record,readJson(safeFile(this.store.dir(id),`internal-reports/${key}/record.json`)));}catch(e){if(e.code!=='ENOENT')throw e;}const content=bundle.report||record.delivery?.readable_report;if(!content)throw Error('REPORT_NOT_AVAILABLE');return {title:this.store.state(id).title,revisionId:record.revisionId,inputVersion:record.inputVersion,content,blocks:reportBlocks(content),sha256:hash(content),audit:bundle.audit||null,local:false};}
 word(input){
  const {id}=input,state=this.store.state(id);if(input.version!==state.version)throw Error('STALE_VERSION');
  const report=this.report(id,input.sequence);if(input.revisionId&&input.revisionId!==report.revisionId)throw Error('INTERNAL_REPORT_BASIS_MISMATCH');
  const root=this.store.dir(id),key=hash(json({revision:report.revisionId,content:report.sha256,title:report.title,format:'internal-word/v1'}));
  const dir=directory(directory(root,'internal-word'),key),receiptPath=join(dir,'receipt.json');let receipt;
  try{receipt=readJson(safeFile(root,receiptPath));}catch(e){if(e.code!=='ENOENT')throw e;
   const attempt=directory(dir,randomUUID()),out=join(attempt,'internal.docx');
   const r=spawnSync(this.store.assets.python(),[fileURLToPath(new URL('./internal-word.py',import.meta.url))],{input:json({...report,out}),encoding:'utf8',timeout:30000,maxBuffer:100000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
   if(r.error||r.status!==0)throw Error('INTERNAL_WORD_UNAVAILABLE');
   const raw=readFileSync(safeFile(root,out,25_000_000));receipt={revisionId:report.revisionId,sourceSha256:report.sha256,path:relative(root,out),sha256:hash(raw)};
   try{publish(receiptPath,json(receipt));}catch(e){if(e.code!=='EEXIST')throw e;receipt=readJson(safeFile(root,receiptPath));}
  }
  if(receipt.revisionId!==report.revisionId||receipt.sourceSha256!==report.sha256)throw Error('INTERNAL_REPORT_BASIS_MISMATCH');
  const raw=readFileSync(safeFile(root,receipt.path,25_000_000));if(hash(raw)!==receipt.sha256)throw Error('INTERNAL_REPORT_DIGEST_MISMATCH');
  return {base64:raw.toString('base64'),filename:report.title+'-内部评估.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sha256:receipt.sha256,revisionId:report.revisionId};
 }
 archive(input){
  const {id}=input,s=this.store.state(id),root=this.store.dir(id);if(input.version!==s.version)throw Error('STALE_VERSION');
  const sequences=unique(input.sequences||[]),reportIds=unique(input.reportIds||[]),sourceIds=unique(input.sourceIds||[]),assetIds=unique(input.assetIds||[]);
  if(!sequences.length&&!reportIds.length&&!sourceIds.length&&!assetIds.length)throw Error('ARCHIVE_SELECTION_EMPTY');
  if(sequences.some(n=>!Number.isInteger(n)||n<1))throw Error('INVALID_ARCHIVE_SELECTION');
  const entries=[],names=new Set(),bases=new Map(),selectedReports=[],selectedSources=[];let size=0;
  const add=(name,path,sha256,max=50_000_000)=>{if(names.has(name))return;if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.split('/').some(p=>p==='..'||!p))throw Error('INVALID_ARCHIVE_PATH');const p=safeFile(root,path,max),raw=readFileSync(p);if(hash(raw)!==sha256)throw Error('ARCHIVE_SOURCE_CHANGED');size+=raw.length;if(size>150_000_000)throw Error('ARCHIVE_TOO_LARGE');entries.push({name,path:p,sha256,bytes:raw.length});names.add(name);};
  const basis=record=>{if(bases.has(record.sequence))return;const data=this.store.results.readBundle(id,record),prefix=`analysis/r${record.sequence}/`;for(const [key,f] of Object.entries(record.files))add(prefix+({sourceIndex:'source-index.json',report:'internal.md',audit:'internal.audit.json'}[key]||key+'.json'),f.path,f.sha256);const derived=this.report(id,record.sequence);if(derived.local){for(const [key,f] of Object.entries(derived.record.files))add(prefix+'local-'+(key==='report'?'internal.md':'internal.audit.json'),f.path,f.sha256);}
   bases.set(record.sequence,{sequence:record.sequence,assessmentId:record.assessmentId,revisionId:record.revisionId,parentRevisionId:record.parentRevisionId,inputVersion:record.inputVersion,manifestDigest:record.manifestDigest,adoptedAt:record.adoptedAt,sourceIndex:data.sourceIndex.sources.map(x=>({id:x.id,title:x.title,sha256:x.sha256}))});};
  for(const seq of sequences)basis(this.selected(id,seq).record);
  for(const requestId of reportIds){const job=this.store.reports.job(id,requestId),state=this.store.reports.status(id,requestId);if(state.phase!=='ready')throw Error('REPORT_NOT_READY');const base=this.records(id).find(r=>r.manifestDigest===job.resultManifestDigest&&r.revisionId===job.revisionId);if(!base)throw Error('REPORT_BASIS_MISMATCH');basis(base);
   for(const format of ['docx','pdf']){this.store.reports.artifact({id,requestId,format});const f=state.files[format==='docx'?'document':'pdf'];add(`reports/${requestId}/report.${format}`,f.path,f.sha256);}
   for(const key of ['bindings','review']){const f=state.files[key];if(!f)throw Error('INCOMPLETE_REPORT');add(`reports/${requestId}/${key}.json`,f.path,f.sha256);}
   if(job.templatePath)add(`reports/${requestId}/template-original.${job.template.format}`,job.templatePath,job.templateSha256);
   selectedReports.push({requestId,revisionId:job.revisionId,reportType:job.reportType,language:job.language,template:job.template,confirmation:job.confirmation,quality:state.quality});
  }
  for(const sourceId of sourceIds){const source=s.evidence.find(e=>e.id===sourceId);if(!source)throw Error('SOURCE_NOT_FOUND');add(`sources/${sourceId}.txt`,source.path,source.sha256,25_000_000);selectedSources.push({id:source.id,title:source.title,path:`sources/${sourceId}.txt`,sha256:source.sha256,withdrawn:s.withdrawnSourceIds?.includes(sourceId)||false});}
  const selectedAssets=[];for(const assetId of assetIds){const asset=s.assets?.find(a=>a.id===assetId);if(!asset)throw Error('ASSET_NOT_FOUND');const name=`originals/${asset.id}${extname(asset.path)}`;add(name,asset.path,asset.sha256,20_000_000);selectedAssets.push({id:asset.id,filename:asset.filename,path:name,sha256:asset.sha256,extractionStatus:asset.status});}
  const exportId=randomUUID(),dir=directory(directory(root,'exports'),exportId),manifest={schema:'dpia-archive/v1',caseId:id,title:s.title,materialVersion:s.version,createdAt:new Date().toISOString(),selection:{sequences,reportIds,sourceIds,assetIds},analyses:[...bases.values()],reports:selectedReports,sources:selectedSources,originals:selectedAssets,files:entries.map(({path,...rest})=>rest),note:'只包含明确选定材料。底稿/索引原始路径属于来源定位，并不表示相关原件已收入本包；以 sources/originals 及其摘要为准。不是监管提交或审批。'};
  const destination=join(dir,'archive.zip');this.python({mode:'archive',entries,manifest,destination});
  const raw=readFileSync(safeFile(root,destination,160_000_000));publish(join(dir,'receipt.json'),json({exportId,sha256:hash(raw),bytes:raw.length,manifest}));return {base64:raw.toString('base64'),filename:s.title+'-归档-'+exportId.slice(0,8)+'.zip',mime:'application/zip',sha256:hash(raw),files:entries.length+2};
 }
}
