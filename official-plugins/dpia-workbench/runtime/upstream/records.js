import {hash} from './results.js';
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function materialDigest(state){
 const sources=(state.evidence||[]).filter(e=>!e.attachmentToQuestion&&e.purpose!=='template'&&!state.withdrawnSourceIds?.includes(e.id)).map(e=>({id:e.id,sha256:e.sha256}));
 const events=(state.events||[]).filter(e=>['fact_confirmation','fact_correction','professional_record','action_progress','risk_dispute'].includes(e.kind));
 return hash(canonical({sources,facts:state.facts,gaps:state.gaps,events}));
}
export function screeningScopeDigest(assessment,factIds,contract='confirmation-stable/v2'){
 if(contract==='legacy/v1'){
  const facts=assessment.facts.filter(f=>factIds.includes(f.id)),ids=new Set(facts.flatMap(f=>f.source_ids));for(const c of assessment.meta.countries||[])for(const id of c.source_ids||[])ids.add(id);
  const scope=Object.fromEntries(['scope','excluded_scope','environment','rule_pack_versions'].map(k=>[k,assessment.meta[k]]));scope.countries=(assessment.meta.countries||[]).map(c=>({code:c.code,name:c.name,status:c.status,source_ids:c.source_ids}));
  return hash(canonical({facts,sources:assessment.sources.filter(s=>ids.has(s.id)),activities:assessment.activities,scope}));
 }
 const confirmations=new Set(assessment.sources.filter(s=>s.kind==='human_confirmation').map(s=>s.id));
 // Recording the confirmation itself must not invalidate the scope it confirms.
 // Values, design state, original evidence, countries and activities remain bound.
 const withoutConfirmations=ids=>ids.filter(id=>!confirmations.has(id));
 const facts=assessment.facts.filter(f=>factIds.includes(f.id)).map(f=>({...f,status:['documented','observed','confirmed'].includes(f.status)?'supported':f.status,source_ids:withoutConfirmations(f.source_ids)})),sourceIds=new Set(facts.flatMap(f=>f.source_ids));
 for(const c of assessment.meta.countries||[])for(const id of withoutConfirmations(c.source_ids||[]))sourceIds.add(id);
 const scope=Object.fromEntries(['scope','excluded_scope','environment','rule_pack_versions'].map(k=>[k,assessment.meta[k]]));
 scope.countries=(assessment.meta.countries||[]).map(c=>({code:c.code,name:c.name,status:c.status,source_ids:withoutConfirmations(c.source_ids||[])}));
 return hash(canonical({facts,sources:assessment.sources.filter(s=>sourceIds.has(s.id)),activities:assessment.activities,scope}));
}
export function validateProfessionalRecords(assessment,events){
 const records=new Map(events.filter(e=>e.kind==='professional_record').map(e=>[e.sourceId,e]));
 const sources=new Map(assessment.sources.map(s=>[s.id,s]));
 const confirmation=assessment.meta.screening_confirmation;
 if(confirmation?.source_ids?.length){
  const covered=new Set();
  for(const id of confirmation.source_ids){const event=records.get(id);if(!event||event.category!=='screening_scope'||event.scopeDigest!==screeningScopeDigest(assessment,event.subjectIds,event.scopeContract||'legacy/v1'))throw Error('UNRECORDED_SCREENING_CONFIRMATION');for(const subject of event.subjectIds)covered.add(subject);}
  if(confirmation.fact_ids.some(id=>!covered.has(id)))throw Error('SCREENING_CONFIRMATION_SCOPE_MISMATCH');
 }
 for(const rule of assessment.rule_assessments)for(const id of rule.reviewer_record_source_ids||[]){if(sources.get(id)?.kind!=='human_confirmation')continue;const e=records.get(id);if(!e||!['legal_review','dpo_opinion','stakeholder_opinion'].includes(e.category)||!e.subjectIds.includes(rule.rule_id))throw Error('PROFESSIONAL_RECORD_SCOPE_MISMATCH');}
 for(const decision of assessment.decisions)for(const id of decision.human_approval_source_ids||[]){const e=records.get(id);if(!e||!['risk_acceptance','launch_decision'].includes(e.category)||!e.subjectIds.includes(decision.jurisdiction))throw Error('APPROVAL_RECORD_SCOPE_MISMATCH');}
 for(const control of assessment.controls)for(const id of control.verification_evidence||[]){if(sources.get(id)?.kind!=='human_confirmation')continue;const e=records.get(id);if(!e||e.category!=='verification'||!e.subjectIds.includes(control.id))throw Error('VERIFICATION_RECORD_SCOPE_MISMATCH');}
}
