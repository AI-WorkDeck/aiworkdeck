"""Read-only record-to-DOCX checks; not legal, semantic or visual approval."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from zipfile import ZipFile
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
LABELS = {'high': {'高'}, 'not_high': {'非高'}, 'undetermined': {'未定', '待定'}}


def norm(value):
    return ''.join(value.split())


def check(assessment_path, docx_path, bindings):
    import dpia
    assessment_path, docx_path = Path(assessment_path), Path(docx_path)
    d = json.loads(assessment_path.read_text(encoding='utf-8'))
    errors = dpia.validate(d)['errors']
    if errors:
        return errors
    for key, path in [('assessment_sha256', assessment_path), ('docx_sha256', docx_path)]:
        if bindings[key] != hashlib.sha256(path.read_bytes()).hexdigest():
            errors.append(key+': stale file binding')
    for key in ['assessment_id', 'revision_id']:
        if bindings[key] != d['meta'][key]:
            errors.append(key+': mismatch')
    if errors:
        return errors
    legal = {s['id']: s['title'] for s in dpia.read(dpia.ROOT/'references/sources.json')['sources']}
    legal.update({s['id']: s['title'] for s in d['sources']})
    with ZipFile(docx_path) as z:
        root = ET.fromstring(z.read('word/document.xml'))
        comments = ET.fromstring(z.read('word/comments.xml')) if 'word/comments.xml' in z.namelist() else ET.Element('comments')
        notes = {}
        for kind in ['footnote', 'endnote']:
            part = 'word/'+kind+'s.xml'
            if part in z.namelist():
                for note in ET.fromstring(z.read(part)):
                    notes[(kind, note.get(W+'id'))] = ''.join(note.itertext())
    ps = list(root.iter(W+'p'))
    parents = {child: parent for parent in root.iter() for child in parent}

    def paragraph(i):
        if type(i) is not int or not 0 <= i < len(ps):
            raise ValueError('Invalid document paragraph index: '+str(i))
        return ps[i]

    def text(i, with_notes=False):
        p = paragraph(i)
        value = ''.join(t.text or '' for t in p.iter(W+'t'))
        if with_notes:
            for kind in ['footnote', 'endnote']:
                for r in p.iter(W+kind+'Reference'):
                    value += ' '+notes.get((kind, r.get(W+'id')), '')
        return value

    def row(i):
        p = paragraph(i)
        while p in parents:
            p = parents[p]
            if p.tag == W+'tr':
                return p
        return None

    risks = {r['id']: r for r in d['risks']}
    ids = [b['id'] for b in bindings['risks']]
    if set(ids) != set(risks) or len(ids) != len(set(ids)):
        return ['Risk bindings must cover every recorded risk exactly once']
    used = set()
    for b in bindings['risks']:
        rid = b['id']; r = risks[rid]
        start, end = b['start'], b['end']
        paragraph(start); paragraph(end)
        if start > end or not start <= b['rating_paragraph'] <= end:
            raise ValueError(rid+': invalid risk range/rating position')
        indices = set(range(start, end+1))
        if used & indices:
            errors.append(rid+': risk sections overlap; shared whole-document bindings are not allowed')
        used.update(indices)
        content = norm(' '.join(text(i, True) for i in range(start, end+1)))
        for ref in r['legal_refs']:
            if norm(legal[ref['source_id']]) not in content or norm(ref['locator']) not in content:
                errors.append(rid+': missing local legal citation '+ref['source_id']+' '+ref['locator'])
        if norm(text(b['rating_paragraph'])) not in LABELS[r['gdpr_rating']['level']]:
            errors.append(rid+': displayed rating differs from record')
        if rid in d['meta'].get('pending_review_ids', []):
            errors.append(rid+': stale risk must be reassessed or explicitly retained as pending outside this current-rating check')
    cm = {c.get(W+'id'): ''.join(t.text or '' for t in c.iter(W+'t')) for c in comments}
    starts, ends, refs = {}, {}, {}
    for i, p in enumerate(ps):
        for tag, dest in [('commentRangeStart', starts), ('commentRangeEnd', ends), ('commentReference', refs)]:
            for el in p.iter(W+tag):
                dest.setdefault(el.get(W+'id'), []).append(i)
    fields = bindings['unknown_fields']
    if len({f['id'] for f in fields}) != len(fields):
        errors.append('Duplicate unknown field binding')
    for f in fields:
        fid, label, answers, cid = f['id'], f['label_paragraph'], f['answer_paragraphs'], f['comment_id']
        paragraph(label)
        if not answers or len(set(answers)) != len(answers):
            raise ValueError(fid+': missing/duplicate answer positions')
        for i in answers:
            if norm(text(i)) or any(e.tag in {W+'drawing', W+'object', W+'sym', W+'fldChar'} for e in paragraph(i).iter()):
                errors.append(fid+': unknown answer is not blank')
            if not ((row(label) is not None and row(label) is row(i)) or
                    (row(label) is None and row(i) is None and abs(i-label) <= 1)):
                errors.append(fid+': label is not local to the actual answer field')
        allowed = {label, *answers}
        if (cid not in cm or len(starts.get(cid, [])) != 1 or len(ends.get(cid, [])) != 1 or
                len(refs.get(cid, [])) != 1 or not all(p in allowed for p in starts.get(cid, [])+ends.get(cid, [])+refs.get(cid, []))):
            errors.append(fid+': comment must be anchored at this field, not a remote questionnaire')
        for key in ['question', 'impact', 'recommendation']:
            if not f[key].strip() or norm(f[key]) not in norm(cm.get(cid, '')):
                errors.append(fid+': comment missing mapped '+key)
    return errors


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('assessment'); p.add_argument('docx'); p.add_argument('bindings')
    args = p.parse_args()
    try:
        errors = check(args.assessment, args.docx, json.loads(Path(args.bindings).read_text(encoding='utf-8')))
    except (OSError, ValueError, KeyError, TypeError, ET.ParseError) as e:
        errors = [str(e)]
    print(json.dumps({'errors': errors, 'scope': 'Recorded citations, ratings and mapped blank/comment anchors only; not legal or visual approval'}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
