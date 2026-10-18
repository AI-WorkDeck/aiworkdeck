#!/usr/bin/env python3
"""Populate the bundled user-supplied EDPB consultation DOCX, preserving its original text."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E

ROOT=Path(__file__).resolve().parents[1]
ORIGINAL=ROOT/'assets/official/edpb-2026-v1-en.docx'
MAPPING=ROOT/'assets/official/edpb-2026-v1-map.json'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS={'w':W}

def wt(t):return '{'+W+'}'+t

def fill(answers,out):
    m=json.loads(MAPPING.read_text());out=Path(out)
    if out.suffix.lower()!='.docx' or out.exists():raise ValueError('Use a new .docx output path')
    if hashlib.sha256(ORIGINAL.read_bytes()).hexdigest()!=m['sha256']:raise ValueError('Original changed: review and remap')
    keys={f['key'] for f in m['fields']}
    if set(answers)!=keys:raise ValueError('Answer keys must match all original answer fields')
    if any(not isinstance(v,str) or not v.strip() for v in answers.values()):raise ValueError('Empty answer: explain pending information or non-applicability')
    with ZipFile(ORIGINAL) as z:
        root=E.fromstring(z.read('word/document.xml'),E.XMLParser(resolve_entities=False,no_network=True))
        tables=root.findall('w:body/w:tbl',NS)
        for f in m['fields']:
            cell=tables[f['table']].findall('w:tr',NS)[f['row']].findall('w:tc',NS)[f['cell']]
            if ''.join(cell.xpath('.//w:t/text()',namespaces=NS))!=f['expected_text']:raise ValueError('Cell anchor mismatch')
            # Keep all source instructions/options; fill a blank answer paragraph or add one.
            paragraphs=cell.findall('w:p',NS)
            if f['mode']=='blank':
                p=paragraphs[0]
                # Only remove empty runs; other original children remain untouched.
                for child in list(p):
                    if child.tag==wt('r') and not ''.join(child.itertext()).strip() and len(child)==0:p.remove(child)
            else:
                p=E.SubElement(cell,wt('p'))
            props=p.find('w:pPr',NS)
            if props is None:props=E.SubElement(p,wt('pPr'));p.remove(props);p.insert(0,props)
            # Explicit answer typography avoids inheriting checkbox fonts or justified labels.
            spacing=props.find('w:spacing',NS)
            if spacing is None:spacing=E.SubElement(props,wt('spacing'))
            spacing.set(wt('before'),'60');spacing.set(wt('after'),'60')
            align=props.find('w:jc',NS)
            if align is None:align=E.SubElement(props,wt('jc'))
            align.set(wt('val'),'left')
            run=E.SubElement(p,wt('r'));pr=E.SubElement(run,wt('rPr'))
            fonts=E.SubElement(pr,wt('rFonts'))
            for attr,val in [('ascii','Arial'),('hAnsi','Arial'),('eastAsia','Noto Sans CJK SC')]:fonts.set(wt(attr),val)
            size=E.SubElement(pr,wt('sz'));size.set(wt('val'),'20')
            color=E.SubElement(pr,wt('color'));color.set(wt('val'),'000000')
            bold=E.SubElement(pr,wt('b'));bold.set(wt('val'),'0')
            value=('Response: ' if f['mode']=='append' else '')+answers[f['key']]
            for i,line in enumerate(value.split('\n')):
                if i:E.SubElement(run,wt('br'))
                text=E.SubElement(run,wt('t'));text.set('{http://www.w3.org/XML/1998/namespace}space','preserve');text.text=line
            # Exact heights in a source template can silently clip substantive answers.
            row=cell.getparent()
            for height in row.findall('w:trPr/w:trHeight',NS):
                if height.get(wt('hRule'))=='exact':height.set(wt('hRule'),'atLeast')
        # Preserve source pagination intent without standalone break paragraphs creating blank pages.
        body=root.find('w:body',NS)
        for p in list(body)[23:]:
            if p.tag!=wt('p') or p.find('w:pPr/w:sectPr',NS) is not None:continue
            if p.xpath('.//w:t|.//w:drawing|.//w:fldChar',namespaces=NS):continue
            breaks=p.findall('.//w:br',NS)
            if any(b.get(wt('type'))=='page' for b in breaks):
                following=p.getnext()
                while following is not None and following.tag==wt('p') and not following.xpath('.//w:t',namespaces=NS):following=following.getnext()
                if following is not None and following.tag==wt('p'):
                    props=following.find('w:pPr',NS)
                    if props is None:props=E.Element(wt('pPr'));following.insert(0,props)
                    if props.find('w:pageBreakBefore',NS) is None:E.SubElement(props,wt('pageBreakBefore'))
                    for b in breaks:
                        if b.get(wt('type'))=='page':b.getparent().remove(b)
            props=p.find('w:pPr',NS)
            if props is None:props=E.Element(wt('pPr'));p.insert(0,props)
            spacing=props.find('w:spacing',NS)
            if spacing is None:spacing=E.SubElement(props,wt('spacing'))
            for k,v in [('before','0'),('after','0'),('line','20'),('lineRule','exact')]:spacing.set(wt(k),v)
        for ti,t in enumerate(tables):
            if ti in [0,1,3,4,5,9,23,24,26,30,31,32,33,34]:continue
            row=t.find('w:tr',NS);props=row.find('w:trPr',NS)
            if props is None:props=E.Element(wt('trPr'));row.insert(0,props)
            if props.find('w:tblHeader',NS) is None:E.SubElement(props,wt('tblHeader'))
        xml=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
        out.parent.mkdir(parents=True,exist_ok=True)
        with out.open('xb') as h,ZipFile(h,'w') as dest:
            for entry in z.infolist():dest.writestr(entry,xml if entry.filename=='word/document.xml' else z.read(entry.filename))
    return {'filled_answer_cells':len(keys),'out':str(out.resolve()),'template_status':'public consultation v1.0','requires':'substantive review, checkbox review, TOC update and page rendering'}

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='cmd',required=True)
    a=sub.add_parser('blank-answers');a.add_argument('--out',required=True)
    a=sub.add_parser('fill');a.add_argument('answers');a.add_argument('--out',required=True)
    args=p.parse_args()
    try:
        if args.cmd=='blank-answers':
            m=json.loads(MAPPING.read_text())
            with Path(args.out).open('x',encoding='utf-8') as f:json.dump({x['key']:'' for x in m['fields']},f,ensure_ascii=False,indent=2)
        else:print(json.dumps(fill(json.loads(Path(args.answers).read_text()),args.out),ensure_ascii=False))
    except (OSError,ValueError,KeyError) as e:p.exit(2,str(e)+'\n')

if __name__=='__main__':main()
