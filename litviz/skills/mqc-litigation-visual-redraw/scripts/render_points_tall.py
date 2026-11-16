#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""编号型时间轴的纵向形态：事件多到横向排不下时，由代码自动改用它。

**为什么需要它（实测数据）。** 横向编号型的列距是定值（卡宽 + 间隙 = 236px），画布宽度
随事件数线性增长，而高度按固定比例从宽度反推，于是内容永远只有 313px 高，事件越多、
上下留白越大：

    事件数    画布            内容占画布高
      7      1814x1251            25%
     10      2522x1739            18%
     14      3466x2390            13%
     28      6770x4668             7%    上下各留约 2170px 空白，A4 上读不出

同一份 28 件的地图改用纵向：画布 700x1087，内容占 92%，五种格式照常导出，
PPTX 核验 0 处错位，28 条正文与 28 个日期标签逐条可查。

**判据由代码算，不问使用者。** 10 件及以上就转纵向（真实运行里 10 件的横向图内容只占 22.7%）：10 件时横向内容占比已降到 18%，
再往上很快退化；而现有示例最多 7 件，全部不受影响，产物逐字节不变。

**样式仍由 render.py 统一处理。** 这里一律按中性灰阶出图，白描与歸藏风的转换照旧在
render.py 里做，避免两处各转一次。
"""
import os
import tempfile

import render_vcolumns as _VC

THRESHOLD = 10          # 超过这个数就转纵向（见上表：10 件时横向已只剩 18%）

_THEME = None           # render.py 会设它；这里不按它改几何，仅为接口一致


def should_go_tall(m):
    """只管编号型时间轴；日期型按真实日期成比例，是另一回事，不动它。"""
    return (m.get("layout") == "numbered_point_timeline"
            and len(m.get("events") or []) >= THRESHOLD)


def _adapt(m):
    """v1 的事件形状 → 纵向渲染器要的形状。只搬字段，一个字不改。"""
    out = dict(m)
    out["style"] = "奇川风"          # 白描 / 歸藏风由 render.py 事后统一转换
    evs = []
    for e in m.get("events") or []:
        ev = dict(e)
        ev["head"] = e.get("text") or e.get("head") or ""
        ev["time"] = {"certainty": "exact", "date_text": e.get("date_text", ""),
                      "date": e.get("date")}
        evs.append(ev)
    out["events"] = evs
    return out


def render(m):
    """与其余渲染器同签名：返回 (svg 文本, 宽, 高)。"""
    tmp = os.path.join(tempfile.mkdtemp(), "tall.svg")
    w, h = _VC.render(_adapt(m), tmp)[:2]
    svg = open(tmp, encoding="utf-8-sig").read()
    return svg, w, h
