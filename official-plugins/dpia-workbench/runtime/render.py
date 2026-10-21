# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Render with installed LibreOffice and PDFium, without a developer's private runtime."""
import argparse
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def office():
    configured = os.environ.get('AWD_DPIA_SOFFICE')
    if configured:
        return configured if Path(configured).is_file() else None
    if sys.platform == 'win32':
        # The Windows GUI launcher can hang without an interactive desktop;
        # LibreOffice provides .com specifically for command-line use.
        program = Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'LibreOffice/program'
        return shutil.which('soffice.com') or next((str(program / name)
            for name in ('soffice.com', 'soffice.exe') if (program / name).is_file()), None) or shutil.which('soffice')
    return shutil.which('soffice') or next((str(p) for p in [
        Path('/Applications/LibreOffice.app/Contents/MacOS/soffice'),
    ] if p.is_file()), None)


def dependencies():
    blockers = []
    for module in ('docx', 'pypdf', 'pypdfium2', 'reportlab'):
        try:
            imported = importlib.import_module(module)
            if module == 'docx' and not hasattr(imported.Document(), 'add_comment'):
                blockers.append('python-docx 需要支持原生批注（1.2.0 或更新版本）。')
        except ImportError:
            blockers.append('Python 缺少 ' + module + '，请安装插件 runtime/requirements.txt。')
    if not office():
        blockers.append('未找到 LibreOffice；请安装并在插件设置中指定 soffice 可执行文件。')
    return {'ready': not blockers, 'blockers': blockers}


def render_pages(document, prefix, dpi=120):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(document))
    try:
        for index in range(len(pdf)):
            page = pdf[index]
            bitmap = page.render(scale=dpi / 72)
            try:
                bitmap.to_pil().save(str(prefix) + '-' + str(index + 1) + '.png')
            finally:
                bitmap.close()
                page.close()
    finally:
        pdf.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('document', nargs='?')
    parser.add_argument('--output_dir')
    parser.add_argument('--emit_pdf', action='store_true')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    check = dependencies()
    if args.check:
        print(json.dumps(check, ensure_ascii=False))
        return 0 if check['ready'] else 1
    if not check['ready']:
        raise RuntimeError('; '.join(check['blockers']))
    source, target = Path(args.document).resolve(strict=True), Path(args.output_dir).resolve()
    target.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix='awd-dpia-office-') as profile:
        subprocess.run([office(), '-env:UserInstallation=' + Path(profile).as_uri(),
                        '--headless', '--convert-to', 'pdf', '--outdir', str(target), str(source)],
                       check=True, timeout=180, capture_output=True)
    pdf = target / (source.stem + '.pdf')
    if not pdf.is_file() or pdf.stat().st_size == 0:
        raise RuntimeError('LibreOffice did not produce a PDF')
    if pdf.name != 'report.pdf':
        pdf.rename(target / 'report.pdf')
    render_pages(target / 'report.pdf', target / 'page')
    print(json.dumps({'pdf': str(target / 'report.pdf')}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
