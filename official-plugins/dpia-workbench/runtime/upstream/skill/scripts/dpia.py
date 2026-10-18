#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Dependency-free DPIA state checks and rendering. Does not perform legal reasoning."""
import argparse
import copy
from datetime import date
import hashlib
import json
from pathlib import Path
import sys
import gdpr_workflow

ROOT = Path(__file__).resolve().parents[1]
MATRIX = [['low','low','medium','high'],['low','medium','high','high'],['medium','high','high','very_high'],['medium','high','very_high','very_high']]
LEVELS = {'unknown':-1,'low':0,'medium':1,'high':2,'very_high':3}
COLLECTIONS = ['sources','facts','activities','flows','controls','risks','actions','questions','linked_assessments','changes']
CURRENT_SCHEMA = '0.5.0'
UNRESOLVED_FACTS = {'inferred','unknown','conflict'}
REQUIRED_LIFECYCLE = ['collect','transmit','use_derive','store','access_share','retain_delete','backup_recover','rights_exit']
REQUIRED_ELEMENTS = ['scope_version','country_entity','purpose','data_subject','data_field','scale_frequency','notice_choice','system_flow','recipient_access','retention_deletion','rights_exit','automated_decision','security_control','implementation_state']

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def dumps(value):
    return json.dumps(value, ensure_ascii=False, indent=2)

def rules():
    return {r['id']:r for p in sorted((ROOT/'jurisdictions').glob('*/rules.json')) for r in read(p)['rules']}

def schema_errors(v, s, p='$'):
    out=[]
    def matches(t):
        return {'object':isinstance(v,dict),'array':isinstance(v,list),'string':isinstance(v,str),'integer':type(v) is int,'null':v is None,'boolean':type(v) is bool}.get(t,False)
    if 'type' in s:
        ts=s['type'] if isinstance(s['type'],list) else [s['type']]
        if not any(matches(t) for t in ts): return [f'{p}: expected {ts}']
    if 'enum' in s and v not in s['enum']: out.append(f'{p}: invalid enum {v!r}')
    if type(v) in (int,float):
        if 'minimum' in s and v<s['minimum']: out.append(f'{p}: below minimum')
        if 'maximum' in s and v>s['maximum']: out.append(f'{p}: above maximum')
    if isinstance(v,dict):
        out.extend(f'{p}: missing {k}' for k in s.get('required',[]) if k not in v)
        for k,x in v.items():
            if k in s.get('properties',{}): out.extend(schema_errors(x,s['properties'][k],f'{p}.{k}'))
            elif isinstance(s.get('additionalProperties'),dict): out.extend(schema_errors(x,s['additionalProperties'],f'{p}.{k}'))
            elif s.get('additionalProperties') is False: out.append(f'{p}: unexpected {k}')
    if isinstance(v,list) and 'items' in s:
        for i,x in enumerate(v): out.extend(schema_errors(x,s['items'],f'{p}[{i}]'))
    return out

def level(r):
    if r['likelihood'] is None or r['severity'] is None:return 'unknown'
    return MATRIX[r['likelihood']-1][r['severity']-1]

def initialize(project,jurisdictions):
    rr=rules();js=list(dict.fromkeys(jurisdictions))
    versions={read(p)['jurisdiction']:read(p)['version'] for p in (ROOT/'jurisdictions').glob('*/rules.json')}
    record = {'meta':{'schema_version':CURRENT_SCHEMA,'countries':[],'project':project,'version':'1','assessed_at':str(date.today()),'stage':'draft','environment':'待确认','scope':'待界定','excluded_scope':'待确认','controller':'待确认','role_analysis':'待分析','template_id':'generic-v1','rule_pack_versions':{j:versions[j] for j in js},'risk_method':'internal-4x4-v1','source_review':'规则基线2026-09-11；本次适用及最新法源待核','fact_baseline_status':'building','fact_baseline_version':'1','fact_baseline_source_ids':[]},
        'jurisdictions':[{'code':j,'applicability':'unknown','analysis':'待核法律适用','fact_ids':[],'source_refs':[],'local_coverage':'pending','coverage_note':'EU当地监管机构清单待核' if j=='EU' else '行业及特别法适用待核','local_source_refs':[]} for j in js],
        'assessment_plan':{'contract_version':'1.1','shared_requirements':[],'status':'building','phase':'design','rule_scopes':[],'questions':[]},
        **{k:[] for k in COLLECTIONS},'rule_assessments':[{'rule_id':r['id'],'status':'unknown','analysis':'待评估','fact_ids':[],'source_refs':copy.deepcopy(r['source_refs']),'reviewer_record_source_ids':[]} for r in rr.values() if r['jurisdiction'] in js],'decisions':[]}
    if js == ['EU']:record['meta'].update(gdpr_workflow.identity())
    return record

def fact_gate_errors(d, require_coverage=True):
    if d.get('meta',{}).get('schema_version')==CURRENT_SCHEMA:
        from fact_requirements import gate_errors
        return gate_errors(d, rules())
    m=d.get('meta',{});errors=[]
    frozen=m.get('fact_baseline_status')=='frozen'
    if not frozen:errors.append('fact baseline not frozen; only a fact list may be delivered')
    if not str(m.get('fact_baseline_version','')).strip():errors.append('fact baseline version missing')
    sources={s.get('id'):s for s in d.get('sources',[])}
    confirmations=m.get('fact_baseline_source_ids',[])
    if frozen:
        if not confirmations:errors.append('frozen fact baseline lacks user confirmation record')
        for sid in confirmations:
            if sid not in sources:errors.append(f'fact baseline confirmation source unknown: {sid}')
            elif sources[sid].get('kind')!='human_confirmation':errors.append(f'fact baseline source must be human_confirmation: {sid}')
    unresolved=[f.get('id','?') for f in d.get('facts',[]) if f.get('status') in UNRESOLVED_FACTS]
    if unresolved:errors.append('frozen fact baseline contains unresolved facts: '+', '.join(unresolved))
    open_questions=[q.get('id','?') for q in d.get('questions',[]) if q.get('status')=='open']
    if open_questions:errors.append('frozen fact baseline contains open questions: '+', '.join(open_questions))
    if not d.get('activities'):errors.append('frozen fact baseline needs processing activities')
    if not d.get('facts'):errors.append('frozen fact baseline needs atomic facts')
    if require_coverage:
        covered={f.get('lifecycle_stage') for f in d.get('facts',[])}
        missing=[x for x in REQUIRED_LIFECYCLE if x not in covered]
        if missing:errors.append('fact baseline lifecycle coverage missing: '+', '.join(missing))
        covered_elements={f.get('element') for f in d.get('facts',[])}
        missing_elements=[x for x in REQUIRED_ELEMENTS if x not in covered_elements]
        if missing_elements:errors.append('fact baseline element coverage missing: '+', '.join(missing_elements))
    return errors

def validate(d):
    errors=schema_errors(d,read(ROOT/'schemas/assessment.schema.json'))
    if errors:return {'schema_valid':False,'errors':errors,'warnings':[]}
    warnings=[];ready=d['meta']['stage']=='review_ready';rr=rules();current=d['meta']['schema_version'] in ['0.4.0',CURRENT_SCHEMA]
    if gdpr_workflow.enabled(d):errors.extend(gdpr_workflow.validation_errors(d))
    if d['meta']['schema_version']==CURRENT_SCHEMA:
        from fact_requirements import structural_errors
        errors.extend(structural_errors(d,rr))
    else:warnings.append('Legacy contract: migrate to 0.5.0 before a new assessment; no requirement-level assurance')
    source_index={s['id']:s for s in d['sources']};official={s['id'] for s in read(ROOT/'references/sources.json')['sources']}
    ids=set(); indexes={}
    for c in COLLECTIONS:
        indexes[c]={x['id']:x for x in d[c]}
        for x in d[c]:
            if not x['id'].strip():errors.append(f'{c}: empty ID')
            if x['id'] in ids or x['id'] in rr:errors.append(f'duplicate/reserved ID: {x["id"]}')
            ids.add(x['id'])
    jcodes=[x['code'] for x in d['jurisdictions']]
    if not jcodes or len(jcodes)!=len(set(jcodes)):errors.append('jurisdictions must be nonempty and unique')
    known_jurisdictions={r['jurisdiction'] for r in rr.values()}
    if set(jcodes)-known_jurisdictions:errors.append('unsupported jurisdiction pack: '+', '.join(sorted(set(jcodes)-known_jurisdictions)))
    amap={a['rule_id']:a for a in d['rule_assessments']}
    if len(amap)!=len(d['rule_assessments']):errors.append('duplicate rule assessment')
    all_refs=ids|set(amap)
    if d['meta']['schema_version']==CURRENT_SCHEMA and not errors:
        all_refs.update(x['id'] for q in d['assessment_plan']['questions'] for x in [q]+q['requirements'])
        all_refs.update(r['id'] for r in d['assessment_plan'].get('shared_requirements',[]))
    def check_refs(xs,pool,where):
        for x in xs:
            if x not in pool:errors.append(f'{where}: unknown reference {x}')
    def legal_refs(xs,where):
        for x in xs:
            if x['source_id'] not in official|set(source_index):errors.append(f'{where}: unknown legal source {x["source_id"]}')
            if not x['locator'].strip():errors.append(f'{where}: empty legal locator')
    def pending(msg):
        (errors if ready else warnings).append(msg)
    if current:
        for field in ['fact_baseline_status','fact_baseline_version','fact_baseline_source_ids']:
            if field not in d['meta']:errors.append(f'meta: {field} missing')
    countries=d['meta'].get('countries',[])
    if not any(c['status']=='confirmed' for c in countries):pending('具体国家范围未确认；不得输出相应国家DPIA，仅可返回事实清单或保留内部共通研究')
    cc=[c['code'] for c in countries]
    if len(cc)!=len(set(cc)):errors.append('Duplicate country')
    for c in countries:
        if len(c['code'])!=2 or not c['code'].isascii() or not c['code'].isalpha() or c['code']!=c['code'].upper() or c['code']=='EU':
            errors.append('Country code must identify a country, not a region')
        check_refs(c['source_ids'],source_index,c['code']);legal_refs(c['law_refs'],c['code'])
        if not c['connection'].strip():errors.append(c['code']+': country connection missing')
        if c['status']=='confirmed' and not c['source_ids']:errors.append(c['code']+': country scope lacks evidence')
        if c['status']=='candidate':pending(c['code']+': candidate country unresolved')
        if c['status']=='confirmed' and c['law_review']!='verified':pending(c['code']+': national law review incomplete')
        if c['law_review']=='verified' and (not c['law_refs'] or not c['law_analysis'].strip() or not c['authorities'].strip()):errors.append(c['code']+': verified national review needs law, analysis and authorities')
    for s in d['sources']:
        for k in ['title','uri','version','locator','observed_at']:
            if not s[k].strip():errors.append(f'{s["id"]}: empty {k}')
        if s['sha256'] is not None and (len(s['sha256'])!=64 or any(c not in '0123456789abcdef' for c in s['sha256'])):errors.append(f'{s["id"]}: invalid SHA256')
    open_question_facts={fid for q in d['questions'] if q.get('status')=='open' for fid in q.get('affected_ids',[])}
    if d['meta']['schema_version']==CURRENT_SCHEMA and not errors:
        from fact_requirements import resolved_requirements
        open_question_facts.update(fid for q in d['assessment_plan']['questions'] for r in resolved_requirements(d['assessment_plan'],q) if r['status']=='missing' for fid in r['fact_ids'])
    for f in d['facts']:
        scope=f.get('scope_activity_ids',[]) if f['activity_id'] is None else [f['activity_id']]
        if not scope:errors.append(f['id']+': shared fact needs explicit activity scope')
        check_refs(scope,indexes['activities'],f['id']);check_refs(f['source_ids'],source_index,f['id'])
        if current:
            for field in ['element','lifecycle_stage'] + (['assessment_impact'] if d['meta']['schema_version']=='0.4.0' else []):
                if not str(f.get(field,'')).strip():errors.append(f'{f["id"]}: {field} missing')
        if f['status'] in ['documented','confirmed','observed','conflict'] and not f['source_ids']:errors.append(f'{f["id"]}: factual assertion lacks evidence')
        if f['status']=='conflict' and len(set(f['source_ids']))<2:errors.append(f'{f["id"]}: conflict requires both sources')
        if f['status'] in ['inferred','unknown','conflict'] and not f['note'].strip():errors.append(f'{f["id"]}: uncertainty needs explanation')
        if f['status']=='confirmed' and not any(source_index.get(s,{}).get('kind')=='human_confirmation' for s in f['source_ids']):errors.append(f'{f["id"]}: confirmation record missing')
        if f['status'] in ['unknown','conflict']:warnings.append(f'{f["id"]}: unresolved fact ({f["status"]})')
        if d['meta'].get('fact_baseline_status')=='awaiting_confirmation' and f['status'] in UNRESOLVED_FACTS and f['id'] not in open_question_facts:errors.append(f'{f["id"]}: unresolved fact lacks an open confirmation question')
    for a in d['activities']:
        check_refs(a['fact_ids'],indexes['facts'],a['id'])
        if ready and (not a['fact_ids'] or not a['purpose'].strip()):errors.append(f'{a["id"]}: activity lacks purpose/evidence')
    for f in d['flows']:
        check_refs([f['activity_id']],indexes['activities'],f['id']);check_refs(f['fact_ids'],indexes['facts'],f['id'])
    for j in d['jurisdictions']:
        check_refs(j['fact_ids'],indexes['facts'],j['code']);legal_refs(j['source_refs'],j['code']);legal_refs(j['local_source_refs'],j['code'])
        if j['applicability']=='unknown':pending(f'{j["code"]}: applicability unresolved')
        elif not j['fact_ids'] or not j['source_refs'] or not j['analysis'].strip():errors.append(f'{j["code"]}: applicability lacks analysis/evidence/legal basis')
        if j['code']=='EU' and j['applicability']=='applies' and j['local_coverage']!='verified':warnings.append('EU: local authority/list coverage incomplete; cannot claim full EU coverage')
        if j['local_coverage']=='verified' and (not j['local_source_refs'] or not j['coverage_note'].strip()):errors.append(f'{j["code"]}: verified local coverage needs sources and explanation')
        if j['code'] not in d['meta']['rule_pack_versions']:errors.append(f'{j["code"]}: missing rule pack version')
    for a in d['rule_assessments']:
        rid=a['rule_id'];r=rr.get(rid)
        if not r:errors.append(f'unknown rule {rid}');continue
        if r['jurisdiction'] not in jcodes:errors.append(f'{rid}: outside selected jurisdictions')
        check_refs(a['fact_ids'],indexes['facts'],rid);legal_refs(a['source_refs'],rid);check_refs(a['reviewer_record_source_ids'],source_index,rid)
        if a['status']!='unknown':
            if not a['analysis'].strip() or not a['source_refs']:errors.append(f'{rid}: resolved assessment needs analysis and law')
            if r['kind'] in ['trigger','indicator','exception'] and not a['fact_ids']:errors.append(f'{rid}: trigger conclusion needs facts')
            unresolved=[f for f in a['fact_ids'] if indexes['facts'].get(f,{}).get('status') in ['unknown','conflict','inferred']]
            if unresolved:pending(f'{rid}: resolved conclusion depends on unresolved/inferred facts {unresolved}')
        if rid=='EU-X01' and a['status']=='met':
            if not any(source_index.get(s,{}).get('kind')=='human_confirmation' for s in a['reviewer_record_source_ids']):pending('EU-X01: exception requires recorded legal review')
    for c in d['controls']:
        check_refs(c['implementation_evidence'],source_index,c['id']);check_refs(c['verification_evidence'],source_index,c['id'])
        if c['status'] in ['implemented','verified'] and not c['implementation_evidence']:errors.append(f'{c["id"]}: implementation evidence missing')
        if c['status']=='verified' and (not c['verification_evidence'] or not c['acceptance'].strip()):errors.append(f'{c["id"]}: verification evidence/acceptance missing')
        if c['status']=='verified' and c['verification_evidence'] and not any(source_index.get(s,{}).get('kind') in ['test','configuration','log','human_confirmation','ui'] for s in c['verification_evidence']):errors.append(f'{c["id"]}: design/policy/contract alone cannot verify operation')
    for r in d['risks']:
        check_refs([r['activity_id']],indexes['activities'],r['id']);check_refs(r['fact_ids'],indexes['facts'],r['id']);check_refs(r['control_ids'],indexes['controls'],r['id'])
        check_refs(r['jurisdictions'],set(jcodes),r['id'])
        if not r['jurisdictions'] or not r['scenario'].strip() or not r['harm'].strip():errors.append(f'{r["id"]}: risk needs jurisdiction, mechanism and personal harm')
        for phase in ['baseline','current','target']:
            if not r[phase]['rationale'].strip():errors.append(f'{r["id"]}.{phase}: rating needs rationale')
        if LEVELS[level(r['current'])]>=0 and LEVELS[level(r['baseline'])]>LEVELS[level(r['current'])]:
            verified=[c for c in r['control_ids'] if indexes['controls'].get(c,{}).get('status')=='verified']
            if not verified:errors.append(f'{r["id"]}: current risk reduced without verified control')
        if level(r['target'])!='unknown' and not r['target_assumptions'].strip():errors.append(f'{r["id"]}: target assumptions missing')
    for a in d['actions']:
        check_refs(a['risk_ids'],indexes['risks'],a['id']);check_refs(a['rule_ids'],rr,a['id']);check_refs(a['evidence_source_ids'],source_index,a['id'])
        if not a['acceptance'].strip():errors.append(f'{a["id"]}: acceptance criteria missing')
        if a['status']=='closed' and not a['evidence_source_ids']:errors.append(f'{a["id"]}: closed action lacks evidence')
        if ready and (not a['owner'].strip() or not a['due'].strip()):errors.append(f'{a["id"]}: owner/due missing')
    for q in d['questions']:
        check_refs(q['affected_ids'],all_refs,q['id']);check_refs(q['answer_source_ids'],source_index,q['id'])
        for field,label in [('compliance_impact','compliance impact'),('recommendation','recommended action')]:
            if not q.get(field,'').strip():
                message=f'{q["id"]}: {label} missing'
                (errors if ready or d['meta']['schema_version'] in ['0.3.0','0.4.0',CURRENT_SCHEMA] else warnings).append(message)
        if q['status']=='answered' and not q['answer_source_ids']:errors.append(f'{q["id"]}: answered question lacks evidence')
        if q['status']=='open' and q['impact']=='blocking':
            if d['meta']['schema_version']==CURRENT_SCHEMA:warnings.append(f'{q["id"]}: open reply task; current-stage blockers are determined by requirements')
            else:pending(f'{q["id"]}: blocking question open')
    for x in d['linked_assessments']:
        check_refs(x['source_ids'],source_index,x['id']);check_refs([x['jurisdiction']],set(jcodes),x['id'])
        if x['status']=='complete' and not x['source_ids']:errors.append(f'{x["id"]}: completed linked assessment lacks deliverable')
        if not x['rationale'].strip():errors.append(f'{x["id"]}: linked assessment needs rationale')
    dec_codes=[x['jurisdiction'] for x in d['decisions']]
    if len(dec_codes)!=len(set(dec_codes)):errors.append('duplicate jurisdiction decision')
    for de in d['decisions']:
        check_refs([de['jurisdiction']],set(jcodes),'decision');check_refs(de['blocking_ids'],all_refs,'decision');check_refs(de['human_approval_source_ids'],source_index,'decision')
        for sid in de['human_approval_source_ids']:
            if source_index.get(sid,{}).get('kind')!='human_confirmation':errors.append('human approval must link human confirmation record')
        if de['recommendation']=='proceed_recommendation':
            j=next((j for j in d['jurisdictions'] if j['code']==de['jurisdiction']),{})
            if j.get('applicability')!='applies' or (j.get('code')=='EU' and j.get('local_coverage')!='verified'):errors.append('unconditional proceed with incomplete jurisdiction coverage')
            if de['blocking_ids']:errors.append('unconditional proceed with blockers')
            if d['meta']['schema_version']!=CURRENT_SCHEMA and any(q['status']=='open' and q['impact']=='blocking' for q in d['questions']):errors.append('unconditional proceed with blocking questions')
            if any(x['jurisdiction']==de['jurisdiction'] and x['status']=='pending' for x in d['linked_assessments']):errors.append('unconditional proceed with pending linked assessment')
            if any(a['status']!='closed' for a in d['actions']):errors.append('unconditional proceed with open actions; resolve launch relevance explicitly')
            incomplete=[rid for rid,r in rr.items() if r['jurisdiction']==de['jurisdiction'] and r['kind']=='content' and amap.get(rid,{}).get('status') not in ['met','not_applicable']]
            if incomplete:errors.append('unconditional proceed with incomplete content: '+', '.join(incomplete))
    for c in d['changes']:check_refs(c['affected_ids'],all_refs,c['id'])
    templates={t['id'] for t in read(ROOT/'assets/template-maps.json')['templates']}
    if d['meta']['template_id'] not in templates:errors.append('unknown template_id')
    gate=fact_gate_errors(d)
    if d['meta'].get('fact_baseline_status')=='frozen' or ready:errors.extend(gate)
    else:warnings.extend(gate)
    if ready:
        if not d['activities']:errors.append('review_ready needs processing activities')
        for j in d['jurisdictions']:
            if j['applicability']!='applies':continue
            for rid,r in rr.items():
                if r['jurisdiction']==j['code'] and r['kind']=='content' and amap.get(rid,{}).get('status','unknown') not in ['met','not_applicable']:errors.append(f'{rid}: mandatory assessment content not analyzed')
            if j['code'] not in dec_codes:errors.append(f'{j["code"]}: recommendation missing')
    else:
        missing=[r for r in rr if rr[r]['jurisdiction'] in jcodes and rr[r]['kind']=='content' and amap.get(r,{}).get('status','unknown')=='unknown']
        if missing:warnings.append('Unassessed content: '+', '.join(missing))
    return {'schema_valid':True,'errors':errors,'warnings':warnings}

def screen(d):
    scoped=gdpr_workflow.enabled(d)
    gate=gdpr_workflow.screening_errors(d) if scoped else fact_gate_errors(d)
    if gate:raise ValueError('; '.join(gate))
    rr=rules();a={x['rule_id']:x for x in d['rule_assessments']};out=[]
    facts={f['id']:f for f in d['facts']}
    confirmed=set(d['meta'].get('screening_confirmation',{}).get('fact_ids',[]))
    def status(rid):
        item=a.get(rid,{})
        if scoped and (not item.get('fact_ids') or set(item['fact_ids'])-confirmed):return 'unknown'
        if any(facts.get(fid,{}).get('status') in ['unknown','conflict','inferred'] for fid in item.get('fact_ids',[])):
            return 'unknown'
        return item.get('status','unknown')
    for j in d['jurisdictions']:
        code=j['code'];tr=[k for k,r in rr.items() if r['jurisdiction']==code and r['kind']=='trigger']
        met=[k for k in tr if status(k)=='met'];unknown=[k for k in tr if status(k) not in ['met','not_met']]
        indicators=[k for k,r in rr.items() if r['jurisdiction']==code and r['kind']=='indicator' and status(k)=='met']
        exception=status('EU-X01')=='met' if code=='EU' else False
        if j['applicability']=='unknown' or (scoped and set(j['fact_ids'])-confirmed) or any(facts.get(fid,{}).get('status') in ['unknown','conflict','inferred'] for fid in j['fact_ids']):result='applicability_unresolved'
        elif j['applicability']=='does_not_apply':result='outside_scope'
        elif exception and met:result='conflict_requires_review'
        elif exception:result='exception_claim_requires_review'
        elif met:result='required'
        elif code=='EU' and len(indicators)>=2:result='recommended_high_risk_review'
        elif unknown or (code=='EU' and j['local_coverage']!='verified'):result='undetermined'
        elif scoped and (not d['meta']['countries'] or any(c['status']=='candidate' for c in d['meta']['countries']) or not any(c['status']=='confirmed' for c in d['meta']['countries'])):result='undetermined'
        else:result='no_trigger_identified_within_assessed_scope'
        out.append({'jurisdiction':code,'result':result,'met_triggers':met,'unknown_triggers':unknown,'met_indicators':indicators,'local_coverage':j['local_coverage'],'note':'Screening summary of authored judgments; not permission to process. One WP248 criterion may suffice; never use counts as an exemption.'})
    return out

def dependencies(x):
    result=set()
    def walk(v,key=''):
        if isinstance(v,dict):
            if 'source_id' in v:result.add(v['source_id'])
            for k,y in v.items():walk(y,k)
        elif isinstance(v,list):
            if key.endswith('_ids') or key.endswith('_evidence') or key in ['verification_evidence','implementation_evidence']:
                result.update(y for y in v if isinstance(y,str))
            for y in v:walk(y,key)
        elif isinstance(v,str) and key in ['activity_id']:result.add(v)
    walk(x);return result

def object_map(d):
    out={x['id']:x for c in COLLECTIONS for x in d[c]}
    if 'assessment_plan' in d:out['assessment-plan']=d['assessment_plan']
    out.update({x['rule_id']:x for x in d['rule_assessments']})
    out.update({f'jurisdiction:{x["code"]}':x for x in d['jurisdictions']})
    out.update({f'decision:{x["jurisdiction"]}':x for x in d['decisions']})
    return out

def diff(old,new):
    a,b=object_map(old),object_map(new);added=sorted(set(b)-set(a));removed=sorted(set(a)-set(b));modified=sorted(k for k in set(a)&set(b) if a[k]!=b[k]);seeds=set(added+removed+modified)
    meta=[k for k in set(old['meta'])|set(new['meta']) if old['meta'].get(k)!=new['meta'].get(k)]
    global_change=set(meta)-{'version','assessed_at','stage','revision_id','parent_revision_id','screening_confirmation','pending_review_ids','fact_baseline_digest','fact_baseline_status','fact_baseline_source_ids','fact_baseline_version'}
    affected=set(seeds)
    if global_change or 'assessment-plan' in seeds:affected.update(x['rule_id'] for x in new['rule_assessments']);affected.update(x['id'] for x in new['risks'])
    combined=a|b
    while True:
        more={k for k,v in combined.items() if dependencies(v)&affected}
        # Any changed activity/risk/assessment/jurisdiction potentially changes the decision.
        if any(k in affected for k in set(x['rule_id'] for x in new['rule_assessments'])|set(x['id'] for x in new['risks'])|set('jurisdiction:'+j['code'] for j in new['jurisdictions'])):
            more.update('decision:'+j['code'] for j in new['jurisdictions'])
        if more<=affected:break
        affected|=more
    return {'added':added,'removed':removed,'modified':modified,'meta_changed':sorted(meta),'reassess':sorted(affected),'note':'Review proposed scope against original changed materials; no automatic legal conclusion or writeback.'}

def cell(v):
    if isinstance(v,(list,dict)):v=json.dumps(v,ensure_ascii=False)
    return str(v).replace('|','\\|').replace('\n','<br>').replace('\r','')

def table(headers, rows):
    return '\n'.join(['| '+' | '.join(map(cell,headers))+' |','| '+' | '.join('---' for _ in headers)+' |']+['| '+' | '.join(map(cell,r))+' |' for r in rows])+'\n'

def render_fact_list(d, source_index=None, intake_review=None):
    if gdpr_workflow.enabled(d):
        if source_index is None or intake_review is None:
            raise ValueError('GDPR fact-list requires --source-index and --intake-review; index evidence and review residual gaps before asking')
        import source_trace
        check = validate(d)
        if check['errors']:raise ValueError('; '.join(check['errors']))
        return source_trace.render(d, source_index, intake_review)
    schema=schema_errors(d,read(ROOT/'schemas/assessment.schema.json'))
    if schema:raise ValueError('Schema validation failed: '+ '; '.join(schema))
    if d['meta']['schema_version']==CURRENT_SCHEMA:
        from fact_requirements import structural_errors
        errors=structural_errors(d,rules())
        if errors:raise ValueError('Requirement validation failed: '+ '; '.join(errors))
    sources={s['id']:s for s in d['sources']};activities={a['id']:a.get('name',a['id']) for a in d['activities']}
    activities[None]='跨活动共通（见适用活动范围）'
    order={name:i for i,name in enumerate(REQUIRED_LIFECYCLE+['cross_cutting'])}
    facts=sorted(d['facts'],key=lambda f:(order.get(f.get('lifecycle_stage'),99),activities.get(f['activity_id'],f['activity_id']),f['id']))
    def evidence(f):
        return '；'.join(sources[s]['title']+' — '+sources[s]['locator'] for s in f['source_ids'] if s in sources) or '待补充'
    def fact_row(f):
        if d['meta']['schema_version']==CURRENT_SCHEMA:
            from fact_requirements import resolved_requirements
            links=sorted({r['id'] for q in d['assessment_plan']['questions'] for r in resolved_requirements(d['assessment_plan'],q) if f['id'] in r['fact_ids']})
            status={'documented':'材料明确（未验证现状）','confirmed':'用户已确认','observed':'已观察','inferred':'推断待确认','unknown':'未知','conflict':'来源冲突'}
            return [f['id'],activities.get(f['activity_id'],f['activity_id']),f.get('lifecycle_stage','待归类'),f.get('element','待归类'),f['context'],{f['predicate']:f['value']},evidence(f),status[f['status']],f['implementation'],links or '尚待需求映射']
        return [f['id'],activities.get(f['activity_id'],f['activity_id']),f.get('lifecycle_stage','待归类'),f.get('element','待归类'),{f['predicate']:f['value']},evidence(f),f['status'],f['implementation'],f.get('assessment_impact','待分级')]
    known_rows=[fact_row(f) for f in facts if f['status'] not in UNRESOLVED_FACTS]
    unresolved_rows=[fact_row(f) for f in facts if f['status'] in UNRESOLVED_FACTS]
    questions=[[q['id'],q['question'],q['impact'],q.get('compliance_impact','待补充'),q.get('recommendation','待补充'),q['owner']] for q in d['questions'] if q['status']=='open']
    known_facts=[f for f in facts if f['status'] not in UNRESOLVED_FACTS]
    all_lifecycle={f.get('lifecycle_stage') for f in facts};known_lifecycle={f.get('lifecycle_stage') for f in known_facts}
    all_elements={f.get('element') for f in facts};known_elements={f.get('element') for f in known_facts}
    coverage=[
        '尚未建立记录的生命周期：'+('、'.join(x for x in REQUIRED_LIFECYCLE if x not in all_lifecycle) or '无'),
        '仅有待确认记录的生命周期：'+('、'.join(x for x in REQUIRED_LIFECYCLE if x in all_lifecycle and x not in known_lifecycle) or '无'),
        '尚未建立记录的要素：'+('、'.join(x for x in REQUIRED_ELEMENTS if x not in all_elements) or '无'),
        '仅有待确认记录的要素：'+('、'.join(x for x in REQUIRED_ELEMENTS if x in all_elements and x not in known_elements) or '无')]
    fact_headers=['ID','处理活动','生命周期','要素','原子事实','材料及定位','证据状态','实施状态','历史影响标签（不作门禁）']
    if d['meta']['schema_version']==CURRENT_SCHEMA:fact_headers=['ID','处理活动','生命周期','要素','事实适用上下文','原子事实','材料及定位','证据状态','实施状态','评估需求']
    m=d['meta'];parts=['# '+m['project']+'：数据生命周期事实清单',f'事实基线版本：{m.get("fact_baseline_version","待建立")}｜状态：{m.get("fact_baseline_status","building")}', '本清单是DPIA评估前的事实核对产物，不是法律结论或上线建议。', '## 已提取的原子事实',table(fact_headers,known_rows) if known_rows else '当前尚无可作为评估输入的已提取事实。']
    parts+=['## 待确认的候选事实',table(fact_headers,unresolved_rows) if unresolved_rows else '当前未记录未决候选事实。']
    parts+=['## 要素与生命周期覆盖检查','\n'.join('- '+item for item in coverage)]
    if d['meta']['schema_version']==CURRENT_SCHEMA:
        from fact_requirements import render_requirements
        parts[-2:]=['## 评估问题与事实需求',render_requirements(d)]
    parts+=['## 待补充/确认问题',table(['ID','待补充/确认','等级','合规影响','建议','建议回复人'],questions) if questions else '当前未记录开放问题。']
    parts+=['## 用户复核', '请按ID更正不准确的事实，并补充待确认项。在事实基线冻结前，不会输出具体DPIA评估。']
    return '\n\n'.join(parts)+'\n'

def write_fact_list(d,dest,source_index=None,intake_review=None):
    content=render_fact_list(d,source_index,intake_review)
    dest=Path(dest);dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open('x',encoding='utf-8') as f:f.write(content)
    return str(dest.resolve())

def render_workpapers(d,out):
    gate=fact_gate_errors(d)
    if gate:raise ValueError('; '.join(gate))
    check=validate(d)
    if check['errors']:raise ValueError('Validation failed: '+ '; '.join(check['errors']))
    out=Path(out);names=['DPIA-report.md','evidence-and-analysis.md','actions-and-decisions.md','assessment.json','validation.json']
    if any((out/n).exists() for n in names):raise ValueError('Output already exists; choose a new version directory')
    rr=rules();amap={a['rule_id']:a for a in d['rule_assessments']};scr=screen(d)
    report=[f'# DPIA：{d["meta"]["project"]}',f'版本：{d["meta"]["version"]}｜日期：{d["meta"]["assessed_at"]}｜状态：{d["meta"]["stage"]}（不是批准）',f'环境：{d["meta"]["environment"]}\n\n范围：{d["meta"]["scope"]}\n\n排除：{d["meta"]["excluded_scope"]}',f'控制者：{d["meta"]["controller"]}\n\n角色分析：{d["meta"]["role_analysis"]}\n\n法源复核：{d["meta"]["source_review"]}', '## 适用与筛查',table(['法域','适用','分析','当地覆盖'],[[j['code'],j['applicability'],j['analysis'],j['local_coverage']+'; '+j['coverage_note']] for j in d['jurisdictions']]),table(['法域','筛查','命中','未知'],[[s['jurisdiction'],s['result'],s['met_triggers'],s['unknown_triggers']] for s in scr]),'## 处理活动',table(['ID','目的','对象/字段','系统/地域','规模/生命周期'],[[a['id'],a['purpose'],[a['data_subjects'],a['data_fields']],[a['systems'],a['regions']],a['scale']+'; '+a['lifecycle']] for a in d['activities']])]
    for j in d['jurisdictions']:
        report.append('## '+j['code']+' 法律与评估分析')
        report.append(table(['规则','主题','状态','论证','事实/法源'],[[rid,rr[rid]['title'],amap.get(rid,{}).get('status','unknown'),amap.get(rid,{}).get('analysis','未评估'),[amap.get(rid,{}).get('fact_ids',[]),amap.get(rid,{}).get('source_refs',[])]] for rid in rr if rr[rid]['jurisdiction']==j['code'] and rr[rid]['kind']=='content']))
    report+=['## 权益影响与风险',table(['ID/类型','机制与个人影响','基准','当前','预期及条件'],[[r['id']+'/'+r['type'],r['scenario']+'；'+r['affected_people']+'；'+r['harm'],level(r['baseline'])+'：'+r['baseline']['rationale'],level(r['current'])+'：'+r['current']['rationale'],level(r['target'])+'：'+r['target']['rationale']+'；'+r['target_assumptions']] for r in d['risks']]),'## 建议（人工审批另见证据）',table(['法域','建议','理由','阻断项','人类记录'],[[x['jurisdiction'],x['recommendation'],x['rationale'],x['blocking_ids'],x['human_approval_source_ids']] for x in d['decisions']]),'## 未决问题',table(['ID','待补充/确认','等级','合规影响','建议','责任人','状态'],[[q['id'],q['question'],q['impact'],q.get('compliance_impact',''),q.get('recommendation',''),q['owner'],q['status']] for q in d['questions']]),'## 校验提示','\n'.join('- '+w for w in check['warnings']) or '结构检查未发现未决提示；不代表实体法律审核通过。']
    template=next(t for t in read(ROOT/'assets/template-maps.json')['templates'] if t['id']==d['meta']['template_id'])
    report+=['## 模板映射',template['id']+'｜'+template['status'],table(['栏目','规则','分析状态'],[[s,rs,{r:amap.get(r,{}).get('status','未选择或未评估') for r in rs if rr[r]['jurisdiction'] in [j['code'] for j in d['jurisdictions']]}] for s,rs in template['sections'].items()])]
    evidence=['# 事实与法律评估底稿','## 材料目录',table(['ID','标题','版本','路径/定位','日期'],[[s['id'],s['title'],s['version'],s['uri']+' — '+s['locator'],s['observed_at']] for s in d['sources']]),'## 数据事实',table(['ID/活动','生命周期/要素','内容','范围','证据/实施状态','评估影响','来源','说明'],[[f['id']+'/'+(f['activity_id'] or 'project'),f.get('lifecycle_stage','')+'/'+f.get('element',''),{f['predicate']:f['value']},f['context'],f['status']+'/'+f['implementation'],f.get('assessment_impact',''),f['source_ids'],f['note']] for f in d['facts']]),'## 数据流',table(['ID/活动','来源→去向','操作/字段','地域','事实'],[[f['id']+'/'+f['activity_id'],f['from']+' → '+f['to'],[f['operation'],f['data_fields']],f['regions'],f['fact_ids']] for f in d['flows']]),'## 全部规则记录',table(['规则','状态','论证','事实','法源','复核'],[[a['rule_id'],a['status'],a['analysis'],a['fact_ids'],a['source_refs'],a['reviewer_record_source_ids']] for a in d['rule_assessments']]),'## 控制证据',table(['ID','措施','状态','实施证据','验证证据','验收'],[[c['id'],c['description'],c['status'],c['implementation_evidence'],c['verification_evidence'],c['acceptance']] for c in d['controls']]),'## 法源注册表',table(['ID','原文','版本/效力','读取状态/限制'],[[s['id'],s['url'],s['version']+'/'+s['legal_force'],s['verification_status']+'; '+s['limitations']] for s in read(ROOT/'references/sources.json')['sources']])]
    actions=['# 整改与决策清单',table(['ID','风险/规则','动作','责任人','期限','验收','状态/证据'],[[a['id'],[a['risk_ids'],a['rule_ids']],a['description'],a['owner'],a['due'],a['acceptance'],[a['status'],a['evidence_source_ids']]] for a in d['actions']]),'## 关联专项',table(['ID','法域/类型','状态','理由','成果'],[[x['id'],x['jurisdiction']+'/'+x['type'],x['status'],x['rationale'],x['source_ids']] for x in d['linked_assessments']]),'## 变更记录',table(['ID','日期','变化','受影响'],[[x['id'],x['date'],x['description'],x['affected_ids']] for x in d['changes']])]
    out.mkdir(parents=True,exist_ok=True)
    for name,content in zip(names,['\n\n'.join(report),'\n\n'.join(evidence),'\n\n'.join(actions),dumps(d),dumps(check)]):
        (out/name).write_text(content+'\n',encoding='utf-8')
    return [str((out/n).resolve()) for n in names]

def render(d,out,workpapers=False):
    from legal_report import render_report
    gate=fact_gate_errors(d)
    if gate:raise ValueError('; '.join(gate))
    check=validate(d)
    if check['errors']:raise ValueError('Validation failed: '+ '; '.join(check['errors']))
    dest=Path(out)/'DPIA-report.md'
    if dest.exists():raise ValueError('Output already exists; choose a new version directory')
    content=render_report(d)
    dest.parent.mkdir(parents=True,exist_ok=True)
    with dest.open('x',encoding='utf-8') as f:f.write(content)
    files=[str(dest.resolve())]
    if workpapers:files+=render_workpapers(d,Path(out)/'workpapers')
    return files

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='cmd',required=True)
    a=sub.add_parser('init');a.add_argument('path');a.add_argument('--project',required=True);a.add_argument('--jurisdictions',nargs='+',choices=['EU'],default=['EU'])
    for cmd in ['validate','screen']:
        a=sub.add_parser(cmd);a.add_argument('path')
    a=sub.add_parser('fact-list');a.add_argument('path');a.add_argument('--out',required=True);a.add_argument('--source-index');a.add_argument('--intake-review')
    a=sub.add_parser('internal-review');a.add_argument('path');a.add_argument('--out',required=True);a.add_argument('--source-index',required=True);a.add_argument('--intake-review',required=True);a.add_argument('--conditional-basis',default='')
    a=sub.add_parser('source-index');a.add_argument('path');a.add_argument('--source-id',action='append',required=True);a.add_argument('--out',required=True)
    a=sub.add_parser('render');a.add_argument('path');a.add_argument('--out',required=True);a.add_argument('--workpapers',action='store_true')
    a=sub.add_parser('diff');a.add_argument('old');a.add_argument('new')
    a=sub.add_parser('revise');a.add_argument('old');a.add_argument('edited');a.add_argument('--out',required=True)
    args=p.parse_args()
    try:
        if args.cmd=='init':
            dest=Path(args.path);dest.parent.mkdir(parents=True,exist_ok=True)
            with dest.open('x',encoding='utf-8') as f:f.write(dumps(initialize(args.project,args.jurisdictions))+'\n')
            print(dumps({'created':str(dest.resolve())}));return 0
        if args.cmd=='revise':
            d,change=gdpr_workflow.revise(read(args.old),read(args.edited))
            dest=Path(args.out);dest.parent.mkdir(parents=True,exist_ok=True)
            with dest.open('x',encoding='utf-8') as f:f.write(dumps(d)+'\n')
            print(dumps({'created':str(dest.resolve()),'assessment_id':d['meta']['assessment_id'],'revision_id':d['meta']['revision_id'],'changes':change}));return 0
        if args.cmd=='diff':
            old,new=read(args.old),read(args.new)
            for d in [old,new]:
                e=schema_errors(d,read(ROOT/'schemas/assessment.schema.json'))
                if e:raise ValueError('; '.join(e))
            print(dumps(diff(old,new)));return 0
        d=read(args.path);v=validate(d)
        if args.cmd=='validate':print(dumps(v));return 1 if v['errors'] else 0
        if args.cmd=='source-index':
            import source_trace
            content=source_trace.build_index(d,args.source_id)
            dest=Path(args.out);dest.parent.mkdir(parents=True,exist_ok=True)
            with dest.open('x',encoding='utf-8') as f:f.write(dumps(content)+'\n')
            print(dumps({'file':str(dest.resolve()),'passages':len(content['passages'])}));return 0
        if args.cmd=='fact-list':print(dumps({'file':write_fact_list(d,args.out,read(args.source_index) if args.source_index else None,read(args.intake_review) if args.intake_review else None)}));return 0
        if args.cmd=='internal-review':
            import internal_review
            print(dumps({'file':internal_review.write(d,read(args.source_index),read(args.intake_review),args.out,args.conditional_basis)}));return 0
        if v['errors']:print(dumps(v));return 1
        if args.cmd=='screen':print(dumps(screen(d)));return 0
        if args.cmd=='render':print(dumps({'files':render(d,args.out,workpapers=args.workpapers),'warnings':v['warnings']}));return 0
    except (OSError,ValueError,KeyError,IndexError,TypeError) as e:
        print(dumps({'error':str(e)}));return 2

if __name__=='__main__':sys.exit(main())
