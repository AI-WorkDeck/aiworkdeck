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
