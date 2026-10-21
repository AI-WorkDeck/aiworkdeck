# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read-only runtime checks; no project material, installation or network access."""
import importlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import sys


def check():
    checks = []
    def add(key, label, ready, message):
        checks.append(dict(id=key, label=label, status='ready' if ready else 'needs_attention', message=message))
    add('python', 'Python', sys.version_info >= (3, 9),
        'Python ' + sys.version.split()[0] + (' 可用' if sys.version_info >= (3, 9) else '；需要 Python 3.9 或更新版本'))
    modules = {'python-docx': 'docx', 'pypdf': 'pypdf', 'pypdfium2': 'pypdfium2', 'reportlab': 'reportlab'}
    for requirement in Path(__file__).with_name('requirements.txt').read_text().splitlines():
        if not requirement.strip() or requirement.startswith('#'):
            continue
        package, required = requirement.split('==')
        try:
            module = importlib.import_module(modules[package])
            actual = importlib.metadata.version(package)
            if actual != required:
                add(package, package, False, f'检测到 {actual}；本插件要求 {required}。请在独立环境安装 requirements.txt。')
            elif package == 'python-docx' and not callable(getattr(module.Document(), 'add_comment', None)):
                add(package, package, False, '缺少 Word 原生批注能力；请重新安装 requirements.txt 中的 python-docx。')
            else:
                add(package, package, True, actual + ' 可加载')
        except Exception:
            add(package, package, False, f'无法加载 {package}=={required}；请在所选 Python 独立环境安装 requirements.txt。')
    candidates = [os.environ.get('DSH_DPIA_PDF_FONT', ''),
                  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
                  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc']
    font_path = next((p for p in candidates if p and Path(p).is_file()), None)
    try:
        if not font_path:
            raise ValueError('missing')
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfgen.canvas import Canvas
        font = TTFont('DpiaEnvironmentProbe', font_path)
        sample = '中文数据保护评估'
        if any(not font.face.charToGlyph.get(ord(ch)) for ch in sample):
            raise ValueError('glyphs')
        pdfmetrics.registerFont(font)
        output = io.BytesIO()
        canvas = Canvas(output); canvas.setFont(font.fontName, 12)
        canvas.drawString(40, 700, sample); canvas.save()
        add('font', 'PDF 中文字体', True, '可嵌入且覆盖合成字“中文数据保护评估”；实际报告仍逐字校验。')
    except Exception:
        add('font', 'PDF 中文字体', False, '未找到可加载且覆盖合成中文的 TrueType 字体。请先准备 reportlab，并在插件设置填写可嵌入的 TTF/TTC 路径。')
    return {'checks': checks}


if __name__ == '__main__':
    print(json.dumps(check(), ensure_ascii=False))
