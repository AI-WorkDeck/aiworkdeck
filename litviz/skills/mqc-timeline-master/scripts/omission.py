#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""未上图披露：算出原句里哪些话没有画到图上，并把其中的限制性表述拦下来请用户确认。

为什么要有这个文件
------------------
时间轴大师的产品定位是**摘要图**：每张卡片只放一行标题（`head`），它是原句的子序列，
只许删字、不许改写。子序列检查保证了「图上的字都是材料里的字」，但它保证不了反过来那
一半 —— **材料里要紧的字有没有被删掉**。

外部复核（原点平台，2026-10）指出的就是这一半：付款条件、保证期间、质量异议这类只写在
正文里的关键信息，图可以成功生成、自检可以通过，而交付图上一个字都没有，用户也不知道。
复核方的准确说法是「交付图的信息被静默遗漏」。病根有两处：

  ① 旧文档（model-steps 第六步）要模型写 `body` 正文，而主路由的三个渲染器只画标题，
     `body` 写了也不上图；
  ② 即使没有 `body`，`head` 本身就是删出来的 ——「在质量异议期满后付款」删成「付款」，
     子序列检查照样通过。

所以这里不只管 `body`，管的是**原句与图上文字之间的差**。这件事是机械可算的：
`head` 是原句的子序列，对齐之后，没对上的那些字就是没上图的部分，一个字都不靠猜。

做法（作者定的方案一：摘要图 + 强制披露）
----------------------------------------
  · 每个事项算出「未上图的原文片段」，全部写进溯源索引，一条不省；
  · 片段里命中限制性表述（金额、期限、条件、质量与验收、违约责任、担保）的，
    在交付清单里逐条列出事项编号与完整原句，**交付前须用户确认**；
  · 地图里若带了 `body` / `items`（旧写法或手写地图），整段正文按「未上图」披露，
    不再静默丢弃。

判据只拦不放：词表漏了一个词，后果是少提示一处（索引里仍有全文）；词表多报一处，
后果是多确认一次。两者都不会让图画错，所以词表宁宽勿窄。
"""
import re

# ---- 限制性表述：按类给，报出时说得清是哪一类 -------------------------------
# 只收**两个字以上**的词。「如」「若」「但」「前」「须」这种单字在中文里到处都是，
# 收进来等于每条都报，报多了就没人看了 —— 那比不报更糟。
# 「但」单独用作转折时最要紧，所以收「但」开头的固定搭配与句中「，但」。
KEY_TERMS = [
    ("金额", ["货款", "价款", "款项", "余款", "尾款", "首付款", "预付款", "定金", "订金",
             "保证金", "押金", "租金", "利息", "本金", "费用", "报酬", "工程款", "价格"]),
    ("付款条件", ["付款", "支付", "给付", "结算", "清偿", "偿还", "分期", "汇款", "转账"]),
    ("期限", ["期限", "期间", "期满", "届满", "之日起", "日内", "以内", "之前", "之后",
             "截止", "到期", "保证期", "保修期", "质保期", "诉讼时效", "宽限期"]),
    ("条件", ["条件", "前提", "如果", "如未", "如不", "若未", "若不", "否则", "除外", "除非",
             "方可", "视为", "为准", "，但", "但是", "但书", "不得", "应当", "必须"]),
    ("质量与验收", ["质量", "异议", "验收", "瑕疵", "合格", "不合格", "检验", "质保", "保修",
                  "退货", "换货", "返工"]),
    ("违约责任", ["违约", "违约金", "赔偿", "损失", "逾期", "滞纳金", "罚息", "解除",
                "终止", "撤销", "催告", "免责"]),
    ("担保", ["担保", "保证人", "连带", "抵押", "质押", "留置", "反担保"]),
]
# 金额与比例：数字后跟元、万元、%、‰ 的一律算金额，词表管不住数字。
_AMOUNT = re.compile(r"[\d０-９一二三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟〇零.,，]+"
                     r"\s*(?:万|亿)?\s*(?:元|美元|港元|欧元)|[\d.]+\s*[%％‰]")

# 日期本身画在卡片的日期行上，不是「没上图」。只由日期、空白、标点构成的片段不报。
_DATE = re.compile(r"[\d〇零一二三四五六七八九十]{2,4}\s*年(?:\s*[\d一二三四五六七八九十]{1,2}\s*月)?"
                   r"(?:\s*[\d一二三四五六七八九十]{1,3}\s*日)?"
                   r"|[\d一二三四五六七八九十]{1,2}\s*月(?:\s*[\d一二三四五六七八九十]{1,3}\s*日)?")
_TRIVIAL = re.compile(r"[\s，,。．.、；;：:！!？?（）()《》〈〉“”‘’「」『』\"'—\-…·]+")


def _norm(s):
    return re.sub(r"\s+", "", s or "")


def align(shown, source):
    """把 shown 对到 source 上，返回 source 里**没对上**的那些片段 [(起, 止), ...]。

    shown 必须是 source 的子序列（主路由在出图前已经核验过）；不是就返回 None，
    调用方据此说「未能比对」，不许猜。

    不用贪心最左匹配：贪心会把标题里的「公司」对到原句开头那个当事人的「公司」上，
    于是中间整段被报成没上图、真正删掉的那几个字反而被当成上了图。这里用动态规划
    取**连续块最少**的对齐 —— 删减出来的标题本来就是原句的几段连续片段，块越少越
    接近模型实际做的那一刀。标题几十字、原句几百字，表格两万格，不费事。
    """
    a, b = _norm(source), _norm(shown)
    n, m = len(a), len(b)
    if m == 0:
        return [(0, n)] if n else []
    INF = 10 ** 9
    # A[i][j]：b[:j] 对进 a[:i]，且 a[i-1] 恰好对上 b[j-1]，所需最少块数
    # B[i][j]：b[:j] 对进 a[:i]，不限 a[i-1] 是否对上
    # pa / pb 记来路，回溯时照着走，不靠数值反推。
    A = [[INF] * (m + 1) for _ in range(n + 1)]
    B = [[INF] * (m + 1) for _ in range(n + 1)]
    pa = [[0] * (m + 1) for _ in range(n + 1)]     # 1 = 接上一块，0 = 另起一块
    pb = [[0] * (m + 1) for _ in range(n + 1)]     # 1 = 跳过 a[i-1]，0 = a[i-1] 对上
    for i in range(n + 1):
        B[i][0] = 0
        pb[i][0] = 1
    for i in range(1, n + 1):
        ai = a[i - 1]
        for j in range(1, m + 1):
            if ai == b[j - 1]:
                cont, new = A[i - 1][j - 1], B[i - 1][j - 1] + 1
                if cont <= new:
                    A[i][j], pa[i][j] = cont, 1
                else:
                    A[i][j], pa[i][j] = new, 0
            if B[i - 1][j] <= A[i][j]:
                B[i][j], pb[i][j] = B[i - 1][j], 1
            else:
                B[i][j], pb[i][j] = A[i][j], 0
    if B[n][m] >= INF:
        return None
    used = [False] * n
    i, j, state = n, m, "B"
    while j > 0 and i > 0:
        if state == "B":
            if pb[i][j] == 1:
                i -= 1
            else:
                state = "A"
            continue
        used[i - 1] = True
        state = "A" if pa[i][j] == 1 else "B"
        i, j = i - 1, j - 1
    out, k = [], 0
    while k < n:
        if not used[k]:
            s = k
            while k < n and not used[k]:
                k += 1
            out.append((s, k))
        else:
            k += 1
    return out


def _meaningful(seg, shown_dates=None):
    """去掉卡片上已经画出的日期与标点之后还剩下的字。只剩一两个虚字（的、了、于、向）不算遗漏。

    shown_dates：这个事项在卡片日期行上印出的那个时间表述原文（骨架里的 raw）。
    给了它，就**只**把它当作已上图；原句里别的日期（付款截止日、交付期限）删掉了，
    照样算遗漏 —— 那正是要报的东西。没给（手写地图、期间型的轴上起止）才退回
    「凡是日期都算已上图」。
    """
    if shown_dates:
        rest = seg
        for d in shown_dates:
            d = _norm(d)
            if d:
                rest = rest.replace(d, "")
        rest = _TRIVIAL.sub("", rest)
    else:
        rest = _TRIVIAL.sub("", _DATE.sub("", seg))
    rest = re.sub(r"^[的了于向在对与和及并已将就把被由从其该此]+|[的了于向在对与和及并已将就把被由从其该此]+$",
                  "", rest)
    # 期间的起止（「2020年1月1日至2021年6月30日」）画在轴上：去掉日期后只剩连接词的不算
    if re.fullmatch(r"[至到起止~～]*", rest):
        return ""
    return rest


def key_hits(text):
    """text 里命中的限制性表述，返回 [(类, 词), ...]，按出现先后、同词只报一次。"""
    hits, seen = [], set()
    t = _norm(text)
    for cat, words in KEY_TERMS:
        for w in words:
            w2 = w
            if w2 and w2 in t and w2 not in seen:
                seen.add(w2)
                hits.append((cat, w2, t.find(w2)))
    for mo in _AMOUNT.finditer(t):
        tok = mo.group(0).lstrip(",，.")
        if tok and tok not in seen:
            seen.add(tok)
            hits.append(("金额", tok, mo.start()))
    hits.sort(key=lambda x: x[2])
    return [(c, w) for c, w, _ in hits]


def review_event(eid, shown, source, body=None, items=None, attrib=None, shown_dates=None):
    """一个事项的披露结果。

    返回 {"id", "shown", "source", "omitted": [片段], "body_dropped": 文本或 None,
          "hits": [(类, 词)], "aligned": bool}
    """
    rec = {"id": str(eid), "shown": shown or "", "source": _norm(source),
           "omitted": [], "body_dropped": None, "hits": [], "aligned": True}
    if source:
        spans = align(shown or "", source)
        if spans is None:
            rec["aligned"] = False
        else:
            src = _norm(source)
            for s, e in spans:
                seg = src[s:e]
                if _meaningful(seg, shown_dates):
                    rec["omitted"].append(seg)
    dropped = (body or "").strip()
    if items:
        dropped = (dropped + "；" if dropped else "") + "；".join(str(x) for x in items)
    if dropped:
        rec["body_dropped"] = dropped
    # 逐段扫，不拼起来扫：拼接会在两段的接缝上凑出原句里并不相连的词
    hits, seen = [], set()
    for seg in rec["omitted"] + ([rec["body_dropped"]] if rec["body_dropped"] else []):
        for h in key_hits(seg):
            if h[1] not in seen:
                seen.add(h[1])
                hits.append(h)
    # 卡片日期行之外的日期被删掉了（交货日、付款截止日、期满日）：本身就是期限，要报。
    # 只在知道卡片印的是哪个日期时才这样判，否则分不清哪个日期已经上图。
    if shown_dates:
        for seg in rec["omitted"]:
            rest = seg
            for d in shown_dates:
                if _norm(d):
                    rest = rest.replace(_norm(d), "")
            for mo in _DATE.finditer(rest):
                tok = mo.group(0)
                if tok not in seen:
                    seen.add(tok)
                    hits.append(("期限", tok))
    rec["hits"] = hits
    return rec


def review_items(items, sentences, dates_of=None):
    """主路由：items.json 的事项对 state 里的句子。

    dates_of：{事项 id: [卡片上印出的时间表述原文]}，取自骨架的 raw。期间型不给
    （起止画在轴上，原句里的日期都算已上图）。"""
    out = []
    for it in items:
        sids = it.get("src_sids")
        if sids is None:
            one = it.get("src_sid")
            sids = [one] if one is not None else []
        src = "".join(sentences[s] for s in sids
                      if isinstance(s, int) and 0 <= s < len(sentences))
        sd = (dates_of or {}).get(str(it.get("id"))) if dates_of is not None else None
        out.append(review_event(it.get("id", "?"), it.get("head") or "", src,
                                body=it.get("body"), items=it.get("items"),
                                shown_dates=sd))
    return out


def review_map(m):
    """直接拿语义地图出图的入口：没有原句可比，只能披露地图里写了却不上图的正文。

    `source.quote` 若写了原句，就拿它比对标题；没写就只报 body / items。
    """
    out = []
    for e in m.get("events") or []:
        q = (e.get("source") or {}).get("quote") or ""
        rec = None
        # 横向用 head_short、纵向用 head：哪一个能对上原句就按哪一个比
        for shown in (e.get("head_short"), e.get("head"), e.get("text")):
            if not shown:
                continue
            r = review_event(e.get("id", "?"), shown, q,
                             body=e.get("body"), items=e.get("items"))
            if r["aligned"]:
                rec = r
                break
        if rec is None:
            # 手写地图没有「标题必须是 quote 子序列」这条保证（quote 常是摘句），
            # 对不上不说明有遗漏，只披露确定不上图的 body / items，不拿它报「无法比对」。
            rec = review_event(e.get("id", "?"), "", "",
                               body=e.get("body"), items=e.get("items"))
            rec["shown"] = e.get("head_short") or e.get("head") or e.get("text") or ""
            rec["source"] = _norm(q)
        out.append(rec)
    return out


def flagged(recs):
    return [r for r in recs if r["hits"]]


def with_omission(recs):
    return [r for r in recs if r["omitted"] or r["body_dropped"]]


def summary_lines(recs, limit_src=None, with_index=True):
    """交付清单里那一段：先一句总数，再逐条列出命中限制性表述的事项。"""
    lines = []
    om = with_omission(recs)
    fl = flagged(recs)
    na = [r for r in recs if not r["aligned"]]
    if not om and not na:
        lines.append("未上图核对：每个事项的原句均已完整上图，没有删去的内容。")
        return lines
    lines.append(f"未上图核对：本图是摘要图，卡片只放一行标题。{len(recs)} 个事项中，"
                 f"{len(om)} 个的原句有部分内容没有画到图上"
                 + ("（完整原句与未上图部分已逐条写入溯源索引）。" if with_index
                    else "（本次不出溯源索引，未上图的原文逐条列在下面）。"))
    if not with_index:
        for r in om:
            if r["hits"]:
                continue                      # 命中限制性表述的下面单独列，不重复
            for seg in r["omitted"]:
                lines.append(f"    [{r['id']}] 未上图：{seg}")
            if r["body_dropped"]:
                lines.append(f"    [{r['id']}] 未上图的正文：{r['body_dropped']}")
    bd = [r for r in recs if r["body_dropped"]]
    if bd:
        lines.append(f"  其中 {len(bd)} 个事项写了正文（body/items），正文不上图："
                     f"事项 {'、'.join(r['id'] for r in bd)}。")
    if na:
        lines.append(f"  事项 {'、'.join(r['id'] for r in na)} 的图上文字不是原句的子序列，"
                     f"无法比对未上图部分，请人工核对。")
    if fl:
        lines.append(f"  ！{len(fl)} 个事项删去的部分含限制性表述（金额、期限、条件、质量、"
                     f"违约、担保等），交付前须请用户逐条确认：")
        for r in fl:
            cats = "、".join(dict.fromkeys(c for c, _ in r["hits"]))
            words = "、".join(w for _, w in r["hits"][:6])
            lines.append(f"    [{r['id']}] 图上：{r['shown']}")
            lines.append(f"         未上图涉及：{cats}（{words}）")
            for seg in r["omitted"]:
                lines.append(f"         删去的原文：{seg}")
            if r["body_dropped"] and key_hits(r["body_dropped"]):
                lines.append(f"         未上图的正文：{r['body_dropped']}")
            src = r["source"]
            if limit_src and len(src) > limit_src:
                src = src[:limit_src] + ("（全文见溯源索引）" if with_index else "")
            if src:
                lines.append(f"         完整原句：{src}")
    return lines


def index_rows(recs):
    """写进溯源索引的「未上图部分」：每个有删减的事项一行，片段原样，不截断。"""
    rows = []
    for r in with_omission(recs):
        parts = list(r["omitted"])
        if r["body_dropped"]:
            parts.append("【正文】" + r["body_dropped"])
        rows.append({"no": r["id"],
                     "kinds": "、".join(dict.fromkeys(c for c, _ in r["hits"])) or "—",
                     "omitted": "／".join(parts)})
    return rows


if __name__ == "__main__":
    import json
    import sys
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if {"-h", "--help"} & set(sys.argv[1:]) or len(sys.argv) < 2:
        print((__doc__ or "").strip())
        print("\n用法：python omission.py <语义地图.json>   # 列出地图里写了却不上图的内容")
        raise SystemExit(0)
    try:                                   # 常见输入错误（路径、JSON、编码）说人话，不甩堆栈
        __import__("_cli_errors").install()
    except ImportError:
        pass
    _m = json.load(open(sys.argv[1], encoding="utf-8-sig"))
    for _ln in summary_lines(review_map(_m)):
        print(_ln)
