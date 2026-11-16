#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""没装 graphviz 时的排布兜底：纯 Python 算坐标，输出与 `dot -Tplain` 同一套数值。

**为什么要有它。** 流程图与关系图这两档把 graphviz 只当定位引擎用：喂进去带尺寸、不带
标签的方块，读回每个方块的中心坐标，连线与画图都是技能自己做的。可是 graphviz 要单独
安装，律师的电脑上普遍没有，装它还要命令行。真实反馈里这已经是第二个人卡在这里。
于是这里把「算坐标」这一件事用纯 Python 重做一遍：装了 graphviz 就照旧用它（产物
逐字节不变），没装就自动顶上，不再让人去装。

**算法。** 经典的分层画法，与 dot 的思路一致，只是实现简单：
  1. 分层：有向边 from→to 决定先后，用最长路径定层；`{rank=same}` 指定的同层强制对齐；
     成环时按首次出现顺序打破，不会死循环。
  2. 同层排序：按邻居重心（barycenter）来回扫两趟，减少交叉。
  3. 落坐标：层间距 ranksep、同层间距 nodesep，与 dot 的取值一致；rankdir=TB 时层沿
     纵向展开，LR 时沿横向。
  4. 输出：与 `dot -Tplain` 相同 —— 单位英寸，坐标是方块中心，原点在左下、y 轴向上。

**为什么不引第三方库。** 这个 skill 的口径是「缺一样只少一种能力」，不引 pip 依赖；
何况要的只是坐标，不值得为此装一个图形库。
"""
import re
from collections import defaultdict

NODE_RE = re.compile(r'^\s*(\w+)\s*\[label="[^"]*",\s*width=([\d.]+),\s*height=([\d.]+)\];')
EDGE_RE = re.compile(r'^\s*(\w+)\s*->\s*(\w+)')
SAME_RE = re.compile(r'\{\s*rank=same;\s*([^}]*)\}')
RANKDIR_RE = re.compile(r'rankdir=(\w+)')
SEP_RE = re.compile(r'nodesep=([\d.]+);\s*ranksep=([\d.]+)')


def parse_dot(src):
    """解析本技能自己生成的 dot 源（格式固定，不做通用 DOT 解析）。"""
    nodes, edges, same = {}, [], []
    for ln in src.splitlines():
        m = NODE_RE.match(ln)
        if m:
            nodes[m.group(1)] = (float(m.group(2)), float(m.group(3)))
            continue
        s = SAME_RE.search(ln)
        if s:
            same.append([t.strip() for t in s.group(1).split(";") if t.strip()])
            continue
        e = EDGE_RE.match(ln)
        if e and "rank=same" not in ln:
            edges.append((e.group(1), e.group(2)))
    rd = RANKDIR_RE.search(src)
    sep = SEP_RE.search(src)
    return {"nodes": nodes, "edges": edges, "same": same,
            "rankdir": rd.group(1) if rd else "TB",
            "nodesep": float(sep.group(1)) if sep else 0.5,
            "ranksep": float(sep.group(2)) if sep else 0.6}


def _ranks(nodes, edges, same):
    """最长路径分层；同层组强制对齐；成环时按出现顺序打破，不死循环。"""
    order = list(nodes)
    idx = {n: i for i, n in enumerate(order)}
    adj = defaultdict(list)
    for a, b in edges:
        if a in nodes and b in nodes and idx[a] != idx[b]:
            adj[a].append(b)
    rank = {n: 0 for n in order}
    for _ in range(len(order)):                 # 迭代到稳定，最多 n 轮
        changed = False
        for a in order:
            for b in adj[a]:
                if rank[b] < rank[a] + 1:
                    if rank[a] + 1 > len(order):      # 成环保护
                        continue
                    rank[b] = rank[a] + 1
                    changed = True
        if not changed:
            break
    for grp in same:                             # {rank=same} 拉到同一层
        g = [n for n in grp if n in rank]
        if len(g) > 1:
            r = max(rank[n] for n in g)
            for n in g:
                rank[n] = r
    return rank


def _order_in_rank(rank, nodes, edges):
    """按邻居重心来回扫两趟，减少交叉。"""
    layers = defaultdict(list)
    for n in nodes:
        layers[rank[n]].append(n)
    nb = defaultdict(list)
    for a, b in edges:
        if a in nodes and b in nodes:
            nb[a].append(b)
            nb[b].append(a)
    for _ in range(2):
        for r in sorted(layers):
            pos = {n: i for i, n in enumerate(layers[r])}
            prev = {n: i for i, n in enumerate(layers.get(r - 1, []))}
            def key(n):
                ups = [prev[x] for x in nb[n] if x in prev]
                return (sum(ups) / len(ups)) if ups else pos[n]
            layers[r].sort(key=key)
    return layers


def layout(src):
    """返回 (nodes, graph_height)，与 run_dot 的返回值同形：英寸、中心坐标、y 轴向上。"""
    g = parse_dot(src)
    nodes, edges = g["nodes"], g["edges"]
    if not nodes:
        return {}, 0.0
    rank = _ranks(nodes, edges, g["same"])
    layers = _order_in_rank(rank, nodes, edges)
    tb = g["rankdir"].upper() == "TB"
    nodesep, ranksep = g["nodesep"], g["ranksep"]

    # 层的「厚度」取该层最大边长；层内累加另一维
    depth, breadth = {}, {}
    for r, ns in layers.items():
        depth[r] = max((nodes[n][1] if tb else nodes[n][0]) for n in ns)
        breadth[r] = sum((nodes[n][0] if tb else nodes[n][1]) for n in ns) \
            + nodesep * (len(ns) - 1)
    total_breadth = max(breadth.values())
    rs = sorted(layers)
    total_depth = sum(depth[r] for r in rs) + ranksep * (len(rs) - 1)

    out = {}
    along = 0.0
    for r in rs:
        across = (total_breadth - breadth[r]) / 2.0        # 每层居中
        for n in layers[r]:
            w, h = nodes[n]
            if tb:
                cx = across + w / 2.0
                cy = total_depth - (along + depth[r] / 2.0)   # y 轴向上
                across += w + nodesep
            else:
                cy = total_breadth - (across + h / 2.0)
                cx = along + depth[r] / 2.0
                across += h + nodesep
            out[n] = (cx, cy, w, h)
        along += depth[r] + ranksep
    gh = total_depth if tb else total_breadth
    return out, gh
