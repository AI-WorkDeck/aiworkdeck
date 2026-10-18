"""Partial GDPR review from recorded risks/actions, not a legal reasoning engine."""
from pathlib import Path

import gdpr_workflow
import source_trace


def render(d, index, trace, conditional_basis=''):
    from dpia import ROOT, read, validate, screen
    if not gdpr_workflow.enabled(d):
        raise ValueError('internal-review requires GDPR-v1')
    check = validate(d)
    if check['errors']:
        raise ValueError('; '.join(check['errors']))
    issues = source_trace.errors(d, index, trace)
    if issues:
        raise ValueError('; '.join(issues))
    if any(c.get('pause', {}).get('scope') == 'assessment' for c in trace['checks']):
        raise ValueError('Whole assessment is explicitly paused: resolve the foundational scope before delivering an internal risk review')
    if not d['risks']:
        raise ValueError('No recorded risks: do not deliver a narrative-only risk assessment; record supported risks/actions or remain at facts/screening without inventing risks')
    facts = {f['id']: f for f in d['facts']}
    for r in d['risks']:
        supported = [facts[f] for f in r['fact_ids'] if facts[f]['status'] in ['documented', 'confirmed', 'observed']]
        if not supported or not r['affected_people'].strip() or not r['target_assumptions'].strip():
            raise ValueError(r['id']+': risk needs supported facts, affected people and explicit target limitations')
        if len(supported) != len(r['fact_ids']) and r['gdpr_rating']['level'] != 'undetermined':
            raise ValueError(r['id']+': unresolved fact dependencies cannot support a determinate rating')
        linked = [a for a in d['actions'] if r['id'] in a['risk_ids']]
        if not linked or any(not a['description'].strip() or not a['acceptance'].strip() for a in linked):
            raise ValueError(r['id']+': each delivered risk needs linked actions and acceptance, including draft reviews')
    # A partial review is not routed through the complete fact-baseline/report gate.
    screening = None
    try:
        screening = screen(d)
    except ValueError:
        if not conditional_basis.strip():
            raise ValueError('Screening unresolved: provide an explicit --conditional-basis for limited analysis, or deliver the fact list; do not fabricate confirmation')
    if screening:
        result = screening[0]['result']
        if result in ['outside_scope', 'no_trigger_identified_within_assessed_scope']:
            raise ValueError('Screening closes this DPIA scope; use the screening conclusion instead of inventing an internal DPIA')
        if result != 'required' and not conditional_basis.strip():
            raise ValueError('Screening not required/settled; limited analysis needs --conditional-basis')
    legal = {s['id']: (s['title'], s['url']) for s in read(ROOT/'references/sources.json')['sources']}
    legal.update({s['id']: (s['title'], s['uri']) for s in d['sources']})
    import internal_report_view
    problems = internal_report_view.layout_errors(d, trace)
    if problems:
        raise ValueError('; '.join(problems))
    import internal_judgments
    problems = internal_judgments.dimension_errors(d, required=True)
    if problems:
        raise ValueError('; '.join(problems))
    statement = internal_judgments.screening_statement(d, trace, screening, conditional_basis)
    return internal_report_view.render(d, index, trace, statement, conditional_basis, legal)


def write(d, index, trace, out, conditional_basis=''):
    import hashlib
    import json
    content = render(d, index, trace, conditional_basis)
    dest = Path(out)
    audit_path = dest.with_suffix('.audit.json')
    if audit_path == dest or dest.exists() or audit_path.exists():
        raise FileExistsError('Report or technical index already exists; use a new version filename')
    audit = dict(
        assessment_id=d['meta']['assessment_id'], revision_id=d['meta']['revision_id'],
        input_digest=source_trace.digest(dict(assessment=d, source_index=index, intake_review=trace)),
        report_sha256=hashlib.sha256(content.encode('utf-8')).hexdigest(),
        screening_conclusion=trace.get('screening_conclusion'), conditional_basis=conditional_basis,
        dimension_reviews=[a for a in d['rule_assessments'] if 'review' in a],
        report_topics=trace['report_topics'], report_topic_limits=trace.get('report_topic_limits', {}), source_index=index,
        fact_links=trace['fact_links'], checks=trace['checks'],
        risk_links=[dict(id=r['id'], fact_ids=r['fact_ids'], control_ids=r['control_ids'],
                        legal_refs=r['legal_refs']) for r in d['risks']],
        action_links=[dict(id=a['id'], risk_ids=a['risk_ids'], rule_ids=a['rule_ids'],
                          evidence_source_ids=a['evidence_source_ids']) for a in d['actions']],
        pending_review_ids=d['meta'].get('pending_review_ids', []),
        warnings=__import__('dpia').validate(d)['warnings'],
        limitation='Record/presentation checks only; not proof of legal accuracy or evidence sufficiency')
    dest.parent.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        with dest.open('x', encoding='utf-8') as report:
            created.append(dest)
            with audit_path.open('x', encoding='utf-8') as technical:
                created.append(audit_path)
                report.write(content)
                technical.write(json.dumps(audit, ensure_ascii=False, indent=2)+'\n')
    except Exception:
        # Only clean files created by this call, never a pre-existing output.
        for path in created:
            path.unlink()
        raise
    return str(dest.resolve())
