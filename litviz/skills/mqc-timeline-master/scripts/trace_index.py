# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""溯源索引 DOCX 生成器：trace_index.js 的纯 Python 标准库替身 [AWD-PATCH 8]。

为什么不用 node + npm docx：那条路要求用户机器装 Node 与全局 docx 包，主 SVG 出得来、
索引却缺依赖（桌面端两者都不随包分发）。这份文档是**固定格式的小文件**（一个标题、一段
说明、一张五列三线表、一段尾注、页脚页码），用 zipfile 生成 OOXML 保留内容与格式约定，
零外部依赖，Mac/Windows 行为一致。

与 trace_index.js 的输出语义逐条对齐（不改任何事实内容）：
- 五列：图上编号 / 卡片上的文字 / 出自材料 / 定位 / 原文摘录；列宽 1150/2400/1500/1200/2750。
- 三线表：顶线、表头下线、底线 0.75pt 黑；其余格线 0.25pt 灰；首列左缘、末列右缘无线。
- 直角引号「」『』一律换中文引号 “”，收在 _run 一个出口做。
- 中文宋体、西文与数字 Times New Roman（rFonts 的 ascii/hAnsi/eastAsia 分别指定）。
- 每个段落关掉 autoSpaceDE / autoSpaceDN（js 版生成后还要 _kill_autospace 二次解包，
  这里生成时就写进每个 pPr，一步到位）。
- 表头行 tblHeader 跨页重复；单元格纵向居中；第 1、4 列水平居中，其余两端对齐。
- A4 纵向，页边距四周 1440 缇；页脚正中页码（Times New Roman 9pt）。

用法（与 js 版命令行兼容）：
    python trace_index.py <trace.json> <输出.docx>
也可进程内调用 write_docx(payload, out_path)。
"""
import json
import os
import sys
import tempfile
import re
import zipfile
from xml.sax.saxutils import escape

CN = "宋体"
EN = "Times New Roman"
W = [1150, 2400, 1500, 1200, 2750]

# 三线表主线 6（0.75pt 黑）；细格线 2（0.25pt 灰）。按单侧边框生成， tcBorders 里
# 四条边按 top/left/bottom/right 的顺序各出现一次。
def _bd(tag, sz, color):
    return f'<w:{tag} w:val="single" w:sz="{sz}" w:space="0" w:color="{color}"/>'


def _nb(tag):
    return f'<w:{tag} w:val="none" w:sz="0" w:space="0" w:color="FFFFFF"/>'


def _line(tag):
    return _bd(tag, 6, "000000")


def _hair(tag):
    return _bd(tag, 2, "808080")


def _none(tag):
    return _nb(tag)
_AUTOSPACE = '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>'


def to_curly(s):
    """直角引号一律换中文引号 —— 收在 _run 这一个出口做，不会有哪一处忘了换。"""
    return (str("" if s is None else s)
            .replace("\u300c", "\u201c").replace("\u300d", "\u201d")
            .replace("\u300e", "\u201c").replace("\u300f", "\u201d"))


def _run(text, size=21, bold=False, eastasia=CN):
    text = to_curly(text)
    for ch in text:
        code = ord(ch)
        if not (code in (9, 10, 13) or 0x20 <= code <= 0xD7FF
                or 0xE000 <= code <= 0xFFFD or 0x10000 <= code <= 0x10FFFF):
            raise ValueError(f"原文包含 XML 不支持的字符 U+{code:04X}，未写入索引")
    # XML 中的换行/制表符只是文本空白；Word 需要显式 br/tab 才能保留显示语义。
    parts = re.split(r"(\n|\t)", text.replace("\r\n", "\n").replace("\r", "\n"))
    content = "".join('<w:br/>' if part == "\n" else '<w:tab/>' if part == "\t"
                      else f'<w:t xml:space="preserve">{escape(part)}</w:t>' for part in parts)
    return ('<w:r><w:rPr>'
            f'<w:rFonts w:ascii="{EN}" w:hAnsi="{EN}" w:eastAsia="{eastasia}"/>'
            f'{"<w:b/>" if bold else ""}'
            f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
            '</w:rPr>'
            f'{content}</w:r>')


def _para(text, size=21, bold=False, center=False, after=0, before=0,
          eastasia=CN):
    jc = "center" if center else "left"
    spacing = (f'<w:spacing w:before="{before}" w:after="{after}"/>'
               if (before or after) else "")
    return (f'<w:p><w:pPr>{_AUTOSPACE}{spacing}'
            f'<w:jc w:val="{jc}"/></w:pPr>'
            f'{_run(text, size=size, bold=bold, eastasia=eastasia)}</w:p>')


def _cell(text, width, bold=False, center=False, top=None, bottom=None,
          left=None, right=None):
    """top/bottom/left/right 收单侧边框 XML 片段，None 落细格线（_hair）。"""
    def pick(side, tag):
        return side(tag) if callable(side) else _hair(tag)
    borders = ("<w:tcBorders>"
               f'{pick(top, "top")}{pick(left, "left")}'
               f'{pick(bottom, "bottom")}{pick(right, "right")}'
               "</w:tcBorders>")
    jc = "center" if center else "both"   # 两端对齐 = Word 的 CTRL+J
    return ('<w:tc>'
            f'<w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{borders}'
            '<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
            '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/>'
            '</w:tcMar><w:vAlign w:val="center"/></w:tcPr>'
            f'<w:p><w:pPr>{_AUTOSPACE}<w:jc w:val="{jc}"/></w:pPr>'
            f'{_run(text, bold=bold)}</w:p></w:tc>')


def build_document_xml(data):
    headers = ["图上编号", "卡片上的文字", "出自材料", "定位", "原文摘录"]
    rows = data.get("rows") or []

    header_cells = "".join(
        _cell(t, W[i], bold=True, center=True,
              top=_line, bottom=_line,
              left=_none if i == 0 else None,
              right=_none if i == 4 else None)
        for i, t in enumerate(headers))
    header_row = f'<w:tr><w:trPr><w:tblHeader/></w:trPr>{header_cells}</w:tr>'

    body_rows = []
    for idx, r in enumerate(rows):
        cells = "".join(
            _cell(r.get(k, ""), W[i],
                  center=(i in (0, 3)),
                  bottom=_line if idx == len(rows) - 1 else None,
                  left=_none if i == 0 else None,
                  right=_none if i == 4 else None)
            for i, k in enumerate(("no", "head", "file", "locator", "quote")))
        body_rows.append(f"<w:tr>{cells}</w:tr>")

    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in W)
    total = sum(W)
    table = ('<w:tbl><w:tblPr>'
             f'<w:tblW w:w="{total}" w:type="dxa"/>'
             '<w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
             '<w:left w:val="none" w:sz="0" w:space="0" w:color="FFFFFF"/>'
             '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>'
             '<w:right w:val="none" w:sz="0" w:space="0" w:color="FFFFFF"/>'
             '<w:insideH w:val="single" w:sz="2" w:space="0" w:color="808080"/>'
             '<w:insideV w:val="single" w:sz="2" w:space="0" w:color="808080"/>'
             '</w:tblBorders><w:tblLayout w:type="fixed"/>'
             f'</w:tblPr><w:tblGrid>{grid}</w:tblGrid>'
             f'{header_row}{"".join(body_rows)}</w:tbl>')

    footer_para = ('<w:p><w:pPr>' + _AUTOSPACE + '<w:jc w:val="center"/></w:pPr>'
                   '<w:fldSimple w:instr=" PAGE ">' + _run("1", size=18, eastasia=EN)
                   + '</w:fldSimple></w:p>')

    body = (
        _para(data.get("title") or "溯源索引", size=32, bold=True,
              center=True, after=240)
        + _para(data.get("note")
                or "本表说明图上各元素分别出自材料何处，仅列对应关系，不含任何评价。",
                after=240)
        + table
        + _para(data.get("foot")
                or "“定位”为材料规范化后的句号，可据此回到原文逐字核对。",
                before=240)
        + '<w:sectPr>'
        '<w:footerReference w:type="default" r:id="rId2"/>'
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" '
        'w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
        '</w:sectPr>')

    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<w:document '
            'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<w:body>{body}</w:body></w:document>'), footer_para


_STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
           '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:docDefaults><w:rPrDefault><w:rPr>'
           f'<w:rFonts w:ascii="{EN}" w:hAnsi="{EN}" w:eastAsia="{CN}"/>'
           '<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>'
           '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" '
           'w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
           '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
           '<w:name w:val="Normal"/><w:qFormat/></w:style>'
           '</w:styles>')

_CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                  '<Default Extension="rels" ContentType='
                  '"application/vnd.openxmlformats-package.relationships+xml"/>'
                  '<Default Extension="xml" ContentType="application/xml"/>'
                  '<Override PartName="/word/document.xml" ContentType='
                  '"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                  '<Override PartName="/word/styles.xml" ContentType='
                  '"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                  '<Override PartName="/word/footer1.xml" ContentType='
                  '"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
                  '</Types>')

_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
         '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/'
         'officeDocument/2006/relationships/officeDocument" '
         'Target="word/document.xml"/></Relationships>')

_DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/'
             'officeDocument/2006/relationships/styles" Target="styles.xml"/>'
             '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/'
             'officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
             '</Relationships>')


def build_docx_bytes(data):
    """把 payload 组装成完整 DOCX 的字节。"""
    doc_xml, footer_para = build_document_xml(data)
    footer_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                  '<w:ftr xmlns:w="http://schemas.openxmlformats.org/'
                  'wordprocessingml/2006/main">'
                  f'{footer_para}</w:ftr>')
    import io
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CONTENT_TYPES)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/document.xml", doc_xml)
        z.writestr("word/_rels/document.xml.rels", _DOC_RELS)
        z.writestr("word/styles.xml", _STYLES)
        z.writestr("word/footer1.xml", footer_xml)
    return out.getvalue()


def write_docx(payload, out_path):
    """原子写出：先写同目录临时文件再 os.replace，失败不留半个 docx。"""
    blob = build_docx_bytes(payload)   # 组装失败在写盘前抛出
    tmp = None
    try:
        # 同目录唯一临时文件：原子替换且不覆盖/清理另一调用的 .part。
        with tempfile.NamedTemporaryFile(mode="wb", dir=os.path.dirname(os.path.abspath(out_path)),
                                         prefix=".trace-index-", suffix=".part", delete=False) as f:
            tmp = f.name
            f.write(blob)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, out_path)
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass

    return len(blob)


def main(argv):
    if len(argv) < 2:
        print("用法：python trace_index.py <trace.json> <输出.docx>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as source:
        data = json.load(source)
    out = argv[2] if len(argv) > 2 else "溯源索引.docx"
    n = write_docx(data, out)
    print(f"写出 {out} {n} 字节")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
