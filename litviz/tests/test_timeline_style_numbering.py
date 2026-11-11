#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""[AWD-PATCH 9] 管线给模型的风格提示必须与 pick.STYLES 的真实编号一致（dev-board#1713）。

上游 `next` 的提示写成「1 法官白描 / 2 当事人奇川风 / 3 同行歸藏风」，跳过时间段时又提示
`style 2`；而 stage_style 按 pick.STYLES 取号（1 奇川风 / 2 歸藏风 / 3 白描）。模型照提示转述，
用户选奇川风就出成了歸藏风。

    python3 -I litviz/tests/test_timeline_style_numbering.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SCRIPTS = os.path.join(os.path.dirname(_HERE), "skills", "mqc-timeline-master", "scripts")
_PIPELINE = os.path.join(_SCRIPTS, "pipeline.py")
sys.path.insert(0, _SCRIPTS)
import pick  # noqa: E402


class StyleNumberingTest(unittest.TestCase):
    def test_next_hint_matches_real_style_ids(self):
        with tempfile.TemporaryDirectory() as wd:
            with open(os.path.join(wd, "state.json"), "w", encoding="utf-8") as f:
                json.dump({"sentences": ["x"], "files": ["a.txt"],
                           "picked_files": ["a.txt"], "picked_spans": []}, f)
            out = subprocess.run([sys.executable, "-I", _PIPELINE, "next"], cwd=wd,
                                 capture_output=True, text=True, check=True).stdout
        # 上游 v3.1.0 的提示带括号说明（「1 奇川风（当事人与客户）/ 2 歸藏风…」），
        # 所以逐对核：提示里出现的每个「编号 风格名」都必须与 pick.STYLES 一致。
        real = {s["name"]: str(s["id"]) for s in pick.STYLES}
        pairs = re.findall(r"(\d) (%s)" % "|".join(real), out)
        self.assertEqual({n for _, n in pairs}, set(real), out)
        for num, name in pairs:
            self.assertEqual(num, real[name], f"提示把 {name} 编成了 {num}")
        self.assertNotIn("法官白描", out)

    def test_no_hint_defaults_to_a_non_default_style(self):
        src = open(_PIPELINE, encoding="utf-8").read()
        default = next(s["id"] for s in pick.STYLES if s["name"] == "奇川风")
        hinted = set(re.findall(r"pipeline\.py style (\d)", src))
        # 上游 v3.1.0 改由 _ask_style() 从 pick 取号，源码里可能已无手写提示；有就只许指向默认档。
        self.assertLessEqual(hinted, {str(default)}, f"style 的跑法提示只该指向默认档：{hinted}")


if __name__ == "__main__":
    unittest.main()
