"""Typed evidence dependencies, not an automated legal sufficiency opinion."""
import hashlib
import json
from pathlib import Path

SCHEMA = Path(__file__).resolve().parents[1]/'schemas/assessment-plan.schema.json'


def requirement_scope(r):
    return r['scope_activity_ids'] if 'scope_activity_ids' in r else [r['activity_id']]


def resolved_requirements(plan, question):
    """Resolve only explicit uses; never extend a shared definition's scope."""
    library={r['id']:r for r in plan.get('shared_requirements',[])}
    result=list(question['requirements'])
    for ref in question.get('requirement_refs',[]):
        r=library.get(ref['requirement_id'])
        if r is not None:
            result.append(dict(r,scope_activity_ids=ref['activity_ids'],importance=ref['importance']))
    return result


def baseline_digest(d):
    """Invalidate confirmation when evidence, scope, phase or requirements change."""
    payload = {k:d.get(k) for k in ['sources','facts','activities','flows','controls','questions','assessment_plan','jurisdictions']}
    payload['meta'] = {k:d['meta'].get(k) for k in ['scope','excluded_scope','countries','environment','fact_baseline_version','rule_pack_versions','template_id']}
    return hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def structural_errors(d, rules):
    from dpia import schema_errors
    if 'assessment_plan' not in d:return ['assessment_plan missing']
    plan=d['assessment_plan']
    errors=schema_errors(plan,json.loads(SCHEMA.read_text()),'assessment_plan')
    if errors:return errors
    ids={x['id'] for k in ['sources','facts','activities','flows','controls','risks','actions','questions','linked_assessments','changes'] for x in d[k]}|set(rules)
    activities={a['id'] for a in d['activities']};facts={f['id']:f for f in d['facts']}
    selected={a['rule_id'] for a in d['rule_assessments']}
    extended=plan.get('contract_version')=='1.1'
    if not extended and ('shared_requirements' in plan or any('requirement_refs' in q for q in plan['questions']) or any('coverage_level' in s for s in plan['rule_scopes'])):
        errors.append('shared/project references require assessment_plan.contract_version 1.1')
    library={}
    def register(x):
        if not x['id'].strip() or x['id'] in ids:errors.append('duplicate/empty plan ID: '+x['id'])
        ids.add(x['id'])
    def check_requirement(r):
        if not r['description'].strip() or not r['predicate'].strip() or not r['rationale'].strip():errors.append(r['id']+': requirement definition/reason missing')
        if not r['accepted_implementation'] or not r['accepted_source_kinds']:errors.append(r['id']+': evidence acceptance criteria empty')
        if set(r['fact_ids'])-set(facts):errors.append(r['id']+': unknown fact reference')
        if r['status']=='missing' and not r['followup'].strip():errors.append(r['id']+': missing fact needs actionable followup')
        if r['status']!='missing':errors.extend(evidence_errors(r,facts,{s['id']:s for s in d['sources']}))
    for r in plan.get('shared_requirements',[]):
        register(r);library[r['id']]=r
        scope=r['scope_activity_ids']
        if not scope or len(scope)!=len(set(scope)) or set(scope)-activities:errors.append(r['id']+': shared requirement needs explicit unique activity scope')
        check_requirement(r)
    scopes={}
    for scope in plan['rule_scopes']:
        rid=scope['rule_id']
        if rid in scopes or rid not in selected or rid not in rules:errors.append(rid+': duplicate/unknown rule scope')
        scopes[rid]=scope
        if not scope['activity_ids'] or set(scope['activity_ids'])-activities or not scope['rationale'].strip():errors.append(rid+': rule scope needs activities and reason')
        if set(scope['fact_ids'])-set(facts):errors.append(rid+': rule scope references unknown facts')
        if scope.get('coverage_level','activity')=='project' and not rules.get(rid,{}).get('project_procedure',False):errors.append(rid+': rule pack does not allow project procedure coverage')
    for q in plan['questions']:
        for x in [q]+q['requirements']:
            register(x)
        if not q['question'].strip() or not q['phases'] or not q['activity_ids'] or not (q['requirements'] or q.get('requirement_refs')):errors.append(q['id']+': question/scope/phases/requirements empty')
        if set(q['activity_ids'])-activities:errors.append(q['id']+': unknown activity scope')
        for b in q['rule_bindings']:
            if b['rule_id'] not in selected or b['required_fact'] not in rules.get(b['rule_id'],{}).get('required_facts',[]):errors.append(q['id']+': invalid rule requirement binding')
            if b['rule_id'] in scopes and set(q['activity_ids'])-set(scopes[b['rule_id']]['activity_ids']):errors.append(q['id']+': binding outside reviewed rule scope')
            s=scopes.get(b['rule_id'],{})
            if s.get('coverage_level')=='project' and set(q['activity_ids'])!=set(s['activity_ids']):errors.append(q['id']+': project procedure must explicitly address its entire affected activity scope')
        for r in q['requirements']:
            if r['activity_id'] not in q['activity_ids']:errors.append(r['id']+': requirement outside question scope')
            check_requirement(r)
        seen=set()
        for ref in q.get('requirement_refs',[]):
            rid=ref['requirement_id'];r=library.get(rid)
            if r is None:errors.append(q['id']+': unknown shared requirement '+rid)
            if rid in seen:errors.append(q['id']+': duplicate shared requirement use '+rid)
            seen.add(rid)
            scope=ref['activity_ids']
            if not scope or len(scope)!=len(set(scope)) or set(scope)-set(q['activity_ids']) or (r and set(scope)-set(r['scope_activity_ids'])):errors.append(q['id']+': shared reference outside explicit scope')
            if not ref['rationale'].strip():errors.append(q['id']+': shared reference needs use rationale')
    return errors


def evidence_errors(r, facts, sources):
    errors=[]
    if not r['fact_ids']:return [r['id']+': sufficiency/not-applicable lacks facts']
    for fid in r['fact_ids']:
        f=facts.get(fid,{})
        if not f:continue  # Structural check reports dangling references.
        scope=f.get('scope_activity_ids',[]) if f['activity_id'] is None else [f['activity_id']]
        if set(requirement_scope(r))-set(scope) or f['predicate']!=r['predicate']:errors.append(r['id']+': fact scope/predicate mismatch: '+fid)
        v=f['value'];typ=r['value_type']
        matches={'string':isinstance(v,str) and bool(v.strip()),'boolean':type(v) is bool,'integer':type(v) is int,'number':type(v) in (int,float),'array':isinstance(v,list) and bool(v),'object':isinstance(v,dict) and bool(v)}
        if not matches[typ]:errors.append(r['id']+': fact value type/empty mismatch: '+fid)
        if f['status'] not in ['documented','confirmed','observed']:errors.append(r['id']+': unresolved evidence: '+fid)
        if f['implementation'] not in r['accepted_implementation']:errors.append(r['id']+': implementation not sufficient: '+fid)
        if not any(sources.get(s,{}).get('kind') in r['accepted_source_kinds'] for s in f['source_ids']):errors.append(r['id']+': source kind not sufficient: '+fid)
        if r['status']=='not_applicable' and (type(v) is not bool or v is not False):errors.append(r['id']+': not-applicable requires an evidenced negative boolean fact')
    return errors


def coverage_state(d, rules):
    """Structural validation must precede this calculation. Counts are not obligations."""
    p=d['assessment_plan'];scopes={s['rule_id']:s for s in p['rule_scopes']}
    expected=set();declared=set();covered=set();errors=[]
    for s in scopes.values():
        units=['@project'] if s.get('coverage_level')=='project' else s['activity_ids']
        expected.update((aid,s['rule_id'],t) for aid in units for t in rules[s['rule_id']]['required_facts'])
    for q in p['questions']:
        if p['phase'] not in q['phases']:continue
        reqs=resolved_requirements(p,q);supported=set()
        for aid in q['activity_ids']:
            decisive=[r for r in reqs if aid in requirement_scope(r) and r['importance']=='blocking']
            if not decisive:errors.append(q['id']+': no decisive fact requirement for '+aid)
            if decisive and all(r['status']!='missing' for r in decisive):supported.add(aid)
        for r in reqs:
            if r['importance']=='blocking' and r['status']=='missing':errors.append(r['id']+': required evidence missing for '+q['id'])
        for b in q['rule_bindings']:
            if scopes.get(b['rule_id'],{}).get('coverage_level')=='project':
                key=('@project',b['rule_id'],b['required_fact']);declared.add(key)
                if supported==set(q['activity_ids']):covered.add(key)
            else:
                declared.update((aid,b['rule_id'],b['required_fact']) for aid in q['activity_ids'])
                covered.update((aid,b['rule_id'],b['required_fact']) for aid in supported)
    return dict(expected=expected,declared=declared,covered=covered,errors=errors)


def gate_errors(d, rules):
    errors=structural_errors(d,rules)
    if errors:return errors
    m=d['meta'];p=d['assessment_plan'];sources={s['id']:s for s in d['sources']}
    if m.get('fact_baseline_status')!='frozen':errors.append('fact baseline not frozen; complete-assessment gate unmet, but supported partial analysis and explicitly incomplete drafts remain available under the workflow')
    if not m.get('fact_baseline_version'):errors.append('fact baseline version missing')
    if not m.get('fact_baseline_source_ids') or any(sources.get(s,{}).get('kind')!='human_confirmation' for s in m.get('fact_baseline_source_ids',[])):errors.append('fact baseline needs human confirmation record')
    if m.get('fact_baseline_digest')!=baseline_digest(d):errors.append('fact baseline confirmation digest missing/stale; reconfirm changed dependencies')
    if not any(c['status']=='confirmed' for c in m.get('countries',[])) or any(c['status']=='candidate' for c in m.get('countries',[])):errors.append('country scope unresolved')
    if p['status']!='reviewed':errors.append('assessment requirement plan not reviewed')
    if not d['activities'] or not d['facts']:errors.append('processing activity/fact baseline empty')
    coverage=coverage_state(d,rules);errors.extend(coverage['errors'])
    selected={j['code'] for j in d['jurisdictions']}
    scope_map={s['rule_id']:s for s in p['rule_scopes']}
    if set(scope_map)!={rid for rid,r in rules.items() if r['jurisdiction'] in selected}:errors.append('rule applicability scope plan incomplete')
    facts={f['id']:f for f in d['facts']}
    for s in p['rule_scopes']:
        if not s['fact_ids'] or any(facts[fid]['status'] not in ['documented','confirmed','observed'] or not facts[fid]['source_ids'] for fid in s['fact_ids']):errors.append(s['rule_id']+': rule scope lacks established evidence')
    missing=coverage['expected']-coverage['covered']
    if missing:errors.append(f'rule-to-fact coverage incomplete: {len(missing)} scope/rule/requirement bindings')
    # An authored conclusion may never introduce facts outside the reviewed inputs.
    inputs={fid for q in p['questions'] if p['phase'] in q['phases'] for r in resolved_requirements(p,q) if r['status']!='missing' for fid in r['fact_ids']}
    for a in d['rule_assessments']:
        if a['status']!='unknown' and set(a['fact_ids'])-inputs:errors.append(a['rule_id']+': conclusion references facts outside reviewed requirements')
    for x in d['risks']+d['jurisdictions']:
        if (x.get('applicability','applies')!='unknown') and set(x['fact_ids'])-inputs:errors.append(x.get('id',x.get('code'))+': analysis references facts outside reviewed requirements')
    return errors


def render_requirements(d):
    from dpia import table
    p=d.get('assessment_plan',{});rows=[]
    for q in p.get('questions',[]):
        for r in q['requirements']:
            rows.append([q['id']+' '+q['question'],r['description'],r['activity_id'], '本阶段' if p['phase'] in q['phases'] else '后续阶段',r['importance'],r['status'],r['fact_ids'],r['rationale'],r['followup']])
    text=('当前阶段：'+p.get('phase','待确认')+'；需求计划：'+p.get('status','building')+'。分类标签出现不等于事实充分；每项证据充分性仍须法律人员实质复核。\n\n'+table(['评估问题','所需事实','活动','阶段','对本问题影响','状态','事实来源ID','充分性/缺口影响','补充或验证建议'],rows))
    if p.get('shared_requirements'):
        text+='\n### 共用需求（定义一次，不自动扩展适用范围）\n\n'+table(['需求ID','所需事实','定义活动范围','状态','事实ID','充分性/缺口影响','补充或验证建议'],[[r['id'],r['description'],r['scope_activity_ids'],r['status'],r['fact_ids'],r['rationale'],r['followup']] for r in p['shared_requirements']])
        text+='\n### 问题对共用需求的引用\n\n'+table(['评估问题','需求ID','本次引用范围','阶段','对本问题影响','引用理由'],[[q['id']+' '+q['question'],r['requirement_id'],r['activity_ids'],'本阶段' if p['phase'] in q['phases'] else '后续阶段',r['importance'],r['rationale']] for q in p['questions'] for r in q.get('requirement_refs',[])])
    project=[s for s in p.get('rule_scopes',[]) if s.get('coverage_level')=='project']
    if project:text+='\n### 项目级程序范围（不替代逐活动实体评估）\n\n'+table(['规则','影响活动','范围依据','理由'],[[s['rule_id'],s['activity_ids'],s['fact_ids'],s['rationale']] for s in project])
    return text
