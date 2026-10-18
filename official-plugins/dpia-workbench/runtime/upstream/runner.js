import { randomUUID } from 'node:crypto';
import { readdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publish, readJson } from './store.js';
import {telemetry,usageWarnings} from './telemetry.js';
import {hash,safeFile} from './results.js';

// Every durable transition is append-only. Persist identity and prompt before any
// Host call; retries reuse both Session identity and DSH's idempotency requestId.
export class Runner {
 constructor(store, sessions, workspaces) { this.store=store;this.sessions=sessions;this.workspaces=workspaces;this.locks=new Set();this.promptObservations=new Map(); }
 read(id) {
  const dir=this.store.dir(id),names=readdirSync(dir).filter(n=>/^execution-\d{6}\.json$/.test(n)).sort();
  if(!names.length)return {revision:0,phase:'not_started'};
  const s=readJson(join(dir,names.at(-1)));
  if(s.id!==id||!Number.isInteger(s.revision)||`execution-${String(s.revision).padStart(6,'0')}.json`!==names.at(-1)||!/^session-[0-9a-f-]{36}$/.test(s.sessionId))throw Error('CORRUPT_EXECUTION');
  return s;
 }
 save(id,state) {
  const next={...state,id,revision:state.revision+1,updatedAt:new Date().toISOString()};
  if(next.revision>999999)throw Error('CASE_LIMIT');
  try{publish(join(this.store.dir(id),`execution-${String(next.revision).padStart(6,'0')}.json`),JSON.stringify(next,null,2)+'\n');}catch(e){if(e.code==='EEXIST')throw Error('STALE_EXECUTION');throw e;}
  return next;
 }
 async status(id) {
  let s=this.read(id);let running=false,available=false,statusKnown=true,values=null,sessionAsOfSeq=null;
  if(s.sessionId)try{const {items}=await this.sessions.list({},new AbortController().signal);const row=items.find(x=>x.sessionId===s.sessionId);available=!!row;running=row?.running===true;values=row?.projections?.values||null;sessionAsOfSeq=row?.projections?.asOfSeq??null;}catch{statusKnown=false;}
  const latest=this.read(id);if(latest.revision!==s.revision)return {revision:latest.revision,phase:latest.phase,sessionId:latest.sessionId,requestId:latest.requestId,statusKnown:false,running:false,available:false,sync:null,report:null};
  if(s.phase==='cancel_requested'&&statusKnown&&!running&&!this.locks.has(id))s=this.save(id,{...s,phase:'cancelled',stoppedAt:new Date().toISOString()});
  const sync=s.kind==='report'?null:this.store.results&&s.requestId&&statusKnown&&!running&&s.phase==='accepted'?this.store.results.sync(id,s.requestId):null;
  const report=s.kind==='report'&&this.store.reports?this.store.reports.status(id,s.requestId):null;
  if(!s.stoppedAt&&statusKnown&&!running&&!this.locks.has(id)&&(sync?.state==='synced'||['ready','failed','render_failed'].includes(report?.phase)))s=this.save(id,{...s,stoppedAt:new Date().toISOString()});
  // Admission returns before the queued user/message is committed. Compare the
  // actual dispatch event, not acceptedAt, to avoid treating our own prompt as new input.
  const lastPromptAt=values?.sessionListMetadata?.lastPromptAt;
  const dispatch=s.dispatchRequestId||s.requestId;
  let ownPromptAt=this.promptObservations.get(dispatch),unarchivedInput=null;
  if(!ownPromptAt&&dispatch&&Number.isInteger(s.promptAfterSeq)&&Number.isInteger(sessionAsOfSeq)&&sessionAsOfSeq>s.promptAfterSeq&&typeof this.sessions.page==='function'){
   try{
    const page=await this.sessions.page({address:{kind:'session',sessionId:s.sessionId},throughSeq:Math.min(sessionAsOfSeq,s.promptAfterSeq+32),maxMessages:32},new AbortController().signal);
    const event=page.records?.map(r=>r.event).find(e=>e?.type==='user/message'&&e.data?.source?.kind==='user'&&e.data.source.rpcId===dispatch);
    if(Number.isFinite(event?.time)){ownPromptAt=event.time;this.promptObservations.set(dispatch,ownPromptAt);}
   }catch{}
  }
  if(Number.isFinite(ownPromptAt)&&Number.isFinite(lastPromptAt))unarchivedInput=lastPromptAt>ownPromptAt;
  else if(s.stoppedAt&&Number.isFinite(lastPromptAt))unarchivedInput=lastPromptAt>Date.parse(s.stoppedAt)?true:null;
  const observed=telemetry(values,s.usageBaseline);
  const elapsedSeconds=s.startedAt?Math.max(0,Math.round(((s.stoppedAt?Date.parse(s.stoppedAt):Date.now())-Date.parse(s.startedAt))/1000)):null;
  return {...observed,reminders:usageWarnings(this.store.state(id).reminders,{...observed,elapsedSeconds}),stoppedAt:s.stoppedAt,unarchivedInput,sessionAsOfSeq,revision:s.revision,phase:s.phase,sessionId:s.sessionId,requestId:s.requestId,materialVersion:s.materialVersion,updatedAt:s.updatedAt,startedAt:s.startedAt,elapsedSeconds:s.startedAt?Math.max(0,Math.round(((s.stoppedAt?Date.parse(s.stoppedAt):Date.now())-Date.parse(s.startedAt))/1000)):null,running,available,statusKnown,sync,kind:s.kind,report,recoverable:!!s.sessionId&&statusKnown&&!available,unfinished:statusKnown&&!running&&s.phase==='accepted'&&(s.kind==='report'?report?.phase!=='ready':sync?.state!=='synced')};
 }
 async run(input) {
  if(input?.action==='execution')return this.status(input.id);
  if(input?.action==='cancel'){
   const {id}=input;if(this.locks.has(id))throw Error('EXECUTION_BUSY');this.locks.add(id);
   try{
    const s=this.read(id);if(input.executionRevision!==s.revision)throw Error('STALE_EXECUTION');
    if(!s.sessionId||typeof this.sessions.cancel!=='function')throw Error('CANCEL_NOT_AVAILABLE');
    if(s.phase==='cancelled')return {...await this.status(id),cancelAcknowledged:true};
    if(s.phase!=='cancel_requested')this.save(id,{...s,phase:'cancel_requested'});
    let acknowledged=false;try{const response=await this.sessions.cancel({sessionId:s.sessionId});acknowledged=response.accepted===true;}catch{}
    // An acknowledgement confirms the request, not that the agent has stopped.
    return {...await this.status(id),cancelAcknowledged:acknowledged};
   }finally{this.locks.delete(id);}
  }
  if(input?.action==='sync'){const s=this.read(input.id);const status=await this.status(input.id);if(status.running||!status.statusKnown)throw Error('EXECUTION_BUSY');return s.kind==='report'?{state:'report',report:this.store.reports.status(input.id,s.requestId)}:this.store.results.sync(input.id,s.requestId);}
  if(!['start','prepare','startReport','retryReport','recoverSession','repairOutput'].includes(input?.action))return this.store.run(input);
  const {id}=input;this.store.dir(id);
  if(this.locks.has(id))throw Error('EXECUTION_BUSY');this.locks.add(id);
  try {
   let s=this.read(id);const c=this.store.view(id);
   if(input.version!==c.version)throw Error('STALE_VERSION');
   if(input.executionRevision!==s.revision)throw Error('STALE_EXECUTION');
   const status=await this.status(id);
   if(!status.statusKnown)throw Error('HOST_STATUS_UNAVAILABLE');
   if(status.running)throw Error('EXECUTION_BUSY');
   if(input.action==='recoverSession'){
    if(!s.sessionId||status.available)throw Error('SESSION_RECOVERY_NOT_NEEDED');
    s=this.save(id,{...s,sessionId:'session-'+randomUUID(),replacedSessionId:s.sessionId,previousRequestId:s.requestId,phase:'preparing',requestId:undefined,prompt:undefined,kind:undefined,startedAt:undefined,stoppedAt:undefined});
   }
   if(s.phase==='cancel_requested')throw Error('CANCEL_PENDING');
   if(s.sessionId&&!status.available&&!['preparing','ready'].includes(s.phase))throw Error('SESSION_UNAVAILABLE');
   if(s.phase==='accepted'&&Date.now()-Date.parse(s.updatedAt)<3000)throw Error('EXECUTION_BUSY');
   if(!s.sessionId)s=this.save(id,{...s,sessionId:'session-'+randomUUID(),phase:'preparing'});
   // DSH adopts these exact identities after interruption; never creates a second chat.
   const {workspace}=await this.workspaces.create({path:c.directory});
   if(typeof workspace.workspaceId!=='string'||!workspace.workspaceId)throw Error('INVALID_HOST_WORKSPACE');
   await this.sessions.create({sessionId:s.sessionId,workspaceId:workspace.workspaceId});
   if(s.phase==='preparing'){
    await this.sessions.rename({sessionId:s.sessionId,title:'DPIA · '+c.title});
    s=this.save(id,{...s,phase:'ready'});
   }
   if(['prepare','recoverSession'].includes(input.action))return this.status(id);
   if(input.action==='repairOutput'&&!['submitting','uncertain'].includes(s.phase)){
    if(s.phase!=='accepted'||s.kind!=='assessment'||!s.requestId)throw Error('OUTPUT_REPAIR_NOT_AVAILABLE');
    if(this.store.results.latest(id)?.requestId===s.requestId)throw Error('RESULT_ALREADY_SYNCED');
    const path=safeFile(c.directory,`runs/${s.requestId}/job.json`);if(hash(readFileSync(path))!==s.jobSha256)throw Error('RESULT_JOB_MISMATCH');
    const job=readJson(path);if(job.parentRevisionId!==(this.store.results.latest(id)?.revisionId??this.store.assessment(id).meta.revision_id))throw Error('RESULT_PARENT_CONFLICT');
    const before=await this.status(id),dispatchRequestId='dpia-'+randomUUID();
    const prompt='/assess-product-dpia\n仅修复已冻结任务的未完成交付。任务：'+path+'。沿用该任务的 contextPath、输入摘要、父版和原输出目录；当前工作台后续材料不属于该轮。读取本轮已有产物与校验错误，仅补齐/纠正缺失的结构、来源、报告或 answerReviews，按原 job 再运行 commit-result.mjs。不得改 job、历史采用版本或原 Skill，不重新采集整案或假造缺失事实。若需要新事实才能形成结论，保留明确缺口并交付可支持部分。修复结束后提交 result.json，不能只输出接续指令。原任务指令如下，仍限于其冻结范围：\n'+(s.repairBasePrompt||s.prompt);
    s=this.save(id,{...s,phase:'submitting',dispatchRequestId,prompt,repairBasePrompt:s.repairBasePrompt||s.prompt,repairOf:s.requestId,startedAt:new Date().toISOString(),stoppedAt:undefined,promptAfterSeq:before.sessionAsOfSeq,usageBaseline:before.usageTotals});
   }
   if(s.phase!=='submitting'&&s.phase!=='uncertain'){
    const before=await this.status(id);
    const requestId='dpia-'+randomUUID();
    const kind=['startReport','retryReport'].includes(input.action)?'report':'assessment';
    const {prompt,promptPolicyVersion,job}=kind==='report'?(input.action==='retryReport'?this.store.reports.retry(input,requestId):this.store.reports.prepare(input,requestId)):this.store.handoff(id,{direct:true,requestId,intent:input.intent,answerIds:input.answerIds});
    const body='/assess-product-dpia\n'+prompt;
    s=this.save(id,{...s,phase:'submitting',kind,requestId,dispatchRequestId:requestId,repairOf:undefined,repairBasePrompt:undefined,jobSha256:job?hash(JSON.stringify(job,null,2)+'\n'):null,startedAt:new Date().toISOString(),stoppedAt:undefined,promptAfterSeq:before.sessionAsOfSeq,usageBaseline:before.usageTotals,materialVersion:c.version,promptPolicyVersion,prompt:body});
   }
   // A failed acknowledgement is not proof of rejection. Reuse this frozen prompt
   // even if materials changed meanwhile; UI tells the user what revision it sent.
   try {
    const response=await this.sessions.prompt({sessionId:s.sessionId,requestId:s.dispatchRequestId||s.requestId,content:[{type:'text',text:s.prompt}],clientTimeZone:'Asia/Shanghai'},new AbortController().signal);
    if(response.accepted!==true)throw Error('PROMPT_NOT_ACCEPTED');
   }catch{
    this.save(id,{...s,phase:'uncertain'});return this.status(id);
   }
   this.save(id,{...s,phase:'accepted',acceptedAt:new Date().toISOString()});return this.status(id);
  } finally {this.locks.delete(id);}
 }
}
