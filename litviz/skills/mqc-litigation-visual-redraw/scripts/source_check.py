#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""源图预检：在开始读图之前，先判断源是矢量还是位图，并把代价说清楚。

为什么要有这一步（真实运行记录）：使用者给了一张 1920×667 的截图，宿主又不让模型看图，
模型于是用像素测量去估文本边界、「还原」出 28 条文字，还标成逐字照录；整轮跑下来又慢
又贵，文字来源还不可靠。而同一张图如果是 SVG，文字是真文字，抽出来只要几百 token。

所以这一步做两件事，都在**开工之前**：
  1. 认出每个源是哪一类：矢量（SVG）、有文字层的 PDF、位图（PNG/JPG…）、
     没有文字层的 PDF（扫描件）、或本身就是矢量原件（PPTX/VSDX/drawio，可另存 SVG）。
  2. 只要有一个源要靠读图，就打印代价提醒与一句必须问使用者的话，
     并以退出码 3 表示「等使用者回话，不要自行开工」。

判据只看文件本身，不猜：SVG 数 <text> 段；PDF 逐页数可读汉字；其余按扩展名。
"""
import os
import re
import sys

VECTOR = {".svg"}
BITMAP = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
ORIGINAL = {".pptx", ".ppt", ".vsdx", ".drawio", ".xml", ".fig", ".ai", ".emf", ".wmf"}


def _svg_text_runs(path):
    """数 SVG 里的文字段：<text> 与 <foreignObject> 里的 HTML 文字都算。

    真实运行记录：Mermaid 导出的关系图把 56 段文字全放在 foreignObject 里，
    一个 <text> 都没有，于是被误判成位图、退出码 3 拦下；而那份 SVG 的文字
    其实是真文字，逐字可抄。"""
    s = open(path, encoding="utf-8-sig", errors="replace").read()
    n = len(re.findall(r"<text\b", s))
    for fo in re.findall(r"<foreignObject\b[\s\S]*?</foreignObject>", s):
        if re.sub(r"<[^>]+>", "", fo).strip():
            n += 1
    return n


def _pdf_pages_text(path):
    """逐页可读汉字数。装了 PyMuPDF 或 pypdf 才能判，都没装就返回 None（不瞎猜）。"""
    pages = None
    try:
        try:
            import pymupdf as _mu
        except ImportError:
            import fitz as _mu
        with _mu.open(path) as doc:
            pages = [p.get_text() for p in doc]
    except ImportError:
        try:
            import pypdf
            pages = [(p.extract_text() or "") for p in pypdf.PdfReader(path).pages]
        except ImportError:
            return None
    return [len(re.findall(r"[\u4e00-\u9fff]", t)) for t in pages]


def classify(path):
    """返回 (类别, 一句话说明)。类别：vector / pdf_text / bitmap / pdf_scan / original / unknown"""
    ext = os.path.splitext(path)[1].lower()
    if ext in VECTOR:
        n = _svg_text_runs(path)
        if n:
            return "vector", f"矢量图，{n} 段文字可逐字照录"
        return "bitmap", "SVG 里没有文字段（可能整幅是嵌入位图或已转曲），只能靠读图"
    if ext == ".pdf":
        cjk = _pdf_pages_text(path)
        if cjk is None:
            return "unknown", "PDF：本机没装 PyMuPDF / pypdf，判不了有没有文字层"
        if sum(cjk) >= 5 * max(1, len(cjk)):
            return "pdf_text", f"PDF 有文字层，{len(cjk)} 页共 {sum(cjk)} 个汉字可逐字照录"
        return "pdf_scan", f"PDF {len(cjk)} 页只有 {sum(cjk)} 个汉字，是扫描件，只能靠读图"
    if ext in BITMAP:
        return "bitmap", "位图，只能靠读图还原"
    if ext in ORIGINAL:
        return "original", "矢量原件，另存或导出为 SVG 后文字可逐字照录"
    return "unknown", "认不出格式"


def report(paths):
    rows = [(p, *classify(p)) for p in paths]
    heavy = [r for r in rows if r[1] in ("bitmap", "pdf_scan")]
    orig = [r for r in rows if r[1] == "original"]
    out = ["源图预检"]
    for p, kind, why in rows:
        mark = {"vector": "好", "pdf_text": "好", "original": "可更好",
                "bitmap": "费时费钱", "pdf_scan": "费时费钱"}.get(kind, "不确定")
        out.append(f"  [{mark}] {os.path.basename(p)}　{why}")
    if orig and not heavy:
        out += ["", "　提示：这是矢量原件，导出成 SVG 再给我，文字可逐字照录，更快也更准。"]
    if heavy:
        out += ["",
                "　⚠ 其中有只能靠读图的源。继续的话会发生什么，先说清楚：",
                "　　· 读图比读文字慢得多，token（积分）消耗通常高出一个量级；",
                "　　· 宿主不让模型看图时，图上的字根本读不出来，这一步会直接卡住；",
                "　　· 字是看出来的，遇到截断、小字、盖章会读错，需要你逐条核对。",
                "",
                "　更省的做法（任选其一，几分钟就能拿到）：",
                "　　1. 原件是 PPT / drawio / Figma / Visio：另存或导出为 SVG，把 SVG 给我；",
                "　　2. 原件是有文字层的 PDF：直接把 PDF 给我；",
                "　　3. 都没有：你把图上的文字抄成一份文本给我（或口述），我据此重画。",
                "",
                "　请回答：继续用现在这张图（回「继续」），还是换 SVG / PDF / 文字稿（回「换」）？",
                "　在你回答之前不要开工。"]
    return "\n".join(out), bool(heavy)


def main(argv):
    if not argv:
        print("用法：python3 scripts/source_check.py 源文件 [更多源文件…]")
        return 2
    text, heavy = report(argv)
    print(text)
    return 3 if heavy else 0


if __name__ == "__main__":
    if {"-h", "--help"} & set(__import__("sys").argv[1:]):   # 只打印用法、什么都不做（原来会把 --help 当成文件名）
        getattr(__import__("sys").stdout, "reconfigure", lambda **k: None)(encoding="utf-8")
        print((__doc__ or "").strip() or "用法见本模块的 SKILL.md")
        raise SystemExit(0)
    try:                                   # 常见输入错误（路径、JSON、编码）说人话，不甩堆栈
        __import__("_cli_errors").install()
    except ImportError:
        pass
    import sys as _sys
    for _stream in (_sys.stdout, _sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    sys.exit(main(sys.argv[1:]))
