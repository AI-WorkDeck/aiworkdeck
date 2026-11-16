#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""贯通上下游的那条路：材料 → 部分清单 → 勾选 → 出图。

**为什么要有这个文件。** 前面每一次「打通」都是我在临时脚本里手工把各步串起来的，
串法每次不同、不可复现，别人也无从照着走。这里把它定成一条路：
哪几步是代码算的、哪几步要模型答、答完由谁验、验不过怎么退回。

**为什么它不是一个「一键出图」的函数。** 中间有两步必须模型读懂材料才能做（判定每句是不是
事实、把材料划成几个部分），代码做不了；正则切过一版，切出三组同名和半截残句。所以这条路
是分段的：每一段代码做完，把「现在需要模型答什么」明确打出来，模型答完写成 JSON 交回来，
代码验过再走下一段。答错就是一次失败的检查，不是一张错的图。

分段（与 check_model_output 的六个检查器一一对应）：

    stage read      代码   读材料、切句、认叙述块              → state.json
    （三轮勾选之后）scope   代码   列出勾选范围内的句子，模型只判这些
    stage classify  模型   范围内每句是不是已发生的事实，附理由 ← verdicts.json
    stage parts     模型   划成几个部分，每个附事实卡          ← parts.json
    stage offer     代码   生成给律师看的勾选清单
    stage pick      律师   报编号（也可全选、或交给 AI 定）
    stage budget    代码   按勾选算形态与每模块字数容量
    stage extract   模型   按容量写每个事项，声明 src_sids     ← items.json
    stage render    代码   校验 → 出图

用法：
    python pipeline.py read     <材料...>            # 建 state
    python pipeline.py offer                          # 需要 verdicts + parts
    python pipeline.py budget   <勾选的部分编号,...>
    python pipeline.py render   <输出.svg>            # 需要 items
每一步都会打印下一步该做什么，不必记这份说明。
"""
import copy
import json
import re
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (HERE, os.path.join(HERE, "..", "..", "mqc-litigation-visual-redraw", "scripts")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import read_source as R                                           # noqa: E402
import check_model_output as C                                     # noqa: E402
import capacity as CAP                                             # noqa: E402
import omission as OM                                              # noqa: E402

def _py(script):
    """给用户看的下一步命令：用脚本的真实路径，在哪个目录里照抄都能跑（0.9.8：SKILL.md 要求在用户的工作目录里运行）。"""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), script)
    return f'python3 "{p}"' if " " in p else f"python3 {p}"


PIPE = _py("pipeline.py")                  # 给用户看的命令：在哪个目录照抄都能跑


STATE = "state.json"


#: 四份要模型填的 JSON，各自的形状与「什么算对」。
#: 固化这件事的起因：每走一遍我都是手工写这四个文件、形状全靠记着 —— 换个人（或下一个
#: 会话的我）照着文档也走不通。所以每一步都要能自己打印出模板与判据。
SHAPES = {
    "verdicts.json": {
        "when": "三轮勾选（pick / span / style）之后；先跑 scope 看范围内有哪几句",
        "shape": '[{"i": 0, "is_event": false, "why": "材料标题"}, ...]',
        "rules": [
            "勾选范围内的每一句都要有一条，一句不漏（句号用 scope 列出的原句号）；"
            "范围外的句子不必判，判了也不报错",
            "is_event 只在「已发生的具体事实」时为真；诉请、法律评价、"
            "合同约定、材料标题、署名都不是",
            "why 一句话说清为什么，用于返工时定位",
            "**更省的写法（推荐）：写 verdicts.txt，每句一行「句号 Y或N 理由」**，如"
            "「10 Y 本院于2025年3月19日立案」「11 N 到庭人员，程序性叙述」。"
            "判据完全相同，每句仍要单独表态、单独写理由；两个文件都在时以 verdicts.txt 为准",
        ],
        "checker": "check_classify",
    },
    "parts.json": {
        "when": "verdicts 之后",
        "shape": '[{"id": 1, "name": "…", "sids": [0,1,2], '
                 '"first": "<首句原文>", "last": "<末句原文>"}]',
        "rules": [
            "勾选范围内的每句都落在某个部分里，一句不漏；一句不属于两个部分",
            "部分数不超 8；名字不重复（同名无法勾选）",
            "first / last 照抄原文，不许概括（写首句、末句里连续的一段即可）",
            "**不必列句号**：写 \"ranges\": [[157, 315]] 代替 sids，代码按勾选范围展开；"
            "中间夹着别的部分时写多段，如 [[41, 132], [134, 156]]",
            "每个部分里至少有一个事实句 —— 全是约定或主张的部分画不出东西，"
            "应并进相邻部分",
            "有叙述块时不许跨块（判决书的诉称/辩称/查明/理由）",
        ],
        "checker": "check_parts",
    },
    "skeleton.json": {
        "when": "budget 之后，**写正文之前**",
        "shape": '[{"id": "1", "src_sids": [1,2], "certainty": "exact", '
                 '"kind": "sign", "raw": "2023 年 4 月 12 日", "date": "2023/4/12", '
                 '"lane": "D"}]　期间型与 range 用 from / to 代替 date',
        "rules": [
            "只填骨架，不填 head —— 容量要等骨架定了才算得出来",
            # 这三项是 model-steps.md 第五步「时间归档」早就定好的，只是先前没写进这份
            # 契约，于是模型只给一个 date，四档确定度被压成了一个字段 —— 后果实测过：
            # 材料只说「2023 年 11 月」，我给 date=2023/11，编号型静默补成 11 月 1 日，
            # **图上印出了材料里不存在的「2023.11.01」**。而校验器 check_dates 本来就
            # 拦得住（判为 exact 却没有到日的表述），只是没人把骨架交给它。
            "certainty 四档按**材料的精度**填，不按推测：精确到日 exact（给 date）、"
            "只到年月或一段区间 range（给 from 与 to）、只说「次日」「之后」relative"
            "（给 anchor）、只知先后 order。判 exact 就必须有到日的表述",
            "raw 必须是那一句里的时间表述**原文，逐字**——检查会拿它回句子里找，"
            "找不到就报错。这一条挡的是把日期推算出来（「次年初」写成 2017/1/1）",
            "kind 说这个日期钉住哪个动作：occur / sign / effect / send / arrive / "
            "receipt / record / due。发出与到达要分开（催告函的发出日与到达日"
            "在法律上不是一件事）",
            # 图像来源要留名分。规矩见 HANDOVER 5.4：让模型直接读图（不引 OCR 依赖），
            # 但**图像来源的事件单独标记，交付时必须声明**哪几份材料没有文字层、
            # 有几个事件出自读图。schema 与 validate_map 早就完整实现了这条
            # （图像来源事件必须有 scope、数目必须相符、documents_unreadable 必须列出，
            # 不符是错误不是告警），缺的只是**管线组装地图时没把它带上** ——
            # 于是那条守卫在管线产物上永远看不到图像来源事件。
            "medium 只在这条事项**出自读图**时写 \"image\"（截图、扫描件、照片），"
            "默认 text_layer。写了它就必须在 image_docs.json 里列出读了图的材料，"
            "管线据此填 scope，validate_map 会核对数目",
            "四档各一个完整例子（照这个形状写就能过校验）：\n"
            "      精确到日　{\"id\": \"1\", \"src_sids\": [40], \"certainty\": \"exact\", "
            "\"kind\": \"sign\", \"raw\": \"2019年11月29日\", \"date\": \"2019/11/29\"}\n"
            "      汉字落款　{\"id\": \"18\", \"src_sids\": [336, 343], \"certainty\": \"exact\", "
            "\"kind\": \"occur\", \"raw\": \"二〇二五年十二月二十九日\", \"date\": \"2025/12/29\"}"
            "（raw 照抄汉字，date 写数字，校验认得汉字日期）\n"
            "      只到年　　{\"id\": \"8\", \"src_sids\": [134], \"certainty\": \"range\", "
            "\"kind\": \"occur\", \"raw\": \"2021年\", \"from\": \"2021/1/1\", \"to\": \"2021/12/31\"}"
            "（from/to 只是这一年的边界，图上不显示，也不按 1 月 1 日排）\n"
            "      只知先后　{\"id\": \"9\", \"src_sids\": [150], \"certainty\": \"order\", "
            "\"kind\": \"occur\", \"raw\": \"驳回上诉\", \"anchor\": \"8\"}"
            "（raw 抄那一句里点明这件事的原文词；anchor 写它之后的那个事项 id）",
            "图上日期那一行由代码按骨架生成，不必自己写：精确到日显示「2019.11.29」，"
            "只到年月显示材料原文（「2021年」），只知先后与相对的**留空**（不写「上诉后」这类推出来的词）",
            "src_sids 升序；一个事项跨几句就都写上（同一天的几条聊天记录常要合并）",
            "lane 必须与来源一致（起诉状的句子标 P、答辩状标 D）",
            "三条以上泳道（主体层级 / 程序层级 / 主从关系）：lane 用自定义的 id，"
            "并在 lane_labels.json 里给出每条的名字；默认上二下一，"
            "要改成上一下二就在 lane_sides.json 里写 {\"某条\": \"dn\"}；"
            "每侧最多 3 条、两侧共 6 条是极限",
            "期间型要 from 与 to 都有，且至少两段、存在重叠",
        ],
        "checker": "check_dates / check_lane_source / check_span_worthiness",
    },
    "items.json": {
        "when": "capacity 之后",
        "shape": '在骨架上补 head（与 attrib）：'
                 '[{"id": "1", "src_sids": [1,2], "date": "…", "lane": "D", '
                 '"head": "…", "attrib": "原告称", "emphasis": true}]',
        "rules": [
            "只需要这几个字段：id、src_sids、head（奇川风可加 emphasis，有陈述人时加 attrib）。"
            "时间一律取骨架里的，items 里写的 date、certainty 等出图时会被忽略，不必抄；"
            "id 必须与骨架一一对应",
            "head 必须是 src_sids 那几句拼接后的**子序列** —— 只许删字，"
            "不许改写、换词、加标点",
            "head 不超容量（capacity 那一步给的数）；attrib 占容量，连括号一起算",
            "attrib 不超 5 字，只说明是谁陈述；冲突的两方都要有",
            "emphasis 最多一项（多标就不是重点了），只在奇川风有效",
            "**不写 body / items**：本图是摘要图，卡片只放 head。原句里删掉的部分出图后"
            "逐条披露，删去的若含付款条件、期限、质量异议、违约、担保这类限制性表述，"
            "交付前要用户确认 —— 所以要紧的限制条件，容量够就留在 head 里",
        ],
        "checker": "check_subsequence / check_capacity",
    },
}


def print_shape(name):
    """打印某一份 JSON 的形状与判据。每一步结束时调用，不让人靠记性。"""
    if name not in SHAPES:                     # 给了路径或拼错：列出可选的名字，不甩 KeyError
        print(f"没有「{name}」这一份的形状说明。可选：{'、'.join(SHAPES)}")
        raise SystemExit(2)
    s = SHAPES[name]
    print(f"下一步要写 {name}（{s['when']}）：")
    print(f"  {s['shape']}")
    for r in s["rules"]:
        print(f"  · {r}")
    print(f"  由 {s['checker']} 校验，不过就报错并指出该改哪一项")


def _load(path, what):
    if not os.path.exists(path):
        print(f"缺 {path}（{what}）。这一步要模型先答，答完写成这个文件再来。")
        sys.exit(2)
    return json.load(open(path, encoding="utf-8-sig"))


def _items_outside_picked(sk, st):
    """来源句全部不在勾选部分里的事项 id（没勾过部分时不查）。"""
    picked = set(st.get("picked_sids_all") or [])
    if not picked:
        return []
    return [it.get("id") for it in sk
            if not any(x in picked for x in (it.get("src_sids") or []))]


def _load_verdicts():
    """逐句判定：verdicts.txt（紧凑行格式）优先，其次 verdicts.json。

    紧凑行格式每句一行「句号 是否 理由」，是否写 Y 或 N，例如
        10 Y 本院于2025年3月19日立案，已发生的程序事实
        11 N 到庭人员，程序性叙述
    每一句仍然单独表态、单独写理由，判据与 JSON 完全相同，只是不重复键名、引号和括号。
    实测两次真实运行的判定转成这种写法再解析回来逐项相同，token 分别少 41% 与 57%；
    逐句判定是模型输出最重的一步，这里省下的就是等待时间。
    写坏的行（缺理由、把 Y/N 写成是/否）逐行报出行号，不静默丢弃。"""
    if os.path.exists("verdicts.txt"):
        out, bad = [], []
        for n, line in enumerate(open("verdicts.txt", encoding="utf-8-sig"), 1):
            if not line.strip():
                continue
            m = re.match(r"^\s*(\d+)\s+([YyNn])\s+(\S.*?)\s*$", line)
            if not m:
                bad.append(n)
                continue
            out.append({"i": int(m.group(1)), "is_event": m.group(2) in "Yy",
                        "why": m.group(3)})
        if bad:
            print(f"verdicts.txt 第 {bad[:10]} 行写法不对：每行应为「句号 Y或N 理由」，"
                  f"如「10 Y 本院于2025年3月19日立案」。理由不能空，是否只写 Y 或 N。")
            sys.exit(1)
        return out
    return _load("verdicts.json", "模型的逐句判定（或写 verdicts.txt 紧凑行格式）")


def _expand_parts(parts, st):
    """部分划分可以不列句号，写 "ranges": [[起, 止], ...]，由代码展开成勾选范围内的句号。

    原来每个部分都要把几百个句号一个个列出来（真实运行里 7KB），与判断无关，纯粹是抄数。
    一个部分可以写多段区间（范围内有被筛掉的句子、或部分之间交错时要用）。
    写了 sids 的照旧用 sids，两种写法可以混用。"""
    scope = set(scope_sids(st))
    for p in parts:
        if not p.get("sids") and p.get("ranges"):
            ids = []
            for r in p["ranges"]:
                a, b = (r[0], r[-1]) if isinstance(r, (list, tuple)) and r else (r, r)
                ids += [i for i in range(int(a), int(b) + 1) if i in scope]
            p["sids"] = sorted(set(ids))
    return parts


def _save(obj, path=STATE):
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


# ------------------------------------------------------------------ stage read
def stage_read(paths):
    """代码做：读材料、切句、认叙述块。多份材料按顺序拼成一条句号序列。"""
    sents, origin, blocks = [], [], {}
    for p in paths:
        try:
            r = R.read_with_blocks(p)
        except R.PdfTextUnavailable as e:
            print(e)
            sys.exit(1)
        except RuntimeError as e:
            # .doc 读不了（加密、结构对不上）等：照 PDF 那条路的做法，干净地说清怎么办，
            # 不抛 traceback。真实运行里模型看到裸 traceback 就会自己去写解析脚本。
            print(str(e))
            sys.exit(1)
        if str(p).lower().endswith(".pdf"):
            print(f"《{os.path.basename(p)}》从 PDF 文字层读入（{R.read_pdf.last_pages} 页，"
                  f"抽取工具 {R.read_pdf.last_engine}）。不必另行转成文字。")
        base = len(sents)
        sents += r["sentences"]
        origin += [os.path.basename(p)] * len(r["sentences"])
        for k, (a, b) in (r.get("blocks_sids") or {}).items():
            blocks[f"{os.path.basename(p)}:{k}"] = (a + base, b + base)
    st = {"files": [os.path.basename(p) for p in paths],
          "files_full": list(paths),
          "sentences": sents, "origin": origin, "blocks": blocks}
    _save(st)
    print(f"读入 {len(paths)} 份材料，共 {len(sents)} 句"
          f"{'，认出 %d 个叙述块' % len(blocks) if blocks else '（无叙述块，可能是口述或提示词）'}。")
    print()
    # 先问后判：逐句判定要等三轮勾选之后才写，而且只判勾选范围内的句子。
    # 原来这里紧接着打出 verdicts.json 与 parts.json 的写法，照着做的模型会在问第一个
    # 问题之前把全部句子判完 —— 用户先干等最长的那一段，而这段写完又可能因为他只勾了
    # 一部分而大半作废。形状说明挪到 style 之后给（scope 与 offer 那两步）。
    print("先问用户、后判句：三轮勾选（材料来源、时间段、呈报给谁）问完之后，")
    print("再跑 scope 列出勾选范围内的句子，只判那些句子。")
    print()
    # 合并步骤：读完直接给出第一轮清单，省一个来回（原来要再跑一次 pick 才看得到）。
    stage_pick(None)
    return st


# ----------------------------------------------------------------- stage offer
def _form_hint(part, S, ev):
    """这一段会画成什么图 —— 标在勾选清单里，图种就不必单独问一轮。

    图种是勾选结果决定的：勾「时效抗辩」自然是几个时点跨很多年（日期型），勾「工期与
    停工」自然是几段期间（期间型）。所以不必在勾完之后再问一遍。
    只有两种都可行且都有意义时才标出默认那一种，让他要改时说一声。
    """
    import re as _re
    sids = [s for s in part["sids"] if s in set(ev)]
    txt = "".join(S[s] for s in sids)
    # 期间型要求**至少两段**有起止的法律期间，不是「出现了期间的名字」。
    # 第一版判据是「撞到法律期间词 + 有一个『至』字」，于是「被告的时效抗辩」那一段
    # （只有一句事实、是主张不是期间）被标成期间型 —— 判据太粗，撞词就算。
    # 现在按 check_span_worthiness 的三条来数：要数得出两段以上带起止的期间。
    _pairs = _re.findall(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日"
                         r"[^。；]{0,12}?(?:至|到|起至)\s*(20\d{2})\s*年", txt)
    if len(_pairs) >= 2 and any(k in txt for k in C.LEGAL_PERIODS[:20]):
        return "期间型"
    ds = _re.findall(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", txt)
    if 3 <= len(ds) <= 8:
        yrs = sorted(int(y) for y, _m, _d in ds)
        if yrs[-1] - yrs[0] >= 3 and any(k in txt for k in C.DATED_ARGUMENTS):
            return "日期型（讲距离）或编号型（讲先后），默认日期型"
    return "编号型"


def stage_pick(paths_or_sel=None):
    """强制交互的**前两轮**：勾材料来源、勾时间段。

    只有这两个维度，因为它们**天然互斥**：一句话只可能出自一份材料、也只可能落在一个
    时间点上。第三个维度「按内容」试过三种判据（法律期间词表、时间成簇、行为词）全部
    做不到互斥 —— 混乱材料里一句「两个月了，验收和付款都没动」同时是验收、付款、催告，
    而勾选要求互斥，否则勾两项会把同一句画两遍。所以舍弃。
    """
    import pick as PK
    st = _load(STATE, "先跑 read")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    if paths_or_sel in (None, "", "show"):
        r1 = PK.round_one(st["files_full"])
        # **只有一个选项时不问，直接进下一环节。**
        # 只投喂一份材料（或只讲了一段话）时，「选哪一份」只有一个答案 ——
        # 问一个只有一个答案的问题是浪费用户的时间。
        # 同理见 round_two 那一轮：材料只覆盖一小段时间线时不问时间段。
        if len(r1) == 1:
            st["pick_r1"] = [{k: v for k, v in r.items() if k != "sentences"}
                             for r in r1]
            st["picked_files"] = [r1[0]["id"]]
            _save(st)
            print(f"只有一份材料（{r1[0]['name']}，{r1[0]['n_sent']} 句，"
                  f"{r1[0]['span']}），跳过第一轮。")
            print()
            rows2, note = PK.round_two(r1, [r1[0]["id"]])
            st["pick_r2"] = rows2
            _save(st)
            _n_dates = sum(r["n"] for r in rows2)
            _ask, _why = PK.span_worth_asking(rows2, _n_dates)
            if not _ask:
                st["picked_spans"] = [r["id"] for r in rows2]
                _save(st)
                print(f"{_why}，不必再选时间段。")
                print()
                _ask_style()
                return
            print(f"第二轮 · 时间段　{note}")
            print()
            for r in rows2:
                print(f"  [{r['id']}] {r['label']}　{r['n']} 个日期")
            print()
            print("  [全部] 全部时间")
            print()
            print("然后跑：" + PIPE + " span 全部      （或 span 1,2）")
            return
        st["pick_r1"] = [{k: v for k, v in r.items() if k != "sentences"} for r in r1]
        _save(st)
        print(f"第一轮 · 制作图表的材料来源（{len(r1)} 份）")
        print()
        for r in r1:
            print(f"  [{r['id']}] {r['name']}")
            print(f"      {r['n_sent']} 句，其中 {r['n_dated']} 句带日期　{r['span']}")
            print(f"      首句：{r['first']}")
            print()
        print("  [全部] 全部材料")
        print()
        print("报编号即可（可多选），或报「全部」。然后跑：")
        print("  " + PIPE + " pick 1,2      # 勾第 1、2 份")
        print("  " + PIPE + " pick 全部")
        return
    # 用户可以直接报「全部」而不先看清单 —— 真跑就是这样崩的（KeyError: pick_r1）。
    # 不能假设用户按我设想的顺序来：每一步都要能独立成立，缺的前置自己补上。
    if "pick_r1" not in st:
        r1 = PK.round_one(st["files_full"])
        st["pick_r1"] = [{k: v for k, v in r.items() if k != "sentences"} for r in r1]
        _save(st)
    sel = ([r["id"] for r in st["pick_r1"]] if paths_or_sel in ("全部", "all")
           else [int(x) for x in paths_or_sel.replace("，", ",").split(",") if x.strip()])
    st["picked_files"] = sel
    r1 = PK.round_one(st["files_full"])
    rows2, note = PK.round_two(r1, sel)
    st["pick_r2"] = rows2
    _save(st)
    print(f"已勾材料 {sel}")
    print()
    # 时间段只有一档时同样不问
    _n_dates = sum(r["n"] for r in rows2)
    _ask, _why = PK.span_worth_asking(rows2, _n_dates)
    if not _ask:
        st["picked_spans"] = [r["id"] for r in rows2]
        _save(st)
        print(f"{_why}，不必再选时间段。")
        print()
        _ask_style()
        return
    print(f"第二轮 · 时间段　{note}")
    print()
    for r in rows2:
        print(f"  [{r['id']}] {r['label']}　{r['n']} 个日期")
    print()
    print("  [全部] 全部时间")
    print()
    print("然后跑：" + PIPE + " span 全部      （或 span 1,2）")


def stage_span(sel):
    """第二轮的答案：勾了哪几个时间段。勾完进第三轮。"""
    import pick as PK
    st = _load(STATE, "先跑到 pick")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    rows2 = st.get("pick_r2") or []
    if not rows2:
        # 同理：直接跑 span 时补上第二轮
        r1b = PK.round_one(st["files_full"])
        rows2, _n = PK.round_two(r1b, st.get("picked_files"))
        st["pick_r2"] = rows2
        _save(st)
    ids = ([r["id"] for r in rows2] if sel in ("全部", "all")
           else [int(x) for x in sel.replace("，", ",").split(",") if x.strip()])
    st["picked_spans"] = ids
    _save(st)
    print(f"已勾时间段 {ids}")
    print()
    _ask_style()


def _ask_style():
    """第三轮的问题：编号与名称一律从 pick.round_three() 取，不许在别处手写。

    真实运行记录：文档与提示里写的是「1 白描 / 2 奇川风 / 3 歸藏风」，而代码是
    「1 奇川风 / 2 歸藏风 / 3 白描」，模型照提示敲 `style 2` 拿到的是歸藏风。
    手写一份编号就会与代码走偏，所以这里只从一处取。"""
    import pick as PK
    print("第三轮 · 风格")
    print()
    for s in PK.round_three():
        print(f"  [{s['id']}] {s['name']}" + (f"　{s['tag']}" if s["tag"] else ""))
        print(f"      {s['look']}")
        print(f"      {s['use']}")
        print()
    first = PK.round_three()[0]
    print(f"  不回 = 1（{first['name']}）")
    print()
    print("把使用者的选择填进去：" + PIPE + " style <编号>")
    print()
    print("同一轮顺带问格式（可多选）：1 SVG　2 PNG　3 PPTX　4 VSDX　5 drawio")
    print("  不回 = 1,3（SVG + PPTX）；PNG 要本机有转图工具，选了才出。")
    print("  使用者要别的就跑：" + PIPE + " formats <编号，如 1,2,3 或 全部>")


def stage_style(sel):
    """第三轮的答案：呈报给谁 → 风格。奇川风才进第五轮（标红）。"""
    import pick as PK
    st = _load(STATE, "先跑到 span")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    tbl = {s["id"]: s for s in PK.round_three()}
    # 不回默认第一档（奇川风）—— 照 v1 的「不回 = 1」。
    if str(sel).strip() in ("", "默认", "d"):
        chosen = tbl[1]
        print(f"未指定，按默认：{chosen['name']}")
    elif str(sel).strip() == "4":
        # 第四档「让我定」：steps 表与 next 的提示一直写着 `style <1-4>`，
        # 而 round_three() 只有三档，敲 4 会被判成「没有第 4 项」并退出 ——
        # 文档承诺了一个不存在的选项。这里按 v1 的「不回 = 1」落到默认档，
        # 不新增第四种风格，只把已经承诺的那条路接通。
        chosen = tbl[1]
        print(f"由我来定：{chosen['name']}　{chosen['look']}")
        print(f"      {chosen['use']}")
    else:
        chosen = tbl.get(int(sel))
        if not chosen:
            print(f"没有第 {sel} 项，请报 1 到 4（4 = 让我替你定）")
            sys.exit(1)
        print(f"已选：{chosen['name']}　{chosen['look']}")
    st["style"] = chosen["name"]
    _save(st)
    print()
    if chosen["name"] != "奇川风":
        print(f"第五轮跳过（{chosen['name']} 不需要标红：单色或自有视觉规则）")
    else:
        print("第五轮（标红）在抽取完事项之后问。")
    # 原来这里写的是「然后跑 capacity」，与步骤表（style 之后是 offer）不一致；
    # capacity 要的 skeleton.json 此时还不可能有。
    print()
    # 合并步骤：选完风格直接列出范围内句子（写进 scope.txt），省一个来回。
    stage_scope()


def scope_sids(st):
    """勾选范围内的全部句号，升序。逐句判定与部分划分只对这些句子要求一句不漏。"""
    return [i for i in range(len(st.get("sentences") or [])) if in_scope(st, i)]


def borderline_sids(st):
    """被时间段筛掉、但句中另有日期落在勾中时间段里的句子。

    过筛只看一句话里的**第一个**日期（in_scope 的现有规则，这里不改它）。
    「2020 年签约，2022 年 3 月付款」在只勾 2022 年时就不在范围内。原来它会被判、
    被划分，到算容量时才剔掉并打印一句「按勾选的范围剔掉 N 个事项」，至少看得见；
    改成只判范围内的句子之后，它从一开始就不出现 —— 那就成了静默丢失。
    所以把这类句子单独找出来、明着列给用户，不许悄悄消失。
    """
    import pick as PK
    spans = st.get("picked_spans")
    if not spans:
        return []
    labels = {r["label"] for r in (st.get("pick_r2") or []) if r["id"] in spans}
    if not labels:
        return []
    no_span = dict(st)
    no_span["picked_spans"] = None            # 只看材料那一道筛
    out = []
    for i, s in enumerate(st.get("sentences") or []):
        if in_scope(st, i) or not in_scope(no_span, i):
            continue
        ds = PK.dates_in(s)
        if any(PK.in_bucket(d, lab) for d in ds[1:] for lab in labels):
            out.append(i)
    return out


def _print_borderline(st):
    b = borderline_sids(st)
    if not b:
        return
    S = st["sentences"]
    print()
    print(f"另有 {len(b)} 句含勾中时间段的日期，但按句中第一个日期不在范围内，"
          f"未纳入（如需纳入，请放宽时间段）：")
    for i in b:
        print(f"  [{i}] {S[i][:60]}")


def stage_scope():
    """代码做：列出勾选范围内的句子。模型只判这些句子，句号用这里的原句号。

    句子写进文件，屏幕上只打印摘要。原来整份打印：真实运行里一份判决书就是 59KB，
    超过了 Claude Code 单次返回的上限，被转存成文件、模型又去读一遍；而模型要拿句号
    清单写判定，只好自己用 importlib 把 in_scope 重写了一遍。现在两样都直接给文件。"""
    st = _load(STATE, "先跑 read 与三轮勾选")
    S = st["sentences"]
    ids = scope_sids(st)
    with open("scope.txt", "w", encoding="utf-8") as fh:
        for i in ids:
            fh.write(f"[{i}] {S[i]}\n")
    json.dump(ids, open("scope_sids.json", "w", encoding="utf-8"))
    if len(ids) == len(S):
        print(f"勾选范围是全部材料，共 {len(S)} 句，逐句判定要判全部句子。")
    else:
        import pick as _pk
        _dated = [i for i in range(len(S)) if _pk.dates_in(S[i])]
        _kept_dated = [i for i in _dated if i in set(ids)]
        print(f"全部材料共 {len(S)} 句；勾选范围内 {len(ids)} 句，只判这些"
              f"（范围外的句子不必判）。")
        # 把时间段过筛的判据与局限说清楚。真实运行里有人勾了某两年，以为图上只会出现
        # 那两年的事，结果 344 句里只有 60 句带日期，其余 284 句因为没有日期一律保留，
        # 判定量几乎没降，图上也仍有别的年份。不说清楚，下次还会这样期待。
        print(f"  时间段只按「句子里有没有该时段的日期」筛：全篇 {len(_dated)} 句带日期，"
              f"其中 {len(_kept_dated)} 句落在你勾的时段；"
              f"另有 {len(ids) - len(_kept_dated)} 句没有日期，一律保留"
              f"（没日期的事也可能是要画的事，不能替你删）。")
        print("  想真正收窄画哪一段内容，靠第四轮勾部分（budget），不是靠时间段。")
    print("  句子全文（带原句号）：scope.txt　　句号清单：scope_sids.json")
    print("  读 scope.txt 逐句判定；不必读 state.json，也不必自己重算范围。")
    _print_borderline(st)
    print()
    print_shape("verdicts.json")
    print()
    print_shape("parts.json")
    print("然后跑：" + PIPE + " offer")


def in_scope(st, sid):
    """这一句在不在勾选的范围内。

    前两轮的勾选**必须真的限制后面的抽取**，否则它们只写不读、就是摆设 ——
    与 anchor 那个死字段一模一样的毛病（声明了、校验了、没人用）。
    所以抽取与出图都要过这道筛：句子出自勾中的材料，且它的日期落在勾中的时间段里。
    没有日期的句子跟着它所在的材料走（否则「此后」这类事项会被时间筛掉）。
    """
    import pick as PK
    files = st.get("picked_files")
    spans = st.get("picked_spans")
    origin = (st.get("origin") or [])
    if files:
        rows = st.get("pick_r1") or []
        # **按文件名精确比对，不用短名。** 短名是给人看的（去掉「材料N」前缀、截到十字），
        # 拿它当过筛的键有两处会坏：
        #   ① 同名多份 —— 二十份格式一样的催款函，`pick.name_of` 会编成「催款函 2」
        #      「催款函 3」，而这里算出的键不带编号，于是勾一份等于勾全部；
        #   ② 长名被截断 —— 两份材料前十字相同就分不开。
        # `pick_r1` 每行本来就带 `path`，`origin` 记的是每句出自哪个文件名，
        # 两边取同一个键（basename）就是精确的，不需要任何字符串加工。
        _picked = [r for r in rows if r["id"] in files]
        _nopath = [r.get("name") for r in _picked if not r.get("path")]
        if _nopath:
            # **缺字段不许静默放过。** 第一版写成「allow 为空就不过筛」，于是 pick_r1 里
            # 没有 path 时所有材料都进范围 —— 那是最坏的失效方式：过筛看起来在跑，
            # 实际一个都没筛掉，而且不报错。宁可当场报错，也不要静默失效
            # （与「守卫拿不到材料时不能静默跳过」是同一条）。
            raise ValueError(
                f"勾中的材料 {_nopath} 在 state 的 pick_r1 里没有 path，无法精确过筛。"
                f"pick_r1 由 pipeline.stage_pick 写入、每行都带 path；"
                f"手工拼 state 时要一并给上。")
        allow = {os.path.basename(r["path"]) for r in _picked}
        if allow and sid < len(origin) and origin[sid] not in allow:
            return False
    if spans:
        rows2 = st.get("pick_r2") or []
        labels = {r["label"] for r in rows2 if r["id"] in spans}
        if labels and sid < len(st.get("sentences", [])):
            ds = PK.dates_in(st["sentences"][sid])
            if ds:
                d = ds[0]
                # 判据是**这个日期落在哪一档**（`pick.in_bucket`，与列清单同一个函数），
                # 不是「标签里含不含这个年份」。后者在季度档上等于不过筛：
                # 「2024 年第 1 季度」这个标签里就写着 2024，于是 2024 年任何一天都算命中。
                if any(PK.in_bucket(d, lab) for lab in labels):
                    return True
                return False
    return True


def stage_offer():
    """代码做：验模型的两份输出，然后生成勾选清单。"""
    st = _load(STATE, "先跑 read")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    S = st["sentences"]
    verdicts = _load_verdicts()
    parts = _expand_parts(_load("parts.json", "模型的部分划分"), st)

    # 只要求勾选范围内一句不漏（见 check_classify 的 scope 说明）。
    scope = set(scope_sids(st))
    # 回头改了勾选、范围变大时，之前判过的句子不必重判：沿用 state 里的旧判定，
    # verdicts.json 只需补上新纳入范围的那几句。同一句两边都有时以新写的为准。
    # 重复判定仍然只在 verdicts.json 自身内部查，与原来一致。
    _new_i = {v.get("i") for v in verdicts}
    verdicts = verdicts + [v for v in (st.get("verdicts") or [])
                           if v.get("i") not in _new_i]
    errs, redo = C.check_classify(S, verdicts, scope=scope)
    if errs:
        print("逐句判定没通过，请就下列句号重答：", redo[:20])
        for e in errs[:5]:
            print("  ", e)
        sys.exit(1)
    ev_all = [v["i"] for v in verdicts if v.get("is_event")]

    blocks = {k: tuple(v) for k, v in (st.get("blocks") or {}).items()}
    errs, redo = C.check_parts(S, parts, blocks=blocks or None, events=ev_all,
                               scope=scope)
    if errs:
        print("部分划分没通过，请就下列部分重划：", redo[:20])
        for e in errs[:5]:
            print("  ", e)
        sys.exit(1)

    # 往下传的事实句只取勾选范围内的：范围外的事实句到算容量时本来就会被剔掉。
    # 这样与范围内句子合成的事项不会因为混进一句范围外的句子而整个被剔掉。
    ev = [i for i in ev_all if i in scope]
    st["verdicts"], st["parts"], st["events"] = verdicts, parts, ev
    _save(st)
    if len(scope) == len(S):
        print(f"读完{'、'.join('《%s》' % f for f in st['files'])}，共 {len(S)} 句，"
              f"其中 {len(ev)} 句是已发生的事实。")
    else:
        print(f"读完{'、'.join('《%s》' % f for f in st['files'])}，共 {len(S)} 句；"
              f"勾选范围内 {len(scope)} 句，其中 {len(ev)} 句是已发生的事实。")
    _print_borderline(st)
    print("可以整份还原，也可以只取其中几个部分：")
    print()
    for p in parts:
        n_ev = len([s for s in p["sids"] if s in set(ev)])
        print(f"  {p['id']}. {p['name']}　（{_form_hint(p, S, ev)}）")
        print(f"     {len([s for s in p['sids'] if s in scope])} 句，其中 {n_ev} 句是事实")
        print(f"     首：{p.get('first', '')}")
        print(f"     末：{p.get('last', '')}")
        print()
    # 图种按**勾选的组合**算，不按单个部分算。
    # 实测：那份答辩状划成六个部分，每部分里各只有一段期间，逐部分判就全是编号型；
    # 而六段一起勾就是期间型（六段工期与停工互相重叠，那正是它的论点）。
    # 所以清单上的标注只是「单独勾这一段时」的图种，多选时要重算 —— 必须说清楚，
    # 否则用户以为勾了六个编号型，出来却是一张期间型。
    _all_form = _form_hint({"sids": [s for p in parts for s in p["sids"]]}, S, ev)
    if _all_form != "编号型":
        print(f"（若全选或多选相关的几段，会合成一张{_all_form}——"
              f"上面标的是「单独勾这一段」时的图种）")
    print("报编号即可，可多选，也可全选，或者让我替你定。")
    # 例子里的编号必须来自**这份清单**：写死一个数时，清单只有一两项就会提示
    # 「budget 4」而第 4 项根本不存在 —— 用户照着敲就会撞错。
    _eg = str(parts[-1].get("id", 1)) if parts else "1"
    print(f"然后跑：{PIPE} budget {_eg}"
          + ("      （或 budget 1,2 多选 / budget all 全选）" if len(parts) > 1
             else "      （或 budget all）"))


# ---------------------------------------------------------------- stage budget
def _norm_raw(x):
    """归一化时间表述，**直接借 check_model_output 的那把尺子**，不另写一份。
    两边用不同的归一化，就会出现「校验器说查不到、而我这边说查得到」这类矛盾。"""
    import check_model_output as _C
    return _C._norm(x or "")


def stage_capacity():
    # 骨架支持两种：时点（date）与**期间**（from / to）。
    # 这一条是拿真材料撞出来的：那份答辩状讲的全是有长度的期间（总工期、两次停工、
    # 设计变更期间），而骨架原来只有一个 date 字段，只能把期间硬塞成一个时点 ——
    # 于是管道报「编号型」，把「重叠关系是本图的论点」那件事整个丢掉了。
    # 材料的性质决定图种（见约束表第九节），而骨架是唯一表达材料性质的地方，
    # 所以骨架必须能表达期间，否则图种在这一步就已经错了。
    """按**真实的事项骨架**算容量。

    这一步是补出来的，起因是一次真实的错：budget 当时按「勾选到的事实句数」（17 句）
    加「无日期、无泳道」去估，算出每模块 40 字；而真实骨架是 11 个事项、上下分主张方、
    同侧最长连续 3 项，横向只装得下 24 字。我按 40 字写完，横向被拒、自动转了纵向 ——
    而横向本来完全排得下，只是字要短一些。**容量估错的代价不是超容量报错，是形态被换掉。**

    句数不等于事项数（多句可以合成一个事项），有没有泳道、同侧连续几项都影响容量，
    所以容量必须等骨架定了才算，不能按句数估。
    """
    st = _load(STATE, "先跑到 budget")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    sk = _load("skeleton.json", "模型定的事项骨架（只有 id / src_sids / date / lane）")
    # 勾选的范围要真的生效：范围外的事项直接剔掉并报出来，不能默默画进去。
    # 事项的来源句全部不在勾选的部分里，等于画进了律师没勾的内容（实测时我就犯过：
    # 勾了第 2 至 5 部分，却从第 1 部分取了一个立案事项，校验没拦）。
    # 只要求至少一句在勾选部分里 —— 落款日期这类佐证句常在相邻部分，不算越界。
    _out = _items_outside_picked(sk, st)
    if _out:
        if True:
            print(f"骨架里的事项 {_out} 的来源句全部不在勾选的部分里 —— 要么删掉这些事项，"
                  f"要么回到 budget 把它们所在的部分也勾上。")
            sys.exit(1)
    # 事项的日期落在勾选时段之外时提示一句。时间段只能粗筛句子，真正画什么由事项决定；
    # 真实运行里勾了 2014–2015，图上仍出现 2021、2023 的事，事后才发现。这里只提示，
    # 不替使用者删——删不删是他的判断。
    _spans = st.get("picked_spans") or []
    _rows2 = st.get("pick_r2") or []
    if _spans and _rows2 and len(_spans) < len(_rows2):
        _yrs = [int(y) for r in _rows2 if r.get("id") in _spans
                for y in re.findall(r"((?:19|20)\d{2})", r.get("label", ""))]
        if _yrs:
            _lo, _hi = min(_yrs), max(_yrs)
            _out2 = []
            for it in sk:
                _d = it.get("date") or it.get("from") or ""
                if _d[:4].isdigit() and not (_lo <= int(_d[:4]) <= _hi):
                    _out2.append(f"{it.get('id')}（{_d[:4]}年）")
            if _out2:
                print(f"  提示：{len(_out2)} 个事项的年份不在你勾的时段（{_lo}–{_hi}）里："
                      + "、".join(_out2[:8]) + ("…" if len(_out2) > 8 else ""))
                print("  时间段只按句中日期筛句子，没日期的句子一律保留，所以别的年份"
                      "仍可能进来。要只画那一段，从骨架里删掉这些事项即可。")
    _drop = [it for it in sk
             if not all(in_scope(st, s) for s in (it.get("src_sids") or []))]
    if _drop:
        sk = [it for it in sk if it not in _drop]
        print(f"按勾选的范围剔掉 {len(_drop)} 个事项："
              f"{[it.get('id') for it in _drop]}")
        if not sk:
            print("剔完没有事项了 —— 勾选的范围里没有可画的内容，请放宽范围。")
            sys.exit(1)
    # ---- 时间归档要过 check_dates（这是接线，不是新判据）---------------------
    # 起因是一次真实的错：材料只说「2023 年 11 月」，我在骨架里给 date=2023/11，
    # **编号型静默把它补成 2023-11-01，图上印出了材料里不存在的那个日**（终端还打印
    # 「同日相反主张：2023年11月1日」）。日期型倒是明确拒绝了（Un-parseable），
    # 而编号型没有人管 —— 图看起来完全正常，这正是这个项目定义的最坏产物。
    #
    # 而机制**本来就有**：model-steps.md 第五步「时间归档」定了四档确定度、raw 必须
    # 逐字可查；check_model_output.check_dates 全部实现了，回归里还有三条改坏测试
    # （时间原文改写 / 无到日却判 exact / range 缺端点）盯着它。缺的只是**没人把骨架
    # 交给它** —— 与 time.anchor 那个死字段、前两轮勾选只写不读是同一类毛病：
    # 声明了、校验器管着、交付路径不读它。
    #
    # 所以这里只做一件事：把骨架按 check_dates 认识的形状交给它。**判据一个字不新写**，
    # certainty / kind / raw 由模型填（那本来就是模型第五步的活），代码不去猜 ——
    # 拿正则从句子里猜时间表述就是第二份判据，必然漂。
    # 一个事项可以跨几句（同一天的几条聊天记录常要合并），而时间表述可能落在其中
    # **任何一句**里 —— 拿 src_sids[0] 去验，合并出来的事项就会被误报「raw 查不到」
    # （实测：付款那一项引了句 10 到 16，日期在末句，而 i 指向首句）。
    # 所以 i 取**raw 真正出现的那一句**；一句都找不到才是真错，交给 check_dates 去报。
    def _host(it):
        _sids = it.get("src_sids") or [0]
        _raw = _norm_raw(it.get("raw", ""))
        for _s in _sids:
            if _raw and _raw in _norm_raw(st["sentences"][_s]):
                return _s
        return _sids[0]
    _tm = [{"i": _host(it), "certainty": it.get("certainty"),
            "kind": it.get("kind"), "raw": it.get("raw", ""),
            **({"date": it["date"]} if it.get("date") else {}),
            **({"from": it["from"], "to": it["to"]}
               if it.get("from") and it.get("to") else {}),
            **({"anchor": it["anchor"]} if it.get("anchor") else {})}
           for it in sk if it.get("certainty")]
    if len(_tm) < len(sk):
        _miss = [it.get("id") for it in sk if not it.get("certainty")]
        print(f"骨架缺 certainty 的事项：{_miss} —— 时间归档是模型第五步的活，"
              f"四档按材料的精度填（见 {PIPE} shape skeleton.json）。"
              f"只到年月要判 range 并给 from 与 to，不许补成某月 1 日。")
        sys.exit(1)
    _te, _tr = C.check_dates(st["sentences"], _tm)
    if _te:
        for _x in _te[:8]:
            print(f"  时间归档不合：{_x}")
        print("请按材料的精度改正后重跑（判 exact 必须有到日的表述；"
              "只到年月判 range 并给 from 与 to）。")
        sys.exit(1)

    # **期间型的信号不能只看「有没有 from/to」。** 这是接上时间校验之后当场撞出来的：
    # 材料只说「2023 年 11 月」，按 model-steps 第五步要判 certainty=range 并给 from 与
    # to（那是**精度只到月的一个时点**），而这里把它当成了「一段期间」，于是要求
    # 所有事项都给起止、还报「各段互不重叠，应改用编号型」—— 两个语义撞在同一个字段上。
    # 约束表第九节写得很清楚：期间型有意义是因为**那段时间本身有法律后果**
    # （诉讼时效期间、催告后的沉默期间），不是因为有两个端点。
    # 所以判据加一条：certainty 明确写了 range 的，是月精度时点，不算期间。
    has_spans = any(it.get("from") and it.get("to") and it.get("certainty") != "range"
                    for it in sk)
    if has_spans:
        # 期间型要先过「该不该用」这一关（法律含义 + 起止明确 + 存在重叠），
        # 不是「有 from/to 就用」。判据见 check_span_worthiness。
        _se, _sw = C.check_span_worthiness(
            [{"id": it.get("id"), "from": it.get("from"), "to": it.get("to"),
              "label_text": it.get("head") or it.get("label_text", "")} for it in sk])
        for _x in _sw:
            print("  提醒：", _x)
        if _se:
            print("这份材料不该用期间型：")
            for _x in _se:
                print("  ", _x)
            print("请把每段期间的起止写成两个时点，改走编号型。")
            sys.exit(1)
    if has_spans:
        n_span = len([it for it in sk if it.get("from") and it.get("to")])
        if n_span != len(sk):
            print(f"骨架里 {n_span} 个是期间、{len(sk) - n_span} 个是时点 —— "
                  f"期间型的每一行是一段期间，时点走另一条轨（points）。"
                  f"请把时点写成 points 而不是混在 spans 里。")
    # 日期型也要先过「该不该用」这一关，而且**前置判据与渲染器的结论一致**（验过五个
    # 场景全对），所以前端在写骨架时就知道，不必写完字撞回来才发现。
    if not has_spans:
        _ds = [it.get("date") for it in sk if it.get("date")]
        if len(_ds) == len(sk):
            _de, _dw = C.check_dated_worthiness(_ds, st.get("purpose", ""))
            if _de:
                print("这份材料不适合日期型（将走编号型）：")
                for _x in _de[:3]:
                    print("  ", _x)
            for _x in _dw[:2]:
                print("  提醒：", _x)

    dates = [it.get("date") or it.get("from") for it in sk]
    sides = [it.get("lane") for it in sk] if any(it.get("lane") for it in sk) else None
    _spans = ([{"from": it["from"], "to": it["to"]} for it in sk
               if it.get("from") and it.get("to")] if has_spans else None)
    b = CAP.budget(dates, sides, has_spans=has_spans, spans=_spans,
                   title=st.get("title", "图名草稿"))
    st["has_spans"] = has_spans
    if has_spans:
        st["per_span"] = b.get("per_span", [])
    # 三条以上泳道时把名字与侧别读进 state（模型另写两个小文件，缺就不管）
    for _fn, _key in (("lane_labels.json", "lane_labels"),
                      ("lane_sides.json", "lane_sides"),
                      ("lane_relations.json", "lane_relations"),
                      # 读了图的材料清单：[{"file": "…", "reason": "…"}]。
                      # 有 medium=image 的事项时必须给，出图那一步据此填 scope。
                      ("image_docs.json", "image_docs")):
        if os.path.exists(_fn):
            st[_key] = json.load(open(_fn, encoding="utf-8-sig"))
    st["skeleton"] = sk
    st["cap"] = b["cap_per_module"]
    st["cap_title"] = b["cap_title"]
    st["cap_lane_label"] = b.get("cap_lane_label", 0)
    _save(st)
    print(f"骨架：{len(sk)} 个事项"
          f"{'，上下分主张方' if sides else '，单侧'}")
    print("形态与容量：", b["note"])
    if b.get("hint"):
        print("  ", b["hint"])
    print()
    # ---- 第五轮 · 标红哪一项（照抄 v1 的 checkpoint ③）------------------------
    # v1 的 SKILL.md 第 97 行写着：**不要自己选强调 —— 深红重点是用户的决定，
    # 在 CHECKPOINT 那一轮问，默认不标**。而 schema 第 592 行同一条纪律：
    # 「选择必须由用户作出，模型永远不许自己拟定」。
    # v2 先前只有分流（奇川风才问）与跳过的提示，**这一问本身没实现** ——
    # 于是 emphasis 字段实际是模型自己填的，八份示例七份都标了红。这里补上。
    # 白描与歸藏风不问：单色没有红可标，歸藏风有自己的视觉规则。
    if st.get("style") == "奇川风":
        print()
        print("第五轮 · 重点")
        print()
        print("  深红只标一处：本案的胜负手。")
        print()
        print("  [0] 全图不标红")
        # 这一轮在写正文之前问，所以骨架里还没有 head。
        # 用**源句**给用户看内容 —— 只印日期的话，八行日期看不出哪个是胜负手。
        _S5 = st.get("sentences") or []
        for _e in sk:
            _raw = (_e.get("raw") or _e.get("date") or "")
            _txt = _e.get("head") or ""
            if not _txt:
                _sids = _e.get("src_sids") or ([_e["src_sid"]]
                                               if _e.get("src_sid") is not None
                                               else [])
                _txt = "".join(_S5[i] for i in _sids if 0 <= i < len(_S5))
                # 去掉句首那个日期，剩下的才是这件事本身
                _txt = re.sub(r"^[\d〇一二三四五六七八九十]{2,4}\s*年\s*"
                              r"[\d一二三四五六七八九十]{1,2}\s*月"
                              r"(\s*[\d一二三四五六七八九十]{1,3}\s*日)?"
                              r"[，,、\s]*", "", _txt)
            print(f"  [{_e['id']}] {_raw}　{_txt[:26]}")
        print()
        print("  不回 = 由我挑一处并说明理由")
        print()
        print("  然后跑：" + PIPE + " mark <编号>      # 0 = 不标红")
        print()

    print("下一步（模型）：按这个容量写正文，写成 items.json（在骨架上补 head）：")
    if has_spans:
        # 期间型不能报一个数：那个数是最短那一段的容量，用它套全图会把长段白白写短。
        # 逐段报，前端才知道哪一段能写长、哪一段只能给两个字或者干脆让它落到条外。
        print("  · **期间型逐段不同**，各段条内可放的字数：")
        for x in (b.get("per_span") or []):
            place = "条内" if x["in_bar"] >= 3 else "太短，标签会落到条右侧或条下方"
            print(f"      {x['id']}　{x['days']:>5} 天　条内 {x['in_bar']:>2} 字　{place}")
        print("    条右侧只放得下一行；条下方有整幅宽度，可以写长。")
    else:
        print(f'  · head 至多 {b["cap_per_module"]} 字，且必须是 src_sids 那几句拼接后的子序列')
    print(f"  · 图名至多 {b['cap_title']} 字：{PIPE} title '…'")
    print("然后跑：" + PIPE + " render 出图.svg")


def _curly(s):
    """把直角引号「」『』换成中文弯引号“”‘’。

    直角引号是日文与港台的习惯，大陆法律文书用弯引号。这件事在图名上尤其显眼 ——
    图名是整张图最大的字，用错了引号一眼就看出来（作者指出的正是这一处）。
    转换放在**写图名这一个出口**，不靠每次手打时记得：靠记性的地方一定会漏。
    """
    return (str(s).replace("「", "“").replace("」", "”")
            .replace("『", "‘").replace("』", "’"))


def stage_mark(sel):
    """第五轮的答案：标红哪一项。0 = 全图不标红。

    **`emphasis_source` 必须如实记**：用户选的记 user，模型代挑的记 model，
    不标的记 none。schema 那条纪律（模型永远不许自己拟定选择）靠这个字段落地 ——
    产物里能看出这一处红是谁决定的。
    """
    st = _load(STATE, "先跑到 capacity")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    if st.get("style") != "奇川风":
        print(f"{st.get('style')} 不标红，这一轮不适用。")
        return
    sk = st.get("skeleton") or []
    if not sk:
        print("还没有骨架，先跑 capacity。")
        sys.exit(1)
    _sel = str(sel).strip()
    if _sel in ("0", "无", "不标"):
        st["emphasis"] = None
        st["emphasis_source"] = "none"
        _save(st)
        print("全图不标红。")
        return
    _ids = {str(e["id"]) for e in sk}
    if _sel not in _ids:
        print(f"没有第 {_sel} 项。可选：0（不标红）或 {sorted(_ids, key=int)}")
        sys.exit(1)
    st["emphasis"] = _sel
    st["emphasis_source"] = "user"
    _save(st)
    _hit = [e for e in sk if str(e["id"]) == _sel][0]
    print(f"标红第 {_sel} 项：{_hit.get('raw') or _hit.get('date')}　"
          f"{(_hit.get('head') or '')[:24]}")
    print()
    print("然后跑：" + PIPE + " title '…'")


def stage_title(title):
    """图名由模型写，容量由代码给。单独一步，因为它与事项的容量是两回事。

    第一次跑完整条路时忘了接这一步，出来的图题头是「图名待定」—— 一张图最显眼的地方
    空着，比任何排版问题都刺眼。凡是产物上会出现的东西，管道里都要有一步管它。
    """
    st = _load(STATE, "先跑到 budget")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    title = _curly(title)
    cap = st.get("cap_title") or 0
    if cap and len(title) > cap:
        print(f"图名 {len(title)} 字超过容量 {cap} 字，请改短。")
        sys.exit(1)
    st["title"] = title
    _save(st)
    print(f"图名已定（{len(title)} 字，容量 {cap} 字）：{title}")
    print("然后跑：" + PIPE + " render 出图.svg")


def stage_budget(pick):
    """代码做：按勾选的部分算形态与容量。这是前后端对接的那个数。"""
    st = _load(STATE, "先跑 read 与 offer")
    st.pop("omission_review", None)   # 出图的输入变了：上一张图的未上图确认作废，等 render 重算
    S, ev = st["sentences"], set(st["events"])
    parts = st["parts"]
    ids = ([p["id"] for p in parts] if pick == "all"
           else [int(x) for x in pick.replace("，", ",").split(",") if x.strip()])
    sids = sorted(s for p in parts if p["id"] in ids for s in p["sids"] if s in ev)
    if not sids:
        print("勾选的部分里没有事实句，换一个部分。")
        sys.exit(1)
    st["picked_ids"], st["picked_sids"] = ids, sids
    st["picked_sids_all"] = sorted({x for p in (st.get("parts") or [])
                                    if p.get("id") in ids for x in (p.get("sids") or [])})
    _save(st)
    print(f"勾选了部分 {ids}，其中 {len(sids)} 句是事实：")
    for s in sids:
        print(f"  [{s}] {S[s][:60]}")
    print()
    print()
    print(f"这 {len(sids)} 句事实要合成几个事项、每个属于哪一方，是模型的判断 —— "
          f"**容量只有等这个骨架定了才算得出来**。")
    print_shape("skeleton.json")
    print("然后跑：" + PIPE + " capacity      # 按真实骨架算容量")
    return
    print("下一步（模型）：按容量写每个事项，写成 items.json：")
    print('  [{"id": "1", "head": "<原句的子序列，只许删不许改写>", '
          '"src_sids": [25], "date": "2014/3/12", "lane": "P"}]')
    print("  · head 至多", b["cap_per_module"], "字，且必须是 src_sids 那几句拼接后的子序列")
    print("  · src_sids 必须升序；一个事项跨几句就都写上")
    print("然后跑：" + PIPE + " render 出图.svg")


# ---------------------------------------------------------------- stage render
def stage_render(out):
    """代码做：校验模型抽出来的文字，组地图，出图。"""
    import copy
    import render_figure as RF
    st = _load(STATE, "先跑到 budget")
    S = st["sentences"]
    items = _load("items.json", "模型按容量抽出来的事项")

    e1, redo1 = C.check_subsequence(items, S)
    if st.get("has_spans"):
        # 期间型**不做逐段的字数拦截**。理由是它的三档落位（条内 / 条右侧一行 /
        # 条下方整幅宽）本来就是为「标签比条长」准备的退路，标签超出条身不是错误，
        # 是常态：那份答辩状里 49 天的图纸逾期段条内只放得下 2 字，而这一段本来就该
        # 让标签落到条外去写全。
        # 上一步我发现「拿最短那段的容量套全图」是错的，却只改了提示文字、没改这里的
        # 检查 —— 同一处错改了一半，于是六段全被判超容量。**指出问题与修掉问题是两件事。**
        e2, w2, redo2 = [], [], []
        _cap_of = {x["id"]: x["in_bar"] for x in (st.get("per_span") or [])}
        for _i, _it in enumerate(items):
            _c = _cap_of.get(f"s{_i + 1}", 0)
            if _c and len(_it["head"]) > _c:
                w2.append(f"{_it['id']}: {len(_it['head'])} 字超出条身容量 {_c} 字，"
                          f"标签会落到条右侧或条下方（这是设计中的退路，不是错误）")
    else:
        e2, w2, redo2 = C.check_capacity(items, st["cap"],
                                         cap_title=st.get("cap_title"),
                                         title=st.get("title"), sentences=S)
    lane_tbl = st.get("lane_of_file") or {}
    e3, redo3 = C.check_lane_source(items, lane_tbl)
    # 侧标签的两条纪律（[C18]）：不许下法律定性，两侧必须出自两方各自的材料。
    # 真实犯过：七份材料全部出自原告一方，图上却标着「原告主张 / 被告自认」——
    # 「自认」二字整份材料里一个字都没有，是我的法律定性。同一批材料里 5 条卡片正文
    # 全部通过子序列核验（正文有铁律），而侧标签当时没有任何来源约束。
    for _x_lbl in C.check_lane_labels(st.get("lane_labels"), items, lane_tbl):
        print(f"  侧标签不合：{_x_lbl}")
        e3 = list(e3) + [_x_lbl]
    if e1 or e2 or e3:
        print("抽取没通过，请就下列事项重写：", sorted(set(redo1 + redo2 + redo3)))
        for e in (e1 + e2 + e3)[:6]:
            print("  ", e)
        sys.exit(1)
    for w in w2[:5]:
        print("  告警：", w)
    # 材料自身的矛盾：报告，不修正，也不拦住出图。
    # 这些要进交付说明 —— 照材料画，另附一行指出矛盾，不许悄悄改成合理的日期。
    # 泳道名要传进去：「同日相反主张」只在两侧确实是对立陈述时才成立
    # （支付宝流水的「支出 / 收入」同日并存是正常账目，不是相反主张）。
    # lane 定义**在这里就地组装**，不能用 m["lanes"] —— 那个要到出图那一段（本函数
    # 更下面）才赋值，传进来是空的，于是判据退回词表兜底。第一版就这么错了：
    # 把 relation 从 actor 改成 assertion，误报本该回来，实测仍是 0 处 ——
    # **字段成了死字段，而表面上「误报消失了」，是靠词表蒙对的**。
    # 这正是这个项目最隐蔽的那类错，所以每加一个字段都要试着把它改坏一次。
    _lane_defs = [{"id": _l, "label_text": (st.get("lane_labels") or {}).get(_l, _l),
                   **({"relation": (st.get("lane_relations") or {})[_l]}
                      if (st.get("lane_relations") or {}).get(_l) else {})}
                  for _l in dict.fromkeys(
                      it.get("lane") for it in items if it.get("lane"))]
    # 承诺或约定的时点不是事实（告警）。这一类**过得了全部句法判据** ——
    # 日期在材料里、精确到日、正文是原句子序列、raw 逐字可查，四条铁律都拦不住，
    # 因为它错在语义。真实犯过：付款计划四个付款日看起来是最好的时间轴素材，全是承诺。
    # 第五轮的答案落进事项：只有用户选过（或明确不标）才动 emphasis。
    # **模型不许自己填** —— 这一处红是谁决定的，由 emphasis_source 如实记着。
    _emph = st.get("emphasis")
    _esrc = st.get("emphasis_source")
    if _esrc in ("user", "model"):
        for _it in items:
            _it["emphasis"] = (str(_it.get("id")) == str(_emph))
    elif _esrc == "none":
        for _it in items:
            _it.pop("emphasis", None)

    for _x_fut in C.check_future_as_fact(items, S):
        print(f"  请核对：{_x_fut}")
    _mc = C.check_material_conflicts(items, sentences=S,
                                     lane_labels=st.get("lane_labels"),
                                     lane_defs=_lane_defs,
                                     conflicts=st.get("conflicts"))
    for w in _mc:
        print("  材料矛盾：", w)
    if _mc:
        st["material_conflicts"] = _mc
        _save(st)

    if st.get("has_spans"):
        # 期间型：一段一行，容量逐段不同，所以容量检查要**逐段**比对，不能拿一个数套全图。
        m = {"schema_version": 2, "layout": "period_gantt",
             "title_text": st.get("title") or "图名待定", "spans": [], "points": []}
        cap_of = {x["id"]: x["in_bar"] for x in (st.get("per_span") or [])}
        for i, it in enumerate(items):
            sid = f"s{i + 1}"
            m["spans"].append({
                "id": sid, "from": it["from"], "to": it["to"],
                "label_text": it["head"], "unit_type": it.get("unit_type", "fact"),
                "source": {"file": it.get("src_file") or (st["files"] or ["材料"])[0],
                           "locator": f"句{it.get('src_sids')}"},
                **({"emphasis": True} if it.get("emphasis") else {})})
        if m["spans"]:
            m["axis"] = {"start": m["spans"][0]["from"], "end": m["spans"][-1]["to"]}
        kind, form, why, wh = RF.deliver(m, out)
        print(f"出图：{kind}·{form}　整幅 {wh[0]:.0f}x{wh[1]:.0f}　{out}")
        _say_why(kind, why)
        # 期间型的条上标签同样是原句删出来的，同样要披露。这一档不出溯源索引，
        # 所以没上图的原文直接在这里全部打出来。
        _om_lines, _ = _review_omissions(items, S, st, with_index=False)
        print()
        for _ln in _om_lines:
            print(_ln)
        return

    proto = {"unit_type": "fact", "source": {}, "time": {}}
    m = {"schema_version": 2, "layout": "numbered_point_timeline",
         "title_text": st.get("title") or "图名待定", "events": []}
    # 泳道按骨架里**实际出现的**来，不写死两条。
    # 原来写死「原告主张 / 被告主张」，于是三泳道在管道这一侧根本走不到 ——
    # 渲染器支持六条，而管道只会给它两条。
    # 名字从 state 里的 lane_labels 取（模型在写骨架时一并给出）；没给就退回默认。
    _used = []
    for it in items:
        _l = it.get("lane")
        if _l and _l not in _used:
            _used.append(_l)
    # ---- 侧标签只在**模型说得出名字**时才出 -----------------------------------
    # 规矩见 HANDOVER：「有 lanes 就是有意义的分布，必出侧标签；没有就是纯为省空间的
    # 交替，不许出侧标签 —— **否则等于宣称一个数据里没有的区分**。」
    #
    # 原来这里有一句兜底 `{"P": "原告主张", "D": "被告主张"}`：模型不写
    # lane_labels.json，管线就**替它编造**一个诉讼语义。后果在真材料上出现过 ——
    # 支付宝流水两侧其实是支出与收入，图上却标着「原告主张 / 被告主张」，
    # 而图看起来完全正常。这两个词在语料里太顺手，兜底一接管就成了默认叙事。
    #
    # 三态，都不靠猜材料类型：
    #   · 事项不带 lane          → 单侧或纯交替，无侧标签
    #   · 带 lane、不给名字      → **上下分侧，不出侧标签**（分侧真实、但一句话说不清，
    #                             或者不必说。渲染器本来就支持这一档，实测几何与容量
    #                             与带标签时**完全一致**，侧标签不占横向空间）
    #   · 带 lane、给了名字      → 分侧 + 侧标签
    # 也就是说：**代码不代笔**。说不出名字不是错，编一个才是错。
    if _used:
        _labels = st.get("lane_labels") or {}
        _named = [_l for _l in _used if str(_labels.get(_l, "")).strip()]
        if not _named:
            # 一个都没命名 → 不声明 lanes，图上只做上下分侧、不出侧标签
            print(f"  分侧未命名（{len(_used)} 侧）：图上上下分侧但不出侧标签。"
                  f"分侧的语义说得出来时写 lane_labels.json，"
                  f'如 {{"P": "供货方主张", "D": "采购方主张"}}')
            _used = []
    if _used:
        m["lanes"] = []
        for _l in _used:
            # label_text 只用模型给的名字。给了一部分没给另一部分时，
            # 未命名那一条用 id 会把 P/D 这种内部标记印到图上，所以一并要求补齐。
            # 侧标签的字数上限由**当前档位的几何**决定：它贴左边缘起排，右边第一个
            # 障碍是首个圆点。事项越多卡越窄、余量越小（6 项 8 字、10 项 5 字、
            # 18 项 2 字），单行放不下折两行，两行还放不下就该在这里拦住 ——
            # 渲染器不截断也不缩字号（与图名同一条规矩）。
            # 作者定的用法：**优先四五个字**，够区分就行，两行只是兜底。
            _cap_ll = st.get("cap_lane_label") or 0
            _nm = str(_labels.get(_l, "")).strip()
            if _cap_ll and _nm and len(_nm) > _cap_ll:
                print(f"  侧标签「{_nm}」{len(_nm)} 字，这一档至多 {_cap_ll} 字"
                      f"（单行 {_cap_ll // 2} 字，放不下会折两行）。"
                      f"事项越多留给侧标签的横向余量越小 —— 请换个短名，"
                      f"四五个字够区分就行。")
                sys.exit(1)
            if not _nm:
                print(f"  泳道 {_l} 没有名字，而其余泳道有 —— 侧标签要么都出、"
                      f"要么都不出（半数命名会让图上出现 {_l} 这种内部标记）。"
                      f"请在 lane_labels.json 里补齐。")
                sys.exit(1)
            _entry = {"id": _l, "label_text": _labels[_l]}
            # relation 说明两侧是什么关系：assertion 谁的主张（默认）、
            # actor 哪一层主体、stage 哪个程序阶段（取自 RELAY-2 对泳道的定义）。
            # 只有 assertion 时「同日相反主张」才成立 —— 流水的支出与收入同日并存、
            # 一审与二审同日各有动作，都不是相反主张。不填等于 assertion。
            _rel = (st.get("lane_relations") or {}).get(_l)
            if _rel:
                _entry["relation"] = _rel
            # side 只在 state 里明确写了才带上（默认上二下一由渲染器定，见 M14）
            if (st.get("lane_sides") or {}).get(_l):
                _entry["side"] = st["lane_sides"][_l]
            m["lanes"].append(_entry)
        if len(m["lanes"]) >= 3:
            print(f"三泳道以上：{len(m['lanes'])} 条"
                  f"（{'、'.join(x['label_text'] for x in m['lanes'])}）")
    # 时间一律取**骨架**里的（capacity 那一步已经过 check_dates），不从 items.json 另取。
    # 原来这里只看 items 的 date：确定度、起止、锚点、动作类型全部丢掉，没日期的一律当成
    # 「relative」且不带锚点 —— 真实运行里两个外部模型都撞上：只到年份的起诉、只知先后的
    # 二审驳回、汉字落款的判决，全被排到轴的最后，日期那一行是空的。它们随后去读源码、
    # 自己写脚本组地图出图，绕开了容量拦截与泳道校验。
    # 事项按材料里的先后（最小句号）排好再组地图：排序函数把列表顺序当作材料先后，
    # 只到年月的事项靠它落位。
    _sk_by_id = {str(x.get("id")): x for x in (st.get("skeleton") or [])}
    _missing_sk = [it.get("id") for it in items if str(it.get("id")) not in _sk_by_id]
    if _sk_by_id and _missing_sk:
        print(f"items.json 里的事项 {_missing_sk} 在骨架里没有 —— items 必须在骨架上补字，"
              f"id 与骨架一一对应（要加减事项，先改 skeleton.json 重跑 capacity）。")
        sys.exit(1)
    items = sorted(items, key=lambda it: min(it.get("src_sids") or [10 ** 9]))
    for it in items:
        ev = copy.deepcopy(proto)
        ev["id"] = it["id"]
        ev["head"] = it["head"]
        ev["time"] = _time_block(_sk_by_id.get(str(it["id"])) or it)
        ev["source"] = _source_of(it.get("src_sids") or [], st)
        # medium 落在 **source 里**，不是事项的顶层 —— validate_map 读的是
        # event.source.medium（第一版我写在顶层，那条守卫根本看不到）。
        if it.get("medium") == "image":
            ev["source"]["medium"] = "image"
        if it.get("lane"):
            ev["lane"] = it["lane"]
        if it.get("emphasis"):
            ev["emphasis"] = True
        m["events"].append(ev)
    # ---- 图像来源要有名分（HANDOVER 5.4）--------------------------------------
    # 规矩：让模型直接读图（不引 OCR 依赖），但图像来源的事件单独标记，
    # **交付时必须声明哪几份材料没有文字层、有几个事件出自读图**。
    # 判据一个字不新写 —— schema 与 validate_map 早就完整实现了（图像来源事件必须有
    # scope、events_from_image 数目必须与实际相符、documents_unreadable 必须列出，
    # 不符是错误不是告警；造五个用例逐个验过，四种错法全被抓）。
    # 缺的只是管线组装地图时不带 medium、不带 scope，于是那条守卫在管线产物上
    # 永远看不到图像来源事件 —— 与 time.anchor 那个死字段同一类：
    # 规矩定了、schema 认了、校验器管着，交付路径不读它。
    _img_evs = [e for e in m["events"]
                if (e.get("source") or {}).get("medium") == "image"]
    if _img_evs:
        _docs = st.get("image_docs") or []
        if not _docs:
            print(f"  有 {len(_img_evs)} 个事项出自读图，但没有 image_docs.json —— "
                  f"按规矩必须声明哪几份材料没有文字层。请写 image_docs.json："
                  f'[{{"file": "材料一.docx", "reason": "聊天记录截图，无文字层"}}]')
            sys.exit(1)
        m["scope"] = {"mode": "full", "selection_source": "default",
                      "events_from_image": len(_img_evs),
                      "documents_unreadable": [
                          {"file": d.get("file", "?"),
                           "reason": d.get("reason", "无文字层，已读图"),
                           "read_as_image": True} for d in _docs]}
        print(f"  读图声明：{len(_img_evs)} 个事项出自读图"
              f"（事项 {'、'.join(str(e.get('id')) for e in _img_evs)}），"
              f"材料《{'》《'.join(d.get('file', '?') for d in _docs)}》无文字层；"
              f"这些事项未经逐字核验。")
    kind, form, why, wh = RF.deliver(m, out)
    print(f"出图：{kind}·{form}　整幅 {wh[0]:.0f}x{wh[1]:.0f}　{out}")
    _say_why(kind, why)
    # 传交付时**实际用的** layout：kind 是中文图种名，这里映回语义地图的 layout 名，
    # 因为 v1 的 _MODULE_LAYOUTS 是按 layout 名写的。
    _LAY_OF = {"编号型": "numbered_point_timeline", "日期型": "dated_point_timeline",
               "期间型": "proportional_gantt"}
    _apply_style(st, out, layout=_LAY_OF.get(kind, "numbered_point_timeline"))
    # ---- 五种可编辑格式（v1 已经解决过，这里只调它）------------------------
    # 顺序上必须在 _apply_style **之后**：风格变换改的是那张 SVG，而 pptx / vsdx
    # 是**读最终 SVG** 转出来的，先转就会把变换前的样子固定下来。
    _fmts = []
    try:
        import export_formats as EX
        import checkpoint as _CPF
        _want = _CPF.parse_formats(",".join(st.get("formats") or []))
        _fmts = EX.deliver(out, m, formats=_want, style=st.get("style"))
        print("可编辑格式：")
        for _f, _pth, _note in _fmts:
            print(f"  {_f:<11}{os.path.basename(_pth) if _pth else '（未生成）':<34}{_note}")
    except Exception as _exc:
        print(f"  可编辑格式未生成：{str(_exc).splitlines()[0][:70]}")
    # ---- 制作说明的事实（全部是已经算出来的，不推断）-----------------------
    # 制作说明是**给律师看的**，所以三条纪律：
    #   ① 不出现内部标识与像素数（英文 layout 名、230px 这类内部门禁值）——
    #      第一版把路由的整段机械理由抄了进去，图上就出现了 numbered_point_timeline；
    #   ② 每条一句话说完，不带两个句号；
    #   ③ 写实际发生的，不写能力上限 —— 容量那条第一版写「至多 110 字」，
    #      而图上每条只有 8 到 15 字，读起来像自相矛盾。改成同时给实际值。
    # 卡片日期行印的是骨架里的 raw：只有它算「已上图」，原句里别的日期删掉了照样要报
    _dates_of = {}
    for _sk in (st.get("skeleton") or []):
        _raw = str(_sk.get("raw") or "").strip()
        if _raw:
            _dates_of[str(_sk.get("id"))] = [_raw]
    _om_lines, _om_rows = _review_omissions(items, S, st, with_index=True,
                                            dates_of=_dates_of)
    _trace(items, S, st, out, omissions=_om_rows)
    _print_checklist(m)
    print()
    for _ln in _om_lines:
        print(_ln)
    print()
    stage_time()          # 出图后顺带给出计时账，下次要提速就知道该从哪一段下手


def _review_omissions(items, S, st, with_index=True, dates_of=None):
    """未上图披露（方案一：摘要图 + 强制披露）。返回 (要打印的行, 写进溯源索引的行)。

    卡片只放一行标题，标题是原句删出来的。删掉的那些字里若有付款条件、期限、
    质量异议这类限制性表述，图照样画得出、自检照样过，而律师并不知道它们没上图 ——
    外部复核称之为「交付图的信息被静默遗漏」。这里逐条算出来，写进溯源索引，
    命中限制性表述的列进交付清单，**交付前须用户确认**（pipeline.py ack）。

    这一步**绝不能让出图失败**：图已经写好了，核对本身出错时，按「全部待人工核对」
    记下并说清楚，确认门照样关着 —— 宁可多确认一次，也不许因为核对坏了就当作没有遗漏。
    """
    try:
        recs = OM.review_items(items, S, dates_of=dates_of)
        flag = OM.flagged(recs)
        lines = OM.summary_lines(recs, with_index=with_index)
        rows = OM.index_rows(recs) if with_index else []
        review = {"flagged": [r["id"] for r in flag],
                  "with_omission": [r["id"] for r in OM.with_omission(recs)],
                  "acked": not flag}
    except Exception as exc:                              # noqa: BLE001
        flag = [True]
        lines = [f"未上图核对没有做成（{type(exc).__name__}）：请逐条把图上文字与原句对照，"
                 f"确认没有遗漏要紧的限制条件。"]
        rows = []
        review = {"flagged": [str(it.get("id")) for it in items], "with_omission": [],
                  "acked": False, "error": type(exc).__name__}
    if flag:
        lines += ["",
                  "  交付前须确认：请把上面这几条原样给用户看，说明它们没有画到图上；",
                  "  用户确认可以按摘要交付（或改写 items.json 把要紧的字放回标题后重跑 render），",
                  f"  确认后跑：{PIPE} ack",
                  "  未确认之前，不要把图当作「已完整展示案件事实」交出去。"]
    review["with_index"] = bool(with_index)
    st["omission_review"] = review
    _save(st)
    return lines, rows


def _print_checklist(m):
    """出图后打印一份**文字版核对清单**：图上从先到后的编号、每个日期标签、正文开头、出处。

    真实运行里 PNG 没出来，模型想「看一眼图对不对」，读图工具又显示不了，于是反复转
    格式、做预览网页，花了 5 分多钟。图上的先后与标签都是代码算出来的，直接以文字给出，
    核对就不必看图；文字的排版与越界由渲染器自身的门禁保证（出图失败会直接报错）。"""
    import geom as _G
    evs = _G.order_by_time(copy.deepcopy(m.get("events") or []))
    print("核对清单（图上从先到后；核对以此为准，不必查看图片）：")
    for k, e in enumerate(evs, 1):
        dt = (e.get("time") or {}).get("date_text") or "（留空）"
        src = e.get("source") or {}
        print(f"  {k:>2}. {dt:<12} {str(e.get('head', ''))[:24]}　｜{src.get('file', '')} "
              f"{src.get('locator', '')}")


def _apply_style(st, out, layout=None):
    """按第三轮选的风格做变换。**直接用 v1 的两个函数，不另写一份。**

    白描 = to_monochrome（单色线稿，位置与尺寸和彩色版一字不差）
    歸藏风 = to_guizang（克莱因蓝、浅灰点阵底、无衬线）
    奇川风 = 不变换（它就是渲染器的原生产物）

    两个函数都接受一张 SVG、返回变换后的 SVG，所以能直接用在这一档的产物上 ——
    验过：白描与歸藏在时间轴大师的图上都变换成功。
    **调 to_guizang 时必须把 layout 传进去。** 它的签名是 `to_guizang(svg, layout=None)`，
    而里面每一步变换都带一个 `need`：「这一步在这种 layout 上该不该触发」。
    modules -> white cards / blue diamonds 那一步只对流程图与关系图成立
    （`_MODULE_LAYOUTS` 是 relation_tree / graphviz_flow / graphviz_relation），
    时间轴没有那种模块组。不传 layout 时 need 退回 True，于是每张时间轴都会报一句
    「1 post-processing step matched NOTHING — the figure may be wrong」——
    **那是一条误报，而 v1 在 `_sub` 的注释里专门写了为什么不能有误报**：
    a report that cries wolf gets ignored（会哭狼的报告没人看，而它存在的目的
    正是防止这件事）。所以这不是「不影响」，它会把真报警一起淹掉。
    """
    style = st.get("style") or "奇川风"
    if style == "奇川风":
        return
    import sys as _s
    _v1 = os.path.join(HERE, "..", "..", "mqc-litigation-visual-redraw", "scripts")
    if _v1 not in _s.path:
        _s.path.insert(0, _v1)
    import render as _V1R
    svg = open(out, encoding="utf-8-sig").read()
    try:
        # layout 由调用方传进来 —— 它的真值是 render_figure.deliver **实际交付的图种**。
        # 不从 state 猜、也不给硬编码默认值：拿默认值当真值正是这个项目一直在避免的事
        # （猜错时 need 又会算错，误报照样出现，而且更难查）。
        new_svg = (_V1R.to_monochrome(svg) if style == "白描"
                   else _V1R.to_guizang(svg, layout=layout))
    except Exception as exc:
        print(f"  {style} 变换失败：{str(exc).splitlines()[0][:60]}（保留奇川风）")
        return
    # 选了哪种风格，主交付物就是哪种风格：直接写回主图，后面的 PPTX / VSDX / drawio
    # 都从它转。原来另存成 -歸藏风.svg、主图留着奇川风，于是「改成歸藏风」之后
    # 其余格式全是奇川风（真实运行记录：模型只好手工补四步，还踩出一个标题框铺满整页的坑）。
    open(out, "w", encoding="utf-8").write(new_svg)
    print(f"  风格：{style}（主图与所有格式都按这个风格出）")


def _kill_autospace(docx):
    """关掉 Word 的中西文自动间距（autoSpaceDE / autoSpaceDN）。

    源文本里的空格已经在 _squeeze_cjk 挤掉了，JSON 里是「2022年11月8日」，而渲出来
    仍有空隙 —— 那是 Word 自己加的：OOXML 里这两个属性默认开启，会在中文与西文、
    中文与数字之间插入间距。作者要求前后不许有空格。

    docx-js 只能生成 autoSpaceDN，生成不了 autoSpaceDE，所以按文档技能给的办法
    解包改 XML：在样式表的默认段落属性里把两个都关掉，一处生效、全篇统一。
    「看起来是数据问题、实际是渲染器默认行为」这类坑，只有把产物渲出来看才发现。
    """
    import shutil
    import zipfile
    tmpd = docx + ".unz"
    if os.path.isdir(tmpd):
        shutil.rmtree(tmpd)
    with zipfile.ZipFile(docx) as z:
        z.extractall(tmpd)
    # 写进**每一个段落**的 pPr，不写在 styles.xml 的默认值里。
    # 默认值试过：属性确实写进了 docDefaults，渲出来空隙照旧 —— 表格单元格里的段落
    # 有自己的样式链，把默认值覆盖掉了。与其猜样式的层级，不如逐段写死，一处不漏。
    dp = os.path.join(tmpd, "word", "document.xml")
    add = '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>'
    xml = open(dp, encoding="utf-8-sig").read()
    # 有 pPr 的段落：插在 pPr 开头；没有 pPr 的：补一个
    xml = xml.replace("<w:pPr>", "<w:pPr>" + add)
    xml = re.sub(r"<w:p>(?!<w:pPr>)", "<w:p><w:pPr>" + add + "</w:pPr>", xml)
    open(dp, "w", encoding="utf-8").write(xml)
    base = docx + ".tmp"
    if os.path.exists(base):
        os.unlink(base)
    shutil.make_archive(base, "zip", tmpd)
    shutil.move(base + ".zip", docx)
    shutil.rmtree(tmpd)


def _squeeze_cjk(s):
    """去掉中文与西文（含数字）之间的空格。

    Word 会自动处理中西文间距，源文本里再留空格就是双份，看着满篇空隙。
    只去「一侧是中文、另一侧是西文或数字」的那些空格；西文之间的空格保留
    （「Times New Roman」不能被挤成一个词）。
    """
    import re as _re
    _CJK = r"\u4e00-\u9fff\u3000-\u303f\uff00-\uffef"
    s = _re.sub(rf"([{_CJK}])[ \t]+([0-9A-Za-z])", r"\1\2", s)
    s = _re.sub(rf"([0-9A-Za-z])[ \t]+([{_CJK}])", r"\1\2", s)
    # 反复挤，处理「中 1 中」这种夹在中间的
    for _ in range(3):
        s2 = _re.sub(rf"([{_CJK}])[ \t]+([0-9A-Za-z])", r"\1\2", s)
        s2 = _re.sub(rf"([0-9A-Za-z])[ \t]+([{_CJK}])", r"\1\2", s2)
        if s2 == s:
            break
        s = s2
    return s


def _date_text(t):
    """图上日期那一行写什么。作者定的规矩：**只写材料里原有的时间表述，不推算。**

      exact            → 「2019.11.29」（到日的日期换个排版，不是推算）
      range            → 材料原文，如「2021年」「2025年1月」，去掉排版留下的空格
      relative / order → 空着。「上诉后」这类标签是推出来的，材料里没有这个日子
    """
    c = t.get("certainty")
    if c == "exact" and t.get("date"):
        y, mo, da = (str(t["date"]).split("/") + ["1", "1"])[:3]
        return f"{y}.{int(mo):02d}.{int(da):02d}"
    if c == "range":
        # 起止同一天的区间其实就是那一天（汉字落款一度只能这样凑过校验），按日期显示
        if t.get("from") and t.get("from") == t.get("to"):
            y, mo, da = (str(t["from"]).split("/") + ["1", "1"])[:3]
            return f"{y}.{int(mo):02d}.{int(da):02d}"
        return re.sub(r"\s+", "", t.get("raw") or "")
    return ""


def _time_block(x):
    """把骨架里的一条事项转成地图的 time 块，四档确定度原样带过去。"""
    c = x.get("certainty") or ("exact" if x.get("date") else "order")
    t = {"certainty": c,
         "origin": "extracted" if c in ("exact", "range") else "derived",
         "kind": x.get("kind") or "occur",
         "raw": x.get("raw") or (x.get("date") or "先后可定")}
    for k in ("date", "from", "to", "anchor"):
        if x.get(k):
            t[k] = x[k]
    if t.get("anchor"):
        t["relation"] = "after"
    t["date_text"] = _date_text(t)
    return t


def _source_of(sids, st):
    """出处按**句子实际所属的材料**记，定位用该材料内的句号（从 1 起）。

    原来一律记成第一份材料、定位用拼接后的全局句号：真实运行里二审裁定的内容被记到
    一审判决书名下，「句380」在二审裁定原文里也找不到。溯源索引就是用来证明图不是
    瞎编的，这一处错了最伤。"""
    origin = st.get("origin") or []
    files = st.get("files") or ["材料"]
    first = {}
    for i, f in enumerate(origin):
        first.setdefault(f, i)
    by_file = {}
    for sid in sids:
        if isinstance(sid, int) and 0 <= sid < len(origin):
            by_file.setdefault(origin[sid], []).append(sid - first[origin[sid]] + 1)
    if not by_file:
        return {"file": files[0], "locator": f"句{sids}"}
    return {"file": "、".join(by_file),
            "locator": "；".join(("" if len(by_file) == 1 else f"{f} ") +
                                "句" + "、".join(str(n) for n in ns)
                                for f, ns in by_file.items())}


def _trace(items, S, st, out, omissions=None):
    """顺带写一份**溯源索引**：图上每个元素出自材料何处。

    作者定过：不做「事实与证据对照表」（那会破坏这个 skill 的纯粹，它只画时间轴），
    改成溯源索引 —— 只说明图上**已经画出来**的元素各自出自哪一处，让用户知道图不是瞎编的。
    所以这份表里没有评价、没有证据是否成立的判断，只有对应关系。

    它现在能自动生成，是因为每个事项都带 src_sids：那个字段本来是给子序列检查用的，
    顺带就把溯源这件事解决了。一个字段管两件事，不必让模型再答一遍。
    """
    rows = []
    for it in items:
        sids = it.get("src_sids") or ([it["src_sid"]] if it.get("src_sid") is not None else [])
        quote = "".join(S[s] for s in sids if isinstance(s, int) and 0 <= s < len(S))
        # 中文与西文之间不许有空格。
        # 材料原文里那些空格是排版软件留下的（「2023 年 1 月 12 日」），照抄进 Word
        # 就成了满篇中西文之间的空隙 —— Word 自己会做中西文间距，源文本里再塞空格
        # 就是双份。规范化时只清了页码与软换行，没清这一类，这里补上。
        quote = _squeeze_cjk(quote)
        _src = _source_of(sids, st)
        rows.append({"no": it.get("id", ""),
                     "head": it.get("head") or it.get("label_text", ""),
                     "file": _src["file"],
                     "locator": _src["locator"],
                     # 原文**不截断**。原来截到 120 字，而溯源索引是未上图披露
                     # 指向的「完整内容所在位置」—— 截了就又是一处静默遗漏。
                     "quote": quote})
    # 标题用换行分两级，不要拿全角空格拼在一行（渲出来是两个突兀的空格）
    # **一处挤干净**，不逐字段挤。
    # 逐字段挤过一版，漏了「定位」那一列（「句 9」是我自己拼的字符串，忘了挤），
    # docx 里还剩 12 段带空格。凡是「每处都要记得做一次」的事，就该收成一个出口
    # 统一做 —— 靠记性的地方一定会漏。
    payload = {"title": (st.get("title") or "本图") + "・溯源索引",
               "rows": [{k: _squeeze_cjk(v) if isinstance(v, str) else v
                         for k, v in r.items()} for r in rows]}
    if omissions:
        payload["omissions"] = [{k: _squeeze_cjk(v) if isinstance(v, str) else v
                                 for k, v in r.items()} for r in omissions]
    # [AWD-PATCH 8] 溯源索引改用同目录的 trace_index.py（纯标准库）生成，
    # 不再起 node 子进程 —— 桌面端不随包分发 Node/npm docx，那条路在用户
    # 机器上会「主图出来了、索引没写成」。trace_index.js 保留（上游回归
    # run_checks.py 的引号守卫仍走它），两版输出语义保持一致。
    docx = os.path.splitext(out)[0] + "-溯源索引.docx"
    tmp = os.path.splitext(out)[0] + "-trace.json"
    with open(tmp, "w", encoding="utf-8") as trace_file:
        json.dump(payload, trace_file, ensure_ascii=False)
    try:
        import trace_index as _TI   # HERE 已在 sys.path（本文件头部）
        _TI.write_docx(payload, docx)   # 原子写：失败不留半个 docx
        print(f"溯源索引：{docx}（{len(rows)} 行）")
    except Exception as exc:
        _trace_md(payload, out, f"Word 版没写成（{type(exc).__name__}）")
        return
    return


def _trace_md(payload, out, why):
    """Word 版溯源索引要 node 与它的 docx 模块；缺了不许让整份溯源消失，
    也不许让模型去排查 node 环境（真实运行里就这样卡过）。退回一份 Markdown 表格，
    内容与 Word 版逐行相同，并明说原因。"""
    md = os.path.splitext(out)[0] + "-溯源索引.md"
    esc = lambda x: str(x).replace("|", "｜").replace("\n", " ")
    lines = [f"# {payload['title']}", "", "| 编号 | 图上文字 | 出自 | 定位 | 原文 |",
             "| --- | --- | --- | --- | --- |"]
    lines += [f"| {esc(r['no'])} | {esc(r['head'])} | {esc(r['file'])} | "
              f"{esc(r['locator'])} | {esc(r['quote'])} |" for r in payload["rows"]]
    if payload.get("omissions"):
        lines += ["", "## 未上图的原文", "",
                  "本图是摘要图，卡片只放一行标题。下列事项的原句有部分内容没有画到图上，"
                  "请据此核对；「涉及」一列标出其中的限制性表述。", "",
                  "| 编号 | 涉及 | 未上图的原文 |", "| --- | --- | --- |"]
        lines += [f"| {esc(r['no'])} | {esc(r['kinds'])} | {esc(r['omitted'])} |"
                  for r in payload["omissions"]]
    open(md, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"溯源索引：{md}（{len(payload['rows'])} 行；{why}，已改出 Markdown 版，内容相同）")


def _say_why(kind, why):
    """出图理由分两层：先一句人话说结论，再把机械判据原样给出。

    这一处改的只是**呈现**，不是判据。起因是真实读者（含自动评测）把
    「日期型：…超过 8 格的上限…请改用编号型」读成了「出不了图，要改材料」，
    而事实相反：阶梯自动落到下一档，图已经出好了。结论不说在前面，
    读者就只能从一串机械理由里自己推。

    另外原来写的是 `why[:110]`，会在词中间断掉（实测断出
    「请改用编号型（numbered_point_timeli」这种残句）。机械理由一个字不删 ——
    C4 要求指名不成立的是哪一条 —— 改成按宽度折行，不截断。
    """
    if not why:
        return
    print(f"  图已出。图种是算出来的：这份材料落在「{kind}」这一档，"
          f"上一档不成立时会自动落档，不需要你改材料。判据：")
    # 折行的原子是「一个汉字」或「一串连续的 ASCII」：按单字符折会把
    # numbered_point_timeline 劈成两行，读起来像两个不同的标识符。
    atoms, buf = [], ""
    for ch in str(why):
        if ch == "\n":
            if buf:
                atoms.append(buf)
                buf = ""
            atoms.append("\n")
        elif ord(ch) < 128 and not ch.isspace():
            buf += ch
        else:
            if buf:
                atoms.append(buf)
                buf = ""
            atoms.append(ch)
    if buf:
        atoms.append(buf)

    line, width = "", 0
    for a in atoms:
        if a == "\n":
            print(f"    {line}")
            line, width = "", 0
            continue
        w = sum(1 if ord(c) < 128 else 2 for c in a)
        if width and width + w > 88:
            print(f"    {line}")
            line, width = "", 0
        if not line and a == " ":
            continue
        line += a
        width += w
    if line:
        print(f"    {line}")


#: 全流程。命令、谁做、要什么。`python pipeline.py steps` 打印它。
STEPS = [
    ("read <材料...>", "代码", "读材料、切句、认叙述块", ""),
    ("pick",           "用户", "第一轮：勾材料来源（含「全部」）", ""),
    ("span <编号|全部>", "用户", "第二轮：勾时间段（粒度按跨度自适应）", ""),
    # [AWD-PATCH 9] 顺序照 pick.STYLES 的真实编号：1 奇川风 / 2 歸藏风 / 3 白描 / 4 让 AI 定
    ("style <1-4>",    "用户", "第三轮：选风格 → 奇川风 / 歸藏风 / 白描 / 让 AI 定", ""),
    ("scope",          "代码", "列出勾选范围内的句子（逐句判定只判这些）", ""),
    ("offer",          "模型", "划分并给勾选清单", "verdicts.json + parts.json"),
    ("budget <编号|all>", "用户", "勾哪几个部分", ""),
    ("capacity",       "代码", "按真实骨架算形态与容量", "skeleton.json"),
    ("title '…'",      "模型", "图名（容量内）", ""),
    ("render <出图.svg>", "代码", "校验 → 出图 → 顺带写溯源索引", "items.json"),
]


def stage_next():
    """现在走到第几步、下一步跑什么、缺哪个文件。

    **不做「一键出图」**：九步里有四步必须等用户回答（勾材料、勾时间段、选风格、勾部分），
    一口气跑完等于把那几轮交互替用户答了 —— 而那几轮勾选是这个 skill 的设计核心
    （见 references/front-end.md「一轮交互」那一节：先前的设计是四问，
    「先问全部还是局部」被作者指出是假省 token，改成读完材料直接给勾选清单）。

    这一条解决的是**另一件事**：中途接手时没人说得清当前状态。各步的报错本来就清楚
    （「缺 state.json，先跑 read」），但换会话、跑错顺序、文件写坏之后，
    模型只能靠 state.json 里有哪些键去推断走到第几步 —— 那是猜。
    """
    st = None
    if os.path.exists(STATE):
        try:
            st = json.load(open(STATE, encoding="utf-8-sig"))
        except Exception as exc:
            print(f"state.json 读不出来（{type(exc).__name__}）—— 从头跑 read")
            print(f"  {_py('pipeline.py')} read <材料...>")
            return
    if st is None:
        print("还没开始。第一步是读材料：")
        print(f"  {_py('pipeline.py')} read <材料...>")
        print()
        print("材料是扫描件或照片（没有文字层）时，先走读图三步：")
        print(f"  {_py('read_image.py')} probe <材料.pdf>")
        return

    # 出过图、但还有限制性表述没经用户确认：这一步优先于其余一切。
    # 图文件已经在磁盘上，最容易出事的就是在这时把它当成定稿交出去。
    _rv = st.get("omission_review")
    if _rv and not _rv.get("acked"):
        print(f"已出图，但还差一步确认：事项 {'、'.join(_rv.get('flagged') or [])} "
              f"删去的部分含限制性表述，没有画到图上。")
        print("  把 render 打印的「未上图核对」那几条给用户看，用户确认后跑：")
        print(f"  {PIPE} ack")
        print("  确认之前不要交付。")
        return

    # 走到哪一步，看的是**产物**而不是自称：每一步都有它必须留下的东西
    done, nxt = [], None
    done.append(f"read（{len(st.get('sentences') or [])} 句，"
                f"{len(st.get('files') or [])} 份材料）")
    for key, name, cmd, note in (
            # 判「答过没有」要看**答案**写没写（picked_files / picked_spans），不能看清单
            # 打没打（pick_r1 / pick_r2）：read 现在读完就顺带打出第一轮清单，
            # 按清单判的话，第一轮还没勾，next 就说下一步是第二轮（自检时撞出来的）。
            ("picked_files", "pick 第一轮·勾材料来源", "pick 全部", "只有一份材料时自动跳过"),
            ("picked_spans", "span 第二轮·勾时间段", "span 全部", "跨度短、日期少时自动跳过"),
            ("style", "style 第三轮·选风格", "style 1", "1 奇川风（当事人与客户）/ 2 歸藏风（同行、讲课、公众号）/ 3 白描（法官、打印）/ 4 让我定"),
            ("parts", "offer 划分并给清单", "offer",
             "先跑 scope 列出范围内的句子，再写 verdicts.json + parts.json"),
            # 键名一律照代码里实际写的那个 —— 第一版这里猜成 picked_parts，
            # 而 stage_budget 写的是 picked_ids，于是勾完部分之后 next 还在说
            # 「下一步 budget」。**凭记忆写键名就是这个下场**，守卫盯住它。
            ("picked_ids", "budget 勾哪几个部分", "budget all", ""),
            ("cap", "capacity 算形态与容量", "capacity", "先写 skeleton.json"),
            ("title", "title 图名", "title '…'", "容量内"),
    ):
        if st.get(key) is not None:
            done.append(name.split("·")[0].split(" ")[0] + f"（{name}）")
        elif nxt is None:
            nxt = (name, cmd, note)
    print(f"已走完：{len(done)} 步")
    for d in done:
        print(f"  · {d}")
    if nxt is None:
        print()
        print("九步已齐，最后一步出图（先写 items.json：在骨架上补 head）：")
        print("  " + PIPE + " render 出图.svg")
        print()
        print("出图会一并给出五种可编辑格式与溯源索引 docx。")
        return
    name, cmd, note = nxt
    print()
    print(f"下一步：{name}")
    print(f"  {PIPE} {cmd}" + (f"      # {note}" if note else ""))
    _need = {"offer": ("verdicts.json", "parts.json"),
             "capacity": ("skeleton.json",)}.get(cmd.split()[0], ())
    for f in _need:
        if not os.path.exists(f):
            print(f"  这一步要模型先写 {f} —— 形状与判据："
                  f"{PIPE} shape {f}")


def stage_ack():
    """用户确认：命中限制性表述、没有画到图上的那几条，已经看过，同意按摘要图交付。

    这一步只记一笔「谁在什么时候确认了哪几条」，不改图。要把那些字放回图上，
    是改 items.json 的标题再重跑 render，不是在这里做。"""
    import datetime
    st = _load(STATE, "先跑到 render")
    rv = st.get("omission_review")
    if not rv:
        print("还没出图，没有可确认的未上图事项。先跑 render。")
        sys.exit(1)
    if not rv.get("flagged"):
        print("本图没有命中限制性表述的未上图事项，不需要确认。")
        return
    rv["acked"] = True
    rv["acked_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    st["omission_review"] = rv
    _save(st)
    print(f"已记下用户确认：事项 {'、'.join(rv['flagged'])} 的限制性表述不上图，"
          f"按摘要图交付；"
          + ("完整原句见溯源索引。" if rv.get("with_index", True)
             else "完整原句见 render 打印的「未上图核对」。"))


def stage_steps():
    # 标题原来写「四轮交互都在前段」。表里标「用户」的确实是四行，但**实际有五轮** ——
    # 第五轮（标红，`mark`）在抽取完事项之后问，不在这张表里，于是同一个包里
    # README 说五个问题、这里说四轮。数字一旦写死就会与别处打架，改成不数数：
    # 判据是「谁做」那一列，它跟着 STEPS 走，永远不会漂。
    print("全流程（标着「用户」的那几步等他勾选，其余自动）：")
    print()
    print(f"  {'命令':<22}{'谁做':<6}{'做什么':<34}{'要先写的文件'}")
    print("  " + "-" * 86)
    for cmd, who, what, need in STEPS:
        print(f"  {cmd:<22}{who:<6}{what:<34}{need}")
    print()
    print()
    print("  另有 mark <编号|0>    用户  第五轮：深红标在哪一处（0 = 不标）")
    print("  ——它在抽取完事项之后、出图之前问，只有奇川风才问，所以不在上表的主序里。")
    print()
    print("中途接手：" + PIPE + " next   —— 现在走到第几步、下一步跑什么")
    print("四份 JSON 的形状与判据：" + PIPE + " shape verdicts.json")
    print("（也可写 parts.json / skeleton.json / items.json）")


def _log_time(cmd):
    """记一本计时账：每条命令跑完的时刻写进 state。

    为什么要有它：真实运行一轮 15 分钟，可命令本身只花几秒，时间全在「两条命令之间」——
    也就是模型读材料、逐句判定、写骨架的那几段。没有这本账，就只能猜是哪一段慢，
    而这一路已经证明猜是靠不住的。账只记命令名与时刻，不记任何材料内容。"""
    import datetime as _dt
    try:
        st = json.load(open(STATE, encoding="utf-8-sig"))
    except Exception:
        return
    log = st.get("timing") or []
    log.append({"cmd": cmd, "at": _dt.datetime.now().isoformat(timespec="seconds")})
    st["timing"] = log[-60:]
    try:
        json.dump(st, open(STATE, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception:
        pass


def stage_time():
    """打印计时账：每一步本身用了多久、两步之间等了多久（那是模型在干活）。"""
    import datetime as _dt
    st = _load(STATE, "还没开始跑")
    log = st.get("timing") or []
    if len(log) < 2:
        print("计时账还没有内容（至少跑过两条命令才有得比）。")
        return
    t = [(x["cmd"], _dt.datetime.fromisoformat(x["at"])) for x in log]
    total = (t[-1][1] - t[0][1]).total_seconds()
    print(f"计时账　从 {t[0][1].strftime('%H:%M:%S')} 到 {t[-1][1].strftime('%H:%M:%S')}，"
          f"合计 {int(total // 60)} 分 {int(total % 60)} 秒")
    print("  两条命令之间的时间＝模型在读材料、判定、写文件，那才是大头。")
    for k in range(1, len(t)):
        gap = (t[k][1] - t[k - 1][1]).total_seconds()
        bar = "▇" * min(30, int(gap / max(1, total) * 60))
        print(f"  {t[k-1][0]:>10} → {t[k][0]:<10} {int(gap // 60):>3} 分 {int(gap % 60):02d} 秒  {bar}")


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
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == "time":
        stage_time()
        sys.exit(0)
    if cmd == "formats":
        import checkpoint as _CPF
        _st = _load(STATE, "先跑到 read")
        _st["formats"] = list(_CPF.parse_formats(" ".join(sys.argv[2:])))
        _save(_st)
        print("出图格式：" + "、".join(x.upper() for x in _st["formats"]))
        _log_time(cmd)
        sys.exit(0)
    if cmd == "ack":
        stage_ack()
    elif cmd == "mark":
        stage_mark(sys.argv[2] if len(sys.argv) > 2 else "")
    elif cmd == "next":
        stage_next()
    elif cmd == "steps":
        stage_steps()
    elif cmd == "shape":
        print_shape(sys.argv[2] if len(sys.argv) > 2 else "verdicts.json")
    elif cmd == "read":
        stage_read(sys.argv[2:])
    elif cmd == "pick":
        stage_pick(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "span":
        stage_span(sys.argv[2] if len(sys.argv) > 2 else "全部")
    elif cmd == "style":
        stage_style(sys.argv[2] if len(sys.argv) > 2 else "")   # 不回 = 1（奇川风），与提示一致
    elif cmd == "scope":
        stage_scope()
    elif cmd == "offer":
        stage_offer()
    elif cmd == "capacity":
        stage_capacity()
    elif cmd == "title":
        stage_title(sys.argv[2] if len(sys.argv) > 2 else "")
        if len(sys.argv) > 3:                     # 合并步骤：图名与标红一次报（标红仍是用户选的）
            stage_mark(sys.argv[3])
    elif cmd == "budget":
        stage_budget(sys.argv[2] if len(sys.argv) > 2 else "all")
    elif cmd == "render":
        stage_render(sys.argv[2] if len(sys.argv) > 2 else "out.svg")
    else:
        print(__doc__)
        sys.exit(2)
    _log_time(cmd)
