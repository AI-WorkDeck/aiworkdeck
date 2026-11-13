# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Generate pitch-materials sample templates and fictional test fixtures.

Usage: python make_templates.py   (needs python-docx and python-pptx)
All firms, people and numbers are fictional.
"""
import datetime
import io
import json
import zipfile
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from pptx import Presentation
from pptx.dml.color import RGBColor as PRGB
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.util import Inches, Pt as PPt

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "backend/src/main/resources/pitch-samples"
FIX = ROOT / "tests/fixtures"
FIXED_DT = datetime.datetime(2026, 11, 12, 9, 0, 0)


def normalize_zip(path):
    """Rewrite the OOXML zip with fixed timestamps so output is byte-stable."""
    src = zipfile.ZipFile(path)
    items = [(i.filename, src.read(i.filename)) for i in src.infolist()]
    src.close()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in items:
            zi = zipfile.ZipInfo(name, (2026, 11, 12, 9, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
    Path(path).write_bytes(buf.getvalue())


# ---------------------------------------------------------------- docx helpers

def set_fonts(run, ea, latin="Times New Roman", size=None, bold=None, color=None):
    rpr = run._r.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.insert(0, rf)
    for a in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        if rf.get(qn(a)) is not None:
            del rf.attrib[qn(a)]
    rf.set(qn("w:ascii"), latin)
    rf.set(qn("w:hAnsi"), latin)
    rf.set(qn("w:cs"), latin)
    rf.set(qn("w:eastAsia"), ea)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color:
        run.font.color.rgb = RGBColor.from_string(color)


def style_fonts(style, ea, size, bold=False, color="000000"):
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = RGBColor.from_string(color)
    rpr = style.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.insert(0, rf)
    for k in list(rf.attrib):
        del rf.attrib[k]
    for a in ("w:ascii", "w:hAnsi", "w:cs"):
        rf.set(qn(a), "Times New Roman")
    rf.set(qn("w:eastAsia"), ea)


def shade(cell, fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcpr.append(shd)


def para_border(p, side, color, sz=8, space=2):
    ppr = p._p.get_or_add_pPr()
    bd = OxmlElement("w:pBdr")
    e = OxmlElement("w:" + side)
    e.set(qn("w:val"), "single")
    e.set(qn("w:sz"), str(sz))
    e.set(qn("w:space"), str(space))
    e.set(qn("w:color"), color)
    bd.append(e)
    ppr.append(bd)


SPLITS = {"{{客户名称}}": ("{{客户", "名称}}"), "{{业绩.名称}}": ("{{业绩.", "名称}}")}


class Theme:
    def __init__(self, **kw):
        self.__dict__.update(kw)


NEUTRAL = Theme(name="neutral", head_ea="黑体", body_ea="宋体", accent="000000", h_rule=None,
                th_fill="E7E9EE", th_color="000000", split=False, header_text="{{律所名称}}",
                header_color="595959")
QIHENG = Theme(name="qiheng", head_ea="黑体", body_ea="宋体", accent="1F5C4A", h_rule="B08D57",
               th_fill="1F5C4A", th_color="FFFFFF", split=True, header_text="启衡律师事务所　·　投标文件",
               header_color="1F5C4A")


def add_runs(p, text, T, size=12, bold=False, color=None, split=False, ea=None):
    ea = ea or T.body_ea
    pieces = [(text, bold)]
    if split and T.split:
        for key, (a, b) in SPLITS.items():
            if key in text:
                pre, post = text.split(key, 1)
                pieces = [(pre + a, False), (b, True), (post, bold)]
                break
    for t, b in pieces:
        if t == "":
            continue
        r = p.add_run(t)
        set_fonts(r, ea, size=size, bold=b, color=color)
    return p


BODY_LS = 1.5


def body_p(doc, text, T, indent=True, bold=False, size=12, align=None, split=False, after=0, before=0):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.line_spacing = BODY_LS
    pf.space_after = Pt(after)
    pf.space_before = Pt(before)
    if indent:
        pf.first_line_indent = Pt(24)
    if align:
        p.alignment = align
    add_runs(p, text, T, size=size, bold=bold, split=split)
    return p


def heading(doc, text, T, level=1, page_break=False):
    p = doc.add_paragraph(style="Heading %d" % level)
    p.paragraph_format.page_break_before = page_break
    r = p.add_run(text)
    set_fonts(r, T.head_ea, size={1: 16, 2: 14, 3: 12}[level], bold=(level != 1 or True),
              color=T.accent if T.name != "neutral" else "000000")
    if level == 1 and T.h_rule:
        para_border(p, "bottom", T.h_rule, sz=12, space=3)
    return p


def make_table(doc, widths_cm, header, row, T, split_cols=()):
    t = doc.add_table(rows=2, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    tblpr = t._tbl.tblPr
    lay = OxmlElement("w:tblLayout")
    lay.set(qn("w:type"), "fixed")
    tblpr.append(lay)
    for i, w in enumerate(widths_cm):
        t.columns[i].width = Cm(w)
    for ri, vals in enumerate((header, row)):
        for ci, v in enumerate(vals):
            c = t.cell(ri, ci)
            c.width = Cm(widths_cm[ci])
            p = c.paragraphs[0]
            p.paragraph_format.line_spacing = 1.15
            p.paragraph_format.space_before = Pt(3)
            p.paragraph_format.space_after = Pt(3)
            if ri == 0:
                shade(c, T.th_fill)
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                add_runs(p, v, T, size=10, bold=True, color=T.th_color, ea=T.head_ea)
            else:
                add_runs(p, v, T, size=8.5, split=(ci in split_cols))
    trpr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement("w:tblHeader")
    th.set(qn("w:val"), "true")
    trpr.append(th)
    for r in t.rows:
        cs = OxmlElement("w:cantSplit")
        r._tr.get_or_add_trPr().append(cs)
    return t


def add_field(p, instr, ea, size, color):
    for kind in ("begin", None, "end"):
        r = p.add_run()
        set_fonts(r, ea, size=size, color=color)
        if kind:
            fc = OxmlElement("w:fldChar")
            fc.set(qn("w:fldCharType"), kind)
            r._r.append(fc)
        else:
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = instr
            r._r.append(it)


def new_doc(T, header_text):
    doc = Document()
    cp = doc.core_properties
    cp.author = "AI WorkDeck"
    cp.last_modified_by = "AI WorkDeck"
    cp.created = FIXED_DT
    cp.modified = FIXED_DT
    cp.revision = 1
    cp.title = ""
    sec = doc.sections[0]
    sec.orientation = WD_ORIENT.PORTRAIT
    sec.page_width, sec.page_height = Cm(21), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2.3)
    sec.top_margin, sec.bottom_margin = Cm(2.6), Cm(2.4)
    sec.header_distance = sec.footer_distance = Cm(1.2)
    st = doc.styles
    style_fonts(st["Normal"], T.body_ea, 12)
    st["Normal"].paragraph_format.line_spacing = 1.5
    for lv, sz in ((1, 16), (2, 14), (3, 12)):
        h = st["Heading %d" % lv]
        style_fonts(h, T.head_ea, sz, True, T.accent if T.name != "neutral" else "000000")
        h.paragraph_format.space_before = Pt(18 if lv == 1 else 10)
        h.paragraph_format.space_after = Pt(8 if lv == 1 else 4)
        h.paragraph_format.line_spacing = 1.3
        h.paragraph_format.keep_with_next = True
    sec.different_first_page_header_footer = True
    hp = sec.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    hp.paragraph_format.line_spacing = 1.0
    add_runs(hp, header_text, T, size=9, color=T.header_color)
    para_border(hp, "bottom", T.h_rule or "BFBFBF", sz=6, space=4)
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp.paragraph_format.line_spacing = 1.0
    r = fp.add_run("第 ")
    set_fonts(r, T.body_ea, size=9, color="595959")
    add_field(fp, "PAGE", T.body_ea, 9, "595959")
    r = fp.add_run(" 页")
    set_fonts(r, T.body_ea, size=9, color="595959")
    return doc


def build_bid(path, T):
    doc = new_doc(T, T.header_text)
    # cover
    if T.name == "qiheng":
        t = doc.add_table(rows=1, cols=1)
        t.autofit = False
        t.columns[0].width = Cm(16.4)
        c = t.cell(0, 0)
        c.width = Cm(16.4)
        shade(c, T.accent)
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(40)
        p.paragraph_format.space_after = Pt(6)
        add_runs(p, "启衡律师事务所", T, size=30, bold=True, color="FFFFFF", ea="黑体")
        p2 = c.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p2.paragraph_format.space_after = Pt(40)
        add_runs(p2, "QIHENG LAW FIRM", T, size=12, color="E3D3B0")
        para_border(p2, "bottom", T.h_rule, sz=18, space=14)
        top = Pt(70)
    else:
        top = Pt(140)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = top
    p.paragraph_format.line_spacing = 1.3
    add_runs(p, "{{项目名称}}", T, size=26, bold=True, ea="黑体", color=T.accent if T.name != "neutral" else None)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(90)
    add_runs(p, "投　标　文　件", T, size=22, bold=True, ea="黑体")
    for lab, val in (("项目名称", "{{项目名称}}"), ("投 标 人", "{{律所名称}}"), ("日　　期", "{{日期}}")):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(6)
        add_runs(p, lab + "：", T, size=14, bold=True, ea="黑体")
        add_runs(p, val, T, size=14)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    heading(doc, "一、致{{客户名称}}的函", T)
    body_p(doc, "尊敬的{{客户名称}}：", T, indent=False, split=True)
    body_p(doc, "{{律所名称}}（以下简称“本所”）诚挚感谢贵方邀请我们参与“{{项目名称}}”。"
                "本所已认真研读相关文件，并组建了经验丰富的服务团队，承诺以专业、审慎、及时的服务满足贵方的法律需求，"
                "并严格遵守保密义务。现提交本投标文件，敬请审阅。", T)
    body_p(doc, "此致", T, indent=False, before=6)
    body_p(doc, "敬礼！", T, indent=False)

    heading(doc, "二、律所简介", T)
    heading(doc, "（一）基本情况", T, 2)
    body_p(doc, "{{律所简介}}", T)
    heading(doc, "（二）资质荣誉", T, 2)
    make_table(doc, [2.3, 5.0, 2.2, 4.6, 2.3], ["序号", "名称", "类型", "颁发机构", "年份"],
               ["{{资质.序号}}", "{{资质.名称}}", "{{资质.类型}}", "{{资质.颁发机构}}", "{{资质.年份}}"], T)

    heading(doc, "三、服务团队", T)
    # 姓名行、领域行与简介不分页（复制后的每位律师都继承）
    body_p(doc, "{{律师.姓名}}　{{律师.职务}}", T, indent=False, bold=True, before=6).paragraph_format.keep_with_next = True
    body_p(doc, "执业领域：{{律师.领域}}；执业年份：{{律师.执业年份}}；教育背景：{{律师.教育}}", T, indent=False).paragraph_format.keep_with_next = True
    body_p(doc, "{{律师.简介}}", T, after=6)

    heading(doc, "四、相关业绩", T)
    make_table(doc, [2.0, 2.6, 2.4, 2.2, 2.2, 2.2, 2.8],
               ["序号", "项目名称", "客户", "领域", "年份", "角色", "简介"],
               ["{{业绩.序号}}", "{{业绩.名称}}", "{{业绩.客户}}", "{{业绩.领域}}", "{{业绩.年份}}",
                "{{业绩.角色}}", "{{业绩.简介}}"], T, split_cols=(1,))

    heading(doc, "五、服务方案", T)
    body_p(doc, "{{服务方案}}", T)

    heading(doc, "六、报价", T)
    body_p(doc, "本所采用的报价方式为：{{报价方式}}。报价明细如下：", T)
    make_table(doc, [2.3, 4.4, 5.4, 4.3], ["序号", "收费项目", "计算方式", "金额"],
               ["{{报价.序号}}", "{{报价.项目}}", "{{报价.计算}}", "{{报价.金额}}"], T)
    body_p(doc, "报价合计：{{报价合计}}（{{报价大写}}）", T, indent=False, bold=True, before=8)
    body_p(doc, "{{报价说明}}", T, indent=False)

    heading(doc, "附件：资格与评分对照表", T, page_break=True)
    make_table(doc, [2.0, 2.0, 2.8, 2.0, 2.0, 2.8, 2.8],
               ["序号", "类型", "招标要求", "分值", "结论", "依据", "缺口"],
               ["{{对照.序号}}", "{{对照.类型}}", "{{对照.要求}}", "{{对照.分值}}", "{{对照.结论}}",
                "{{对照.依据}}", "{{对照.缺口}}"], T)
    doc.save(path)
    normalize_zip(path)


# ---------------------------------------------------------------- pptx helpers

def rgb(h):
    return PRGB.from_string(h)


def style_run(run, size, color, bold=False, font="微软雅黑"):
    f = run.font
    f.size = PPt(size)
    f.bold = bold
    f.color.rgb = rgb(color)
    f.name = font
    rpr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        e = rpr.makeelement(qn(tag), {"typeface": font})
        rpr.append(e)


def tbox(slide, x, y, w, h, text, size, color, bold=False, font="微软雅黑", anchor=MSO_ANCHOR.TOP,
         align=PP_ALIGN.LEFT, spacing=1.2):
    s = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = s.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Inches(0.05)
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = spacing
    r = p.add_run()
    r.text = text
    style_run(r, size, color, bold, font)
    return s


def rect(slide, x, y, w, h, fill):
    s = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = rgb(fill)
    s.line.fill.background()
    s.shadow.inherit = False
    return s


def ptable(slide, x, y, widths, header, row, P, row_h=0.55):
    shape = slide.shapes.add_table(2, len(header), Inches(x), Inches(y), Inches(sum(widths)), Inches(row_h * 2))
    tbl = shape.table
    tbl.horz_banding = False
    tbl.first_row = True
    for i, w in enumerate(widths):
        tbl.columns[i].width = Inches(w)
    for ri, vals in enumerate((header, row)):
        tbl.rows[ri].height = Inches(row_h)
        for ci, v in enumerate(vals):
            c = tbl.cell(ri, ci)
            c.fill.solid()
            c.fill.fore_color.rgb = rgb(P["th"] if ri == 0 else P["td"])
            c.vertical_anchor = MSO_ANCHOR.MIDDLE
            c.margin_left = c.margin_right = Inches(0.12)
            p = c.text_frame.paragraphs[0]
            r = p.add_run()
            r.text = v
            style_run(r, 15, "FFFFFF" if ri == 0 else P["text"], bold=(ri == 0), font=P["font"])
    return shape


PN = dict(name="neutral", font="微软雅黑", bg="FFFFFF", dark="0B1F3A", accent="E0A030", text="26324A",
          muted="6B7690", th="0B1F3A", td="EEF1F6", title="0B1F3A", firm=None)
PQ = dict(name="qiheng", font="微软雅黑", bg="F8F4EA", dark="1F5C4A", accent="B08D57", text="2B3A34",
          muted="7B6A4A", th="1F5C4A", td="EFE8D4", title="1F5C4A", firm="启衡律师事务所")


def content_slide(prs, P, title, sub=None):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = rgb(P["bg"])
    if P["name"] == "neutral":
        rect(s, 0.8, 0.55, 0.1, 0.75, P["accent"])
        tbox(s, 1.05, 0.5, 11.4, 0.85, title, 30, P["title"], True, anchor=MSO_ANCHOR.MIDDLE)
    else:
        rect(s, 0, 0, 0.45, 7.5, P["dark"])
        rect(s, 0.45, 0, 0.07, 7.5, P["accent"])
        tbox(s, 1.0, 0.5, 11.5, 0.85, title, 30, P["title"], True, font="宋体", anchor=MSO_ANCHOR.MIDDLE)
        rect(s, 1.05, 1.38, 1.6, 0.05, P["accent"])
        tbox(s, 1.0, 6.95, 8, 0.35, "启衡律师事务所　|　专业　诚信　担当", 11, P["muted"])
    return s


def build_ppt(path, P):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
    cp = prs.core_properties
    cp.author = "AI WorkDeck"
    cp.last_modified_by = "AI WorkDeck"
    cp.created = FIXED_DT
    cp.modified = FIXED_DT
    cp.title = ""
    cp.revision = 1
    blank = prs.slide_layouts[6]
    q = P["name"] == "qiheng"
    X0 = 1.05 if q else 0.8   # content left edge
    W = 11.5 if q else 11.7
    ft = "宋体" if q else "微软雅黑"

    # 1 cover
    s = prs.slides.add_slide(blank)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = rgb(P["bg"] if q else P["dark"])
    if q:
        rect(s, 0, 0, 4.7, 7.5, P["dark"])
        rect(s, 4.7, 0, 0.08, 7.5, P["accent"])
        tbox(s, 0.5, 2.9, 3.8, 1.0, "启衡律师事务所", 30, "FFFFFF", True, font="宋体")
        rect(s, 0.55, 3.95, 1.4, 0.05, P["accent"])
        tbox(s, 0.5, 4.15, 3.8, 0.5, "QIHENG LAW FIRM", 14, "E3D3B0")
        tbox(s, 5.5, 2.0, 7.2, 1.9, "{{项目名称}}", 38, P["title"], True, font="宋体", anchor=MSO_ANCHOR.BOTTOM)
        rect(s, 5.55, 4.1, 1.6, 0.05, P["accent"])
        tbox(s, 5.5, 4.4, 7.2, 0.5, "{{客户名称}}", 22, P["text"])
        tbox(s, 5.5, 5.0, 7.2, 0.45, "{{律所名称}}", 18, P["muted"])
        tbox(s, 5.5, 5.5, 7.2, 0.45, "{{日期}}", 16, P["muted"])
    else:
        rect(s, 0.9, 2.35, 0.12, 1.9, P["accent"])
        tbox(s, 1.3, 2.2, 10.8, 1.5, "{{项目名称}}", 40, "FFFFFF", True, anchor=MSO_ANCHOR.MIDDLE)
        tbox(s, 1.3, 3.75, 10.8, 0.6, "{{客户名称}}", 22, "C9D3E6")
        tbox(s, 1.3, 5.6, 8, 0.5, "{{律所名称}}", 20, "FFFFFF", True)
        tbox(s, 1.3, 6.1, 8, 0.45, "{{日期}}", 16, "9FB0CC")

    # 2 firm
    s = content_slide(prs, P, "律所简介")
    tbox(s, X0, 1.75, W, 2.4, "{{律所简介}}", 16, P["text"], spacing=1.4)
    tbox(s, X0, 4.1, 6, 0.4, "资质与荣誉", 16, P["title"], True, font=ft)
    ptable(s, X0, 4.6, [5.0, 4.2, 2.0] if not q else [4.9, 4.1, 2.0], ["资质荣誉", "颁发机构", "年份"],
           ["{{资质.名称}}", "{{资质.颁发机构}}", "{{资质.年份}}"], P)

    # 3 team (repeats per lawyer)
    s = content_slide(prs, P, "服务团队：{{律师.姓名}}")
    tbox(s, X0, 1.6, 8, 0.5, "{{律师.职务}}", 20, P["accent"] if not q else P["muted"], True)
    y = 2.45
    for lab, ph in (("执业领域", "{{律师.领域}}"), ("执业年份", "{{律师.执业年份}}"), ("教育背景", "{{律师.教育}}")):
        tbox(s, X0, y, 4.6, 0.35, lab, 12, P["muted"])
        tbox(s, X0, y + 0.33, 4.6, 0.9, ph, 18, P["text"], True)
        y += 1.4
    rect(s, 6.3, 2.5, 0.06, 3.85, P["accent"])
    tbox(s, 6.55, 2.45, 5.9, 0.35, "个人简介", 12, P["muted"])
    tbox(s, 6.55, 2.85, 5.9, 3.6, "{{律师.简介}}", 16, P["text"], spacing=1.4)

    # 4 credentials
    s = content_slide(prs, P, "相关业绩")
    ptable(s, X0, 1.9, [1.9, 3.8, 2.4, 1.7, 1.7] if q else [1.9, 3.9, 2.5, 1.7, 1.7],
           ["序号", "项目名称", "客户", "年份", "角色"],
           ["{{业绩.序号}}", "{{业绩.名称}}", "{{业绩.客户}}", "{{业绩.年份}}", "{{业绩.角色}}"], P, row_h=0.6)

    # 5 service plan
    s = content_slide(prs, P, "服务方案")
    tbox(s, X0, 1.7, W, 5.1, "{{服务方案}}", 16, P["text"], spacing=1.35)

    # 6 quote
    s = content_slide(prs, P, "报价")
    ptable(s, X0, 1.9, [4.0, 4.7, 2.8] if q else [4.2, 4.7, 2.8], ["收费项目", "计算方式", "金额"],
           ["{{报价.项目}}", "{{报价.计算}}", "{{报价.金额}}"], P, row_h=0.6)
    tbox(s, X0, 4.2, W, 0.6, "合计 {{报价合计}}（{{报价大写}}）", 22, P["title"], True, font=ft)
    tbox(s, X0, 5.0, W, 1.7, "{{报价说明}}", 14, P["muted"], spacing=1.3)

    # 7 closing
    s = prs.slides.add_slide(blank)
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = rgb(P["dark"])
    if q:
        rect(s, 0, 5.2, 13.333, 0.06, P["accent"])
        tbox(s, 0, 2.3, 13.333, 1.0, "感谢聆听", 40, "FFFFFF", True, font="宋体", align=PP_ALIGN.CENTER)
        tbox(s, 0, 3.6, 13.333, 0.6, "{{律所名称}}", 22, "E3D3B0", align=PP_ALIGN.CENTER)
        tbox(s, 0, 5.5, 13.333, 0.5, "启衡律师事务所　QIHENG LAW FIRM", 14, "BFD3CB", align=PP_ALIGN.CENTER)
    else:
        rect(s, 6.17, 4.1, 1.0, 0.07, P["accent"])
        tbox(s, 0, 2.3, 13.333, 1.0, "感谢聆听", 40, "FFFFFF", True, align=PP_ALIGN.CENTER)
        tbox(s, 0, 3.4, 13.333, 0.6, "{{律所名称}}", 22, "C9D3E6", align=PP_ALIGN.CENTER)
    prs.save(path)
    normalize_zip(path)


# ---------------------------------------------------------------- tender fixture

def build_tender(path):
    T = Theme(name="tender", head_ea="黑体", body_ea="宋体", accent="000000", h_rule=None, th_fill="E7E9EE",
              th_color="000000", split=False, header_text="QCCT-2026-FW-118　招标文件", header_color="595959")
    global BODY_LS
    BODY_LS = 1.3
    doc = new_doc(T, T.header_text)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(110)
    add_runs(p, "青川市城市建设投资集团有限公司", T, size=22, bold=True, ea="黑体")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.line_spacing = 1.4
    add_runs(p, "2027—2029年度常年法律顾问服务采购项目", T, size=22, bold=True, ea="黑体")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(30)
    p.paragraph_format.space_after = Pt(100)
    add_runs(p, "招　标　文　件", T, size=30, bold=True, ea="黑体")
    for a, b in (("招标编号", "QCCT-2026-FW-118"), ("采 购 人", "青川市城市建设投资集团有限公司"),
                 ("采购代理机构", "青川汇招工程咨询有限公司"), ("发布日期", "2026年11月10日")):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_runs(p, a + "：" + b, T, size=14)
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    def kv_table(rows):
        t = doc.add_table(rows=len(rows), cols=2)
        t.style = "Table Grid"
        t.autofit = False
        t.columns[0].width, t.columns[1].width = Cm(3.8), Cm(12.6)
        for i, (k, v) in enumerate(rows):
            for j, txt in enumerate((k, v)):
                c = t.cell(i, j)
                c.width = Cm(3.8 if j == 0 else 12.6)
                if j == 0:
                    shade(c, "F0F1F4")
                pp = c.paragraphs[0]
                pp.paragraph_format.line_spacing = 1.2
                pp.paragraph_format.space_before = pp.paragraph_format.space_after = Pt(3)
                pp.paragraph_format.keep_with_next = i < len(rows) - 1
                add_runs(pp, txt, T, size=10.5, bold=(j == 0))
        return t

    def bp(text, **kw):
        return body_p(doc, text, T, **kw)

    heading(doc, "第一章　招标公告", T)
    bp("青川汇招工程咨询有限公司受青川市城市建设投资集团有限公司（以下简称“采购人”）委托，"
       "就其2027—2029年度常年法律顾问服务采购项目进行公开招标，欢迎符合资格条件的律师事务所参加投标。")
    heading(doc, "一、项目概况", T, 2)
    kv_table([("项目名称", "青川市城市建设投资集团有限公司2027—2029年度常年法律顾问服务采购项目"),
              ("招标编号", "QCCT-2026-FW-118"),
              ("采购方式", "公开招标"),
              ("预算金额", "年度不超过人民币40万元（含税），三年合计不超过人民币120万元"),
              ("服务期限", "三年，自合同签订之日起计算"),
              ("服务地点", "采购人住所地及采购人指定的其他地点"),
              ("投标截止时间", "2026年12月8日 09:30（北京时间）"),
              ("开标时间及地点", "2026年12月8日 09:30，青川市公共资源交易中心第三开标室"),
              ("联系方式", "采购代理机构：青川汇招工程咨询有限公司，联系人：吴经理，电话：0000-5550118（虚构）")])
    heading(doc, "二、获取招标文件", T, 2)
    bp("潜在投标人请于2026年11月10日至2026年11月17日（工作日 09:00—17:00）通过青川市公共资源交易平台（虚构）免费下载招标文件。")
    heading(doc, "三、其他事项", T, 2)
    bp("本项目不接受联合体投标，不接受分包。本公告在青川市公共资源交易平台同步发布。")

    heading(doc, "第二章　投标人须知", T)
    for t in ("1. 投标人应仔细阅读招标文件全部内容，按招标文件要求编制投标文件。未按要求提交的，其投标可能被拒绝。",
              "2. 投标文件应包括投标函、投标人资格证明文件、服务团队、类似业绩、服务方案、报价文件及其他应当提交的材料，"
              "并按第六章的格式装订成册，正本一份、副本四份，同时提交电子版一份。",
              "3. 投标报价为人民币含税价，应包含完成本项目全部服务内容所需的一切费用，投标报价超过预算金额的为无效投标。",
              "4. 投标有效期为自投标截止之日起90日。",
              "5. 投标人对招标文件有疑问的，应于投标截止时间十日前以书面形式向采购代理机构提出，逾期不予受理。",
              "6. 评标由采购人依法组建的评标委员会负责，评标委员会按第四章评分标准独立打分，以综合得分最高者为中标候选人。",
              "7. 投标人应对其在投标过程中知悉的采购人商业秘密和个人信息承担保密义务。"):
        bp(t, indent=False)

    heading(doc, "第三章　投标人资格要求", T)
    bp("投标人应同时满足以下全部资格条件，不满足任一项的，其投标将被认定为无效：")
    reqs = ["依法设立的律师事务所，且执业满10年；",
            "执业律师不少于50人；",
            "拟派项目负责人为合伙人，且执业满15年；",
            "近三年（2023年1月1日至今）承办过不少于3项国有企业或政府平台公司常年法律顾问业绩；",
            "具有建设工程或PPP项目法律服务业绩；",
            "近三年无行政处罚或行业处分记录；",
            "在青川市设有分所或办公场所；",
            "通过ISO 9001质量管理体系认证。"]
    for i, r in enumerate(reqs, 1):
        bp("%d. %s" % (i, r), indent=False)
    bp("投标人应在投标文件中提供上述资格条件的证明材料（营业执照、执业许可证、合同首尾页、证书复印件等），"
       "并加盖投标人公章。证明材料不全的，评标委员会可以要求投标人限期补正。", before=6)

    heading(doc, "第四章　评分标准", T)
    bp("评标采用综合评分法，满分100分。各评分项及评分细则如下：")
    rows = [("类似业绩", "10", "近三年（2023年1月1日至今）承办的国有企业或政府平台公司常年法律顾问项目，每项得2分，最高10分。需提供合同首尾页。"),
            ("团队负责人资历", "10", "拟派项目负责人执业年限、专业经历、所获荣誉等综合评价，评委在0—10分范围内打分。"),
            ("团队配置", "10", "拟派服务团队的人员规模、专业搭配、执业年限及分工合理性，评委在0—10分范围内打分。"),
            ("服务方案", "25", "对采购人业务的理解程度、服务内容的完整性、针对性和可操作性、风险防控措施，评委在0—25分范围内打分。"),
            ("应急响应", "5", "对紧急事项的响应时限、值班安排、现场到场承诺等，评委在0—5分范围内打分。"),
            ("荣誉资质", "5", "投标人获得全国优秀律师事务所、省级及以上优秀律师事务所等荣誉的，国家级得5分，省级得3分，市级得1分，不累计，取最高。"),
            ("报价", "30", "以通过资格审查的有效投标最低价为评标基准价，基准价得满分；其他投标人得分 = 基准价 ÷ 投标报价 × 30。"),
            ("信息安全与保密措施", "5", "信息管理制度、保密承诺、技术防护及人员保密管理措施，评委在0—5分范围内打分。")]
    t = doc.add_table(rows=len(rows) + 2, cols=3)
    t.style = "Table Grid"
    t.autofit = False
    wd = [3.6, 1.6, 11.2]
    for i, w in enumerate(wd):
        t.columns[i].width = Cm(w)
    allrows = [("评分项", "分值", "评分细则")] + rows + [("合计", "100", "")]
    for ri, vals in enumerate(allrows):
        for ci, v in enumerate(vals):
            c = t.cell(ri, ci)
            c.width = Cm(wd[ci])
            pp = c.paragraphs[0]
            pp.paragraph_format.line_spacing = 1.2
            pp.paragraph_format.space_before = pp.paragraph_format.space_after = Pt(3)
            if ri == 0:
                shade(c, "E7E9EE")
            if ci == 1:
                pp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_runs(pp, v, T, size=10.5, bold=(ri in (0, len(allrows) - 1)))
        t.rows[ri]._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
    bp("说明：评分中的“近三年”均指2023年1月1日至投标截止之日。同一客户的多项事务合并计算为一项。", before=6, size=11)

    heading(doc, "第五章　服务需求", T)
    bp("中标人应在服务期内为采购人及其下属全资、控股子公司提供常年法律顾问服务，工作范围包括但不限于：")
    scope = ["法律咨询：就采购人经营管理中的法律问题提供口头或书面咨询意见，一般咨询应在1个工作日内答复；",
             "合同审查：审查、起草、修改采购人各类合同及法律文件，涉及工程建设、投融资、采购等重大合同应出具书面审查意见；",
             "重大决策：参与采购人重大投资、重组、债务融资、资产处置等事项的论证，出具法律意见书；",
             "合规与风控：协助建立和完善合规管理体系、内控制度，开展法律风险排查，每年不少于2次专项风险提示；",
             "建设工程与PPP：为采购人的城市建设项目提供招投标、合同履行、工程变更与结算、PPP项目公司治理等全过程法律支持；",
             "争议处理：代理采购人参与诉讼、仲裁、调解及执行程序（诉讼仲裁代理另行签订委托合同，收费不在本项目预算内）；",
             "法治培训：每年为采购人管理层和业务部门提供不少于4场法治培训；",
             "紧急事项：设立专线并保证7×24小时联络，重大突发事件2小时内响应，必要时24小时内到场。"]
    for i, r in enumerate(scope, 1):
        bp("（%d）%s" % (i, r), indent=False)
    heading(doc, "服务质量要求", T, 2)
    bp("中标人应指派固定的项目负责人和不少于5人的服务团队，未经采购人同意不得更换项目负责人；"
       "每季度向采购人提交服务报告，服务期满前提交年度总结。中标人应严格保守采购人商业秘密，并对工作成果的准确性负责。")
    kv_table([("服务期限", "三年"), ("付款方式", "按年度分两期支付，每期支付年度顾问费的50%"),
              ("考核方式", "采购人每年组织一次服务满意度考核，考核不合格的有权解除合同")])

    heading(doc, "第六章　投标文件格式", T)
    bp("投标文件应按以下顺序编制，并编制目录和连续页码：")
    for t_ in ("1. 投标函（含对招标文件的实质性响应承诺）；",
               "2. 投标人基本情况及资格证明文件（营业执照、执业许可证、荣誉资质等）；",
               "3. 拟派服务团队及人员简历（含项目负责人资格证明）；",
               "4. 类似业绩一览表及证明材料；",
               "5. 服务方案；",
               "6. 报价文件（含报价明细、税费说明）；",
               "7. 资格与评分对照表；",
               "8. 其他需要说明的事项。"):
        bp(t_, indent=False)
    bp("投标文件封面应载明项目名称、招标编号、投标人名称及日期，并由法定代表人或授权代表签字、加盖公章。", before=6)
    BODY_LS = 1.5
    doc.save(path)
    normalize_zip(path)


# ---------------------------------------------------------------- library fixture

def build_library(path):
    lib = {
        "version": 1,
        "firm": {
            "name": "启衡律师事务所",
            "intro": "启衡律师事务所成立于2009年，总部设在江岭市，现有执业律师86人，其中合伙人23人。"
                     "本所深耕建设工程与基础设施、国企合规与常年法律顾问、争议解决、公司资本市场等领域，"
                     "长期为省市属国有企业、政府投融资平台及民营上市公司提供全周期法律服务。"
                     "本所坚持专业化分工与团队协作，建立了覆盖合同审查、风险预警和重大事项论证的标准化服务流程。",
        },
        "credentials": [
            {"id": "c1", "title": "江岭市城市发展投资集团有限公司常年法律顾问", "client": "江岭市城市发展投资集团有限公司",
             "clientAlias": "某市属城市发展平台公司", "area": "国企合规", "year": "2024", "amount": "年度顾问费 36 万元",
             "role": "常年法律顾问", "summary": "为集团及12家下属子公司提供常年法律顾问服务，年均审查合同300余份，出具重大事项法律意见书20余份。",
             "lawyers": ["沈知远", "林婉清", "韩雨桐"], "tags": ["国企", "平台公司", "常年顾问"], "source": "manual"},
            {"id": "c2", "title": "汇川新区开发建设有限公司常年法律顾问", "client": "汇川新区开发建设有限公司",
             "clientAlias": "某省级新区开发平台公司", "area": "国企合规", "year": "2025", "amount": "年度顾问费 28 万元",
             "role": "常年法律顾问", "summary": "协助平台公司完善投融资决策与合规审查流程，参与土地整理及安置房项目的全流程法律把控。",
             "lawyers": ["沈知远", "贺文博"], "tags": ["国企", "平台公司", "常年顾问"], "source": "manual"},
            {"id": "c3", "title": "岭南省能源化工集团股份有限公司常年法律顾问", "client": "岭南省能源化工集团股份有限公司",
             "clientAlias": "某省属能源化工国有企业", "area": "国企合规", "year": "2023", "amount": "年度顾问费 42 万元",
             "role": "常年法律顾问", "summary": "为省属能源化工集团提供合规体系建设、重大合同审查和国有资产交易的法律服务。",
             "lawyers": ["林婉清", "周子墨"], "tags": ["国企", "常年顾问", "合规"], "source": "manual"},
            {"id": "c4", "title": "北辰市交通运输集团有限公司常年法律顾问", "client": "北辰市交通运输集团有限公司",
             "clientAlias": "某市属交通运输国有企业", "area": "国企合规", "year": "2026", "amount": "年度顾问费 32 万元",
             "role": "常年法律顾问", "summary": "服务集团公共交通、物流与站场业务，重点处理特许经营、采购招标和劳动用工事务。",
             "lawyers": ["贺文博", "韩雨桐"], "tags": ["国企", "常年顾问"], "source": "manual"},
            {"id": "c5", "title": "江岭市地铁6号线PPP项目社会资本方法律服务", "client": "远航基础设施投资有限公司",
             "clientAlias": "某社会资本方联合体牵头人", "area": "建设工程", "year": "2024", "amount": "项目总投资约 86 亿元",
             "role": "牵头律师", "summary": "负责PPP项目投标、项目公司设立、融资及建设期合同体系的全程法律服务。",
             "lawyers": ["沈知远", "贺文博", "唐思齐"], "tags": ["PPP", "建设工程", "基础设施"], "source": "manual"},
            {"id": "c6", "title": "滨海新城综合体项目全过程法律服务", "client": "瑞铭置业集团有限公司",
             "clientAlias": "某大型房地产开发企业", "area": "建设工程", "year": "2025", "amount": "",
             "role": "项目法律顾问", "summary": "覆盖招标、总承包合同、变更签证、竣工结算及工程款支付的建设全周期法律服务。",
             "lawyers": ["林婉清", "周子墨"], "tags": ["建设工程", "全过程"], "source": "manual"},
            {"id": "c7", "title": "某大型建设工程施工合同纠纷仲裁案", "client": "恒域建设集团有限公司",
             "clientAlias": "某特级资质施工企业", "area": "争议解决", "year": "2024", "amount": "争议金额 2.3 亿元",
             "role": "主办律师", "summary": "代理施工企业在仲裁委员会主张工程款及违约金，裁决支持主要请求，回收工程款1.9亿元。",
             "lawyers": ["沈知远", "韩雨桐"], "tags": ["仲裁", "建设工程", "争议解决"], "source": "manual"},
            {"id": "c8", "title": "股权转让纠纷诉讼案", "client": "宏景实业控股有限公司",
             "clientAlias": "某实业控股集团", "area": "争议解决", "year": "2023", "amount": "争议金额 1.1 亿元",
             "role": "诉讼代理人", "summary": "代理股权受让方主张解除合同并返还转让款，二审改判支持全部诉讼请求。",
             "lawyers": ["林婉清", "周子墨"], "tags": ["诉讼", "股权", "争议解决"], "source": "manual"},
            {"id": "c9", "title": "云麓智能科技股份有限公司科创板IPO", "client": "云麓智能科技股份有限公司",
             "clientAlias": "某科创板拟上市企业", "area": "资本市场", "year": "2025", "amount": "",
             "role": "发行人律师", "summary": "担任发行人律师，完成尽职调查、股改、规范性问题整改及全套发行法律文件。",
             "lawyers": ["贺文博", "唐思齐"], "tags": ["IPO", "资本市场"], "source": "manual"},
            {"id": "c10", "title": "鼎盛连锁零售劳动用工合规及集体劳动争议处理", "client": "鼎盛连锁零售有限公司",
             "clientAlias": "某全国性连锁零售企业", "area": "劳动", "year": "2024", "amount": "",
             "role": "劳动合规顾问", "summary": "梳理全国门店用工合规体系，处理门店关闭引发的集体劳动争议，涉及员工320余人。",
             "lawyers": ["韩雨桐", "唐思齐"], "tags": ["劳动", "合规"], "source": "manual"},
        ],
        "lawyers": [
            {"id": "l1", "name": "沈知远", "title": "高级合伙人", "areas": ["建设工程", "国企合规"], "since": "2008",
             "education": "岭南大学法学院 法学硕士", "bio": "本所创始合伙人之一，执业18年，专注建设工程、PPP及国有企业法律顾问。担任多家省市属国企常年法律顾问，曾获岭南省优秀律师称号。"},
            {"id": "l2", "name": "林婉清", "title": "合伙人", "areas": ["国企合规", "争议解决"], "since": "2013",
             "education": "江岭大学法学院 法学硕士", "bio": "执业13年，擅长国有企业合规管理、重大合同及商事争议解决，主办多起金额过亿元的诉讼和仲裁案件。"},
            {"id": "l3", "name": "贺文博", "title": "合伙人", "areas": ["资本市场", "建设工程"], "since": "2014",
             "education": "北辰政法大学 法律硕士", "bio": "执业12年，主要从事资本市场、投融资及基础设施项目法律服务，参与多个IPO及PPP项目。"},
            {"id": "l4", "name": "韩雨桐", "title": "资深律师", "areas": ["争议解决", "劳动"], "since": "2016",
             "education": "江岭大学法学院 法学学士", "bio": "执业10年，擅长建设工程纠纷、劳动争议及企业合规，协助多家国企建立劳动用工合规制度。"},
            {"id": "l5", "name": "周子墨", "title": "律师", "areas": ["建设工程", "国企合规"], "since": "2019",
             "education": "岭南大学法学院 法学硕士", "bio": "执业7年，参与建设工程全过程法律服务和国企常年法律顾问工作，负责合同审查与法律检索。"},
            {"id": "l6", "name": "唐思齐", "title": "律师助理", "areas": ["资本市场", "劳动"], "since": "2024",
             "education": "江岭大学法学院 法学硕士", "bio": "2024年加入本所，协助团队开展尽职调查、法律检索、合同整理与项目文件管理工作。"},
        ],
        "qualifications": [
            {"id": "q1", "name": "律师事务所执业许可证", "kind": "资质", "issuer": "岭南省司法厅", "year": "2009", "expires": ""},
            {"id": "q2", "name": "岭南省优秀律师事务所", "kind": "荣誉", "issuer": "岭南省律师协会", "year": "2024", "expires": ""},
            {"id": "q3", "name": "江岭市律师协会先进集体", "kind": "荣誉", "issuer": "江岭市律师协会", "year": "2023", "expires": ""},
            {"id": "q4", "name": "岭南省政府法律顾问单位库入库单位", "kind": "资质", "issuer": "岭南省司法厅", "year": "2023", "expires": "2027-12-31"},
            {"id": "q5", "name": "江岭市律师行业党建示范点", "kind": "荣誉", "issuer": "江岭市司法局", "year": "2022", "expires": ""},
        ],
        "services": [
            {"id": "s1", "title": "常年法律顾问服务方案", "area": "常年顾问",
             "content": "本所将组建由合伙人牵头、不少于5人的固定服务团队，为贵方提供全面的常年法律顾问服务。\n"
                        "日常咨询：对贵方提出的一般法律问题，在1个工作日内给予答复，复杂问题在3个工作日内出具书面意见。\n"
                        "合同与制度：审查、起草和修改各类合同及规章制度，对重大合同提供书面审查意见并跟踪履行。\n"
                        "重大事项：参与重大投资、融资、重组和资产处置事项的论证，出具法律意见书并提示风险。\n"
                        "合规与培训：每年开展不少于2次法律风险排查，提供不少于4场专题培训。\n"
                        "应急响应：设立7×24小时联络专线，重大突发事件2小时内响应，必要时24小时内到场。"},
            {"id": "s2", "title": "建设工程全过程法律服务", "area": "建设工程",
             "content": "本所为建设工程项目提供从立项到结算的全过程法律服务。\n"
                        "前期阶段：协助完成招标投标合规审查、合同体系设计和重大风险评估。\n"
                        "实施阶段：审查并跟踪合同履行，处理工程变更、签证、索赔和工期争议，防范逾期与质量风险。\n"
                        "结算阶段：协助竣工验收、结算审计及工程款支付，必要时通过仲裁或诉讼维护合法权益。"},
            {"id": "s3", "title": "争议解决服务", "area": "争议解决",
             "content": "本所争议解决团队代理民商事诉讼、仲裁及执行案件。\n"
                        "案件评估：接受委托后一周内出具案件分析与策略意见，明确证据与风险。\n"
                        "程序代理：全程代理一审、二审、仲裁及执行程序，重大节点向委托方书面汇报。\n"
                        "和解调解：在维护委托方利益的前提下，积极评估和解方案，降低纠纷成本。"},
        ],
        "quotes": [
            {"id": "p1", "name": "常年法律顾问年度固定费", "mode": "mixed", "note": "年度固定费含日常咨询、合同审查与培训；专项事务按小时另行计费。",
             "rates": {"高级合伙人": "3500", "合伙人": "2800", "资深律师": "1800", "律师": "1200", "律师助理": "500"},
             "items": [{"label": "年度常年法律顾问费", "kind": "fixed", "amount": "300000"},
                       {"label": "专项事务（合伙人）", "kind": "hourly", "title": "合伙人", "hours": "40"}],
             "discountPct": "10", "capAmount": "", "taxRatePct": "6", "taxIncluded": True},
            {"id": "p2", "name": "专项计时收费", "mode": "hourly", "note": "按实际工作小时计费，每月提交工时清单。",
             "rates": {"高级合伙人": "3500", "合伙人": "2800", "资深律师": "1800", "律师": "1200", "律师助理": "500"},
             "items": [{"label": "高级合伙人", "kind": "hourly", "title": "高级合伙人", "hours": "20"},
                       {"label": "合伙人", "kind": "hourly", "title": "合伙人", "hours": "40"},
                       {"label": "律师", "kind": "hourly", "title": "律师", "hours": "120"},
                       {"label": "律师助理", "kind": "hourly", "title": "律师助理", "hours": "60"}],
             "discountPct": "5", "capAmount": "600000", "taxRatePct": "6", "taxIncluded": False},
        ],
    }
    Path(path).write_text(json.dumps(lib, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    SAMPLES.mkdir(parents=True, exist_ok=True)
    FIX.mkdir(parents=True, exist_ok=True)
    build_bid(SAMPLES / "bid-template.docx", NEUTRAL)
    build_ppt(SAMPLES / "proposal-template.pptx", PN)
    build_bid(FIX / "qiheng-bid-template.docx", QIHENG)
    build_ppt(FIX / "qiheng-proposal-template.pptx", PQ)
    build_tender(FIX / "tender-chengtou-2027.docx")
    build_library(FIX / "library-qiheng.json")
    print("done")
