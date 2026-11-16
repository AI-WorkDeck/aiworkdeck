# SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# B13 fixtures: base / main / other docx with PENDING tracked changes (w:ins / w:del with author + date).
import zipfile, sys
from xml.sax.saxutils import escape
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
def write(path, paras):
    doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W + '><w:body>' + ''.join(paras) + '</w:body></w:document>'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CT); z.writestr('_rels/.rels', RELS); z.writestr('word/document.xml', doc)
R = lambda t: '<w:r><w:t xml:space="preserve">' + escape(t) + '</w:t></w:r>'
def INS(i, a, d, t): return '<w:ins w:id="%d" w:author="%s" w:date="%s"><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:ins>' % (i, a, d, escape(t))
def DEL(i, a, d, t): return '<w:del w:id="%d" w:author="%s" w:date="%s"><w:r><w:delText xml:space="preserve">%s</w:delText></w:r></w:del>' % (i, a, d, escape(t))
P = lambda inner: '<w:p>' + inner + '</w:p>'
JIA, YI = ('甲律师', '2026-11-01T09:00:00Z'), ('乙律师', '2026-11-02T10:00:00Z')
paras = ['股权转让协议（虚构示范）', '第一条 转让标的：甲方将其持有的目标公司 30% 股权转让给乙方。', '第二条 转让价款：转让价款为人民币 1200 万元。',
         '第三条 付款安排：乙方应于协议生效后 10 个工作日内付清。', '第四条 过渡期：自签署日至交割日为过渡期。', '第五条 争议解决：提交示范仲裁委员会仲裁。']
d = sys.argv[1]
AI = ('AI WorkDeck', '2026-11-03T08:00:00Z')
# every version inherits the base: clause 3 carries an AI pending deletion nobody touched
def base_paras():
    b = [P(R(t)) for t in paras]
    b[3] = P(R('第三条 付款安排：乙方应于协议生效后 10 个工作日内') + DEL(51, *AI, '分两期') + R('付清。'))
    return b
write(d + '/base.docx', base_paras())
# A: main changes clause 2 (pending, 甲); other: pending deletion only in clause 1, pending change in clause 4, a pending new clause after clause 4 (乙)
m = base_paras()
m[2] = P(R('第二条 转让价款：转让价款为人民币 1') + DEL(11, *JIA, '2') + INS(12, *JIA, '5') + R('00 万元。'))
write(d + '/main.docx', m)
o = base_paras()
# same author, a different time than clause 4 (dates must be matched by position, not by text)
o[1] = P(R('第一条 转让标的：甲方将其持有的') + DEL(20, '乙律师', '2026-11-02T11:30:00Z', '目标公司 ') + R('30% 股权转让给乙方。'))
o[4] = P(R('第四条 过渡期：自签署日至') + DEL(21, *YI, '交割日') + INS(22, *YI, '付款完成日') + R('为过渡期。'))
o.insert(5, '<w:p><w:pPr><w:rPr><w:ins w:id="23" w:author="%s" w:date="%s"/></w:rPr></w:pPr>%s</w:p>' % (YI[0], YI[1], INS(24, *YI, '第四条之一 陈述与保证：双方保证所提供信息真实。')))
write(d + '/other.docx', o)
# B: both sides change clause 3 with pending changes
m3 = base_paras()
m3[3] = P(R('第三条 付款安排：乙方应于协议生效后 ') + DEL(31, *JIA, '10') + INS(32, *JIA, '15') + R(' 个工作日内付清。'))
write(d + '/main-conflict.docx', m3)
o3 = base_paras()
o3[3] = P(R('第三条 付款安排：乙方应于协议生效后 ') + DEL(41, *YI, '10') + INS(42, *YI, '5') + R(' 个工作日内付清。'))
write(d + '/other-conflict.docx', o3)
# D/E (ledger B13b): pending tracked changes inside table cells
def tc(inner): return '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>' + inner + '</w:tc>'
def tbl(rows): return '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' + ''.join('<w:tr>' + ''.join(tc(c) for c in r) + '</w:tr>' for r in rows) + '</w:tbl>'
TP = ['付款计划（虚构示范）', '第一条 价款分两期支付。', '第二条 逾期付款按日万分之五计息。']
def table_doc(cells, p1=None):
    return [P(R(TP[0])), p1 or P(R(TP[1])), tbl(cells), P(R(TP[2]))]
base_cells = [[P(R('付款节点')), P(R('金额'))], [P(R('签约后 10 日')), P(R('300 万元'))]]
write(d + '/table-base.docx', table_doc(base_cells))
main_cells = [[P(R('付款节点')), P(R('金额'))], [P(R('签约后 10 日')), P(DEL(61, *JIA, '300') + INS(62, *JIA, '350') + R(' 万元'))]]
write(d + '/table-main.docx', table_doc(main_cells, P(R('第一条 价款分') + DEL(63, *JIA, '两') + INS(64, *JIA, '三') + R('期支付。'))))
other_cells = [[P(R('付款节点')), P(R('金额'))], [P(R('签约后 ') + DEL(71, *YI, '10') + INS(72, *YI, '15') + R(' 日')), P(R('300 万元'))]]
write(d + '/table-other.docx', table_doc(other_cells))
multi_cells = [[P(R('付款节点')), P(R('金额'))], [P(R('签约后 ') + DEL(81, *YI, '10') + INS(82, *YI, '15') + R(' 日')) + P(R('（以书面通知为准）')), P(R('300 万元'))]]
write(d + '/table-other-multi.docx', table_doc(multi_cells))
