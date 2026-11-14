#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# 长合同夹具（标准库，无依赖）：30 章 × 30 条，约 1800 段、130+ 页，虚构文本。
# 用法：python3 gen-long-contract.py <out.docx>
import zipfile, random, sys
from xml.sax.saxutils import escape
random.seed(86)
out = sys.argv[1]
def p(t, bold=False, pb=False):
    r = '<w:r>' + ('<w:rPr><w:b/></w:rPr>' if bold else '') + '<w:t xml:space="preserve">' + escape(t) + '</w:t></w:r>'
    br = '<w:r><w:br w:type="page"/></w:r>' if pb else ''
    return '<w:p>' + br + r + '</w:p>'
body = [p('设备采购及技术服务总合同（虚构示范，长文本样本）', True)]
n = 0
for ch in range(1, 31):
    body.append(p(f'第{ch}章　{random.choice(["定义与解释","采购范围","价款与支付","交付与验收","质量保证","知识产权","保密","违约责任","争议解决","其他"])}', True, pb=ch > 1))
    for k in range(30):
        n += 1
        body.append(p(f'{ch}.{k+1}　双方同意，本条所称金额以人民币计，合计不超过{random.randint(10,999)*1000}元；乙方应于收到书面通知后{random.randint(3,30)}个工作日内履行相应义务，逾期按日万分之{random.randint(1,9)}支付违约金。本款适用于第{n}号附件所列全部设备及服务，双方另有书面约定的除外。'))
        body.append(p('　'))
doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
       + ''.join(body) + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>')
ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', rels); z.writestr('word/document.xml', doc)
print(n, 'clauses', len(body), 'paragraphs')
