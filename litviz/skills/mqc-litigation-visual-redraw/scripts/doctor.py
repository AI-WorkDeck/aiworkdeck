#!/usr/bin/env python3
"""doctor.py — environment self-check for a fresh clone.

A bare `git clone` gives you the code but not the system tools it shells out to,
and the failures that follow ("dot: not found", a PNG that never appears, a title
in the wrong typeface) are hard to read. Run this first:

    python3 scripts/doctor.py

It reports what is present, what is missing, and exactly what to install — and
tells you which features degrade if you skip an optional item. Exit code is 0 when
everything REQUIRED is present, 1 otherwise, so CI can gate on it.
"""
import os
import shutil
import subprocess
import sys

def _tests_cmd():
    """本模块的回归命令（时间轴模式下是时间轴大师的），同样写成真实路径。"""
    here = os.path.dirname(os.path.abspath(__file__))
    tl = os.path.normpath(os.path.join(here, "..", "..", "mqc-timeline-master", "tests", "run_checks.py"))
    own = os.path.normpath(os.path.join(here, "..", "tests", "run_checks.py"))
    p = tl if (("--for" in sys.argv and "timeline" in sys.argv) and os.path.exists(tl)) else own
    return f'python3 "{p}"' if " " in p else f"python3 {p}"


def _py(script):
    """给用户看的下一步命令：用脚本的真实路径，在哪个目录里照抄都能跑（0.9.8：SKILL.md 要求在用户的工作目录里运行）。"""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), script)
    return f'python3 "{p}"' if " " in p else f"python3 {p}"


OK, WARN, BAD = "  ok  ", " warn ", " MISS "


def _find(cmd):
    """与 render.py 用同一套查找：PATH 之外还查 Windows 的常见安装位置。

    真实运行记录里撞到的：用户机器上装了 Inkscape（C:\\Program Files\\Inkscape\\bin），
    出图那边已经能自动找到，自检这边还只看 PATH，于是报「none found / PNG preview will not」，
    使用者以为环境不全，又去手工加 PATH。两处必须用同一套判据。"""
    try:
        from render import _find_tool          # 同目录，出图用的就是它
        got = _find_tool(cmd)
        return got if got and os.path.exists(got) or got != cmd else None
    except Exception:
        return shutil.which(cmd)


def _has(cmd):
    return _find(cmd) is not None


def _fonts():
    """Installed font families, as one newline-separated blob (None if unknown).

    `fc-list` is a fontconfig tool — it exists on Linux and macOS and NEVER on
    Windows, where most of this skill's users are. Reporting "cannot verify
    typefaces" to all of them is not a check, it is a shrug: it leaves the one
    platform whose font situation is least predictable with the least
    information. So Windows is read directly from its font directories and the
    registry, which is where the answer actually lives."""
    if _has("fc-list"):
        try:
            out = subprocess.run(["fc-list", "--format", "%{family}\n"],
                                 capture_output=True, text=True, timeout=20,
                                 encoding="utf-8", errors="replace")   # fc-list 输出 UTF-8
            if out.stdout.strip():
                return out.stdout
        except Exception:
            pass

    if sys.platform.startswith("win"):
        names = []
        try:                                    # registered names, incl. CJK aliases
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
            for i in range(winreg.QueryInfoKey(key)[1]):
                try:
                    names.append(winreg.EnumValue(key, i)[0])
                except OSError:
                    break
        except Exception:
            pass
        for d in (os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"),
                  os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Windows\Fonts")):
            try:
                names += [os.path.splitext(f)[0] for f in os.listdir(d)]
            except OSError:
                pass
        # A Windows box always has these; naming them lets the checks below
        # recognise the CJK faces the system ships rather than reporting them missing.
        alias = {"simsun": "SimSun 宋体", "msyh": "Microsoft YaHei 微软雅黑",
                 "simhei": "SimHei 黑体", "msjh": "Microsoft JhengHei",
                 "simkai": "KaiTi 楷体", "simfang": "FangSong 仿宋"}
        names += [v for k, v in alias.items()
                  if any(k in n.lower() for n in names)]
        if names:
            return "\n".join(names)
    return None


def install_plex_mono():
    """Fetch IBM Plex Mono and register it for this machine.

    The 歸藏风 numerals are set in IBM Plex Mono, which ships with no OS. It has
    been reinstalled by hand on every fresh clone so far, and forgetting leaves
    the numbers in whatever generic monospace the renderer falls back to — a
    silent, easily-missed degradation of the one mode that depends on them.

    Two things worth knowing, both learned the hard way:
      * @fontsource ships .woff2, and decoding that needs the Brotli extension,
        which is not present in a bare container. The .woff in the same package
        is zlib and fontTools reads it with no extra dependency — so this uses
        the .woff.
      * this is a TOOLING dependency, not a rendering one. Nothing in the render
        path imports fontTools; it is only needed to perform this install.
    """
    import glob
    import subprocess
    import tempfile
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("need fontTools to convert the webfont: pip install fonttools")
        return 1
    dest = os.path.expanduser("~/.fonts")
    os.makedirs(dest, exist_ok=True)
    work = tempfile.mkdtemp(prefix="plex-")
    r = subprocess.run(["npm", "pack", "@fontsource/ibm-plex-mono"],
                       cwd=work, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("could not fetch the font package (network?):", r.stderr.strip()[:200])
        return 1
    tgz = glob.glob(os.path.join(work, "*.tgz"))
    if not tgz:
        print("no package downloaded")
        return 1
    subprocess.run(["tar", "xzf", os.path.basename(tgz[0])], cwd=work, check=True)
    n = 0
    for weight in ("400", "500", "600", "700"):
        src = os.path.join(work, "package", "files",
                           f"ibm-plex-mono-latin-{weight}-normal.woff")
        if not os.path.exists(src):
            continue
        try:
            f = TTFont(src)
            f.flavor = None
            f.save(os.path.join(dest, f"IBMPlexMono-{weight}.ttf"))
            n += 1
        except Exception as e:
            print(f"  weight {weight} skipped: {e}")
    subprocess.run(["fc-cache", "-f"], capture_output=True)
    print(f"installed {n} weight(s) of IBM Plex Mono into {dest}"
          if n else "nothing installed")
    return 0 if n else 1


def _importable(name):
    import importlib.util
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def main():
    if "--fix-fonts" in sys.argv[1:]:
        return install_plex_mono()
    rows, fatal = [], False

    # --- required ---------------------------------------------------------
    py_ok = sys.version_info >= (3, 9)
    rows.append((OK if py_ok else BAD, "Python ≥ 3.9",
                 f"found {sys.version.split()[0]}" if py_ok else "upgrade Python"))
    fatal |= not py_ok

    # 时间轴大师也用这份自检（单目录分发包里它就在 pipeline.py 旁边）。graphviz 只有
    # 诉讼可视化重画画流程图才要；对时间轴用户报「MISS / REQUIRED」是误导 —— 真实运行
    # 里模型据此以为环境不全。用 --for timeline，或与 pipeline.py 同目录时自动认出。
    _timeline = ("--for" in sys.argv and "timeline" in sys.argv) or \
        os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pipeline.py"))
    dot = _has("dot")
    if _timeline:
        rows.append((OK if dot else WARN, "graphviz (dot)",
                     "found" if dot else "not needed by the timeline skill (flowcharts only)"))
        _pdf = [m for m in ("pymupdf", "fitz", "pypdf") if _importable(m)]
        rows.append((OK if _pdf else WARN, "PDF text layer (PyMuPDF / pypdf)",
                     f"using {_pdf[0]}" if _pdf else
                     "missing — PDF materials cannot be read directly: pip install pymupdf"))
    else:
        # graphviz 不再是必需项：没装时由内置排布算坐标（layout_fallback.py），
        # 流程图与关系图照样出得来，实测画布与 graphviz 版只差两三个像素。
        # 装它仍有好处（分层更紧凑），所以留作建议，不再拦人。
        rows.append((OK if dot else WARN, "graphviz (dot)",
                     "flowchart node positioning" if dot else
                     "not installed — 内置排布会顶上（装上可得到更紧凑的分层）"))

    # --- png rasteriser (any one) -----------------------------------------
    raster = [c for c in ("rsvg-convert", "inkscape", "soffice") if _has(c)]
    # 找到了就把路径也报出来，免得使用者以为技能没用上它
    _paths = {c: _find(c) for c in raster}
    if raster:
        rows.append((OK, "PNG rasteriser",
                     f"using {raster[0]}（{_paths.get(raster[0]) or 'PATH'}）"))
    else:
        rows.append((WARN, "PNG rasteriser",
                     "none found (PATH 与常见安装位置都没有) — SVG still renders, PNG preview will not. "
                     "Install one: librsvg2-bin / inkscape / libreoffice"))

    # --- fonts (optional, affect looks only) ------------------------------
    # Defined BEFORE the branch: this was set only inside the else, so on any
    # machine without a font list — every Windows box — the later `if not
    # mono_ok` raised UnboundLocalError and doctor died instead of reporting.
    # A variable that only exists on the happy path is not a variable.
    mono_ok = True                    # nothing to offer if we cannot look
    fl = _fonts()
    if fl is None:
        rows.append((WARN, "fonts",
                     "cannot list installed fonts on this system — the figure still "
                     "renders; only the typeface may differ"))
    else:
        song = any(k in fl for k in ("Song", "宋", "SimSun", "Source Han Serif", "Noto Serif CJK"))
        rows.append((OK if song else WARN, "serif CJK (奇川风 titles)",
                     "found" if song else
                     "missing — titles fall back to a default serif; "
                     "install fonts-noto-cjk (or Source Han Serif)"))
        sans = any(k in fl for k in ("Noto Sans CJK", "Noto Sans SC", "Inter",
                                     "PingFang", "Helvetica", "Arial", "DejaVu Sans"))
        rows.append((OK if sans else WARN, "sans CJK (歸藏风 body)",
                     "found" if sans else "missing — install fonts-noto-cjk"))
        mono = "IBM Plex Mono" in fl
        mono_ok = mono
        rows.append((OK if mono else WARN, "IBM Plex Mono (歸藏风 numerals)",
                     "found" if mono else
                     "missing — numbers fall back to a generic monospace; "
                     "install IBM Plex Mono for the intended Swiss texture"))

    # Display faces used by the long-form README graphics. These are NOT needed to
    # render a figure — only to rasterise the repo's own illustrations. They earn a
    # line here because rasterising without them fails SILENTLY: the text is still
    # there, in the wrong typeface, and the giant condensed display word comes out
    # as ordinary sans. Nothing else notices.
    for face, what in (("Anton", "long-form display headings"),
                       ("Inter", "歸藏风 long-form body")):
        have = face.lower() in fl.lower() if fl else False
        rows.append((OK if have else WARN, f"{face} (README long-form art)",
                     "found" if have else
                     f"missing — {what} will silently fall back to a generic sans; "
                     f"`npm pack @fontsource/{face.lower()}` and convert the .woff"))

    # Pillow: TEST-ONLY. Nothing in the render path imports it, so the
    # zero-dependency rule still holds for producing a figure. Without it the
    # handful of guards that MEASURE a rendered image skip themselves — the run
    # stays green, it is simply less thorough, and that is worth saying out loud.
    try:
        import PIL  # noqa: F401
        _pil = True
    except ImportError:
        _pil = False
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import make_gallery as _mg
        _cjk = _mg.has_cjk_font()
    except Exception:
        _cjk = False
    rows.append((OK if _cjk else WARN, "CJK font file (gallery labels)",
                 "found" if _cjk else
                 "missing — the mode labels on comparison images cannot be drawn; "
                 "guards that measure them SKIP. `apt install fonts-noto-cjk`"))

    rows.append((OK if _pil else WARN, "Pillow (image-measuring guards)",
                 "found" if _pil else
                 "missing — guards that measure rendered pixels will SKIP; "
                 "`pip install pillow` to run them"))

    # optional QA tooling: renders a generated .pptx and measures where the text
    # actually landed. Not needed to PRODUCE anything — only to self-check.
    pdftotext = _find("pdftotext")
    rows.append((OK if pdftotext else WARN, "pdftotext (pptx render self-check)",
                 "verify_pptx.py can measure a rendered deck" if pdftotext else
                 "missing — `python3 scripts/verify_pptx.py fig.svg fig.pptx` will skip; "
                 "install poppler-utils to self-check the PPT layout"))

    # --- offer to fix what can be fixed -----------------------------------
    if not mono_ok:
        rows.append((WARN, "  ↳ fixable", "run `python3 scripts/doctor.py --fix-fonts` "
                                          "to install IBM Plex Mono"))

    # --- report -----------------------------------------------------------
    print("\nmqc-timeline-master · 环境自检（共享内核）\n" if _timeline
          else "\nmqc-litigation-visual-redraw · environment check\n")
    for state, name, note in rows:
        print(f"[{state}] {name:<34} {note}")
    print()
    if fatal:
        print("Result: MISSING REQUIRED TOOLING — install the items marked MISS above.\n")
        return 1
    warns = sum(1 for s, _, _ in rows if s == WARN)
    print(f"Result: ready to render{f' ({warns} optional item(s) degraded)' if warns else ''}.\n")
    if _timeline:                       # 下一步给时间轴大师自己的命令：在那个目录里，V1 的 render.py 不存在
        _pl = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "mqc-timeline-master",
                                            "scripts", "pipeline.py"))
        if not os.path.exists(_pl):                 # 单目录分发包：pipeline.py 与本文件同目录
            _pl = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pipeline.py")
        print(f'Next:  python3 "{_pl}" next' if " " in _pl else f"Next:  python3 {_pl} next")
        print(f"       {_tests_cmd()}\n")
        return 0
    _ex = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "examples", "flowchart.json"))
    print(f"Next:  {_py('render.py')} {_ex} out/flowchart")
    print(f"       {_tests_cmd()}\n")
    return 0



def _quiet_broken_pipe():
    """`… | head` closes the pipe early; without this the script ends on a
    traceback, which looks like a crash to anyone reading the terminal."""
    import signal
    try:
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    except (AttributeError, ValueError):
        pass

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
    _quiet_broken_pipe()
    raise SystemExit(main())
