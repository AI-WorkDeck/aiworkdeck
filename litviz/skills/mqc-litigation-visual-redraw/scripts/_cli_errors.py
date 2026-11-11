# -*- coding: utf-8 -*-
"""命令行的出错边界：常见的输入错误说人话，不甩 Python 堆栈。

只在脚本被直接运行时装上（各脚本的主入口里调用 install()），
被别的脚本 import 时不生效，也不改变任何正常流程——它只接管「本来就要崩」的那一刻：

  路径打错            → 找不到文件：…，请核对路径
  JSON 写坏           → 第几行第几列、什么错、常见原因
  文件不是 UTF-8      → 请用 UTF-8 保存（或者给错了文件）
  该是 xlsx/docx/pptx 的不是 → 打不开，核对是不是给错了文件
  给了文件夹 / 没有权限
  缺少可选的 Python 包（openpyxl、Pillow……）→ 说缺哪个、怎么装
  脚本自己抛出的 RuntimeError（这几个模块用它报写给人看的错）→ 原样说出那句话

其余异常照旧打印完整堆栈（那是程序的错，要看到）。设置环境变量 NLV_DEBUG=1 时一律打印完整堆栈。
退出码与原来一样（1）：只换说法，不换结果。"""
import os
import sys

_HINT = "（中文路径与空格都可以，记得加引号）"
# 各模块自己定义的「写给人看的错」：材料格式认不出、读不了 .doc、缺 python-docx、说明写错……
_OWN = {"UnknownFormat", "PdfTextUnavailable", "DocReadError", "DocxUnavailable", "FrameError", "FirmStyleError",
        "ExportError", "BrandError", "AdaptError", "DeckError", "AIError", "SpecError"}


def _say(msg, what="输入的问题"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:                                   # noqa: BLE001
        pass
    print(f"出错：{msg}", file=sys.stderr)
    print(f"（这是{what}，不是程序崩溃；需要看完整堆栈时设置环境变量 NLV_DEBUG=1）", file=sys.stderr)


def _hook(kind, err, tb, _orig=sys.excepthook):
    import json
    import zipfile
    if os.environ.get("NLV_DEBUG"):
        return _orig(kind, err, tb)
    if isinstance(err, ModuleNotFoundError) and err.name:
        pkg = {"PIL": "pillow", "docx": "python-docx", "fitz": "pymupdf"}.get(err.name.split(".")[0],
                                                                            err.name.split(".")[0])
        _say(f"缺少 Python 包 {err.name.split('.')[0]}：这一步要用它。安装：pip install {pkg}"
             f"（各模块的依赖与缺了会怎样，见 SKILL.md 的「依赖」一节）。", "本机少装了一个包")
    elif isinstance(err, IsADirectoryError):
        _say(f"{err.filename} 是一个文件夹，这里要的是文件。")
    elif isinstance(err, FileNotFoundError):
        _say(f"找不到文件 {err.filename}：请核对路径{_HINT}。")
    elif isinstance(err, PermissionError):
        _say(f"没有权限读写 {err.filename}：文件可能正被别的程序（Excel、Word、PowerPoint）打开，关掉再试。")
    elif isinstance(err, json.JSONDecodeError):
        _say(f"JSON 写坏了：第 {err.lineno} 行第 {err.colno} 列，{err.msg}。"
             f"常见原因：多了一个逗号、用了中文引号、少了括号。")
    elif isinstance(err, UnicodeDecodeError):
        _say("文件不是 UTF-8 文本：请用 UTF-8 保存；也可能是给错了文件（例如把 Word、Excel 当成了 JSON）。")
    elif type(err).__name__ in _OWN:
        _say(str(err))                     # 本项目自己的错误类型：消息本来就是写给人看的
    elif isinstance(err, RuntimeError) or (isinstance(err, ValueError) and "SVG" in str(err)):
        _say(str(err))                     # 这几个模块用 RuntimeError 报写给人看的错（说明已经写好了）
    elif isinstance(err, zipfile.BadZipFile):
        _say("这个文件打不开：.xlsx / .docx / .pptx 实际是压缩包，这一份不是。请核对是不是给错了文件，或文件已损坏。")
    else:
        return _orig(kind, err, tb)


def install():
    sys.excepthook = _hook
