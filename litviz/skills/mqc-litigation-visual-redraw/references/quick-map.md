# 速查：写一份语义地图

写地图只需要这一页。判据、理由、边界情形在 `extraction-guide.md` 与
`semantic-map-schema.md`，**拿不准时再翻**，那两份是这一页的来源，两边不一致以它们为准
（回归里有一道守卫逐项对账，见文末）。

## 一、先定版式（按顺序问，第一个成立的就是它）

| 问自己 | 成立则用 |
| --- | --- |
| 是把 A 与 B 并排比对吗 | `comparison_table` |
| 事件都有到日的日期，且要按真实间隔看疏密吗 | `dated_point_timeline` |
| 是一段一段的期间（有起止），要按长短比例画吗 | `proportional_gantt` |
| 是一串先后发生的事，日期不全或不必按间隔 | `numbered_point_timeline` |
| 是流程、步骤、分支判断 | `graphviz_flow` |
| 是「谁与谁、就什么标的」的关系网 | `graphviz_relation` |
| 是一层层往下分的从属结构（树，不是网） | `relation_tree` |

树与网最容易选错：**有回路、有交叉指向就是网，不是树**。

## 二、各版式写什么

顶层三件必填：`schema_version`（**1**）、`layout`、`title_text`。下面的字段与取值
取自本 skill 自带的示例地图（那七份都是过了校验并出过图的），回归里逐项对账。

```jsonc
// numbered_point_timeline（不按间隔）／dated_point_timeline（按真实日期成比例）
{"schema_version": 1, "diagram_type": "timeline", "layout": "numbered_point_timeline",
 "title_text": "…",
 "events": [{"id": "1", "band": "up", "date_text": "2021.05.17", "text": "照录原文",
             "emphasis": false}]}
//   band 只写 up / down；date_text 是图上那行字；
//   dated_point_timeline 的每个事件还要 "date": "2021/5/17"（按它排位置）

// proportional_gantt（期间按长短成比例）
{"schema_version": 1, "diagram_type": "timeline", "layout": "proportional_gantt",
 "title_text": "…",
 "axis": {"mode": "proportional_year", "start": "2015/01/01", "end": "2025/12/31"},
 "spans": [{"id": "B1", "label_text": "担保期间", "from": "2015/11/03",
            "to": "2016/11/03", "emphasis": false}],
 "points": [{"id": "E1", "label_text": "债权转让", "date": "2017/06/27",
             "label_level": 0, "label_side": "right", "emphasis": false}]}
//   axis 用 start / end（不是 from / to）；points 可省

// graphviz_flow（流程）
{"schema_version": 1, "diagram_type": "flowchart", "layout": "graphviz_flow",
 "title_text": "…", "direction": "TB",
 "nodes": [{"id": "n1", "kind": "terminal", "title": "照录原文"}],
 "edges": [{"from": "n1", "to": "n2", "label": "是"}]}
//   kind：terminal 起止 / process 动作 / decision 判断；edges 的 label 可省

// graphviz_relation（关系网）
{"schema_version": 1, "diagram_type": "relationship", "layout": "graphviz_relation",
 "title_text": "…", "engine": "dot", "direction": "LR",
 "nodes": [{"id": "jia", "title": "债权人（甲）", "note": "民间借贷关系"}],
 "edges": [{"from": "jia", "to": "yi", "label": "借款"}]}

// relation_tree（一层层往下分的树）
{"schema_version": 1, "diagram_type": "relationship", "layout": "relation_tree",
 "title_text": "…", "arrows": false,
 "nodes": [{"id": "kong", "title": "实际控制人 王某"}],
 "edges": [{"from": "kong", "to": "jia", "label": "持股80%"}]}

// comparison_table（A 与 B 并排比对）
{"schema_version": 1, "layout": "comparison_table", "title_text": "…",
 "columns": [{"id": "spc", "title": "原告主张"}, {"id": "spp", "title": "被告抗辩"}],
 "rows": [{"dimension": "焦点一·款项性质",
           "cells": {"spc": "照录原文", "spp": "照录原文"}}]}
//   rows 的 cells 是**按列 id 取值的对象**，不是数组
```

`provenance{}` 放来源与读不准的地方：`text_policy`、`uncertainties[]`、`emphasis_note`。

## 三、五条红线

1. **照录原文。** 日期、金额、证据编号逐字抄，不规范化、不改写、不合并。
2. **标红不由模型定。** 深红是使用者在确认那一步选的，没选就全图不标。
3. **不抄装饰。** 饼图、波形、图标、花边一律不进图，这个 skill 重画结构。
4. **读不准的进 `provenance.uncertainties`**，不许猜一个填进图里。
5. **确认那一步不可跳过**，见下。
6. **源图先问有没有矢量原件。** 有 SVG（含 PPT / drawio / Figma / Visio 导出的 SVG）就用
   SVG：文字是真文字，逐字照抄，又快又省。只有位图时才靠读图；**读不了图就停下来说明，
   不许用像素测量去「还原」文字**再标成逐字照录。

> graphviz 可选：没装时由内置排布算坐标，流程图与关系图照样出（实测画布与装了的版本差 2 像素）。

## 四、三条命令

```
python3 scripts/source_check.py 源文件…                              # 开工前先跑：位图会先问过使用者
python3 scripts/checkpoint.py map.json --suggest=<你建议标红的编号>   # 把输出原样给使用者
python3 scripts/render.py map.json <输出名>                          # 按第④问所选出格式；不选 = SVG + PPTX
```

使用者答完，把答案写回地图：`"checkpoint": {"confirmed": true, "emphasis_source": "user", "formats": ["svg","pptx"]}`
（`user` / `model` / `none` 三选一）。出图后照打印出来的核对清单核对，不必查看图片。

## 五、这一页与长文的对账

`tests/run_checks.py` 里有一道守卫：逐个示例地图取出它实际用到的顶层字段与元素字段，
与这一页列出的逐项比对，对不上就报错。所以这一页写漏一个字段，回归会当场发现，
不靠人工记忆同步。
