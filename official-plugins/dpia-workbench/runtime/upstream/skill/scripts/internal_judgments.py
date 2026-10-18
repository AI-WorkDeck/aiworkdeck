"""Validate authored screening/dimension records; do not author legal conclusions."""
PROGRESS = dict(not_started='尚未开展', partial='已开展，部分判断待补充', complete='本维度分析已完成')
FINDING = dict(issues_identified='已识别问题', no_issue_identified='评估范围内未识别问题',
               undetermined='结论未定', not_applicable='不适用')


def dimension_errors(d, required=False):
    from dpia import rules
    rr=rules(); out=[]; mapped=set()
    if required:
        expected={rid for rid,r in rr.items() if r['kind']=='content' and r['jurisdiction'] in {j['code'] for j in d['jurisdictions']}}
        missing=expected-{a['rule_id'] for a in d['rule_assessments']}
        if missing:out.append('Missing assessment dimensions: '+', '.join(sorted(missing)))
    risks={r['id'] for r in d['risks']}; actions={a['id'] for a in d['actions']}
    pending=set(d['meta'].get('pending_review_ids', []))
    for a in d['rule_assessments']:
        rid=a['rule_id']; v=a.get('review')
        if rr[rid]['kind']!='content':
            if v is not None:out.append(rid+': dimension review belongs only to content rules')
            continue
        if v is None:
            if required:out.append(rid+': explicitly record analysis progress/finding/remaining gap before internal delivery')
            continue
        for field, allowed in [('risk_ids',risks),('action_ids',actions)]:
            if not set(v[field])<=allowed or len(v[field])!=len(set(v[field])):
                out.append(rid+': invalid dimension '+field)
        mapped.update(v['risk_ids'])
        if rid in pending:continue  # Retained old work is displayed as pending, never a current conclusion.
        if a['analysis'].strip() in ['', '待评估', '待核实', 'unknown', 'pending']:
            out.append(rid+': authored finding or specific deferral reason required; no initialization placeholder')
        if not a['source_refs']:out.append(rid+': dimension needs legal references')
        progress=v['progress']; finding=v['finding']
        if progress!='complete' and not v['limitations'].strip():
            out.append(rid+': incomplete analysis needs the specific unresolved judgment/gap')
        if progress=='not_started' and (v['risk_ids'] or finding!='undetermined'):
            out.append(rid+': linked risk judgments cannot be described as not started')
        if progress!='not_started' and not (a['fact_ids'] or v['risk_ids'] or v['action_ids']):
            out.append(rid+': analysis needs evidence or linked assessed work')
        expected=('not_applicable' if finding=='not_applicable' else 'met') if progress=='complete' else None
        if (expected and a['status']!=expected) or (not expected and a['status'] not in ['unknown','not_met']):
            out.append(rid+': rule status must reflect analysis coverage, not whether remediation is done')
        if finding=='not_applicable' and progress!='complete':
            out.append(rid+': non-applicability needs completed analysis')
        if finding=='issues_identified' and not (v['risk_ids'] or v['action_ids']):
            out.append(rid+': identified issue needs traceable risk/remediation')
    if required and risks-mapped:
        out.append('Recorded risks not mapped to assessed dimensions: '+', '.join(sorted(risks-mapped)))
    return out


def screening_statement(d, trace, screening, conditional_basis):
    """Explicit displayed answer; typed fallback references existing legal analysis."""
    from dpia import rules
    rr=rules(); assessments={a['rule_id']:a for a in d['rule_assessments']}
    pending=set(d['meta'].get('pending_review_ids',[]))
    if screening and screening[0]['result']=='required':
        if trace.get('screening_conclusion',{}).get('result','required')!='required':
            raise ValueError('Displayed screening conclusion conflicts with confirmed screening; reconcile the records')
        return dict(result='required', conditional=False, rule_ids=screening[0]['met_triggers'])
    view=trace.get('screening_conclusion')
    if not isinstance(view,dict) or view.get('result') not in ['required','not_required','undetermined']:
        raise ValueError('Unsettled screening needs explicit screening_conclusion result and authored rule_ids; a limitation paragraph is not an answer')
    ids=view.get('rule_ids')
    if not isinstance(ids,list) or not ids or any(not isinstance(i,str) for i in ids) or len(ids)!=len(set(ids)):
        raise ValueError('screening_conclusion needs unique authored screening rule_ids')
    for rid in ids:
        a=assessments.get(rid)
        if (not a or rr[rid]['kind'] not in ['trigger','indicator','exception'] or not a['source_refs'] or
                not a['fact_ids'] or a['analysis'].strip() in ['', '待评估']):
            raise ValueError('Screening conclusion lacks recorded analysis/facts/law: '+rid)
    if view['result']=='not_required':
        raise ValueError('A no-DPIA conclusion belongs to screening closure, not an internal risk report; complete the scoped screening checks')
    if not conditional_basis.strip():
        raise ValueError('Unsettled screening must state concrete conditions/limits')
    if view['result']=='required':
        fs={f['id']:f for f in d['facts']}
        if any(j['applicability']=='does_not_apply' for j in d['jurisdictions']):
            raise ValueError('Cannot override established GDPR non-applicability')
        if assessments.get('EU-X01',{}).get('status')=='met':
            raise ValueError('Resolve asserted exception/trigger conflict before a conditional required conclusion')
        if not any(rr[rid]['kind']=='trigger' and assessments[rid]['status']=='met' and rid not in pending and
                   all(fs[fid]['status'] in ['documented','confirmed','observed'] for fid in assessments[rid]['fact_ids'])
                   for rid in ids):
            raise ValueError('Conditional required needs an authored supported complete trigger; indicators/counts or stale judgments alone are insufficient')
    return dict(result=view['result'], conditional=True, rule_ids=ids)
