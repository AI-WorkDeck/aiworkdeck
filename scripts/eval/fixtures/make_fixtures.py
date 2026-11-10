# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""生成 model-matrix 用的虚构 docx 夹具（无第三方依赖）。用法：python3 make_fixtures.py"""
import os, zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')

def run(t): return f'<w:r><w:t xml:space="preserve">{escape(t)}</w:t></w:r>'
def para(*parts): return '<w:p>' + ''.join(parts) + '</w:p>'
def p(t): return para(run(t))
def ins(i, t): return f'<w:ins w:id="{i}" w:author="对方律师" w:date="2026-01-10T09:00:00Z"><w:r><w:t xml:space="preserve">{escape(t)}</w:t></w:r></w:ins>'
def dele(i, t): return f'<w:del w:id="{i}" w:author="对方律师" w:date="2026-01-10T09:00:00Z"><w:r><w:delText xml:space="preserve">{escape(t)}</w:delText></w:r></w:del>'

def write(name, body):
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{body}</w:body></w:document>'
    with zipfile.ZipFile(os.path.join(HERE, name), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CT); z.writestr('_rels/.rels', RELS); z.writestr('word/document.xml', doc)

head = [p('设备购销合同（虚构示范）'), p('甲方：示范精密制造有限公司；乙方：样例智能设备有限公司。')]
clauses = [
    p('第一条 标的：乙方向甲方出售传感器 1000 台，总价 800000 元。'),
    p('第二条 质量：按乙方产品说明书及国家标准执行。'),
    p('第三条 交付：甲方应在收到货物后 7 日内验收，甲方逾期验收视为合格；甲方不得无故拒收。'),
    p('第四条 违约金：任一方违约，应按合同总价的 50% 向守约方支付违约金。'),
    p('第五条 争议解决：因本合同引起的争议，提交示范仲裁委员会仲裁。'),
]
write('contract.docx', ''.join(head + clauses))
write('contract-draft.docx', ''.join(head + clauses))
write('contract-tracked.docx', ''.join(head + clauses[:2] + [
    para(run('第三条 交付：甲方应在收到货物后 '), dele(1, '7'), ins(2, '15'), run(' 日内验收。')),
    para(run('第四条 违约金：'), ins(3, '违约方应按合同总价的 20% 支付违约金。'))] + clauses[4:]))
write('mention-zhangsan.docx', ''.join([p('沟通记录（虚构）'), p('2026年1月5日，张三致电乙方，称货物到货时间延迟。'), p('乙方回复将在三日内补发。')]))
write('plain-notes.docx', ''.join([p('会议纪要（虚构）'), p('讨论了交付节奏与付款进度，未形成新的结论。')]))

# ---- V4 合并工具句子用的夹具 ----
# 带一条批注的合同：批注 id=0，作者「对方律师」，挂在第四条上
W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
CT_COMMENTS = CT.replace('</Types>', '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>')
RELS_DOC_COMMENTS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                     '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>')
COMMENTS_XML = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="{W_NS}">'
                '<w:comment w:id="0" w:author="对方律师" w:date="2026-01-10T09:00:00Z" w:initials="DF"><w:p><w:r><w:t>违约金比例偏高，请考虑调整。</w:t></w:r></w:p></w:comment></w:comments>')
body = ''.join(head + clauses[:3] + [
    para('<w:commentRangeStart w:id="0"/>', run('第四条 违约金：任一方违约，应按合同总价的 50% 向守约方支付违约金。'),
         '<w:commentRangeEnd w:id="0"/>', '<w:r><w:commentReference w:id="0"/></w:r>')] + clauses[4:])
with zipfile.ZipFile(os.path.join(HERE, 'contract-commented.docx'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT_COMMENTS); z.writestr('_rels/.rels', RELS)
    z.writestr('word/_rels/document.xml.rels', RELS_DOC_COMMENTS); z.writestr('word/comments.xml', COMMENTS_XML)
    z.writestr('word/document.xml', f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{body}</w:body></w:document>')

# 带一张价目表的合同
def cell(t): return f'<w:tc><w:p>{run(t)}</w:p></w:tc>'
def row(*cs): return '<w:tr>' + ''.join(cell(c) for c in cs) + '</w:tr>'
table = ('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>'
         + row('品名', '数量', '单价') + row('传感器', '1000', '800') + row('网关', '50', '2400') + '</w:tbl>')
write('contract-table.docx', ''.join(head + clauses[:1] + [p('价目表：'), table, p('')] + clauses[1:]))

# 24 页的虚构卷宗 PDF（纯标准库手写，每页一行文字，页码可辨）
def make_pdf(path, pages):
    objs = []
    objs.append('<< /Type /Catalog /Pages 2 0 R >>')
    kids = ' '.join(f'{3 + i * 2} 0 R' for i in range(pages))
    objs.append(f'<< /Type /Pages /Kids [{kids}] /Count {pages} >>')
    for i in range(pages):
        objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {4 + i * 2} 0 R /Resources << /Font << /F1 {3 + pages * 2} 0 R >> >> >>')
        stream = f'BT /F1 24 Tf 72 700 Td (Dossier page {i + 1}) Tj ET'
        objs.append(f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream')
    objs.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    out = bytearray(b'%PDF-1.4\n'); offsets = []
    for n, o in enumerate(objs, 1):
        offsets.append(len(out)); out += f'{n} 0 obj\n{o}\nendobj\n'.encode('latin-1')
    xref = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for off in offsets: out += f'{off:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    open(path, 'wb').write(out)
make_pdf(os.path.join(HERE, 'dossier-24p.pdf'), 24)

# ---- gate-35 句子用的夹具 ----
# 法律意见书（虚构）：引用了两处法条，第二处故意张冠李戴——民法典第 1082 条是离婚限制条款，与违约金调整无关（应为第 585 条）
write('opinion.docx', ''.join([
    p('关于设备购销合同违约金条款的法律意见书（虚构示范）'),
    p('一、事实概要：示范精密制造有限公司（甲方）与样例智能设备有限公司（乙方）约定，任一方违约应按合同总价的 50% 支付违约金。'),
    p('二、法律依据一：依据《中华人民共和国民法典》第五百零九条，当事人应当按照约定全面履行自己的义务。'),
    p('三、法律依据二：依据《中华人民共和国民法典》第一千零八十二条，约定的违约金过分高于造成的损失的，人民法院可以根据当事人的请求予以适当减少。'),
    p('四、结论：建议甲方请求法院将违约金调整至不超过实际损失的 130%。'),
]))
