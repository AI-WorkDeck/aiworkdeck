#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""未上图披露的守卫（v2.2.0，方案一：摘要图 + 强制披露）。

起因是原点平台的外部复核：主路由三个渲染器只画 head，body 写了也不上图，
而图照样生成、自检照样通过 ——「交付图的信息被静默遗漏」。

每条守卫都先证明自己**能失败**（项目的规矩：没见它报过错的守卫不算守卫）：
把被守的东西故意拿掉或改坏，确认这里真的报出来。

单独可跑：python tests/omission_checks.py；也由 run_checks.py 在末尾调用。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, "..")
SCRIPTS = os.path.join(SKILL, "scripts")
sys.path.insert(0, SCRIPTS)
import omission as OM   # noqa: E402

# 一句带全部要紧限制条件的合同句，132 字，故意超过原来溯源索引截断的 120 字
LONG = ("2023年1月10日，甲公司与乙公司签订《买卖合同》，约定乙公司在质量异议期满后十日内"
        "支付货款120万元，逾期按日万分之五支付违约金，甲公司应于2023年3月1日前交付全部设备"
        "并负责安装调试，设备经乙公司验收合格后方视为交付完成，验收不合格的甲公司应在七日内更换。")
SENTS = [LONG, "2023年3月1日，甲公司交付设备。", "2023年5月20日，乙公司提出质量异议。",
         "2024年3月1日，甲公司起诉。"]


def _align_msgs():
    m = []
    r = OM.review_event("1", "甲公司与乙公司签订《买卖合同》", LONG)
    if not r["omitted"] or "质量异议期满后十日内" not in "".join(r["omitted"]):
        m.append("删去的付款条件没被算成「未上图」")
    if not r["hits"]:
        m.append("删去的付款条件、期限、违约金没有命中限制性表述")
    if any("2023年1月10日" in s for s in r["omitted"]):
        m.append("日期画在卡片日期行上，不该算作未上图")
    # 只删了日期与标点：不报
    r2 = OM.review_event("2", "甲公司交付设备", SENTS[1])
    if r2["omitted"] or r2["hits"]:
        m.append(f"只删了日期却报了未上图：{r2['omitted']}")
    # 整句照录：不报
    r3 = OM.review_event("3", LONG, LONG)
    if r3["omitted"]:
        m.append("整句照录仍报了未上图")
    # 不是子序列：说「未能比对」，不许猜
    r4 = OM.review_event("4", "丙公司付款", LONG)
    if r4["aligned"]:
        m.append("标题不是原句子序列时没有报「未能比对」")
    # 对齐要取连续块最少的那一种：标题「乙公司签订《买卖合同》」里的「乙公司」对到原句
    # 「与乙公司签订」那一处，于是删掉的是开头的「甲公司与」，而不是把中间整段报成没上图
    r5 = OM.review_event("5", "乙公司签订《买卖合同》", LONG)
    if not any(s.startswith("2023年1月10日，甲公司与") or "甲公司与" in s for s in r5["omitted"]):
        m.append(f"对齐结果不对：{r5['omitted']}")
    # 无害删减不触发确认
    r6 = OM.review_event("6", "甲公司起诉", "2024年3月1日，甲公司向某某人民法院起诉。")
    if r6["hits"]:
        m.append(f"无害删减（法院名称）触发了限制性表述：{r6['hits']}")
    # 卡片日期行之外的日期被删掉（交货日、截止日）本身就是期限，要报；卡片上印的那个不报
    r7 = OM.review_event("7", "甲公司与乙公司约定交货",
                         "2023年1月10日，甲公司与乙公司约定于2023年3月1日交货。",
                         shown_dates=["2023 年 1 月 10 日"])
    if ("期限", "2023年3月1日") not in r7["hits"]:
        m.append(f"删掉的交货日期没有作为期限报出：{r7['hits']}")
    if any("2023年1月10日" in w for _, w in r7["hits"]):
        m.append("卡片上已经印出的日期被当成了遗漏")
    # 逐段扫：两段删掉的字不许在接缝上拼出原句里并不相连的词（「付」「款」分在两处）
    if OM.review_event("8", "甲乙丙丁", "甲付乙款丙丁")["hits"]:
        m.append("接缝误报：把不相连的两段拼成了「付款」")
    # 中文 Windows 控制台是 GBK：交付清单的每个字都必须编得进 GBK
    _all = "\n".join(OM.summary_lines([r, r7, OM.review_event("9", "甲", "甲", body="乙方付款")],
                                       with_index=True)
                     + OM.summary_lines([r, r7], with_index=False))
    try:
        _all.encode("gbk")
    except UnicodeEncodeError as exc:
        m.append(f"交付清单里有 GBK 编不进的字符：{exc.object[exc.start:exc.end]!r}")
    # 能失败：把词表清空，限制性表述就必须漏报 —— 证明「命中」确实来自词表
    saved, saved_amt = OM.KEY_TERMS, OM._AMOUNT
    try:
        OM.KEY_TERMS = []
        OM._AMOUNT = re.compile(r"(?!x)x")
        if OM.review_event("1", "甲公司与乙公司签订《买卖合同》", LONG)["hits"]:
            m.append("词表清空后仍报命中 —— 判据不是来自词表，守卫是摆设")
    finally:
        OM.KEY_TERMS, OM._AMOUNT = saved, saved_amt
    return m


def _map_msgs():
    """复核方的对照实验：只把首个事件的 body 从 A 换成 B。
    SVG 逐字节相同是**设计如此**（摘要图），但披露必须分别报出 A 与 B。"""
    m = []
    src = json.load(open(os.path.join(SKILL, "examples", "numbered-multiband.json"),
                         encoding="utf-8"))
    for tag, body in (("A", "买方应在验收合格后三十日内支付全部货款"),
                      ("B", "保证期间为六个月，自交付之日起计算")):
        mm = json.loads(json.dumps(src))
        mm["events"][0]["body"] = body
        recs = OM.review_map(mm)
        txt = "\n".join(OM.summary_lines(recs))
        if body not in txt:
            m.append(f"地图写了 body（正文{tag}），披露里没有它 —— 又是静默遗漏")
    # 作者示例里主路由的那几份不再带 body（文档已改为只写 head）
    for f in ("numbered-multiband", "two-sides-numbered", "two-sides-actors",
              "stress-two-sides", "dated-limitation", "dated-proportional"):
        ev = json.load(open(os.path.join(SKILL, "examples", f + ".json"),
                            encoding="utf-8")).get("events") or []
        if any(e.get("body") or e.get("items") for e in ev):
            m.append(f"examples/{f}.json 仍带 body/items，而主路由不画它 —— 示例在教模型写不上图的正文")
    return m


def _doc_msgs():
    m = []
    ms = open(os.path.join(SKILL, "references", "model-steps.md"), encoding="utf-8").read()
    six = ms.split("## 第六步")[1].split("\n## ")[0] if "## 第六步" in ms else ""
    if re.search(r'"body"\s*:', six):
        m.append("model-steps 第六步的示例仍在教模型写 body")
    if "omission" not in six and "未上图" not in six:
        m.append("model-steps 第六步没说删掉的部分会被披露")
    vm = open(os.path.join(SCRIPTS, "validate_map.py"), encoding="utf-8").read()
    if "无正文块" in re.sub(r"#.*", "", vm):
        m.append("validate_map 仍在没有正文时告警（等于要求写一段不上图的正文）")
    sk = open(os.path.join(SKILL, "SKILL.md"), encoding="utf-8").read()
    for need in ("摘要图", "交付前须确认", "pipeline.py ack", "已完整展示案件事实"):
        if need not in sk:
            m.append(f"SKILL.md 缺「{need}」—— 交付纪律没写给 agent")
    pl = open(os.path.join(SCRIPTS, "pipeline.py"), encoding="utf-8").read()
    body = pl.split("def stage_render")[1].split("\ndef ")[0]
    code = "\n".join(l for l in body.splitlines() if not l.lstrip().startswith("#"))
    if code.count("_review_omissions(") < 2:
        m.append("stage_render 没有在编号型与期间型两条路上都调用未上图核对")
    helper = pl.split("def _review_omissions")[1].split("\ndef ")[0] if "def _review_omissions" in pl else ""
    if "OM.review_items" not in helper:
        m.append("_review_omissions 没有调用 omission.review_items")
    if 'quote[:120]' in pl:
        m.append("溯源索引的原文又被截到 120 字")
    return m


def _e2e_msgs():
    """真跑一遍 render → next → ack，看披露、确认门与溯源索引。"""
    m = []
    d = tempfile.mkdtemp(prefix="nlv-omit-")
    try:
        sk = [{"id": str(i + 1), "src_sids": [i], "date": dt, "raw": raw,
               "certainty": "exact", "kind": "occur"}
              for i, (dt, raw) in enumerate((("2023/1/10", "2023年1月10日"),
                                             ("2023/3/1", "2023年3月1日"),
                                             ("2023/5/20", "2023年5月20日"),
                                             ("2024/3/1", "2024年3月1日")))]
        st = {"sentences": SENTS, "files": ["材料一.txt"], "origin": ["材料一.txt"] * 4,
              "cap": 60, "cap_title": 30, "title": "甲乙买卖合同纠纷经过",
              "skeleton": sk, "style": "baimiao", "formats": ["svg"]}
        items = [{"id": "1", "src_sids": [0], "head": "甲公司与乙公司签订《买卖合同》"},
                 {"id": "2", "src_sids": [1], "head": "甲公司交付设备"},
                 {"id": "3", "src_sids": [2], "head": "乙公司提出质量异议"},
                 {"id": "4", "src_sids": [3], "head": "甲公司起诉"}]
        json.dump(st, open(os.path.join(d, "state.json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
        json.dump(items, open(os.path.join(d, "items.json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
        pl = os.path.join(SCRIPTS, "pipeline.py")
        env = dict(os.environ, PYTHONIOENCODING="utf-8")

        def run(*a):
            r = subprocess.run([sys.executable, pl, *a], cwd=d, capture_output=True,
                               text=True, encoding="utf-8", errors="replace",
                               timeout=300, env=env)
            return r.returncode, r.stdout + r.stderr

        rc, out = run("render", "out.svg")
        if rc != 0:
            return [f"render 没跑通：{out[-300:]}"]
        if "交付前须确认" not in out or "质量异议期满后十日内" not in out:
            m.append("render 没有把删去的付款条件列进交付清单")
        if "[2]" in out.split("未上图核对")[-1]:
            m.append("只删了日期的事项被当成需要确认")
        _, nx = run("next")
        if "ack" not in nx or "确认之前不要交付" not in nx:
            m.append("未确认时 next 没有停在确认这一步")
        # 出图的输入变了（这里改图名），上一张图的确认门就作废，下一步应是重新出图
        run("title", "甲乙买卖合同纠纷经过")
        _, nx1 = run("next")
        if "确认之前不要交付" in nx1:
            m.append("改了图名之后 next 仍要求确认上一张图 —— 确认门没有随输入作废")
        rc, out = run("render", "out.svg")
        if rc != 0 or "交付前须确认" not in out:
            m.append("重新出图后没有重新要求确认")
        rc, ak = run("ack")
        if rc != 0 or "已记下用户确认" not in ak:
            m.append(f"ack 没跑通：{ak[-200:]}")
        _, nx2 = run("next")
        if "确认之前不要交付" in nx2:
            m.append("ack 之后 next 仍停在确认这一步")
        # 溯源索引：Word 版或 Markdown 版，二者之一必须有「未上图的原文」与 132 字全文
        docx = os.path.join(d, "out-溯源索引.docx")
        md = os.path.join(d, "out-溯源索引.md")
        blob = ""
        if os.path.exists(docx):
            import zipfile
            blob = re.sub(r"<[^>]+>", "", zipfile.ZipFile(docx).read("word/document.xml")
                          .decode("utf-8"))
        elif os.path.exists(md):
            blob = open(md, encoding="utf-8").read()
        else:
            m.append("溯源索引没写出来")
        if blob:
            if "未上图的原文" not in blob:
                m.append("溯源索引没有「未上图的原文」一节")
            if "验收不合格的甲公司应在七日内更换" not in blob:
                m.append("溯源索引的原文被截断（第 120 字之后的内容不见了）")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return m


def _spans_msgs():
    """期间型：条上标签同样是删出来的，同样要披露；这一档不出溯源索引，原文直接打出来。
    起止日期画在轴上，「某日至某日」不算遗漏。"""
    m = []
    d = tempfile.mkdtemp(prefix="nlv-omit-sp-")
    try:
        S = ["2020年1月1日至2021年6月30日，甲公司租赁乙公司厂房，约定租金每月5万元，"
             "逾期支付按日千分之一支付违约金。",
             "2021年3月1日至2022年2月28日，乙公司对厂房进行改造。"]
        st = {"sentences": S, "files": ["a.txt"], "origin": ["a.txt"] * 2, "has_spans": True,
              "per_span": [{"id": "s1", "in_bar": 20, "days": 546},
                           {"id": "s2", "in_bar": 20, "days": 364}],
              "title": "租赁与改造期间", "style": "baimiao", "formats": ["svg"]}
        items = [{"id": "1", "src_sids": [0], "head": "甲公司租赁乙公司厂房",
                  "from": "2020/1/1", "to": "2021/6/30"},
                 {"id": "2", "src_sids": [1], "head": "乙公司对厂房进行改造",
                  "from": "2021/3/1", "to": "2022/2/28"}]
        json.dump(st, open(os.path.join(d, "state.json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
        json.dump(items, open(os.path.join(d, "items.json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "pipeline.py"), "render",
                            "out.svg"], cwd=d, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=300,
                           env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        out = r.stdout + r.stderr
        if r.returncode != 0 or not os.path.exists(os.path.join(d, "out.svg")):
            return [f"期间型 render 没跑通：{out[-300:]}"]
        if "交付前须确认" not in out or "约定租金每月5万元" not in out:
            m.append("期间型删去的租金与违约金没有披露")
        if "[2] 未上图" in out:
            m.append("期间型的起止日期被当成了未上图内容")
        stj = json.load(open(os.path.join(d, "state.json"), encoding="utf-8"))
        if (stj.get("omission_review") or {}).get("acked") is not False:
            m.append("期间型有待确认事项，确认门却是开着的")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return m


def _failsafe_msgs():
    """核对本身出错时：不许让出图失败，也不许当作没有遗漏 —— 确认门必须关着。"""
    m = []
    d = tempfile.mkdtemp(prefix="nlv-omit-fs-")
    cwd = os.getcwd()
    import pipeline as PL
    saved = PL.OM.review_items
    try:
        os.chdir(d)

        def boom(*a, **k):
            raise RuntimeError("故意弄坏")
        PL.OM.review_items = boom
        st = {"sentences": SENTS}
        lines, rows = PL._review_omissions([{"id": "1", "src_sids": [0], "head": "甲"}],
                                           SENTS, st, with_index=True)
        rv = st.get("omission_review") or {}
        if rv.get("acked") is not False:
            m.append("核对出错时确认门是开着的（等于当作没有遗漏）")
        if not any("没有做成" in x for x in lines):
            m.append("核对出错时没有说出来")
    except Exception as exc:
        m.append(f"核对出错时把异常抛了出去（会让出图失败）：{type(exc).__name__}")
    finally:
        PL.OM.review_items = saved
        os.chdir(cwd)
        shutil.rmtree(d, ignore_errors=True)
    return m


def main():
    msgs = []
    for name, fn in (("对齐与命中", _align_msgs), ("地图入口与示例", _map_msgs),
                     ("文档与管线一致", _doc_msgs), ("端到端 render/next/ack", _e2e_msgs),
                     ("期间型", _spans_msgs), ("核对出错时关门", _failsafe_msgs)):
        got = fn()
        print(f"  {name:<20}{'通过' if not got else str(len(got)) + ' 项未过'}")
        for x in got:
            print(f"    FAIL {x}")
        msgs += got
    return msgs


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    print("=== 未上图披露（摘要图 + 强制披露）===")
    sys.exit(1 if main() else 0)
