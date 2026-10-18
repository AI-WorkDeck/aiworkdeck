import {readFileSync,readdirSync} from 'node:fs';
import {readJson} from './store.js';
import {safeFile,hash} from './results.js';

// Outcomes are explicit model review records tied to the submitted answer and
// validated result. Merely saving text or finding a source never resolves a gap.
export function validateAnswerReviews(job,data,reviews=[]){
 const answers=job.answers||[];
 if(!Array.isArray(reviews)||reviews.length!==answers.length||new Set(reviews.map(r=>r.answerId)).size!==answers.length)throw Error('ANSWER_REVIEW_INCOMPLETE');
 for(const r of reviews){
  const answer=answers.find(a=>a.id===r.answerId),q=data.assessment.questions.find(q=>q.id===r.questionId);
  if(!answer||answer.questionId!==r.questionId||r.sourceId!==answer.sourceId||!q||!['absorbed','partial','conflict','still_missing'].includes(r.status)||typeof r.reason!=='string'||!r.reason.trim()||typeof r.remaining!=='string')throw Error('INVALID_ANSWER_REVIEW');
  if(!data.sourceIndex.sources.some(s=>s.id===r.sourceId)||!Array.isArray(r.checkIds)||!r.checkIds.length)throw Error('ANSWER_REVIEW_SOURCE_MISSING');
  const checks=r.checkIds.map(id=>data.intake.checks.find(c=>c.id===id));
  if(checks.some(c=>!c||!c.searched_source_ids?.includes(r.sourceId)))throw Error('ANSWER_REVIEW_TRACE_MISSING');
  if(r.status==='absorbed'&&(q.status!=='answered'||!q.answer_source_ids?.includes(r.sourceId)||checks.some(c=>['missing','conflict'].includes(c.status))))throw Error('ANSWER_REVIEW_OUTCOME_MISMATCH');
  if(r.status!=='absorbed'&&(q.status!=='open'||!r.remaining.trim()))throw Error('ANSWER_REVIEW_OUTCOME_MISMATCH');
  if(r.status==='conflict'&&!checks.some(c=>c.status==='conflict'))throw Error('ANSWER_REVIEW_OUTCOME_MISMATCH');
 }
 return reviews;
}

export function answerStates(store,id,result){
 const state=store.state(id),drafts=state.answerDrafts||[];if(!drafts.length)return [];
 const states=new Map(drafts.map(d=>[d.id,{answerId:d.id,questionId:d.questionId,status:'draft'}]));
 if(!result)return [...states.values()];
 const root=store.dir(id);
 for(const name of store.results.records(id).reverse()){
  const record=readJson(safeFile(root,name));
  for(const review of record.answerReviews||[]){const old=states.get(review.answerId);if(old?.status==='draft')states.set(review.answerId,{...review,revisionId:record.revisionId,requestId:record.requestId,historical:record.revisionId!==result.record.revisionId});}
  if([...states.values()].every(s=>s.status!=='draft'))break;
 }
 const names=readdirSync(root).filter(n=>/^execution-\d{6}\.json$/.test(n)).sort();
 if(names.length){const execution=readJson(safeFile(root,names.at(-1)));
  if(execution.requestId&&execution.kind!=='report'){
   let job;try{job=readJson(safeFile(root,`runs/${execution.requestId}/job.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(job?.contextPath&&hash(readFileSync(safeFile(root,job.contextPath)))!==job.inputDigest)throw Error('INPUT_DIGEST_MISMATCH');
   for(const answer of job?.answers||[]){const old=states.get(answer.id);if(old?.status==='draft')states.set(answer.id,{...old,requestId:execution.requestId,status:({accepted:'submitted',submitting:'submitting',uncertain:'submission_uncertain',cancel_requested:'cancel_requested',cancelled:'cancelled'})[execution.phase]||'draft'});}
  }
 }
 return [...states.values()];
}
