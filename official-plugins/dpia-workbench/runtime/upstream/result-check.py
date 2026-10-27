"""Validate output with the bundled, unchanged Skill; never execute model code."""
import sys, json, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent/'skill/scripts'))
import dpia, source_trace, internal_review

def inventory(paths):
    objects={}; reports={}; errors=[]; bundles=[]
    for path in paths:
        p=Path(path)
        try:
            if p.suffix=='.md':reports[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
            else:objects[p.name]=json.loads(p.read_text())
        except Exception:errors.append(p.name+': unreadable')
    indexes={source_trace.digest(d):n for n,d in objects.items() if n.startswith('source-index')}
    for name,d in objects.items():
        if not name.startswith('assessment') or not isinstance(d.get('meta'),dict):continue
        snapshot=source_trace.snapshot(d)
        for tn,trace in objects.items():
            if not tn.startswith('intake-review') or trace.get('assessment_digest')!=snapshot:continue
            ix=indexes.get(trace.get('index_digest'))
            if not ix:continue
            files=dict(assessment=name,sourceIndex=ix,intake=tn)
            input_digest=source_trace.digest(dict(assessment=d,source_index=objects[ix],intake_review=trace))
            audits=[(n,a) for n,a in objects.items() if n.endswith('.audit.json') and a.get('revision_id')==d['meta']['revision_id'] and a.get('input_digest')==input_digest]
            matches=[(n,r) for n,a in audits for r,h in reports.items() if h==a.get('report_sha256')]
            if matches:
                for audit,report in matches:
                    f=dict(files,report=report,audit=audit);bundles.append(dict(key=source_trace.digest(f),files=f,revisionId=d['meta']['revision_id'],project=d['meta'].get('project'),stage=d['meta'].get('stage'),counts={k:len(d[k]) for k in ['facts','questions','risks','actions']}))
            elif not d['risks']:
                bundles.append(dict(key=source_trace.digest(files),files=files,revisionId=d['meta']['revision_id'],project=d['meta'].get('project'),stage=d['meta'].get('stage'),counts={k:len(d[k]) for k in ['facts','questions','risks','actions']}))
    return dict(bundles=bundles,errors=errors)

def delivery(d, trace):
    sc=trace.get('screening_conclusion'); errors=[]
    out={'kind':'partial_assessment' if d['risks'] else 'intake','screening_final':False}
    if sc:
        if not isinstance(sc,dict) or not isinstance(sc.get('rule_ids'),list):return out,['Screening conclusion needs rule references']
        authored={r['rule_id']:r for r in d['rule_assessments']}
        if not sc['rule_ids'] or any(r not in authored for r in sc['rule_ids']):errors.append('Screening rule references missing or unknown')
        allowed={'required','not_required','undetermined','outside_scope','no_trigger_identified_within_assessed_scope','applicability_unresolved','conflict_requires_review','exception_claim_requires_review','recommended_high_risk_review'}
        if sc.get('result') not in allowed:errors.append('Unknown screening conclusion')
        try:computed=dpia.screen(d);out['screening_final']=True
        except ValueError as e:computed=[];out['screening_limits']=str(e)
        if sc.get('result') in {'not_required','outside_scope','no_trigger_identified_within_assessed_scope'}:
            matching=[x for x in computed if x['jurisdiction']=='EU' and x['result'] in {'outside_scope','no_trigger_identified_within_assessed_scope'}]
            if not matching:errors.append('No-DPIA conclusion is not supported by confirmed screening scope and authored rules')
            if not str(sc.get('reason','')).strip() or not str(sc.get('reassessment_conditions','')).strip():errors.append('No-DPIA delivery needs screening reasons and reassessment conditions')
            out['kind']='screening_exit'
        elif sc.get('result')=='required':
            rules=dpia.rules()
            if not any(authored.get(r,{}).get('status')=='met' and rules.get(r,{}).get('kind')=='trigger' for r in sc['rule_ids']):errors.append('Required screening conclusion lacks an authored met trigger')
            if not d['risks']:out['kind']='screening'
    whole=[c for c in trace['checks'] if c.get('pause',{}).get('scope')=='assessment']
    if whole and not d['risks']:out['kind']='blocked';out['pause_reasons']=[c['pause']['reason'] for c in whole]
    out['screening']=sc
    return out,errors

def check(p):
    if 'inventory' in p:return inventory(p['inventory'])
    d,index,trace=(json.loads(Path(p[k]).read_text()) for k in ('assessment','sourceIndex','intake'))
    result=dpia.validate(d)
    if result['errors']:return result
    result['errors'] += source_trace.errors(d,index,trace)
    if result['errors']:return result
    result['delivery'],errors=delivery(d,trace);result['errors']+=errors
    if not d['risks']:
        summary=trace.get('screening_conclusion') or {}
        header='# 筛查与本轮交付\n\n本轮类型：'+result['delivery']['kind']+'\n筛查：'+str(summary.get('result','尚未确定'))+'\n理由：'+str(summary.get('reason','按下列已记录规则及事实范围核对'))+'\n复评条件：'+str(summary.get('reassessment_conditions','补充影响筛查的事实后复评'))+'\n'
        for r in d['rule_assessments']:
            if r['rule_id'] in summary.get('rule_ids',[]):header+='\n'+r['rule_id']+'：'+r['analysis']+'\n'
        result['delivery']['readable_report']=header+'\n'+source_trace.render(d,index,trace)
    if result['errors']:return result
    if p.get('report'):
        audit=json.loads(Path(p['audit']).read_text())
        report=Path(p['report']).read_text()
        expected={'assessment_id':d['meta']['assessment_id'],'revision_id':d['meta']['revision_id'],
            'input_digest':source_trace.digest(dict(assessment=d,source_index=index,intake_review=trace)),
            'report_sha256':hashlib.sha256(report.encode()).hexdigest(),'screening_conclusion':trace.get('screening_conclusion'),
            'source_index':index,'fact_links':trace['fact_links'],'checks':trace['checks'],
            'dimension_reviews':[x for x in d['rule_assessments'] if 'review' in x],
            'risk_links':[dict(id=r['id'],fact_ids=r['fact_ids'],control_ids=r['control_ids'],legal_refs=r['legal_refs']) for r in d['risks']],
            'action_links':[dict(id=a['id'],risk_ids=a['risk_ids'],rule_ids=a['rule_ids'],evidence_source_ids=a['evidence_source_ids']) for a in d['actions']]}
        for k,v in expected.items():
            if audit.get(k)!=v:result['errors'].append('Report audit mismatch: '+k)
        if not result['errors'] and report!=internal_review.render(d,index,trace,audit.get('conditional_basis','')):
            result['errors'].append('Report differs from recorded assessment and audit')
    elif d['risks']:result['errors'].append('Recorded risk analysis needs its readable report and audit')
    return result
if __name__=='__main__':
    try:
        print(json.dumps(check(json.load(sys.stdin)),ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'errors':[str(e)[:2000]],'warnings':[]},ensure_ascii=False))
        sys.exit(1)
