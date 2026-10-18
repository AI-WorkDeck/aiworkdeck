"""Check report eligibility and artifact links, without asserting legal approval."""
import sys,json,copy,hashlib,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'skill/scripts'))
import dpia
p=json.load(sys.stdin)
try:
    if p['mode']=='pdfPages':
        from pypdf import PdfReader
        print(json.dumps({'pages':len(PdfReader(p['document']).pages)}));sys.exit(0)
    if p['mode']=='preflight':
        from zipfile import ZipFile
        from xml.etree import ElementTree as ET
        with ZipFile(p['document']) as z:
            infos=z.infolist()
            if len(infos)>10000 or sum(i.file_size for i in infos)>80_000_000:raise ValueError('DOCX exceeds extraction limit')
            for name in z.namelist():
                if name.endswith('.bin') or 'vbaProject' in name:raise ValueError('Executable embedded content is not allowed')
                if name.endswith('.rels'):
                    for relation in ET.fromstring(z.read(name)):
                        if relation.get('TargetMode')=='External' and not relation.get('Type','').endswith('/hyperlink'):raise ValueError('Linked external content must be embedded and verified before rendering')
        print(json.dumps({'errors':[]}));sys.exit(0)
    d=json.loads(Path(p['assessment']).read_text())
    if p['mode']=='eligibility':
        candidate=copy.deepcopy(d);candidate['meta']['stage']='review_ready'
        check=dpia.validate(candidate)
        print(json.dumps({'eligible':not check['errors'],'blockers':check['errors'],'warnings':check['warnings']},ensure_ascii=False))
    elif p['mode']=='docx':
        import check_report_docx
        bindings=json.loads(Path(p['bindings']).read_text())
        errors=check_report_docx.check(p['assessment'],p['document'],bindings)
        from zipfile import ZipFile
        from xml.etree import ElementTree as ET
        W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        with ZipFile(p['document']) as z:root=ET.fromstring(z.read('word/document.xml'))
        paragraphs=list(root.iter(W+'p'))
        def content(i):
            if type(i)!=int or not 0<=i<len(paragraphs):raise ValueError('Invalid report paragraph')
            return ''.join((t.text or '') if t.tag==W+'t' else '\n' if t.tag in [W+'br',W+'cr'] else '\t' for t in paragraphs[i].iter() if t.tag in [W+'t',W+'br',W+'cr',W+'tab']).strip()
        if p.get('language')=='en':
            ratings={r['id']:r['gdpr_rating']['level'] for r in d['risks']}
            for b in bindings['risks']:
                expected={'high':'high','not_high':'not high','undetermined':'undetermined'}[ratings[b['id']]]
                if content(b['rating_paragraph']).lower()==expected:
                    errors=[e for e in errors if e!=b['id']+': displayed rating differs from record']
        if p.get('review'):
            review=json.loads(Path(p['review']).read_text())
            if p.get('template'):
                mapping=json.loads(Path(p['templateMap']).read_text()) if p.get('templateMap') else {'fields':[]}
                original_language=p.get('templateLanguage') if p.get('templateLanguage')!='user_selected' else review.get('templateVerification',{}).get('originalLanguage')
                if not original_language:errors.append('Original template language not recorded')
                translated=original_language!=p.get('language')
                with ZipFile(p['template']) as source:original=ET.fromstring(source.read('word/document.xml'))
                original_tables=original.findall(W+'body/'+W+'tbl');actual_tables=root.findall(W+'body/'+W+'tbl')
                mapped={(f['table'],f['row'],f['cell']):f for f in mapping['fields']}
                if len(actual_tables)<len(original_tables):errors.append('Official template tables omitted')
                else:
                    for ti,table in enumerate(original_tables):
                        old_rows=table.findall(W+'tr');new_rows=actual_tables[ti].findall(W+'tr')
                        if len(new_rows)<len(old_rows):errors.append('Official template rows omitted');continue
                        for ri,row in enumerate(old_rows):
                            old_cells=row.findall(W+'tc');new_cells=new_rows[ri].findall(W+'tc')
                            if len(new_cells)<len(old_cells):errors.append('Official template cells omitted');continue
                            for ci,cell in enumerate(old_cells):
                                before=''.join(t.text or '' for t in cell.iter(W+'t')).strip()
                                after=''.join(t.text or '' for t in new_cells[ci].iter(W+'t')).strip()
                                f=mapped.get((ti,ri,ci))
                                option_count=sum(x.get(W+'font')=='Wingdings 2' and x.get(W+'char')=='F02A' for x in cell.iter(W+'sym'))
                                if option_count and f:
                                    authored=next((x for x in review['fields'] if x['key']==f['key']),{})
                                    selections=authored.get('selections',[])
                                    marks=[t.text for t in new_cells[ci].iter(W+'t') if t.text in ['☒','☐','[?]']]
                                    expected=[{'selected':'☒','not_selected':'☐','unknown':'[?]'}.get(x.get('status')) for x in sorted(selections,key=lambda x:x.get('index',-1))]
                                    if len(selections)!=option_count or {x.get('index') for x in selections}!=set(range(option_count)) or marks!=expected:errors.append(f['key']+': checkbox selections differ from the actual template')
                                    after=after.replace('☒','').replace('☐','').replace('[?]','')
                                if not translated and before and (not f or f['mode']=='append') and before not in after:errors.append(f'Template text changed or omitted at table {ti} row {ri} cell {ci}')
                    original_headings=[''.join(t.text or '' for t in el.iter(W+'t')).strip() for el in original.findall(W+'body/'+W+'p')]
                    actual_headings='\n'.join(''.join(t.text or '' for t in el.iter(W+'t')) for el in root.findall(W+'body/'+W+'p'))
                    for heading in original_headings:
                        if not translated and heading and heading not in actual_headings:errors.append('Official template heading/instruction omitted: '+heading[:100])
                if translated:
                    original_ps=list(original.iter(W+'p'));expected={i:''.join(t.text or '' for t in el.iter(W+'t')).strip() for i,el in enumerate(original_ps) if ''.join(t.text or '' for t in el.iter(W+'t')).strip()}
                    tb=review.get('translationBindings',[])
                    if len(tb)!=len(expected) or {x.get('sourceParagraph') for x in tb}!=set(expected) or len({x.get('paragraph') for x in tb})!=len(tb):errors.append('Translation does not cover original paragraph structure')
                    for item in tb:
                        actual=content(item['paragraph']);before=expected.get(item['sourceParagraph'],'')
                        if not actual or actual!=item.get('text','').strip():errors.append('Translated paragraph binding differs from actual Word')
                        if actual==before and not item.get('preserveReason','').strip():errors.append('Untranslated original text lacks a specific preservation reason')
                    tr=review.get('translationReview') or {}
                    if tr.get('status')!='pass' or not tr.get('notes','').strip():errors.append('Full translation review is missing')
            unknown={f['id']:f for f in bindings['unknown_fields']}
            for f in review['fields']:
                texts=[content(i) for i in f['paragraphs']]
                if f['status']=='unknown':
                    if f['key'] not in unknown or set(f['paragraphs'])!=set(unknown[f['key']]['answer_paragraphs']):errors.append(f['key']+': unknown answer has no matching local comment binding')
                    if f.get('category')=='signature' and f['key'] in unknown:
                        import re
                        label=content(unknown[f['key']]['label_paragraph'])
                        if not re.search(r'signature|signed by|formal validation date|approval date|签名|签字|签批日期|批准日期',label,re.I):errors.append(f['key']+': signature exception does not match the original field label')
                elif not any(texts):errors.append(f['key']+': answered field is blank')
                if 'answerSha256' in f:
                    answer_indices=f.get('answerParagraphs',[])
                    if not answer_indices or not set(answer_indices).issubset(set(f['paragraphs'])):errors.append(f['key']+': answer binding is missing')
                    elif hashlib.sha256(re.sub(r'\s+',' ','\n'.join(content(i) for i in answer_indices)).strip().encode()).hexdigest()!=f['answerSha256']:errors.append(f['key']+': authored answer changed or omitted')
            action_reviews=review.get('actions',[])
            if len(action_reviews)!=len(d['actions']) or {a.get('id') for a in action_reviews}!={a['id'] for a in d['actions']}:errors.append('Action report coverage differs from assessment')
            for a in action_reviews:
                if not a.get('paragraphs') or not any(content(i) for i in a['paragraphs']):errors.append(str(a.get('id'))+': action content is blank')
            for item in review['dimensions']:
                if not any(content(i) for i in item['paragraphs']):errors.append(item['ruleId']+': dimension content is blank')
        print(json.dumps({'errors':errors},ensure_ascii=False))
    else:raise ValueError('Unknown mode')
except Exception as e:
    print(json.dumps({'errors':[str(e)[:2000]],'eligible':False,'blockers':[str(e)[:2000]]},ensure_ascii=False));sys.exit(1)
