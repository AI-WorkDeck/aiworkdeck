"""Preserve and fill native PDF templates. No legal conclusions or page-review claims."""
import hashlib, io, json, math, os, sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Text


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def identity(obj):
    ref = getattr(obj, 'indirect_reference', None)
    return (ref.idnum, ref.generation) if ref else id(obj)


def field_name(obj):
    parts, seen = [], set()
    while obj:
        obj = obj.get_object()
        if identity(obj) in seen:
            raise ValueError('Cyclic PDF field tree')
        seen.add(identity(obj))
        if obj.get('/T') is not None:
            parts.insert(0, str(obj['/T']))
        obj = obj.get('/Parent')
    return '.'.join(parts)


def inherited(obj, key):
    seen = set()
    while obj:
        obj = obj.get_object()
        if identity(obj) in seen:
            raise ValueError('Cyclic PDF field tree')
        seen.add(identity(obj))
        if key in obj:
            return obj[key]
        obj = obj.get('/Parent')
    return None


def inspect(reader):
    if reader.is_encrypted:
        raise ValueError('Encrypted PDF requires an unlocked source copy')
    if not 0 < len(reader.pages) <= 200:
        raise ValueError('PDF template page limit exceeded')
    root = reader.trailer['/Root']
    form = root.get('/AcroForm', {}).get_object() if root.get('/AcroForm') else {}
    if form.get('/XFA') or root.get('/OpenAction') or root.get('/AA'):
        raise ValueError('Active PDF content is not accepted')
    names = root.get('/Names', {}).get_object() if root.get('/Names') else {}
    if names.get('/JavaScript') or names.get('/EmbeddedFiles'):
        raise ValueError('PDF scripts or embedded files are not accepted')
    canonical, visited = {}, set()

    def visit(ref):
        obj = ref.get_object()
        if identity(obj) in visited:
            raise ValueError('Duplicate or cyclic PDF field tree')
        visited.add(identity(obj))
        name = field_name(obj)
        if obj.get('/T') is not None:
            if name in canonical:
                raise ValueError('Ambiguous duplicate PDF field: ' + name)
            canonical[name] = obj
        if inherited(obj, '/FT') == '/Sig' or obj.get('/AA') or obj.get('/A'):
            raise ValueError('Signature or active PDF fields require a separate workflow')
        for child in obj.get('/Kids', []):
            visit(child)

    for ref in form.get('/Fields', []):
        visit(ref)
    widgets, orphans = [], []
    for index, page in enumerate(reader.pages):
        if page.get('/AA'):
            raise ValueError('Active PDF page is not accepted')
        for ref in page.get('/Annots', []):
            obj = ref.get_object()
            if obj.get('/A') or obj.get('/AA') or obj.get('/Subtype') in ['/RichMedia', '/FileAttachment', '/Screen']:
                raise ValueError('Active PDF annotations are not accepted')
            if obj.get('/Subtype') != '/Widget':
                continue
            name = field_name(obj)
            if not name or inherited(obj, '/FT') == '/Sig':
                raise ValueError('Unnamed or signature widget requires a separate workflow')
            top, chain = obj, set()
            while top:
                top = top.get_object()
                chain.add(identity(top))
                top = top.get('/Parent')
            if name in canonical and identity(canonical[name]) not in chain:
                raise ValueError('Widget conflicts with canonical PDF field: ' + name)
            if not chain.intersection(visited):
                # reattach_fields cannot repair arbitrary detached parent hierarchies.
                if obj.get('/Parent') or name in orphans:
                    raise ValueError('Ambiguous orphan PDF field: ' + name)
                orphans.append(name)
            widgets.append({'page': index, 'name': name, 'type': str(inherited(obj, '/FT')), 'rect': list(map(float, obj['/Rect'])), 'object': obj})
    return {'pages': [{'page': i, 'box': list(map(float, p.mediabox)), 'rotation': p.rotation, 'text': (p.extract_text() or '')[:100000]} for i, p in enumerate(reader.pages)], 'widgets': widgets, 'orphans': orphans}


def public_inspection(info):
    return {**info, 'widgets': [{k: v for k, v in w.items() if k != 'object'} for w in info['widgets']]}


def rect(value, page):
    if not isinstance(value, list) or len(value) != 4 or any(type(n) not in [int, float] or not math.isfinite(n) for n in value):
        raise ValueError('PDF field requires four finite coordinates')
    x0, y0, x1, y1 = value
    box = list(map(float, page.mediabox))
    if not (box[0] <= x0 < x1 <= box[2] and box[1] <= y0 < y1 <= box[3]):
        raise ValueError('PDF field is outside its original page')
    return value


def appearance(widget):
    normal = widget.get('/AP', {}).get('/N')
    if normal is None:
        return False
    normal = normal.get_object()
    if hasattr(normal, 'get_data'):
        return bool(normal.get_data())
    state = widget.get('/AS')
    return state in normal and bool(normal[state].get_object().get_data())


def verify_values(reader, values):
    fields = reader.get_fields() or {}
    info = inspect(reader)
    for name, expected in values.items():
        if name not in fields or str(fields[name].get('/V', '')) != expected:
            raise ValueError('Canonical PDF value differs: ' + name)
        widgets = [w for w in info['widgets'] if w['name'] == name]
        if not widgets or any(str(inherited(w['object'], '/V') or '') != expected or not appearance(w['object']) for w in widgets):
            raise ValueError('Widget value or appearance differs: ' + name)


def fill(job, content, out):
    original = Path(job['templatePath'])
    if sha(original) != job['templateSha256'] or content.get('basisDigest') != job['basisDigest']:
        raise ValueError('Native PDF basis changed')
    original_language = content.get('templateVerification', {}).get('originalLanguage')
    if not original_language or original_language != job['language']:
        raise ValueError('Native PDF retains its source language; select that language')
    reader = PdfReader(original); info = inspect(reader)
    fields = content.get('fields', []); keys = [f['key'] for f in fields]
    coverage = content.get('pdfPages', [])
    if not fields or len(keys) != len(set(keys)) or len(coverage) != len(reader.pages) or {p.get('page') for p in coverage} != set(range(len(reader.pages))):
        raise ValueError('All native PDF pages and unique fields require an explicit review map')
    writer = PdfWriter(); writer.clone_document_from_reader(reader)
    if info['orphans']:
        writer.reattach_fields()
    known = writer.get_fields() or {}; values, records = {}, []
    destinations = {}
    for f in fields:
        loc = f.get('location', {}); page = loc.get('page')
        if type(page) != int or not 0 <= page < len(reader.pages):
            raise ValueError('PDF field page is invalid')
        bounds = rect(loc.get('rect'), reader.pages[page])
        status = f.get('status')
        if status not in ['answered', 'unknown', 'not_applicable'] or not f.get('rationale', '').strip():
            raise ValueError('PDF field status and rationale are required')
        if job['reportType'] == 'formal' and status == 'unknown' and f.get('category') != 'signature':
            raise ValueError('Formal PDF has a substantive missing field')
        value = str(f.get('text') or '') if status != 'unknown' else ''
        if status != 'unknown' and not value.strip():
            raise ValueError('PDF answer is empty')
        name = loc.get('fieldName')
        if name:
            widgets = [w for w in info['widgets'] if w['name'] == name]
            if name not in known or name in values or not any(w['page'] == page and w['rect'] == bounds for w in widgets):
                raise ValueError('PDF form location is ambiguous or missing')
            ft = str(known[name].get('/FT'))
            if ft == '/Btn':
                states = set.intersection(*[set(w['object'].get('/AP', {}).get('/N', {}).get_object()) for w in widgets])
                value = '/Off' if status == 'unknown' else value
                if value not in states:
                    raise ValueError('PDF choice must use an actual appearance state')
            elif ft != '/Tx':
                raise ValueError('Unsupported PDF field type: ' + ft)
            values[name] = value
        else:
            for old in destinations.setdefault(page, []):
                if min(old[2], bounds[2]) > max(old[0], bounds[0]) and min(old[3], bounds[3]) > max(old[1], bounds[1]):
                    raise ValueError('PDF answer areas overlap')
            destinations[page].append(bounds)
            if value:
                from reportlab.pdfgen import canvas
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.ttfonts import TTFont
                font = 'Helvetica'
                if any(ord(ch) > 255 for ch in value):
                    # CID-only fonts depend on viewer substitution and can render blank.
                    # Embed a real font; never silently publish invisible Unicode answers.
                    font = 'DPIAUnicode'
                    if font not in pdfmetrics.getRegisteredFontNames():
                        candidates = [os.environ.get('DSH_DPIA_PDF_FONT', ''),
                                      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
                                      '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc']
                        path = next((p for p in candidates if p and Path(p).is_file()), None)
                        if not path:
                            raise ValueError('An embeddable Unicode font is required; configure DSH_DPIA_PDF_FONT')
                        pdfmetrics.registerFont(TTFont(font, path))
                    face = pdfmetrics.getFont(font).face
                    if any(not ch.isspace() and ord(ch) not in face.charToGlyph for ch in value):
                        raise ValueError('The configured PDF font does not cover all answer characters')
                width, height = bounds[2] - bounds[0] - 4, bounds[3] - bounds[1] - 4
                lines = []
                for line in value.split('\n'):
                    current = ''
                    for ch in line:
                        if pdfmetrics.stringWidth(current + ch, font, 10) > width:
                            if not current: raise ValueError('PDF answer area is too narrow')
                            lines.append(current); current = ''
                        current += ch
                    lines.append(current)
                if len(lines) * 12 > height:
                    raise ValueError('PDF answer exceeds its field; use a concise reference to the Word appendix')
                stream = io.BytesIO(); c = canvas.Canvas(stream, pagesize=(float(reader.pages[page].mediabox.right), float(reader.pages[page].mediabox.top)))
                c.setFont(font, 10)
                for i, line in enumerate(lines): c.drawString(bounds[0] + 2, bounds[3] - 12 - 12 * i, line)
                c.save(); writer.pages[page].merge_page(PdfReader(stream).pages[0])
        annotation = None
        if status == 'unknown':
            if any(not f.get(k, '').strip() for k in ['question', 'impact', 'recommendation']):
                raise ValueError('Unknown PDF field needs question, impact and recommendation')
            annotation = f['key'] + '\n' + '\n'.join(f[k] for k in ['question', 'impact', 'recommendation'])
            writer.add_annotation(page, Text(rect=bounds, text=annotation, open=False))
        records.append({'key': f['key'], 'page': page, 'rect': bounds, 'fieldName': name, 'value': value, 'annotation': annotation})
    for p in coverage:
        expected = {f['key'] for f in records if f['page'] == p['page']}
        if set(p.get('fieldKeys', [])) != expected or not p.get('reason', '').strip() or p.get('kind') != ('fields' if expected else 'instructions'):
            raise ValueError('PDF page coverage differs from mapped fields')
    # Every editable field needs a decision, including unknown blank values.
    if set(values) != {w['name'] for w in info['widgets']}:
        raise ValueError('An interactive PDF field was omitted')
    if values: writer.update_page_form_field_values(None, values, auto_regenerate=False, flatten=False)
    out = Path(out); path = out/'native-report.pdf'; binding = out/'pdf-bindings.json'
    if path.exists() or binding.exists(): raise ValueError('Native PDF output exists; use a new attempt')
    buf = io.BytesIO(); writer.write(buf); verify_values(PdfReader(buf), values)
    path.write_bytes(buf.getvalue())
    data = {'basisDigest': job['basisDigest'], 'originalSha256': sha(original), 'pdfSha256': sha(path), 'pages': len(reader.pages), 'fields': records, 'values': values, 'pageCoverage': coverage}
    binding.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    return {'nativePdf': str(path), 'pages': len(reader.pages), 'interactiveFields': len(values)}


def check(job, out, combined=None):
    out = Path(out); data = json.loads((out/'pdf-bindings.json').read_text()); original = PdfReader(job['templatePath']); actual = PdfReader(out/'native-report.pdf')
    if data['basisDigest'] != job['basisDigest'] or data['originalSha256'] != job['templateSha256'] or sha(job['templatePath']) != job['templateSha256'] or data['pdfSha256'] != sha(out/'native-report.pdf'):
        raise ValueError('Native PDF bindings changed')
    if len(actual.pages) != len(original.pages) or data['pages'] != len(original.pages):
        raise ValueError('Original PDF pages were omitted')
    verify_values(actual, data['values'])
    if len({f['key'] for f in data['fields']}) != len(data['fields']) or data['values'] != {f['fieldName']:f['value'] for f in data['fields'] if f['fieldName']}:
        raise ValueError('PDF field mappings differ')
    review_path=out/'field-review.json'
    if review_path.exists():
        from zipfile import ZipFile
        from xml.etree import ElementTree as ET
        review=json.loads(review_path.read_text())
        if review.get('nativePdf',{}).get('bindingsSha256') != sha(out/'pdf-bindings.json'): raise ValueError('PDF review mapping changed')
        with ZipFile(out/'report.docx') as z: doc=ET.fromstring(z.read('word/document.xml'))
        W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}';ps=list(doc.iter(W+'p'))
        for field in data['fields']:
            reviewed=next((f for f in review['fields'] if f['key']==field['key']),None)
            if not reviewed: raise ValueError('Native PDF field omitted from report review')
            text='\n'.join(''.join(t.text or '' for t in ps[i].iter(W+'t')) for i in reviewed['paragraphs'])
            expected='' if reviewed['status']=='unknown' else field['value']
            if text.strip()!=expected.strip(): raise ValueError('PDF answer differs from Word working copy')
    def verify_pages(target):
        if len(target.pages) < len(original.pages): raise ValueError('Native PDF pages omitted from delivery')
        for i, old in enumerate(original.pages):
            page = target.pages[i]
            if list(page.mediabox) != list(old.mediabox) or page.rotation != old.rotation:
                raise ValueError('Native PDF page geometry changed')
            normalize = lambda s: ''.join(s.split())
            if normalize(old.extract_text() or '') not in normalize(page.extract_text() or ''):
                raise ValueError('Native PDF original text changed')
            for f in [f for f in data['fields'] if f['page'] == i]:
                if f['annotation'] and not any(a.get_object().get('/Contents') == f['annotation'] and list(map(float, a.get_object().get('/Rect', []))) == f['rect'] for a in page.get('/Annots', [])):
                    raise ValueError('Missing native PDF gap annotation')
                if f['value'] and not f['fieldName'] and normalize(f['value']) not in normalize(page.extract_text() or ''):
                    raise ValueError('Native PDF answer is missing')
    verify_pages(actual)
    if combined:
        delivered = PdfReader(combined); verify_values(delivered, data['values']); verify_pages(delivered)
    return {'errors': [], 'pages': data['pages'], 'interactiveFields': len(data['values'])}


if __name__ == '__main__':
    try:
        args = json.load(sys.stdin); mode = args['mode']
        if mode == 'inspect': result = public_inspection(inspect(PdfReader(args['document'])))
        elif mode == 'fill': result = fill(args['job'], json.loads(Path(args['content']).read_text()), args['out'])
        elif mode == 'check': result = check(args['job'], args['out'], args.get('combined'))
        elif mode == 'merge':
            check(args['job'], args['out'])
            writer = PdfWriter(); writer.clone_document_from_reader(PdfReader(Path(args['out'])/'native-report.pdf'))
            for page in PdfReader(args['appendix']).pages: writer.add_page(page)
            with open(args['destination'], 'xb') as f: writer.write(f)
            result = check(args['job'], args['out'], args['destination'])
        else: raise ValueError('Unknown PDF operation')
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)[:2000]})); sys.exit(1)
