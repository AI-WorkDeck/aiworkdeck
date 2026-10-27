import {readFileSync,readdirSync,lstatSync,realpathSync,mkdirSync} from 'node:fs';
import {join,resolve,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {publish,readJson} from './store.js';
import {validateAnswerReviews} from './answers.js';
import {materialDigest,validateProfessionalRecords} from './records.js';

export const hash=b=>createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const keys=['assessment','sourceIndex','intake','report','audit'];
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
export function safeFile(root,name,max=8_000_000){
 if(typeof name!=='string'||!name||name.includes('\0'))throw Error('UNSAFE_RESULT_PATH');
 const path=resolve(root,name),rel=relative(root,path);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('UNSAFE_RESULT_PATH');
 let part=root;
 for(const segment of rel.split(sep)){part=join(part,segment);if(lstatSync(part).isSymbolicLink())throw Error('UNSAFE_RESULT_PATH');}
 const st=lstatSync(path);if(!st.isFile()||st.size>max||realpathSync(path)!==path)throw Error('UNSAFE_RESULT_FILE');return path;
}
function directory(root,name){let p=root;for(const segment of name.split('/')){if(!safeId(segment))throw Error('UNSAFE_RESULT_PATH');p=join(p,segment);try{mkdirSync(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}if(lstatSync(p).isSymbolicLink()||!lstatSync(p).isDirectory()||realpathSync(p)!==p)throw Error('UNSAFE_RESULT_PATH');}return p;}
export class Results {
 constructor(store){this.store=store;}
 root(id){return this.store.dir(id);}
 records(id,prefix='result'){return readdirSync(this.root(id)).filter(n=>new RegExp(`^${prefix}-[0-9]{6}\\.json$`).test(n)).sort();}
 latest(id){const names=this.records(id);return names.length?readJson(safeFile(this.root(id),names.at(-1))):null;}
 readBundle(id,record){
  const root=this.root(id),out={};
  for(const [k,f] of Object.entries(record.files)){
   if(!keys.includes(k))throw Error('INVALID_RESULT_MANIFEST');
   const content=readFileSync(safeFile(root,f.path));if(hash(content)!==f.sha256)throw Error('RESULT_DIGEST_MISMATCH');
   out[k]=k==='report'?content.toString('utf8'):JSON.parse(content.toString('utf8'));
  }
  return out;
 }
 view(id){const record=this.latest(id);if(!record)return null;const data=this.readBundle(id,record);
  record.materialDigest??=materialDigest(readJson(safeFile(this.root(id),`state-${String(record.inputVersion).padStart(6,'0')}.json`)));
  return {record,...data,report:data.report||record.delivery?.readable_report||null,screening:data.intake.screening_conclusion||null,conditionalBasis:data.audit?.conditional_basis||'',dimensions:data.audit?.dimension_reviews||data.assessment.rule_assessments.filter(x=>x.review),warnings:record.warnings};
 }
 verify(id,files,{parentRevisionId,ancestors=[]}={}){
  const root=this.root(id),paths={},data={},raw={};
  for(const k of keys){if(!files[k]){if(['assessment','sourceIndex','intake'].includes(k))throw Error('INCOMPLETE_RESULT');continue;}
   paths[k]=safeFile(root,files[k].path||files[k]);raw[k]=readFileSync(paths[k]);
   if(files[k].sha256&&files[k].sha256!==hash(raw[k]))throw Error('RESULT_DIGEST_MISMATCH');
   data[k]=k==='report'?raw[k].toString('utf8'):JSON.parse(raw[k].toString('utf8'));
  }
  if(!!paths.report!==!!paths.audit)throw Error('INCOMPLETE_REPORT');
  const a=data.assessment,initial=this.store.assessment(id);
  if(a.meta?.assessment_id!==initial.meta.assessment_id||!a.meta?.revision_id)throw Error('WRONG_ASSESSMENT');
  const parent=parentRevisionId??this.latest(id)?.revisionId??initial.meta.revision_id;
  // For legacy adoption, an explicit full ancestor chain bridges the initial revision.
  let previous=parent;for(const name of ancestors){const ancestor=readJson(safeFile(root,name));if(ancestor.meta?.assessment_id!==a.meta.assessment_id||ancestor.meta.parent_revision_id!==previous)throw Error('INVALID_PARENT_CHAIN');previous=ancestor.meta.revision_id;}
  if(a.meta.parent_revision_id!==previous||a.meta.revision_id===previous)throw Error('RESULT_PARENT_CONFLICT');
  const state=this.store.state(id),trusted=new Map((state.events||[]).filter(e=>e.kind==='fact_confirmation'||e.kind==='professional_record').map(e=>[e.sourceId,e]));
  validateProfessionalRecords(a,state.events||[]);
  for(const source of a.sources){
   if(source.kind==='human_confirmation'){
    const event=trusted.get(source.id);if(!event)throw Error('UNRECORDED_CONFIRMATION');
    const evidence=state.evidence.find(x=>x.id===event.sourceId);if(!evidence||source.sha256!==evidence.sha256||source.uri!==evidence.path)throw Error('UNRECORDED_CONFIRMATION');
   }
  }
  for(const f of a.facts.filter(f=>f.status==='confirmed'))if(!f.source_ids.some(s=>trusted.get(s)?.factIds?.includes(f.id)&&trusted.get(s)?.factValueDigest===hash(JSON.stringify(f.value))))throw Error('UNRECORDED_CONFIRMATION');
  for(const source of data.sourceIndex.sources){
   const path=safeFile(root,source.path,25_000_000);if(hash(readFileSync(path))!==source.sha256)throw Error('SOURCE_DIGEST_MISMATCH');
   const original=a.sources.find(s=>s.id===source.id);if(!original||original.uri!==source.path||original.sha256!==source.sha256)throw Error('SOURCE_LINK_MISMATCH');
  }
  // Validate every business URI before the original Skill is allowed to read it.
  const kinds=new Set(['prd','ui','architecture','configuration','test','log','policy','contract','human_confirmation']);
  for(const source of a.sources.filter(s=>kinds.has(s.kind)))safeFile(root,source.uri,25_000_000);
  const checked=spawnSync(this.store.python,[fileURLToPath(new URL('./result-check.py',import.meta.url))],{input:json(paths),encoding:'utf8',timeout:20000,maxBuffer:512*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(checked.error)throw Error('RESULT_VALIDATOR_UNAVAILABLE');let validation;
  try{validation=JSON.parse(checked.stdout);}catch{throw Error('RESULT_VALIDATOR_FAILED');}
  if(checked.status!==0||validation.errors?.length){const e=Error('RESULT_VALIDATION_FAILED');e.details=validation.errors;throw e;}
  return {data,raw,validation};
 }
 adopt(id,manifest,{ancestors=[],legacy=false}={}){
  const current=this.latest(id);let job;
  if(current?.manifestDigest===hash(json(manifest)))return this.view(id);
  if(manifest.schema!=='dpia-result/v1'||manifest.caseId!==id||manifest.assessmentId!==this.store.assessment(id).meta.assessment_id)throw Error('INVALID_RESULT_MANIFEST');
  if(!legacy){
   if(!safeId(manifest.requestId))throw Error('INVALID_RESULT_MANIFEST');
   job=readJson(safeFile(this.root(id),`runs/${manifest.requestId}/job.json`));
   if(job.contextPath&&hash(readFileSync(safeFile(this.root(id),job.contextPath)))!==job.inputDigest)throw Error('INPUT_DIGEST_MISMATCH');
   for(const k of ['requestId','caseId','assessmentId','inputVersion','inputDigest','parentRevisionId','skillVersion','policyVersion'])if(manifest[k]!==job[k])throw Error('RESULT_JOB_MISMATCH');
   const executions=readdirSync(this.root(id)).filter(n=>/^execution-\d{6}\.json$/.test(n)).sort();
   const execution=executions.length?readJson(safeFile(this.root(id),executions.at(-1))):null;
   if(!execution?.jobSha256||execution.jobSha256!==hash(readFileSync(safeFile(this.root(id),`runs/${manifest.requestId}/job.json`))))throw Error('RESULT_JOB_MISMATCH');
   if(execution?.requestId!==manifest.requestId||['cancelled','cancel_requested'].includes(execution?.phase))throw Error('LATE_OR_CANCELLED_RESULT');
   for(const f of Object.values(manifest.files))if(!f.path.startsWith(`runs/${manifest.requestId}/`))throw Error('UNSAFE_RESULT_PATH');
  }
  if(manifest.parentRevisionId!==(current?.revisionId??this.store.assessment(id).meta.revision_id))throw Error('RESULT_PARENT_CONFLICT');
  const {data,raw,validation}=this.verify(id,manifest.files,{parentRevisionId:manifest.parentRevisionId,ancestors});
  const answerReviews=legacy?[]:validateAnswerReviews(job,data,manifest.answerReviews);
  if(manifest.revisionId!==data.assessment.meta.revision_id)throw Error('RESULT_REVISION_MISMATCH');
  const recordNo=this.records(id).length+1;if(recordNo>999999)throw Error('CASE_LIMIT');
  const folder=`adopted/${randomUUID()}`;directory(this.root(id),folder);const files={};
  for(const [k,content] of Object.entries(raw)){const name=`${folder}/${k}.${k==='report'?'md':'json'}`;publish(join(this.root(id),name),content);files[k]={path:name,sha256:hash(content)};}
  const record={schema:'dpia-adopted/v1',sequence:recordNo,caseId:id,assessmentId:manifest.assessmentId,revisionId:manifest.revisionId,parentRevisionId:manifest.parentRevisionId,inputVersion:manifest.inputVersion,inputDigest:manifest.inputDigest,requestId:manifest.requestId,skillVersion:manifest.skillVersion,policyVersion:manifest.policyVersion,materialDigest:legacy?materialDigest(this.store.state(id)):job.materialDigest,delivery:validation.delivery,answerReviews,files,manifestDigest:hash(json(manifest)),adoptedAt:new Date().toISOString(),origin:legacy?'explicit_legacy_import':'run',warnings:validation.warnings||[]};
  try{publish(join(this.root(id),`result-${String(recordNo).padStart(6,'0')}.json`),json(record));}catch(e){if(e.code==='EEXIST')throw Error('RESULT_PARENT_CONFLICT');throw e;}
  return this.view(id);
 }
 legacyCandidates(id){
  const root=this.root(id),names=readdirSync(root).filter(n=>/^assessment(?:-r\d+)?\.json$/.test(n));
  if(names.length>100)throw Error('TOO_MANY_CANDIDATES');
  const records=names.map(name=>{try{const d=readJson(safeFile(root,name));return {file:name,revisionId:d.meta.revision_id,parentRevisionId:d.meta.parent_revision_id,assessmentId:d.meta.assessment_id,counts:{facts:d.facts.length,questions:d.questions.length,risks:d.risks.length,actions:d.actions.length}};}catch{return {file:name,error:'无法读取'};}});
  const current=this.latest(id)?.revisionId??this.store.assessment(id).meta.revision_id;
  const available=readdirSync(root).filter(n=>/^(source-index.*\.json|intake-review.*\.json|internal-review.*\.(md|audit\.json))$/.test(n));
  if(available.length>100)throw Error('TOO_MANY_CANDIDATES');
  const paths=[...names,...available].map(n=>safeFile(root,n));
  const scan=spawnSync(this.store.python,[fileURLToPath(new URL('./result-check.py',import.meta.url))],{input:json({inventory:paths}),encoding:'utf8',timeout:10000,maxBuffer:256*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(scan.error||scan.status!==0)throw Error('RESULT_VALIDATOR_UNAVAILABLE');
  const inventory=JSON.parse(scan.stdout);return {currentRevisionId:current,assessments:records,files:available,bundles:inventory.bundles.filter(b=>b.revisionId!==current),inventoryErrors:inventory.errors};
 }
 importLegacy(input){
  const root=this.root(input.id),state=this.store.state(input.id);if(state.version!==input.version)throw Error('STALE_VERSION');
  const inventory=this.legacyCandidates(input.id),candidate=inventory.assessments.find(a=>a.file===input.files?.assessment&&!a.error);if(!candidate)throw Error('INVALID_LEGACY_SELECTION');
  for(const k of keys.filter(k=>k!=='assessment'))if(input.files[k]&&!inventory.files.includes(input.files[k]))throw Error('INVALID_LEGACY_SELECTION');
  const ancestors=[];let cursor=candidate.parentRevisionId,seen=new Set();
  while(cursor!==inventory.currentRevisionId){if(seen.has(cursor))throw Error('INVALID_PARENT_CHAIN');seen.add(cursor);const prev=inventory.assessments.find(a=>a.revisionId===cursor);if(!prev)throw Error('INVALID_PARENT_CHAIN');ancestors.unshift(prev.file);cursor=prev.parentRevisionId;}
  const files={};for(const k of keys)if(input.files[k])files[k]={path:input.files[k],sha256:hash(readFileSync(safeFile(root,input.files[k])))};
  const manifest={schema:'dpia-result/v1',caseId:input.id,assessmentId:candidate.assessmentId,revisionId:candidate.revisionId,parentRevisionId:inventory.currentRevisionId,inputVersion:state.version,inputDigest:hash(json(state)),requestId:'legacy-'+candidate.revisionId,skillVersion:'0.7.8',policyVersion:'legacy-explicit-import',files};
  return this.adopt(input.id,manifest,{ancestors,legacy:true});
 }
 prepare(id,requestId,inputVersion,contextPath,policyVersion){
  if(!safeId(requestId))throw Error('INVALID_REQUEST_ID');const root=this.root(id),dir=directory(root,`runs/${requestId}`),parent=this.latest(id);
  const context=readJson(safeFile(root,contextPath));
  const job={contextPath,materialDigest:context.materialDigest,answers:(context.answerDrafts||[]).map(a=>({id:a.id,questionId:a.questionId,sourceId:a.sourceId,attachmentSourceIds:a.attachmentSourceIds||[]})),schema:'dpia-job/v1',caseId:id,assessmentId:this.store.assessment(id).meta.assessment_id,requestId,inputVersion,inputDigest:hash(readFileSync(safeFile(root,contextPath))),parentRevisionId:parent?.revisionId??this.store.assessment(id).meta.revision_id,parentAssessmentPath:parent?join(root,parent.files.assessment.path):join(root,'assessment.json'),skillVersion:'0.7.8',policyVersion,createdAt:new Date().toISOString()};
  publish(join(dir,'job.json'),json(job));return {job,dir,jobPath:join(dir,'job.json')};
 }
 sync(id,requestId){
  if(!safeId(requestId))return {state:'none'};
  try{const path=safeFile(this.root(id),`runs/${requestId}/result.json`);const manifest=readJson(path);const result=this.adopt(id,manifest);return {state:'synced',revisionId:result.record.revisionId};}
  catch(e){return {state:e.code==='ENOENT'?'waiting':'failed',code:e.message,details:e.details?.slice(0,10)};}
 }
 history(id){return this.records(id).map(n=>{const r=readJson(safeFile(this.root(id),n));return {sequence:r.sequence,revisionId:r.revisionId,parentRevisionId:r.parentRevisionId,inputVersion:r.inputVersion,adoptedAt:r.adoptedAt,origin:r.origin};});}
}
