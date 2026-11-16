#!/usr/bin/env python3
"""Generate the CHECKPOINT questions — deterministically.

Why a script and not a paragraph of guidance
--------------------------------------------
This skill's whole premise is that the model supplies meaning and the scripts
supply everything that has to come out the same every time. Until now the
checkpoint was the exception: SKILL.md *asked* the model to put three questions
to the user, which meant a hurried or weaker model could drop one, garble the
options, or invent an extra. The consequences of those questions are enforced
deterministically (`common.strip_unearned_emphasis`, the `-draft` naming), so the
questions themselves should be too.

So the questions are generated FROM the map: the same wording every time, and the
emphasis candidates are the diagram's own elements, numbered, so the user answers
with a number instead of describing something.

Usage
-----
    python3 scripts/checkpoint.py map.json                # show the questions
    python3 scripts/checkpoint.py map.json --suggest=11  # …with your proposed emphasis
    python3 scripts/checkpoint.py map.json --json        # machine-readable candidates

The model shows the output, waits for a reply, records it in the map's
`checkpoint` block, and renders. Nothing here writes files or decides anything —
it only makes sure the user is asked the same three things, properly.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import EMPHASIS_HOSTS   # noqa: E402

# Each mode is described by what it LOOKS like and what it is FOR. Neither line
# may describe it by whose style it is: these names are the author's, but the
# people reading this menu are other lawyers choosing a look for their own case
# file — "personal brand" is a reason that belongs to exactly one user.
# The three "适合" lines divide the ground between them rather than compete for
# it. 奇川风 really is the general-purpose one — with the red opt-in its palette
# is under 10% chroma, so it photocopies and files without losing anything — and
# saying so is a fact about the output, not a pitch. That leaves 歸藏风 for reaching
# an audience, and narrows 白描 to what it is genuinely FOR: the cases that demand
# pure black and white.
# Order is fixed: 奇川风 → 歸藏风 → 白描. It is the author's, and it is the order
# every description in this repo follows, so the reader meets the three modes the
# same way wherever they look.
MODE_ORDER = ("奇川风", "歸藏风", "白描")
MODES = [
    ("奇川风", "默认", "宋体标题 · 灰阶分层 · 单一深红点睛",
     "多数场合通用 —— 呈报法庭、交当事人、内部办案皆可"),
    ("歸藏风", "--guizang", "克莱因蓝 · 浅灰点阵底 · 无衬线 · 直角发丝线",
     "对外传播 —— 线上发布、课件、分享"),
    ("白描", "--baimiao", "纯黑白线稿 · 实心块转白底框线 · 近直角",
     "须为纯黑白时 —— 打印、影印、卷宗附件"),
]
assert tuple(m[0] for m in MODES) == MODE_ORDER

# Why THIS layout was chosen. The layout is mostly decided by the data, not by
# taste (extraction-guide's ordered ladder), so the menu shows the reason and the
# siblings that are genuinely available — rather than offering a free choice that
# includes forms the data cannot support.
LAYOUT_WHY = {
    "graphviz_flow":            ("流程图",            "有分支的处理过程，不是时间序列"),
    "graphviz_relation":        ("关系图 · 网络",      "主体之间多向关联，存在多个来源"),
    "relation_tree":            ("关系图 · 层级树",    "自上而下的单一从属关系"),
    "comparison_table":         ("关系图 · 对比表",    "两个对象逐维度对读"),
    "numbered_point_timeline":  ("时间轴 · 编号型",    "按先后等距排列，不按真实时距"),
    "dated_point_timeline":     ("时间轴 · 日期型",    "有精确日期，真实时距有意义"),
    "proportional_gantt":       ("时间轴 · 期间型",    "期间的长短与重叠本身就是法律要点"),
}
FAMILIES = [
    ("时间轴", ("numbered_point_timeline", "dated_point_timeline", "proportional_gantt")),
    ("关系图", ("graphviz_relation", "relation_tree", "comparison_table")),
    ("流程图", ("graphviz_flow",)),
]


def candidates(m):
    """Every element that could carry the emphasis, in reading order.

    Edges are shown by their endpoints' TITLES, not their internal ids: the user
    is being asked to pick what the case turns on, and "n3 → n4" is not something
    anyone can weigh."""
    titles = {}
    for host in ("nodes", "points", "events", "spans"):
        for it in (m.get(host) or []):
            if isinstance(it, dict) and it.get("id"):
                titles[it["id"]] = " ".join(str(
                    it.get("title") or it.get("label") or it.get("text") or it["id"]).split())
    out = []
    for host in EMPHASIS_HOSTS:
        for it in (m.get(host) or []):
            if not isinstance(it, dict):
                continue
            label = (it.get("title") or it.get("label") or it.get("text")
                     or it.get("name") or it.get("id") or "")
            label = " ".join(str(label).split())
            if not label:
                continue
            if host == "edges":
                a = titles.get(it.get("from"), it.get("from", "?"))
                b = titles.get(it.get("to"), it.get("to", "?"))
                arrow = f"{a[:16]} → {b[:16]}"
                label = arrow + (f"（{label}）" if label else "")
            out.append({"host": host, "id": it.get("id"), "label": label})
    return out


def _kind(host):
    return {"events": "事件", "spans": "期间", "points": "节点",
            "nodes": "模块", "edges": "关系"}.get(host, host)


def _siblings(layout):
    """The forms this figure could genuinely be swapped to — its own family."""
    for fam, members in FAMILIES:
        if layout in members:
            others = [LAYOUT_WHY[x][0].split(" · ")[-1] for x in members if x != layout]
            return fam, others
    return None, []


# 输出格式菜单。默认只出 SVG 与 PPTX：两者都不依赖任何外部工具，任何一台 Windows
# 都能一次出齐；PNG 最容易出不来（真实运行里五个 skill 无一幸免），选了才出。
FORMAT_MENU = (
    ("svg",    "SVG",    "主交付物，插进 Word 再编辑，永远会出"),
    ("png",    "PNG",    "位图预览，微信发、打印；需要本机有转图工具"),
    ("pptx",   "PPTX",   "PowerPoint / WPS 里逐个可改"),
    ("vsdx",   "VSDX",   "ProcessOn / Visio / WPS 可打开编辑"),
    ("drawio", "drawio", "draw.io 里可改"),
)
DEFAULT_FORMATS = ("svg", "pptx")


def parse_formats(ans):
    """把使用者的回答（「1,3」「全部」「svg,pptx」或空）变成格式元组。SVG 永远在内。"""
    a = str(ans or "").strip().lower().replace("，", ",").replace("、", ",")
    if not a:
        return DEFAULT_FORMATS
    if a in ("全部", "all", "所有"):
        return tuple(k for k, _, _ in FORMAT_MENU)
    keys = [k for k, _, _ in FORMAT_MENU]
    out = []
    for tok in [x.strip() for x in a.split(",") if x.strip()]:
        if tok.isdigit() and 1 <= int(tok) <= len(keys):
            out.append(keys[int(tok) - 1])
        elif tok in keys:
            out.append(tok)
    out = [k for k in keys if k in out]
    return tuple(["svg"] + [k for k in out if k != "svg"]) if out else DEFAULT_FORMATS


def render_questions(m, suggest=None):
    """The four questions, worded identically every time.

    Kept deliberately spare. This is read by a lawyer mid-case who wants a figure,
    not a form to fill in: three blocks, each answerable with one character, each
    stating what happens if they answer nothing at all.
    """
    layout = m.get("layout", "")
    name, why = LAYOUT_WHY.get(layout, (layout or "?", ""))
    fam, others = _siblings(layout)
    cand = candidates(m)
    unc = (m.get("provenance") or {}).get("uncertainties") or []
    counts = [(f"{len(m.get(h) or [])} 个{_kind(h)}") for h in EMPHASIS_HOSTS if m.get(h)]

    L = []
    A = L.append
    A("出图前请确认三件事 · 回编号即可，也可以直接说「都按默认」")
    A("")
    # 交互里提醒源图格式：位图要靠读图还原，慢、贵，环境不让读图时还会读不成；
    # 矢量原件里的文字是真文字，逐字抄下来即可。真实运行里就撞到过：一张截图，
    # 模型读不了，只能拿像素去估文本边界「还原」文字，既慢又不可靠。
    A("　下次更省：源图若有矢量原件（SVG，或 PPT / drawio / Figma / Visio 导出的 SVG），")
    A("　直接给 SVG，文字可逐字照抄；截图与照片只能靠读图还原，慢、费用高，也更容易读错。")
    A("")
    A("① 结构 ─────────────────────────────")
    A(f"   图种　{name}　·　{why}")
    A(f"   内容　{' · '.join(counts)}")
    if unc:
        A(f"   存疑　{len(unc)} 处，会影响法律含义")
        for u in unc:
            A(f"　　　　· {u}")
    else:
        A("   存疑　无")
    if others:
        A(f"   ▸ 图种若读错，同族可换：{' / '.join(others)}")
    A("")
    A("② 风格 ─────────────────────────────")
    for i, (mode, flag, look, use) in enumerate(MODES, 1):
        A(f"   {i}　{mode}{'　推荐' if flag == '默认' else ''}")
        A(f"　　　{look}")
        A(f"　　　{use}")
    A("   ▸ 不回 = 1")
    A("")
    A("③ 重点 ─────────────────────────────")
    A("   深红只标一处：本案的胜负手。")
    if suggest is not None and 1 <= suggest <= len(cand):
        A(f"   建议标　{suggest}　{cand[suggest-1]['label'][:40]}")
        A("   ▸ 不回 = 采纳建议　·　回 0 = 全图不标红　·　回别的编号 = 换一处")
    else:
        A("   ▸ 不回 = 由我挑一处并说明理由　·　回 0 = 全图不标红")
    if not cand:
        A("　　（这张图没有可标注的元素）")
    elif len(cand) <= 10:
        for i, c in enumerate(cand, 1):
            A(f"　　{i:>2}　[{_kind(c['host'])}] {c['label'][:40]}")
    else:
        # A sixteen-item list is not a menu, it is a wall. The user knows their own
        # case: let them name the element instead of hunting for its number.
        A(f"　　（共 {len(cand)} 处可选，直接说要标哪一处即可，用图里的说法）")
    A("")
    A("④ 格式 ─────────────────────────────")
    A("   要哪几种？可多选，回编号即可（如「1,2,4」）。")
    for i, (key, name, note) in enumerate(FORMAT_MENU, 1):
        A(f"   {i}　{name}　{note}")
    A("   ▸ 不回 = 1,3（SVG + PPTX）　·　回「全部」= 五种都出")
    A("")
    A("确认前的产物一律命名 *-draft。")
    return "\n".join(L)


def main(argv):
    if not argv:
        print(__doc__.strip())
        return 1
    path = argv[0]
    with open(path, encoding="utf-8-sig") as f:
        m = json.load(f)
    sug = None
    for a in argv[1:]:
        if a.startswith("--suggest="):
            try:
                sug = int(a.split("=", 1)[1])
            except ValueError:
                pass
    if "--json" in argv:
        print(json.dumps({
            "candidates": candidates(m),
            "modes": [{"name": n, "flag": f, "look": lk, "use": u} for n, f, lk, u in MODES],
            "default_mode": "奇川风",
            "default_emphasis": "model",
            "uncertainties": (m.get("provenance") or {}).get("uncertainties", []),
        }, ensure_ascii=False, indent=2))
        return 0
    print(render_questions(m, sug))
    return 0



def _quiet_broken_pipe():
    """`… | head` closes the pipe early; without this the script ends on a
    traceback, which looks like a crash to anyone reading the terminal."""
    import signal
    try:
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    except (AttributeError, ValueError):
        pass

if __name__ == "__main__":
    if {"-h", "--help"} & set(__import__("sys").argv[1:]):   # 只打印用法、什么都不做（原来会把 --help 当成文件名）
        getattr(__import__("sys").stdout, "reconfigure", lambda **k: None)(encoding="utf-8")
        print((__doc__ or "").strip() or "用法见本模块的 SKILL.md")
        raise SystemExit(0)
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
    sys.exit(main(sys.argv[1:]) or 0)
