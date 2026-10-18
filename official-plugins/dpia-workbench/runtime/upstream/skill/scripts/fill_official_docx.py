#!/usr/bin/env python3
"""Inspect/fill reviewed answer paragraphs in a DOCX; does not infer official provenance."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import zipfile
from lxml import etree as E

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}

def tag(s):
    return '{'+W+'}'+s

def load(path):
    raw = Path(path).read_bytes()
    with zipfile.ZipFile(path) as z:
        root = E.fromstring(z.read('word/document.xml'), E.XMLParser(resolve_entities=False, no_network=True))
    return hashlib.sha256(raw).hexdigest(), root

def paragraph_text(p):
    return ''.join('\n' if e.tag in (tag('br'), tag('cr')) else '\t' if e.tag == tag('tab') else (e.text or '') for e in p.iter() if e.tag in (tag('t'), tag('br'), tag('cr'), tag('tab')))

def inspect(path):
    sha, root = load(path)
    return {'sha256': sha, 'paragraphs': [{'paragraph': i, 'text': paragraph_text(p)} for i, p in enumerate(root.iter(tag('p')))]}

def fill(path, bindings, answers, out):
    path, out = Path(path), Path(out)
    if out.suffix.lower() != '.docx':
        raise ValueError('Output must be .docx')
    if out.exists() or out.resolve() == path.resolve():
        raise ValueError('Refuse to overwrite original or existing output')
    sha, root = load(path)
    if bindings['sha256'] != sha:
        raise ValueError('Template hash changed; inspect and remap')
    fields = bindings['fields']
    if not fields:
        raise ValueError('No fields mapped')
    keys = [f['key'] for f in fields]
    positions = [f['paragraph'] for f in fields]
    if len(keys) != len(set(keys)) or len(positions) != len(set(positions)):
        raise ValueError('Duplicate field or paragraph')
    if set(keys) != set(answers):
        raise ValueError('Answers must match mapped fields exactly')
    paragraphs = list(root.iter(tag('p')))
    # Reject complex content instead of silently deleting fields/images/checkboxes.
    allowed_children = {tag('pPr'), tag('r')}
    allowed_run = {tag('rPr'), tag('t'), tag('br'), tag('cr'), tag('tab')}
    for f in fields:
        i = f['paragraph']
        if type(i) is not int or i < 0 or i >= len(paragraphs):
            raise ValueError('Invalid paragraph index')
        p = paragraphs[i]
        if paragraph_text(p) != f['expected_text']:
            raise ValueError('Original text does not match binding')
        if any(x.tag not in allowed_children for x in p) or any(x.tag not in allowed_run for r in p.findall('w:r', NS) for x in r):
            raise ValueError('Complex paragraph; use document editing capability')
        if p.find('w:pPr/w:sectPr', NS) is not None:
            raise ValueError('Section boundary cannot be an answer field')
        value = answers[f['key']]
        if not isinstance(value, str) or not value.strip():
            raise ValueError('Empty answer; explicitly record unknown or not applicable')
        first_style = p.find('w:r/w:rPr', NS)
        for child in list(p):
            if child.tag != tag('pPr'):
                p.remove(child)
        r = E.SubElement(p, tag('r'))
        if first_style is not None:
            r.append(copy.deepcopy(first_style))
        for n, line in enumerate(value.split('\n')):
            if n:
                E.SubElement(r, tag('br'))
            t = E.SubElement(r, tag('t'))
            t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
            t.text = line
    modified = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as src, out.open('xb') as handle, zipfile.ZipFile(handle, 'w') as dest:
        for entry in src.infolist():
            dest.writestr(entry, modified if entry.filename == 'word/document.xml' else src.read(entry.filename))
    return {'filled_fields': len(fields), 'template_sha256': sha, 'out': str(out.resolve()), 'legal_review': 'required', 'visual_review': 'required'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('inspect'); p.add_argument('original'); p.add_argument('--out', required=True)
    p = sub.add_parser('fill'); p.add_argument('original'); p.add_argument('bindings'); p.add_argument('answers'); p.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        if args.cmd == 'inspect':
            with Path(args.out).open('x', encoding='utf-8') as f:
                json.dump(inspect(args.original), f, ensure_ascii=False, indent=2)
        else:
            print(json.dumps(fill(args.original, json.loads(Path(args.bindings).read_text()), json.loads(Path(args.answers).read_text()), args.out), ensure_ascii=False))
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, E.XMLSyntaxError) as e:
        parser.exit(2, str(e)+'\n')

if __name__ == '__main__':
    main()
