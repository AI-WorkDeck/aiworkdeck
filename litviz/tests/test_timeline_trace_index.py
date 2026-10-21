# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""溯源索引 DOCX 的零依赖生成回归（dev-board 任务 #1389，[AWD-PATCH 8]）。

背景：原来 pipeline._trace 用 subprocess 起 node trace_index.js，要求用户机器装
Node 与全局 npm docx 包 —— 桌面端两者都不随包分发，于是「主 SVG 出来了、溯源索引
没写成」。替身是 scripts/trace_index.py（纯标准库 zipfile + 手拼 OOXML）。

守卫内容（全部合成文本，不碰真实材料）：
- 在清空 PATH、拿不到任何 node/npm 的环境里，用绝对路径 Python 生成 DOCX；
- 解开 ZIP 验 XML 良构 + 全部行文本/中文/特殊字符（&<>）/引号转换原样保留；
- 验格式属性：宋体 + Times New Roman 字体标签、autoSpaceDE/DN 关、表头跨页重复、
  单元格纵向居中、三线/细线、列宽、页边距、页脚居中页码；
- 走一遍 pipeline._trace 端到端（合成 items/S/state），确认不依赖 node；
- 生成失败时原子性：不留半个 docx。
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(HERE, "..", "skills", "mqc-timeline-master")
SCRIPTS = os.path.join(SKILL, "scripts")
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def no_node_env():
    env = {"PATH": "", "HOME": os.path.expanduser("~")}
    if sys.platform == "win32":
        env["SystemRoot"] = os.environ.get("SystemRoot", r"C:\Windows")
    return env


def q(tag):
    return f"{{{W_NS}}}{tag}"


class TraceIndexDocxTest(unittest.TestCase):
    maxDiff = None

    PAYLOAD = {
        "title": "合成案例・溯源索引",
        "rows": [
            {"no": "1", "head": "双方签订《合作协议》",
             "file": "材料A", "locator": "句1、句2",
             "quote": "「2022年11月8日」双方签订编号 XM-2022-086 的协议。"},
            {"no": "2", "head": "甲方向乙方交付设备 & 验收单（<原件>）",
             "file": "材料B", "locator": "句5",
             "quote": "『验收合格』，货款 1,864,000 元 & 利息（合计）。"},
            {"no": "3", "head": "乙方未按期支付货款",
             "file": "材料A", "locator": "句9",
             "quote": "经多次催告，乙方仍未支付上述款项。"},
        ],
    }

    def generate(self, payload):
        tmp = tempfile.mkdtemp()
        src = os.path.join(tmp, "trace.json")
        dst = os.path.join(tmp, "溯源索引.docx")
        with open(src, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        r = subprocess.run([sys.executable,
                            os.path.join(SCRIPTS, "trace_index.py"), src, dst],
                           capture_output=True, text=True, timeout=60,
                           env=no_node_env())
        self.assertEqual(r.returncode, 0, f"生成失败：{r.stderr}")
        self.assertTrue(os.path.exists(dst))
        return dst, tmp

    def read_generated_parts(self):
        dst, tmp = self.generate(self.PAYLOAD)
        self.addCleanup(_rmtree, tmp)
        with zipfile.ZipFile(dst) as z:
            names = set(z.namelist())
            for part in ("[Content_Types].xml", "_rels/.rels",
                         "word/document.xml", "word/_rels/document.xml.rels",
                         "word/styles.xml", "word/footer1.xml"):
                self.assertIn(part, names)
            doc = z.read("word/document.xml").decode("utf-8")
            ftr = z.read("word/footer1.xml").decode("utf-8")
            ctx = z.read("[Content_Types].xml").decode("utf-8")
        # XML 良构
        root = ET.fromstring(doc)
        self.assertEqual(root.tag, q("document"))
        ET.fromstring(ftr)
        ET.fromstring(ctx)
        return doc, ftr

    def test_generates_docx_without_node_on_path(self):
        self.read_generated_parts()

    def test_all_row_text_chinese_and_specials_preserved(self):
        doc, _ = self.read_generated_parts()
        texts = "".join(t.text or "" for t in ET.fromstring(doc).iter(q("t")))
        for frag in ("合成案例・溯源索引", "双方签订《合作协议》", "材料A", "材料B",
                     "句1、句2", "句5", "句9", " XM-2022-086 ", "1,864,000",
                     "甲方向乙方交付设备 & 验收单（<原件>）",
                     "货款 1,864,000 元 & 利息（合计）。",
                     "经多次催告，乙方仍未支付上述款项。"):
            self.assertIn(frag, texts, f"缺片段：{frag!r}")
        # 默认说明与尾注也在（未提供 note/foot 时）
        self.assertIn("仅列对应关系，不含任何评价", texts)
        self.assertIn("可据此回到原文逐字核对", texts)

    def test_quote_normalisation_curly_quotes(self):
        doc, _ = self.read_generated_parts()
        self.assertNotIn("「", doc)
        self.assertNotIn("」", doc)
        self.assertNotIn("『", doc)
        self.assertNotIn("』", doc)
        self.assertIn("\u201c2022年11月8日\u201d", doc)
        self.assertIn("\u201c验收合格\u201d", doc)

    def test_formatting_properties(self):
        doc, ftr = self.read_generated_parts()
        # 字体：中文宋体 / 西文 Times New Roman（正文表格段落）
        self.assertIn('w:ascii="Times New Roman"', doc)
        self.assertIn('w:eastAsia="宋体"', doc)
        # autoSpaceDE / autoSpaceDN 全篇关闭
        paras = ET.fromstring(doc).iter(q("p"))
        n = 0
        for p in paras:
            pPr = p.find(q("pPr"))
            self.assertIsNotNone(pPr, "每个段落都要有 pPr（autoSpace 写在这里）")
            de = pPr.find(q("autoSpaceDE"))
            dn = pPr.find(q("autoSpaceDN"))
            self.assertIsNotNone(de, "缺 autoSpaceDE")
            self.assertIsNotNone(dn, "缺 autoSpaceDN")
            self.assertEqual(de.get(q("val")), "0")
            self.assertEqual(dn.get(q("val")), "0")
            n += 1
        # 3 行数据 + 表头 = 4 行 × 5 列 + 标题 + 说明 + 尾注 = 23 个段落
        self.assertEqual(n, 23)
        # 表头跨页重复 + 单元格纵向居中
        self.assertIn("<w:tblHeader/>", doc)
        self.assertEqual(doc.count('<w:vAlign w:val="center"/>'), 20)
        # 列宽（合计 = 表宽 9000）
        for w in ("1150", "2400", "1500", "1200", "2750"):
            self.assertIn(f'<w:gridCol w:w="{w}"/>', doc)
        self.assertIn('<w:tblW w:w="9000" w:type="dxa"/>', doc)
        # 三线（sz=6 黑）与细线（sz=2 灰 808080）
        self.assertGreaterEqual(doc.count('w:sz="6" w:space="0" w:color="000000"'), 6)
        self.assertIn('w:sz="2" w:space="0" w:color="808080"', doc)
        # 表头行加粗、居中；第 1/4 列数据行居中，其余两端对齐
        self.assertIn('<w:jc w:val="both"/>', doc)
        self.assertIn('<w:jc w:val="center"/>', doc)
        self.assertIn("<w:b/>", doc)
        # 标题 32 半磅（16pt）、正文 21、页脚 18
        self.assertIn('<w:sz w:val="32"/>', doc)
        self.assertIn('<w:sz w:val="21"/>', doc)
        self.assertIn('<w:sz w:val="18"/>', ftr)
        # 页边距四周 1440 缇，A4
        self.assertIn('<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" '
                      'w:left="1440"', doc)
        self.assertIn('<w:pgSz w:w="11906" w:h="16838"/>', doc)
        # 页脚：居中 + PAGE 域，全 Times New Roman
        self.assertIn('<w:jc w:val="center"/>', ftr)
        self.assertIn('w:instr=" PAGE "', ftr)
        self.assertIn('w:eastAsia="Times New Roman"', ftr)

    def test_ooxml_parent_and_child_order_contract(self):
        doc, footer = self.read_generated_parts()
        root = ET.fromstring(doc)
        table = root.find(".//" + q("tbl"))
        self.assertEqual([node.tag for node in table][:2], [q("tblPr"), q("tblGrid")])
        self.assertEqual([node.get(q("w")) for node in table.find(q("tblGrid"))],
                         ["1150", "2400", "1500", "1200", "2750"])
        for properties in root.iter(q("tcPr")):
            tags = [node.tag for node in properties]
            self.assertLess(tags.index(q("tcMar")), tags.index(q("vAlign")))
        footer_root = ET.fromstring(footer)
        field = footer_root.find(q("p") + "/" + q("fldSimple"))
        self.assertIsNotNone(field, "PAGE field must be a direct paragraph child, not nested in a run")
        self.assertEqual(field.get(q("instr")).strip(), "PAGE")
        self.assertIsNotNone(field.find(q("r") + "/" + q("t")))
        self.assertIsNone(footer_root.find(".//" + q("r") + "/" + q("fldSimple")))

    def test_newlines_and_tabs_are_word_controls(self):
        dst, tmp = self.generate({"rows": [{"quote": "甲\r\n乙\n丙\r丁\t尾"}]})
        self.addCleanup(_rmtree, tmp)
        with zipfile.ZipFile(dst) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
        run = next(run for run in root.iter(q("r")) if any(t.text == "甲" for t in run.findall(q("t"))))
        self.assertEqual(len(run.findall(q("br"))), 3)
        self.assertEqual(len(run.findall(q("tab"))), 1)
        self.assertEqual("".join(t.text or "" for t in run.findall(q("t"))), "甲乙丙丁尾")

    def test_invalid_xml_characters_rejected_before_replacing_output(self):
        sys.path.insert(0, SCRIPTS)
        self.addCleanup(sys.path.remove, SCRIPTS)
        import trace_index
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "existing.docx")
            with open(target, "wb") as handle:
                handle.write(b"previous valid output")
            for character in ("\x00", "\x0b", "\ud800", "\ufffe"):
                with self.subTest(character=repr(character)):
                    with self.assertRaisesRegex(ValueError, "XML"):
                        trace_index.write_docx({"title": "原文" + character}, target)
                    with open(target, "rb") as handle:
                        self.assertEqual(handle.read(), b"previous valid output")
            self.assertEqual(os.listdir(tmp), ["existing.docx"])

    def test_failed_replace_preserves_target_and_unrelated_part(self):
        from unittest.mock import patch
        sys.path.insert(0, SCRIPTS)
        self.addCleanup(sys.path.remove, SCRIPTS)
        import trace_index
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "index.docx")
            for name, content in ((target, b"old output"), (target + ".part", b"another writer")):
                with open(name, "wb") as handle:
                    handle.write(content)
            with patch.object(trace_index.os, "replace", side_effect=OSError("simulated disk error")):
                with self.assertRaises(OSError):
                    trace_index.write_docx({"rows": []}, target)
            with open(target, "rb") as handle:
                self.assertEqual(handle.read(), b"old output")
            with open(target + ".part", "rb") as handle:
                self.assertEqual(handle.read(), b"another writer")
            self.assertEqual(sorted(os.listdir(tmp)), ["index.docx", "index.docx.part"])

    def test_real_libreoffice_multipage_table_headers_and_page_fields(self):
        import shutil
        installed_mac = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
        soffice = (os.environ.get("AWD_TEST_LIBREOFFICE")
                   or (installed_mac if os.path.isfile(installed_mac) else shutil.which("soffice")))
        pdftotext = shutil.which("pdftotext")
        if not soffice or not os.path.isfile(soffice) or not pdftotext:
            self.skipTest("Real rendering requires installed LibreOffice and pdftotext (test-only)")
        payload = {"title": "合成多页溯源索引", "rows": [
            {"no": str(i), "head": f"ITEM{i:03d} 合成合同签订",
             "file": "合成材料", "locator": f"句{i}",
             "quote": f"QUOTE{i:03d} 这是用于渲染测试的合成证据摘录，保留中文与金额 100 元。"}
            for i in range(1, 101)]}
        docx, tmp = self.generate(payload)
        self.addCleanup(_rmtree, tmp)
        from pathlib import Path
        result = subprocess.run([soffice, "--headless", "--nologo", "--nofirststartwizard",
                                 "-env:UserInstallation=" + Path(tmp, "profile").as_uri(),
                                 "--convert-to", "pdf", "--outdir", tmp, docx],
                                capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        pdf = os.path.splitext(docx)[0] + ".pdf"
        self.assertTrue(os.path.isfile(pdf), result.stdout + result.stderr)
        result = subprocess.run([pdftotext, "-layout", pdf, "-"], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        pages = [p for p in result.stdout.split("\f") if p.strip()]
        self.assertGreaterEqual(len(pages), 3)
        for number, page in enumerate(pages, 1):
            compact = "".join(page.split())
            for header in ("图上编号", "卡片上的文字", "出自材料", "定位", "原文摘录"):
                self.assertIn(header, compact, f"page {number} missing repeating header")
            self.assertEqual([line.strip() for line in page.splitlines() if line.strip()][-1], str(number),
                             f"page {number} missing/updating PAGE field")
        for i in range(1, 101):
            self.assertEqual(result.stdout.count(f"ITEM{i:03d}"), 1)
            self.assertEqual(result.stdout.count(f"QUOTE{i:03d}"), 1)
        self.assertIn("合成合同签订", "".join(result.stdout.split()))
        self.assertIn("保留中文与金额100元", "".join(result.stdout.split()))
        artifacts = os.environ.get("AWD_TRACE_TEST_ARTIFACTS")
        if artifacts:
            os.makedirs(artifacts, exist_ok=True)
            shutil.copy2(docx, os.path.join(artifacts, "synthetic-trace.docx"))
            shutil.copy2(pdf, os.path.join(artifacts, "synthetic-trace.pdf"))
            with open(os.path.join(artifacts, "rendered.txt"), "w", encoding="utf-8") as handle:
                handle.write(result.stdout)
            with open(os.path.join(artifacts, "result.json"), "w") as handle:
                json.dump({"executable": soffice, "rows": 100, "pages": len(pages), "repeatedHeaders": True, "pageNumbers": True}, handle)

    def test_pipeline_trace_end_to_end_no_node(self):
        sys.path.insert(0, SCRIPTS)
        self.addCleanup(sys.path.remove, SCRIPTS)
        import pipeline
        tmp = tempfile.mkdtemp()
        self.addCleanup(_rmtree, tmp)
        out = os.path.join(tmp, "图.svg")
        items = [
            {"id": "E-01", "head": "签约", "src_sids": [0, 1], "src_file": "材料A"},
            {"id": "E-02", "head": "付款", "src_sid": 2, "src_file": "材料B"},
        ]
        S = ["「2023年1月12日」双方签订合同。", "约定货款 100 万元。",
             "乙方未付款。"]
        st = {"title": "合成时间轴", "files": ["材料A", "材料B"]}
        old_path = os.environ.get("PATH")
        os.environ["PATH"] = ""   # 拿不到 node 也必须出索引
        try:
            pipeline._trace(items, S, st, out)
        finally:
            if old_path is not None:
                os.environ["PATH"] = old_path
            else:
                del os.environ["PATH"]
        docx = os.path.splitext(out)[0] + "-溯源索引.docx"
        trace = os.path.splitext(out)[0] + "-trace.json"
        self.assertTrue(os.path.exists(docx), "pipeline 没有写出溯源索引 docx")
        self.assertTrue(os.path.exists(trace), "-trace.json 也该照旧落盘（后端 POI 路线）")
        with zipfile.ZipFile(docx) as z:
            doc = z.read("word/document.xml").decode("utf-8")
        self.assertIn("合成时间轴・溯源索引", doc)
        self.assertIn("句0、1", doc)
        self.assertIn("\u201c2023年1月12日\u201d双方签订合同。", doc)

    def test_atomic_no_partial_docx_on_failure(self):
        sys.path.insert(0, SCRIPTS)
        self.addCleanup(sys.path.remove, SCRIPTS)
        import trace_index
        tmp = tempfile.mkdtemp()
        self.addCleanup(_rmtree, tmp)
        bad = os.path.join(tmp, "no-such-dir", "out.docx")
        with self.assertRaises(Exception):
            trace_index.write_docx({"rows": []}, bad)
        self.assertFalse(os.path.exists(bad))
        self.assertEqual([f for f in os.listdir(tmp) if f.endswith(".part")], [])


def _rmtree(path):
    import shutil
    shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
