#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SVG → PNG 的最后两道兜底：resvg-js（Node）与 Playwright（Chromium）。

**为什么要有它（真实运行记录，2026-09-20 五个 skill 全跑）。** 典型的 Windows 机器上
没有 rsvg-convert、resvg、Inkscape、LibreOffice；pip 装的 cairosvg 又缺 cairo 本体，
要么抛 OSError，要么找到了却把中文画成方框。五个 skill 无一幸免，每一轮模型都在现场
自己想办法：有的 `npm install @resvg/resvg-js` 写一段 rasterize.js，有的用 Playwright 截图，
有的从 graphviz 目录里借 cairo-2.dll。这两条路那台机器上其实都走得通，只是技能不认识。

**这里只做「认得」，不做「安装」。** 查得到就用，查不到就说清楚缺什么、怎么补，
不替使用者装东西。两条路都走系统字体，中文正常。

查找 resvg-js 的位置：当前目录与上几级的 node_modules、NODE_PATH、npm 全局目录，
以及 WorkBuddy 的托管工作区（~/.workbuddy/binaries/node/workspace）——那几轮就是装在那里。
"""
import os
import shutil
import subprocess
import tempfile

_JS = r"""
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');
const [,, inp, out, zoom] = process.argv;
const r = new Resvg(fs.readFileSync(inp), {
  fitTo: { mode: 'zoom', value: parseFloat(zoom || '2') },
  font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' },
  background: 'white',
});
fs.writeFileSync(out, r.render().asPng());
"""


def _node():
    got = shutil.which("node")
    if got:
        return got
    if os.name == "nt":
        for root in (os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
            if root:
                cand = os.path.join(root, "nodejs", "node.exe")
                if os.path.exists(cand):
                    return cand
    return None


def _module_dirs():
    """可能装着 @resvg/resvg-js 的 node_modules 目录，按就近优先。"""
    dirs, here = [], os.getcwd()
    for _ in range(4):
        dirs.append(os.path.join(here, "node_modules"))
        here = os.path.dirname(here)
    dirs += [p for p in os.environ.get("NODE_PATH", "").split(os.pathsep) if p]
    home = os.path.expanduser("~")
    dirs += [os.path.join(home, ".workbuddy", "binaries", "node", "workspace", "node_modules"),
             os.path.join(os.environ.get("APPDATA", ""), "npm", "node_modules"),
             "/usr/lib/node_modules", "/usr/local/lib/node_modules"]
    return [d for d in dirs if d and os.path.isdir(os.path.join(d, "@resvg", "resvg-js"))]


def resvg_js(svg_path, png_path, zoom=2.0):
    node = _node()
    mods = _module_dirs()
    if not (node and mods):
        raise RuntimeError("resvg-js 不可用（没有 node，或没装 @resvg/resvg-js）")
    js = os.path.join(tempfile.mkdtemp(), "svg2png.js")
    open(js, "w", encoding="utf-8").write(_JS)
    env = dict(os.environ, NODE_PATH=os.pathsep.join(mods))
    subprocess.run([node, js, svg_path, png_path, str(zoom)], check=True,
                   capture_output=True, env=env, timeout=120)
    return "resvg-js"


def playwright(svg_path, png_path, zoom=2.0):
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        raise RuntimeError("Playwright 不可用（pip 包或 Chromium 未装）")
    import re
    s = open(svg_path, encoding="utf-8-sig").read()
    m = re.search(r'<svg[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"', s)
    w, h = (float(m.group(1)), float(m.group(2))) if m else (1600.0, 1200.0)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": int(w), "height": int(h)}, device_scale_factor=zoom)
        pg.goto("file:///" + os.path.abspath(svg_path).replace("\\", "/"))
        pg.screenshot(path=png_path, full_page=True)
        b.close()
    return "playwright"


def try_all(svg_path, png_path, zoom=2.0):
    """依次试 resvg-js、Playwright；都不行就抛出一句能照做的话。"""
    errs = []
    for fn in (resvg_js, playwright):
        try:
            return fn(svg_path, png_path, zoom)
        except Exception as e:
            errs.append(str(e).splitlines()[0])
    raise RuntimeError("本机没有能出 PNG 的工具。最省事的补法（任选其一）："
                       "① 装 Inkscape；② 在任一目录 npm install @resvg/resvg-js；"
                       "③ pip install playwright 后 playwright install chromium。"
                       "SVG 与 PPTX 不受影响。（" + "；".join(errs) + "）")
