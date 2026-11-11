# -*- coding: utf-8 -*-
"""量箭头几何：线端点、三角尖端、目标模块边界三者的相对位置。

判据（看图时人眼会不舒服的三种）：
  ① 线冲过尖端 —— 线端点到尖端的距离 < 0：线露在三角外面，看着是平头；
  ② 线端点落在三角最窄的那一段 —— 该处三角宽度 < 线宽，线两侧露出；
  ③ 尖端插进模块里 或 离模块太远 —— 插进去 >1px 或空开 >6px。
"""
import math
import re
import sys


def markers(svg):
    out = {}
    for m in re.finditer(r'<marker[^>]*id="([^"]+)"[^>]*>(.*?)</marker>', svg, re.S):
        a, body = m.group(0), m.group(2)
        g = lambda k, d=None: (re.search(rf'{k}="([\d.\-]+)"', a) or [None, d])[1]
        vb = re.search(r'viewBox="([\d.\- ]+)"', a)
        vb = [float(x) for x in vb.group(1).split()] if vb else None
        pts = re.findall(r'([\d.\-]+)[ ,]+([\d.\-]+)', re.search(r'd="([^"]+)"', body).group(1)) \
            if re.search(r'd="([^"]+)"', body) else []
        out[m.group(1)] = dict(refX=float(g("refX", 0) or 0), refY=float(g("refY", 0) or 0),
                               mw=float(g("markerWidth", 0) or 0), mh=float(g("markerHeight", 0) or 0),
                               vb=vb, pts=[(float(x), float(y)) for x, y in pts])
    return out


def rects(svg):
    out = []
    for m in re.finditer(r'<rect([^>]*)/?>', svg):
        a = m.group(1)
        g = lambda k: re.search(rf'\s{k}="([\d.\-]+)"', a)
        if all(g(k) for k in ("x", "y", "width", "height")):
            x, y, w, h = (float(g(k).group(1)) for k in ("x", "y", "width", "height"))
            out.append((x, y, w, h))
    return out


def check(path, verbose=False):
    svg = open(path, encoding="utf-8").read()
    mk, rc = markers(svg), rects(svg)
    W = float(re.search(r'<svg[^>]*width="([\d.]+)"', svg).group(1))
    bad = {"冲过尖端": [], "线宽露出": [], "插进模块": [], "离得太远": []}
    n = 0
    for m in re.finditer(r'<path\s([^>]*?)(?<![\w-])d="([^"]+)"([^>]*?)/?>', svg):
        attr = m.group(1) + m.group(3)
        me = re.search(r'marker-end="url\(#([^)]+)\)"', attr)
        if not me or me.group(1) not in mk:
            continue
        info = mk[me.group(1)]
        # 逐条指令解析，圆弧 A 的前五个参数不是坐标，直接按「最后两个点」取会算错方向
        d, pts, i = m.group(2), [], 0
        toks = re.findall(r'[MLA]|-?[\d.]+', d)
        while i < len(toks):
            t = toks[i]
            if t == "M" or t == "L":
                pts.append((float(toks[i + 1]), float(toks[i + 2]))); i += 3
            elif t == "A":
                pts.append((float(toks[i + 6]), float(toks[i + 7]))); i += 8
            else:
                i += 1
        if len(pts) < 2:
            continue
        n += 1
        (x0, y0), (x1, y1) = pts[-2], pts[-1]
        L = math.dist((x0, y0), (x1, y1)) or 1
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        sw = float((re.search(r'stroke-width="([\d.]+)"', attr) or [None, "1"])[1])
        # marker 的比例：userSpaceOnUse 时 markerWidth 就是像素宽
        vbw = (info["vb"][2] if info["vb"] else info["mw"]) or info["mw"] or 1
        scale = (info["mw"] / vbw) if info["mw"] else 1
        tip_vb = max(x for x, _ in info["pts"]) if info["pts"] else vbw
        ahead = (tip_vb - info["refX"]) * scale          # 端点到尖端
        behind = info["refX"] * scale                     # 端点到三角底边
        tip = (x1 + ux * ahead, y1 + uy * ahead)
        if ahead < 0:
            bad["冲过尖端"].append(round(ahead, 1))
        else:
            # 端点处三角的高度（viewBox 里三角是 0..vbh，尖端在 tip_vb）
            vbh = (info["vb"][3] if info["vb"] else info["mh"]) or info["mh"] or 1
            frac = 1 - (info["refX"] / tip_vb if tip_vb else 0)
            hgt = vbh * frac * (info["mh"] / vbh if info["mh"] else 1)
            if hgt < sw:
                bad["线宽露出"].append((round(hgt, 1), sw))
        # 尖端与前方模块的关系
        gap, deep = None, None
        for (rx, ry, rw, rh) in rc:
            if rw > W * 0.9:
                continue
            inside = rx <= tip[0] <= rx + rw and ry <= tip[1] <= ry + rh
            if inside:
                # 插进去多深：沿来向退回到边界的距离
                back = 0.0
                while back < 30 and (rx <= tip[0] - ux * back <= rx + rw
                                     and ry <= tip[1] - uy * back <= ry + rh):
                    back += 0.25
                deep = back if deep is None else max(deep, back)
            else:
                for t in [i * 0.25 for i in range(0, 60)]:
                    px, py = tip[0] + ux * t, tip[1] + uy * t
                    if rx <= px <= rx + rw and ry <= py <= ry + rh:
                        gap = t if gap is None else min(gap, t)
                        break
        if deep is not None and deep > 0.5:
            bad["插进模块"].append(round(deep, 1))
        elif deep is None and gap is not None and gap > max(6.0, info["mw"] * 0.6):
            bad["离得太远"].append(round(gap, 1))
    return n, bad


if __name__ == "__main__":
    for p in sys.argv[1:]:
        n, bad = check(p)
        flags = "；".join(f"{k} {len(v)} 处{v[:3]}" for k, v in bad.items() if v) or "无异常"
        print(f"  {p.split('/')[-1]:34} 箭头 {n:>3} 个｜{flags}")
