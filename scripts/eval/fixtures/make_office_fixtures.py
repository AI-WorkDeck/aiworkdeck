# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""生成 model-matrix 用的虚构 pptx/xlsx 夹具。
用法：uv run --with python-pptx --with openpyxl python3 scripts/eval/fixtures/make_office_fixtures.py"""
import os, datetime
from pptx import Presentation
from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- 案件汇报.pptx：5 页（标题页 + 4 页标题/正文） ----
prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = '示范科技诉样例公司买卖合同纠纷案'
s.placeholders[1].text = '案件汇报（虚构示范）'
for title, bullets in [
    ('案件概况', ['原告：示范科技有限公司', '被告：样例贸易有限公司', '标的额：人民币 1,280,000 元', '受理法院：示范市中级人民法院']),
    ('争议焦点', ['货物是否存在质量瑕疵', '逾期付款违约金如何计算', '被告反诉是否成立']),
    ('诉讼策略', ['先行申请诉前调解', '调解不成则坚持全额主张', '调解期间同步补强证据']),
    ('风险提示', ['质检报告出具时间晚于验收期', '违约金约定可能被认定过高']),
]:
    sl = prs.slides.add_slide(prs.slide_layouts[1])
    sl.shapes.title.text = title
    tf = sl.placeholders[1].text_frame
    tf.text = bullets[0]
    for b in bullets[1:]:
        tf.add_paragraph().text = b
prs.save(os.path.join(HERE, 'case-report.pptx'))

# ---- 案件台账.xlsx：台账 + 费用 ----
wb = Workbook()
ws = wb.active
ws.title = '台账'
ws.append(['案号', '当事人', '案由', '标的额(元)', '立案日期', '状态'])
rows = [
    ('(2025)示0105民初1001号', '示范科技', '买卖合同纠纷', 1280000, datetime.date(2025, 3, 2), '审理中'),
    ('(2025)示0105民初1187号', '样例物流', '运输合同纠纷', 356000, datetime.date(2025, 4, 18), '已结案'),
    ('(2025)示0108民初2210号', '演示地产', '房屋租赁合同纠纷', 2150000, datetime.date(2025, 6, 9), '审理中'),
    ('(2025)示0102民初0456号', '虚构餐饮', '劳动争议', 86000, datetime.date(2025, 7, 21), '已结案'),
    ('(2026)示0105民初0033号', '示范科技', '借款合同纠纷', 640000, datetime.date(2026, 1, 12), '待开庭'),
    ('(2026)示0101民初0219号', '样例医药', '知识产权纠纷', 3200000, datetime.date(2026, 2, 27), '待开庭'),
    ('(2026)示0108民初0577号', '演示建工', '建设工程施工合同纠纷', 4750000, datetime.date(2026, 4, 3), '审理中'),
    ('(2026)示0102民初0811号', '虚构文创', '著作权侵权纠纷', 120000, datetime.date(2026, 5, 16), '已结案'),
]
for r in rows:
    ws.append(list(r))
for c in range(2, 2 + len(rows)):
    ws.cell(row=c, column=5).number_format = 'yyyy-mm-dd'
    ws.cell(row=c, column=4).number_format = '#,##0'
for col, w in zip('ABCDEF', (26, 12, 22, 14, 12, 10)):
    ws.column_dimensions[col].width = w
fee = wb.create_sheet('费用')
fee.append(['月份', '律师费', '差旅费'])
for m, a, b in [('1月', 42000, 3800), ('2月', 38000, 2100), ('3月', 51000, 4600), ('4月', 47000, 3900), ('5月', 55000, 5200), ('6月', 49000, 3300)]:
    fee.append([m, a, b])
wb.save(os.path.join(HERE, 'case-ledger.xlsx'))
print('ok')

# ---- 视觉核验夹具（office-tier1 O6）：结构读回看不出、只有看图才发现的版面问题 ----
from pptx.util import Emu, Pt
from openpyxl import load_workbook
prs = Presentation(os.path.join(HERE, 'case-report.pptx'))
body = prs.slides[1].placeholders[1]
body.text_frame.text = '原告：示范科技有限公司（统一社会信用代码 91110105MA00EXAMPL，住所地示范市示范区示范大道 100 号）'
for line in ['被告：样例贸易有限公司（住所地样例市样例区样例路 200 号，法定代表人 张某某）',
             '标的额：人民币 1,280,000 元及自 2025 年 3 月 2 日起按 LPR 计算的逾期付款利息',
             '受理法院：示范市中级人民法院，案号 (2025)示01民初1001号，承办法官 李某某']:
    body.text_frame.add_paragraph().text = line
for p in body.text_frame.paragraphs:
    for r in p.runs:
        r.font.size = Pt(36)
# 框太矮、起点太低：四段 36 磅正文溢出文本框并超出页面下沿（看图才看得出被裁）（四个几何量都显式给出，只给高度会让占位缺位置）
body.left, body.top = Emu(int(prs.slide_width * 0.06)), Emu(int(prs.slide_height * 0.40))
body.width, body.height = Emu(int(prs.slide_width * 0.88)), Emu(int(prs.slide_height * 0.22))
prs.save(os.path.join(HERE, 'case-report-overflow.pptx'))

wb = load_workbook(os.path.join(HERE, 'case-ledger.xlsx'))
wb['台账'].column_dimensions['D'].width = 4  # 标的额列太窄：显示成 ###，读值照常是完整数字
wb.save(os.path.join(HERE, 'case-ledger-narrow.xlsx'))
print('ok view fixtures')
