"""Edge-weight audit: does a bar's top rule print at the same weight as its bottom?

Why this exists: a reader spotted that the timeline band's lower rule was visibly
heavier than its upper one. Nothing in the SVG was asymmetric — the cause was
rasterisation. The canvas was rendered at 150 dpi, i.e. a scale of 1.5625, so
integer coordinates landed mid-pixel and a 1.2px centred stroke resolved to one
dark pixel on top and two underneath.

Two rules came out of it, and this script is what holds them:
  * raster at an EXACT integer scale (dpi 192 = 2x, output size pinned), so every
    integer coordinate falls on a pixel boundary;
  * keep hairline stroke widths INTEGER — at 2x a 1.2px stroke is 2.4 device px
    whose two partial ends can round differently at the two edges of one bar.

What it measures is INK — the summed coverage near an edge — not a count of
pixels past a threshold. Counting thresholded pixels reports 2.33 ink as "3" and
2.24 ink as "2" and cries wolf, and a verifier that cries wolf is worse than
none: it trains you to ignore it. For the same reason it needs two independent
sample columns to agree, skips corner arcs, and ignores windows swamped by text.

Usage:  python3 scripts/audit_edges.py figure.svg figure.png
"""

# 放在第三方依赖的 import 之前：没装 openpyxl / Pillow / numpy 的机器上 --help 也要能看用法
if __name__ == "__main__" and {"-h", "--help"} & set(__import__("sys").argv[1:]):   # 只打印用法、什么都不做（原来会把 --help 当成文件名）
    getattr(__import__("sys").stdout, "reconfigure", lambda **k: None)(encoding="utf-8")
    print((__doc__ or "").strip() or "用法见本模块的 SKILL.md")
    raise SystemExit(0)
if __name__ == "__main__":                  # 出错边界也装在第三方 import 之前：没装 openpyxl / Pillow 时说缺什么、怎么装
    try:
        __import__("_cli_errors").install()
    except ImportError:
        pass
from PIL import Image
import re, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from export_pptx import parse_svg          # honours <g transform="translate(...)">

def run(svgf, pngf, tol=0.25):
    s = open(svgf, encoding="utf-8-sig").read()   # 不写编码时中文 Windows 按 GBK 读，自己画的 SVG 都读不了
    _w = re.search(r'width="([\d.]+)"', s)
    if not _w:                                  # 给的不是 SVG：说清楚，不甩 AttributeError
        raise RuntimeError(f"{svgf} 不是一张 SVG（找不到 width）：第一个参数给出图的 .svg，第二个给对应的 .png")
    W = float(_w.group(1))
    im = Image.open(pngf).convert("L"); k = im.width / W
    base = im.getpixel((3, 3))
    def ink(px, py):
        """边缘附近的总墨量(0=无墨)。返回 None 表示这里被文字/实心块淹没。"""
        vals = [im.getpixel((int(px), int(py) + d)) for d in range(-4, 5)]
        cov = [max(0.0, (base - v) / base) for v in vals]
        if sum(c > 0.9 for c in cov) >= 6:
            return None
        return sum(cov)
    bad = []
    for pr in parse_svg(s):
        # geometry comes from the parser so group transforms are applied — 歸藏风
        # wraps its content in translate(0,60) for the 天头, and reading the raw
        # attributes sampled 60px away from the edge being measured
        if pr["k"] != "rect" or not pr.get("stroke"): continue
        x, y, w, h, rx = pr["x"], pr["y"], pr["w"], pr["h"], pr.get("rx", 0.0)
        if w < 40 or h < 10: continue
        for f in (0.12, 0.25, 0.75, 0.88):
            sx = x + w * f
            if sx < x + rx + 2 or sx > x + w - rx - 2:
                continue                      # on the corner arc, not the flat edge
            a, b = ink(sx*k, y*k), ink(sx*k, (y+h)*k)
            if a and b and 0.5 <= max(a, b) < 4.0 and abs(a-b) / max(a, b) > tol:
                bad.append(f"{w:.0f}x{h:.0f}@({x:.0f},{y:.0f}) 上墨量{a:.2f} 下墨量{b:.2f} "
                           f"(差 {abs(a-b)/max(a,b)*100:.0f}%)")
                break
    return bad


def _quiet_broken_pipe():
    """`… | head` closes the pipe early; without this the script ends on a
    traceback, which looks like a crash to anyone reading the terminal."""
    import signal
    try:
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    except (AttributeError, ValueError):
        pass

if __name__ == "__main__":
    try:                                   # 常见输入错误（路径、JSON、编码）说人话，不甩堆栈
        __import__("_cli_errors").install()
    except ImportError:
        pass
    # Windows 中文系统的控制台默认 GBK：不固定成 UTF-8，外部 AI（按 UTF-8 读）看到的是乱码，
    # 自检里的「↳」这类字符还会直接让程序崩溃。写法与关系图大师 make.py 一致。
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    _quiet_broken_pipe()
    r = run(sys.argv[1], sys.argv[2]); print("\n".join(r) if r else "对称")
