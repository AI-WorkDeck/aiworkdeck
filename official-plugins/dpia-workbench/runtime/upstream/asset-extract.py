"""Bounded local extraction with explicit omissions; no network or document macros."""
import sys,json,hashlib
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
path=Path(sys.argv[1]);kind=sys.argv[2];parts=[];warnings=[];blocked=False

def paragraph(el):
    def walk(e):
        tag=e.tag.split('}')[-1]
        if tag in ('t','delText'):return e.text or ''
        if tag=='tab':return '\t'
        if tag in ('br','cr'):return '\n'
        text=''.join(walk(c) for c in e)
        return ('[删除：'+text+']') if tag=='del' else ('[新增：'+text+']') if tag=='ins' else text
    return walk(el).strip()
def add(locator,text):
    if text.strip():parts.append({'locator':locator,'text':text.strip()})
try:
    if kind in ('txt','md'):
        raw=path.read_bytes();encoding='utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig'
        text=raw.decode(encoding)
        for n,line in enumerate(text.splitlines(),1):add('行 '+str(n),line)
    elif kind=='docx':
        with ZipFile(path) as z:
            entries=z.infolist()
            if len(entries)>10000 or sum(x.file_size for x in entries)>80_000_000:raise ValueError('解压内容超出 80 MB / 10,000 项限制')
            def xml(name):
                raw=z.read(name)
                if len(raw)>30_000_000 or b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:raise ValueError('无法安全解析文档 XML')
                return ET.fromstring(raw)
            root=xml('word/document.xml');body=root.find(W+'body')
            if body is None:raise ValueError('文档缺少正文')
            pi=ti=0
            for node in body:
                if node.tag==W+'p':pi+=1;add(f'正文段落 {pi}',paragraph(node))
                elif node.tag==W+'tbl':
                    ti+=1
                    for ri,row in enumerate(node.findall(W+'tr'),1):
                        for ci,cell in enumerate(row.findall(W+'tc'),1):
                            for ni,p in enumerate(cell.findall('.//'+W+'p'),1):add(f'表 {ti} / 行 {ri} / 列 {ci} / 段 {ni}',paragraph(p))
                elif node.tag!=W+'sectPr':warnings.append('存在特殊正文结构，请对照原件检查：'+node.tag.split('}')[-1])
            for name in sorted(z.namelist()):
                if name.startswith('word/') and (name.rsplit('/',1)[-1].startswith(('header','footer')) or name in ('word/footnotes.xml','word/endnotes.xml','word/comments.xml')) and name.endswith('.xml'):
                    for ni,p in enumerate(xml(name).findall('.//'+W+'p'),1):add(f'{name} / 段 {ni}',paragraph(p))
            if root.findall('.//'+W+'del') or root.findall('.//'+W+'ins'):warnings.append('包含修订；已分别标出新增与删除，需核对采用范围')
            if 'word/comments.xml' in z.namelist():warnings.append('包含批注；已附批注文字，需对照原件核对位置')
            if any(n.startswith('word/media/') for n in z.namelist()):warnings.append('包含图片；未识别图像文字，请核对是否有遗漏的业务信息')
            if root.findall('.//'+W+'txbxContent'):warnings.append('包含文本框；请核对其位置与正文对应关系')
    elif kind=='pdf':
        try:from pypdf import PdfReader
        except ImportError:raise ValueError('PDF 提取依赖 pypdf 不可用，请配置文档 Python 环境')
        with path.open('rb') as stream:
            doc=PdfReader(stream)
            if doc.is_encrypted:raise ValueError('PDF 已加密，请提供可读取版本')
            if len(doc.pages)>1000:raise ValueError('PDF 超过 1,000 页，请按评估范围拆分')
            for ni,page in enumerate(doc.pages,1):
                text=page.extract_text() or ''
                if not text.strip():warnings.append(f'第 {ni} 页没有可提取文字，可能为扫描页或空页')
                if len(page.images):warnings.append(f'第 {ni} 页包含图片，未进行 OCR')
                add(f'PDF 第 {ni} 页',text)
            warnings.append('PDF 的复杂表格和多栏阅读顺序需对照原件检查')
    else:raise ValueError('不支持此文件类型')
    body='\n\n'.join('['+p['locator']+']\n'+p['text'] for p in parts)
    if not body.strip():blocked=True;warnings.append('未提取到可分析文字，请补充可读版本')
    if len(body.encode())>2_000_000:raise ValueError('提取文字超过 2 MB，请拆分材料；原件已保留，未截断文本')
    if '\ufffd' in body or '\x00' in body:blocked=True;warnings.append('提取文本存在异常字符，请核对编码或提供可读版本')
    print(json.dumps({'status':'blocked' if blocked else 'needs_review' if warnings else 'ready','warnings':list(dict.fromkeys(warnings)),'parts':len(parts),'text':body},ensure_ascii=False))
except Exception as e:
    print(json.dumps({'status':'blocked','warnings':[str(e)[:1000]],'parts':0,'text':''},ensure_ascii=False))
