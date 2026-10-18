"""GDPR-v1 identity and scoped screening checks; never authors legal judgments."""
import copy
import hashlib
import json
from datetime import date
from uuid import uuid4

VERSION = 'gdpr-v1'


def enabled(d):
    return d.get('meta', {}).get('workflow_version') == VERSION and d['meta'].get('schema_version') == '0.5.0'


def identity():
    return dict(workflow_version=VERSION, assessment_id=str(uuid4()),
                revision_id=str(uuid4()), parent_revision_id=None,
                related_assessment_id=None, pending_review_ids=[],
                risk_method='wp248-qualitative-v1')


def screening_digest(d, fact_ids):
    """Snapshot selected evidence and scope, not the entire future DPIA plan."""
    facts = sorted((f for f in d['facts'] if f['id'] in fact_ids), key=lambda f: f['id'])
    sources = {s for f in facts for s in f['source_ids']}
    sources.update(s for c in d['meta']['countries'] for s in c['source_ids'])
    scope = {k:d['meta'].get(k) for k in ['assessment_id','scope','excluded_scope','environment','rule_pack_versions']}
    scope['countries'] = [{k:c.get(k) for k in ['code','name','status','source_ids']} for c in d['meta']['countries']]
    payload = dict(facts=facts, sources=sorted((s for s in d['sources'] if s['id'] in sources), key=lambda s: s['id']),
                   activities=d['activities'], scope=scope)
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def screening_errors(d):
    from dpia import validate
    errors = validate(d)['errors']
    c = d['meta'].get('screening_confirmation', {})
    facts = {f['id']: f for f in d['facts']}
    sources = {s['id']: s for s in d['sources']}
    ids = c.get('fact_ids', [])
    if not ids or len(ids) != len(set(ids)):
        errors.append('screening needs an explicit unique confirmed fact scope')
    if not d['activities']:
        errors.append('screening needs processing activities')
    for fid in ids:
        f = facts.get(fid, {})
        if f.get('status') not in ['documented','confirmed','observed'] or not f.get('source_ids'):
            errors.append('screening fact unresolved or unsupported: '+fid)
    if not c.get('source_ids') or any(sources.get(s, {}).get('kind') != 'human_confirmation' for s in c.get('source_ids', [])):
        errors.append('screening needs actual user confirmation source')
    if c.get('digest') != screening_digest(d, ids):
        errors.append('screening confirmation missing/stale; confirm changed scope')
    return errors


def validation_errors(d):
    from dpia import read, ROOT
    from internal_judgments import dimension_errors
    m = d['meta']; errors = []
    if [j['code'] for j in d['jurisdictions']] != ['EU']:
        errors.append('GDPR-v1 supports EU only; other packs are historical')
    for key in ['assessment_id','revision_id']:
        if not m.get(key, '').strip(): errors.append('missing stable '+key)
    if m.get('parent_revision_id') == m.get('revision_id'):
        errors.append('revision cannot be its own parent')
    if m.get('related_assessment_id') == m.get('assessment_id'):
        errors.append('related assessment must be a different assessment')
    if m.get('risk_method') != 'wp248-qualitative-v1':
        errors.append('GDPR-v1 must not use the legacy automatic matrix')
    if m['stage'] == 'review_ready' and m.get('pending_review_ids'):
        errors.append('changed dependencies still await review')
    official = {s['id'] for s in read(ROOT/'references/sources.json')['sources']}
    sources = official | {s['id'] for s in d['sources']}
    for r in d['risks']:
        prefix = r['id']+': '
        if not r.get('legal_analysis', '').strip() or not r.get('legal_refs'):
            errors.append(prefix+'risk needs specific law and fact-to-risk legal analysis')
        for ref in r.get('legal_refs', []):
            if ref['source_id'] not in sources or not ref['locator'].strip():
                errors.append(prefix+'risk legal reference missing')
        g = r.get('gdpr_rating', {})
        if g.get('level') not in ['high','not_high','undetermined'] or any(not g.get(k, '').strip() for k in
                ['likelihood_reason','severity_reason','rationale','measures_reason']):
            errors.append(prefix+'risk needs likelihood, severity, level reasons and measures')
        if any(r[p][k] is not None for p in ['baseline','current','target'] for k in ['likelihood','severity']):
            errors.append(prefix+'do not mix legacy numeric ratings with GDPR qualitative assessment')
        if m['stage'] == 'review_ready' and not any(r['id'] in a['risk_ids'] for a in d['actions']):
            errors.append(prefix+'risk needs linked action and acceptance criteria')
    return errors + dimension_errors(d)


def revise(old, edited):
    from dpia import diff, validate
    if not enabled(old) or not enabled(edited):
        raise ValueError('Explicitly migrate legacy records before revising; do not infer assessment identity')
    if old['meta']['assessment_id'] != edited['meta']['assessment_id']:
        raise ValueError('Different assessments: do not silently merge')
    # An edited frozen snapshot is expected to be stale; draft it before validation instead.
    d = copy.deepcopy(edited)
    d['meta'].update(stage='draft', fact_baseline_status='building')
    d['decisions'] = []  # The edited snapshot may have invalidated its old recommendation.
    errors = validate(d)['errors']
    if errors: raise ValueError('; '.join(errors))
    change = diff(old, d)
    m = d['meta']
    m.update(revision_id=str(uuid4()), parent_revision_id=old['meta']['revision_id'],
             assessed_at=str(date.today()), pending_review_ids=change['reassess'],
             fact_baseline_source_ids=[])
    m['fact_baseline_version'] = m['revision_id']
    m.pop('fact_baseline_digest', None)
    m.pop('screening_confirmation', None)
    affected = set(change['reassess'])
    for r in d['rule_assessments']:
        if r['rule_id'] in affected: r.update(status='unknown', analysis='变更后待复评；原论证见上一版本')
    for r in d['risks']:
        if r['id'] in affected and 'gdpr_rating' in r:
            r['gdpr_rating'].update(level='undetermined', rationale='变更后待复评；原评级见上一版本')
    for a in d['actions']:
        if a['id'] in affected and a['status'] == 'closed':a['status'] = 'open'
    # Human approvals remain in the immutable old snapshot, never inherited as new approval.
    d['decisions'] = []
    return d, change
