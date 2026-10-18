import {join} from 'node:path';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Store,publish,readJson,skillDir,PROMPT_POLICY_VERSION} from './store.js';
import {Results,hash,safeFile} from './results.js';
import {Assets} from './assets.js';
import {Reports} from './reports.js';
import {LocalDelivery} from './local-delivery.js';
import {answerStates} from './answers.js';
import {materialDigest,screeningScopeDigest} from './records.js';

const presentation={rules:Object.fromEntries(['eu','sa'].flatMap(j=>readJson(join(skillDir,'jurisdictions',j,'rules.json')).rules).map(r=>[r.id,r.title])),sources:readJson(join(skillDir,'references/sources.json')).sources.map(({id,title,url})=>({id,title,url}))};
const shellQuote=s=>"'"+s.replaceAll("'","'\\''")+"'";
function text(x,max=2000){if(typeof x!=='string'||!x.trim()||x.length>max||x.includes('\0'))throw Error('INVALID_TEXT');return x.trim();}
export class WorkbenchStore extends Store {
 constructor(...args){super(...args);this.results=new Results(this);this.assets=new Assets(this);this.reports=new Reports(this);this.delivery=new LocalDelivery(this);}
 view(id){const c=super.view(id);c.materialDigest=materialDigest(c);c.presentation=presentation;let result;try{result=this.results.view(id);}catch(e){return {...c,result:null,resultError:e.message};}try{return {...c,result,answerStates:answerStates(this,id,result),resultError:null,answerStateError:null};}catch(e){return {...c,result,answerStates:[],resultError:null,answerStateError:e.message};}}
 mutate(input,fn){const s=this.state(input.id);if(s.version!==input.version)throw Error('STALE_VERSION');if(s.version>=999999)throw Error('CASE_LIMIT');fn(s);s.version++;s.updatedAt=new Date().toISOString();const data=JSON.stringify(s,null,2)+'\n';if(Buffer.byteLength(data)>1_000_000)throw Error('CASE_LIMIT');try{publish(join(this.dir(s.id),`state-${String(s.version).padStart(6,'0')}.json`),data);}catch(e){if(e.code==='EEXIST')throw Error('STALE_VERSION');throw e;}return this.view(s.id);}
 event(s,kind,data){s.events??=[];const event={id:'EVT-'+randomUUID(),kind,at:new Date().toISOString(),...data};s.events.push(event);return event;}
 resultObject(id,collection,key){const v=this.results.view(id);const object=v?.assessment[collection]?.find(x=>x.id===key);if(!object)throw Error('RESULT_OBJECT_NOT_FOUND');return {v,object};}
 handoff(id,options={}){
  const base=super.handoff(id,options),c=this.view(id),selected=options.answerIds||[];
  if(c.resultError)throw Error(c.resultError);
  if(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(id=>!c.answerDrafts?.some(d=>d.id===id)))throw Error('INVALID_ANSWER_SELECTION');
  if(c.result)base.prompt=base.prompt.replace(`评估底稿：${base.assessmentPath}`,`本轮有效评估底稿：${join(c.directory,c.result.record.files.assessment.path)}`);
  const context=JSON.parse(readFileSync(base.contextPath,'utf8'));
  context.answerDrafts=(c.answerDrafts||[]).filter(x=>selected.includes(x.id));
  context.events=(c.events||[]).filter(e=>e.kind!=='answer_draft');context.actionProgress=c.actionProgress||[];context.materialDigest=c.materialDigest;
  context.withdrawnSourceIds=c.withdrawnSourceIds||[];const attachments=new Set(context.answerDrafts.flatMap(a=>a.attachmentSourceIds||[]));
  const staged=new Set(c.evidence.filter(e=>e.attachmentToQuestion).map(e=>e.id));const templates=new Set(c.evidence.filter(e=>e.purpose==='template').map(e=>e.id));
  context.evidence=context.evidence.filter(e=>!context.withdrawnSourceIds.includes(e.id)&&!templates.has(e.id)&&(!staged.has(e.id)||attachments.has(e.id)));
  for(const sourceId of attachments){const e=c.evidence.find(e=>e.id===sourceId);if(!e||context.withdrawnSourceIds.includes(sourceId))throw Error('ANSWER_ATTACHMENT_UNAVAILABLE');if(hash(readFileSync(safeFile(c.directory,e.path,25_000_000)))!==e.sha256)throw Error('SOURCE_DIGEST_MISMATCH');}
  for(const answer of context.answerDrafts){
   const sourceId='SRC-'+answer.id,path=join(c.directory,'evidence',sourceId+'.txt');
   const body=`答复者：${answer.answerer}\n日期：${answer.date}\n问题：${answer.questionId}\n答复性质：${answer.mode}\n${answer.text}`;
   try{publish(path,body);}catch(e){if(e.code!=='EEXIST'||readFileSync(safeFile(c.directory,path),'utf8')!==body)throw e;}
   context.evidence.push({id:sourceId,title:'补答 '+answer.questionId,locator:answer.answerer+' · '+answer.date,path,sha256:hash(body),status:'reported',text:body});answer.sourceId=sourceId;
  }
  context.notices=['只处理明确选中的补答；未选草稿不是本轮评估输入。','用户确认仅作用于记录指明的事实及来源版本；不替代法律判断。'];
  const content=JSON.stringify(context,null,2)+'\n',contextPath=join(c.directory,`workbench-input-v${c.version}-${hash(content).slice(0,12)}.json`);
  try{publish(contextPath,content);}catch(e){if(e.code!=='EEXIST')throw e;}
  base.prompt=base.prompt.replace(base.contextPath,contextPath);base.contextPath=contextPath;
  base.prompt+='\n筛查出口：如有依据无需 DPIA，完成原 Skill 的限定事实范围筛查，intake-review.screening_conclusion 写入 result、rule_ids、reason 与 reassessment_conditions，不为此强行创建风险。尚待确认时不能声称已无需 DPIA。真实用户意见与筛查范围确认来自 professional_record 事件，严格按 category、subjectIds 和 scopeDigest 引用，不把一般意见当业务审批。';
  base.prompt+='\n补答附件仅处理本轮所选答复引用的来源。每项选定答复必须在 answer-review.json 数组中记录 {answerId,questionId,sourceId,status:absorbed|partial|conflict|still_missing,checkIds:[来源审查check ID],reason,remaining}。被引用的 check 必须实际检索该答复来源；absorbed 要有已答问题和答案来源，部分/冲突/仍缺信息必须保留问题 open 及具体剩余缺口。提交时加 --answerReviews answer-review.json；没有选定补答时不要求此文件。';
  base.prompt+='\n本轮动作：'+(options.intent||'分析当前有效材料')+'。仅复评新增/纠正输入所影响的判断，逐项记录原结论、变化、依据与剩余缺口。';
  if(options.requestId){const run=this.results.prepare(id,options.requestId,c.version,contextPath,PROMPT_POLICY_VERSION);
   base.prompt+=`\n结果回填协议：本轮输出只写入 ${run.dir}，不得覆盖旧文件。以 ${run.job.parentAssessmentPath} 为父版创建后续修订。完成 assessment、source-index、intake-review 及相应内部报告/audit 后，执行插件提供的本地提交器（只验证/整理文件，不调用模型）：\nnode ${shellQuote(fileURLToPath(new URL('./commit-result.mjs',import.meta.url)))} --job ${shellQuote(run.jobPath)} --assessment <本轮底稿文件名> --sourceIndex <索引文件名> --intake <来源审查文件名> [--report <内部报告文件名> --audit <审计索引文件名>]\n参数仅填写本轮输出目录内的文件名。提交器失败时按具体错误修复本轮产物，不修改原 Skill 或历史文件；不能自行声称同步成功。未答保持未答，禁止伪造确认来源。本轮已选补答来源与事件在输入快照内。`;
   base.job=run.job;
  }
  return base;
 }
 run(input){
  const {action,id}=input||{};
  if(action==='archiveOptions')return this.delivery.options(id);
  if(action==='downloadArchive')return this.delivery.archive(input);
  if(action==='downloadInternalWord')return this.delivery.word(input);
  if(action==='generateInternalReport')return this.delivery.internal(input);
  if(action==='reportOptions')return {templates:this.reports.templates(id),eligibility:this.reports.eligibility(id),reports:this.reports.list(id)};
  if(action==='reportPreview')return this.reports.preview(input);
  if(action==='reportList')return this.reports.list(id);
  if(action==='downloadReport')return this.reports.download(input);
  if(action==='reportPage')return this.reports.previewPage(input);
  if(action==='reviewReportPage')return this.reports.reviewPage(input);
  if(action==='completeReport')return this.reports.complete(id,input.requestId);
  if(action==='importAsset')return this.assets.import(input);
  if(action==='reviewAsset')return this.assets.accept(input);
  if(action==='assetPreview')return this.assets.get(input);
  if(action==='downloadAsset')return this.assets.get(input,true);
  if(action==='legacyCandidates')return this.results.legacyCandidates(id);
  if(action==='adoptLegacy'){if(input.bundleKey){const candidate=this.results.legacyCandidates(id).bundles.find(b=>b.key===input.bundleKey);if(!candidate)throw Error('INVALID_LEGACY_SELECTION');input={...input,files:candidate.files};}this.results.importLegacy(input);return this.view(id);}
  if(action==='resultHistory')return this.results.history(id);
  if(action==='resultVersion'){const records=this.results.records(id);const name=`result-${String(input.sequence).padStart(6,'0')}.json`;if(!records.includes(name))throw Error('RESULT_NOT_FOUND');const record=readJson(safeFile(this.dir(id),name));return {record,...this.results.readBundle(id,record)};}
  if(action==='source'){const v=this.results.view(id),source=v?.sourceIndex.sources.find(s=>s.id===input.sourceId)||this.state(id).evidence.find(s=>s.id===input.sourceId);if(!source)throw Error('SOURCE_NOT_FOUND');const raw=readFileSync(safeFile(this.dir(id),source.path,25_000_000));if(hash(raw)!==source.sha256)throw Error('SOURCE_DIGEST_MISMATCH');return {title:source.title,text:raw.toString('utf8'),sha256:source.sha256};}
  if(action==='report')return this.delivery.report(id,input.sequence);
  if(action==='list'){const data=super.run(input);for(const c of [...data.cases,...data.testFixtures]){const s=this.state(c.id);c.archived=s.archived===true;try{const r=this.results.view(c.id);c.resultStatus=r?'synced':'none';c.openGaps=r?r.assessment.questions.filter(q=>q.status==='open').length:null;c.riskCount=r?r.assessment.risks.length:null;}catch{c.resultStatus='failed';c.openGaps=null;}}return data;}
  if(['archive','answerDraft','confirmFact','correctFact','actionProgress','dispute','restoreInput','withdrawSource','professionalRecord','reminders'].includes(action))return this.mutate(input,s=>{
   const result=this.results.view(id);
   if(action==='reminders'){const minutes=Number(input.minutes),tokens=Number(input.tokens);if(!Number.isFinite(minutes)||minutes<0||minutes>1440||!Number.isSafeInteger(tokens)||tokens<0||tokens>100000000)throw Error('INVALID_REMINDER');s.reminders={minutes,tokens};}
   if(action==='professionalRecord'){
    if(!result)throw Error('RESULT_NOT_AVAILABLE');
    const allowed={screening_scope:result.assessment.facts.map(f=>f.id),legal_review:result.assessment.rule_assessments.map(r=>r.rule_id),dpo_opinion:result.assessment.rule_assessments.map(r=>r.rule_id),stakeholder_opinion:result.assessment.rule_assessments.map(r=>r.rule_id),risk_acceptance:result.assessment.jurisdictions.map(j=>j.code),launch_decision:result.assessment.jurisdictions.map(j=>j.code),verification:result.assessment.controls.map(c=>c.id)};
    const subjectIds=input.subjectIds,category=input.category;if(!allowed[category]||!Array.isArray(subjectIds)||!subjectIds.length||new Set(subjectIds).size!==subjectIds.length||subjectIds.some(id=>!allowed[category].includes(id)))throw Error('INVALID_RECORD_SCOPE');
    const person=text(input.person,200),role=text(input.role,200),date=text(input.date,40),statement=text(input.text,100000);
    const source=this.evidence(s,{title:'意见与确认记录：'+category,locator:person+' · '+role+' · '+date,text:`记录人/来源：${person}\n身份：${role}\n记录日期：${date}\n对象：${subjectIds.join('、')}\n依据修订：${result.record.revisionId}\n原文：${statement}`});
    this.event(s,'professional_record',{category,subjectIds,person,role,date,sourceId:source.id,resultRevisionId:result.record.revisionId,...(category==='screening_scope'?{scopeContract:'confirmation-stable/v2',scopeDigest:screeningScopeDigest(result.assessment,subjectIds)}:{})});
   }
   if(action==='withdrawSource'){if(!s.evidence.some(e=>e.id===input.sourceId))throw Error('SOURCE_NOT_FOUND');s.withdrawnSourceIds??=[];if(!s.withdrawnSourceIds.includes(input.sourceId))s.withdrawnSourceIds.push(input.sourceId);this.event(s,'source_withdrawal',{sourceId:input.sourceId,resultRevisionId:result?.record.revisionId??null});}
   if(action==='archive'){s.archived=input.archived===true;this.event(s,'archive',{archived:s.archived});}
   if(action==='answerDraft'){
    const {v,object}=this.resultObject(id,'questions',input.questionId);s.answerDrafts??=[];
    const draft={id:'ANSWER-'+randomUUID(),questionId:object.id,resultRevisionId:v.record.revisionId,text:text(input.text,100000),answerer:text(input.answerer,200),date:text(input.date,40),mode:['partial','unknown','not_designed','answer'].includes(input.mode)?input.mode:'answer',status:'draft',savedAt:new Date().toISOString()};
    const attachmentSourceIds=input.attachmentSourceIds||[];if(!Array.isArray(attachmentSourceIds)||new Set(attachmentSourceIds).size!==attachmentSourceIds.length||attachmentSourceIds.some(id=>!s.evidence.some(e=>e.id===id&&(!e.attachmentToQuestion||e.attachmentToQuestion===object.id))||s.withdrawnSourceIds?.includes(id)))throw Error('INVALID_ANSWER_ATTACHMENT');draft.attachmentSourceIds=attachmentSourceIds;
    const prev=s.answerDrafts.find(x=>x.questionId===object.id);if(prev)draft.supersedes=prev.id;
    s.answerDrafts=s.answerDrafts.filter(x=>x.questionId!==object.id);s.answerDrafts.push(draft);this.event(s,'answer_draft',draft);
   }
   if(action==='confirmFact'||action==='correctFact'){
    const {v,object}=this.resultObject(id,'facts',input.factId);const source=this.evidence(s,{title:action==='confirmFact'?'事实确认记录':'事实纠正记录',locator:text(input.person,200)+' · '+new Date().toISOString(),text:action==='confirmFact'?`确认范围：${object.id}\n事实：${object.value}\n依据修订：${v.record.revisionId}\n确认人：${text(input.person,200)}\n说明：${text(input.text)}`:text(input.text)});
    this.event(s,action==='confirmFact'?'fact_confirmation':'fact_correction',{factIds:[object.id],sourceId:source.id,resultRevisionId:v.record.revisionId,originalFactHash:hash(JSON.stringify(object)),factValueDigest:hash(JSON.stringify(object.value)),person:input.person});
   }
   if(action==='actionProgress'){
    const {v,object}=this.resultObject(id,'actions',input.actionId);const status=input.status;if(!['planned','reported_implemented','evidence_submitted'].includes(status))throw Error('INVALID_PROGRESS');
    const source=this.evidence(s,{title:'措施进展：'+object.description.slice(0,100),locator:input.owner||'责任人未确定',text:text(input.text,100000)});
    const record={actionId:object.id,resultRevisionId:v.record.revisionId,owner:typeof input.owner==='string'?input.owner.trim().slice(0,200):'',due:typeof input.due==='string'?input.due.slice(0,40):'',status,sourceId:source.id,updatedAt:new Date().toISOString()};s.actionProgress??=[];s.actionProgress=s.actionProgress.filter(x=>x.actionId!==object.id);s.actionProgress.push(record);this.event(s,'action_progress',record);
   }
   if(action==='dispute'){const {v,object}=this.resultObject(id,'risks',input.riskId);const source=this.evidence(s,{title:'风险判断异议 '+object.id,locator:input.person||'用户提出',text:text(input.text,100000)});this.event(s,'risk_dispute',{riskId:object.id,resultRevisionId:v.record.revisionId,sourceId:source.id});}
   if(action==='restoreInput'){
    if(!Number.isInteger(input.fromVersion)||input.fromVersion<1||input.fromVersion>=s.version)throw Error('INVALID_VERSION');
    const old=readJson(safeFile(this.dir(id),`state-${String(input.fromVersion).padStart(6,'0')}.json`));
    // Restore input selection into a new revision, preserving all evidence/events and current results.
    s.facts=old.facts;s.gaps=old.gaps;s.answerDrafts=old.answerDrafts||[];s.withdrawnSourceIds=[...new Set([...(old.withdrawnSourceIds||[]),...s.evidence.filter(e=>!old.evidence.some(o=>o.id===e.id)).map(e=>e.id)])];this.event(s,'input_restore',{fromVersion:input.fromVersion,resultRevisionId:result?.record.revisionId??null});
   }
  });
  return super.run(input);
 }
}
