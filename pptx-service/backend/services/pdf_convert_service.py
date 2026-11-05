# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""
[checkba] PDF 转换服务：

- to_docx: 文本型 PDF 的版式级转 Word（pdf2docx：段落/表格/图片/分栏尽量保留原排版）
- ocr_markdown: 扫描件经本地 mineru-service 解析出 markdown；失败不转云端，
  不生成云端图片描述。即使配置 MINERU_FORCE_CLOUD 或云端凭据，也保持本地处理。
  可选 layout=True 另回逐行 bbox（pages）与 markdown 引用的图片（images，有上限）。

供主仓 backend PdfTools.pdf_to_word 调用（本地同机部署，传本地文件路径）。
"""
import logging
import os
import re
from html.parser import HTMLParser

import fitz  # pymupdf（pdf2docx 依赖自带）
from pdf2docx import Converter

from services.file_parser_service import FileParserService

logger = logging.getLogger(__name__)


class PdfConvertError(Exception):
    """转换错误（带上下文信息，控制器直接回给调用方）"""


def _validate(pdf_path: str) -> str:
    if not pdf_path or not isinstance(pdf_path, str) or '\x00' in pdf_path:
        raise PdfConvertError(f"文件不存在: {pdf_path}")
    allowed_root = os.path.realpath(os.environ.get("PPTX_ALLOWED_ROOT") or os.path.abspath(os.sep))
    resolved = os.path.realpath(os.path.abspath(pdf_path))
    if not resolved.startswith(allowed_root):
        raise PdfConvertError(f"文件路径不允许访问: {pdf_path}")
    if not resolved.lower().endswith('.pdf'):
        raise PdfConvertError(f"仅支持 .pdf 文件: {pdf_path}")
    if not os.path.exists(resolved) or not os.path.isfile(resolved):
        raise PdfConvertError(f"文件不存在: {pdf_path}")
    return resolved


def _validate_output_path(output_path: str) -> str:
    if not output_path or not isinstance(output_path, str) or '\x00' in output_path:
        raise PdfConvertError(f"output_path 必须是 .docx 路径: {output_path}")
    allowed_root = os.path.realpath(os.environ.get("PPTX_ALLOWED_ROOT") or os.path.abspath(os.sep))
    resolved = os.path.realpath(os.path.abspath(output_path))
    if not resolved.startswith(allowed_root):
        raise PdfConvertError(f"输出路径不允许访问: {output_path}")
    if not resolved.lower().endswith('.docx'):
        raise PdfConvertError(f"output_path 必须是 .docx 路径: {output_path}")
    return resolved


def to_docx(pdf_path: str, output_path: str) -> dict:
    """版式级 PDF→docx。仅适用于有文本层的未加密 PDF；扫描件请走 ocr_markdown。"""
    resolved_pdf = _validate(pdf_path)
    resolved_out = _validate_output_path(output_path)

    doc = fitz.open(resolved_pdf)
    try:
        if doc.needs_pass:
            raise PdfConvertError("PDF 已加密，无法转换")
        pages = doc.page_count
        text_chars = sum(len(page.get_text()) for page in doc)
    finally:
        doc.close()

    if text_chars < 20:
        raise PdfConvertError("该 PDF 没有文本层（扫描件），版式级转换不适用，请改用 /api/pdf/ocr-markdown")

    allowed_root = os.path.realpath(os.environ.get("PPTX_ALLOWED_ROOT") or os.path.abspath(os.sep))
    parent = os.path.realpath(os.path.dirname(resolved_out))
    if parent and parent.startswith(allowed_root):
        os.makedirs(parent, exist_ok=True)

    logger.info(f"pdf2docx converting: {resolved_pdf} -> {resolved_out} ({pages} pages)")
    cv = Converter(resolved_pdf)
    try:
        cv.convert(resolved_out)
    finally:
        cv.close()

    if not os.path.exists(resolved_out) or os.path.getsize(resolved_out) == 0:
        raise PdfConvertError("pdf2docx 转换未产出有效文件")
    return {'output_path': resolved_out, 'pages': pages}


def ocr_markdown(pdf_path: str, layout=False) -> dict:
    """扫描件 OCR：只使用本地 MinerU，不隐式上传或生成云端图片描述。

    layout=True 时另回 pages（逐页尺寸 + 逐行文字与 bbox，供可检索 PDF 的隐形文字层）
    与 images（markdown 引用的图片 base64，供保留印章/插图的 Word），以及 warnings。
    """
    if not isinstance(layout, bool):
        raise PdfConvertError("layout 必须是布尔值")
    resolved_pdf = _validate(pdf_path)

    parser = FileParserService(
        mineru_token="",
        local_only=True,
        return_layout=layout,
    )

    _batch_id, markdown, _extract_id, error, _failed = parser.parse_file(
        resolved_pdf, os.path.basename(resolved_pdf))

    if error or not markdown or not markdown.strip():
        raise PdfConvertError(
            error or "本地 OCR 未返回解析内容，请检查本机扫描件 OCR 组件与模型后重试；未转用云端 OCR。")
    if not layout:
        return {'markdown': markdown}

    raw = parser.last_local_layout or {}
    warnings = []
    middle_json = raw.get('middle_json')
    if not isinstance(middle_json, dict):
        warnings.append("本地 OCR 未返回版面数据（middle_json），pages 为空")
        middle_json = {}
    images = _collect_images(markdown, raw.get('images') or {}, warnings)
    return {'markdown': markdown, 'pages': _layout_pages(middle_json),
            'images': images, 'warnings': warnings}


# [checkba] layout=true 的图片回传上限：单张与合计，超限跳过并写 warnings
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 64 * 1024 * 1024

_MD_IMAGE_RE = re.compile(r'!\[[^\]]*\]\(([^)\s]+)')


class _HtmlText(HTMLParser):
    """收集 HTML 里的文字节点（表格 span 的文字只在 html 里）。"""

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data.strip():
            self.parts.append(data.strip())


def _html_text(html: str) -> str:
    p = _HtmlText()
    p.feed(html)
    p.close()
    return ' '.join(p.parts)


def _span_text(span: dict) -> str:
    content = span.get('content')
    if isinstance(content, str) and content:
        return content
    html = span.get('html')
    if isinstance(html, str) and html:
        return _html_text(html)
    return ''


def _block_lines(block: dict, out: list):
    for line in block.get('lines') or []:
        text = ''.join(_span_text(s) for s in line.get('spans') or [])
        if text.strip() and line.get('bbox'):
            out.append({'text': text, 'bbox': list(line['bbox'])})
    for child in block.get('blocks') or []:
        _block_lines(child, out)


def _layout_pages(middle_json: dict) -> list:
    """MinerU middle.json → [{width, height, lines:[{text, bbox}]}]，坐标为 PDF 点、左上原点。"""
    infos = sorted(middle_json.get('pdf_info') or [], key=lambda p: p.get('page_idx', 0))
    pages = []
    for info in infos:
        width, height = (info.get('page_size') or [0, 0])[:2]
        lines = []
        for block in info.get('para_blocks') or []:
            _block_lines(block, lines)
        pages.append({'width': width, 'height': height, 'lines': lines})
    return pages


def _collect_images(markdown: str, raw_images: dict, warnings: list) -> dict:
    """只回 markdown 引用到的图片（键 = markdown 里的相对路径，值 = 纯 base64），按上限跳过。"""
    images = {}
    total = 0
    for ref in dict.fromkeys(_MD_IMAGE_RE.findall(markdown)):
        name = os.path.basename(ref)
        uri = raw_images.get(name)
        if not isinstance(uri, str) or not uri:
            warnings.append(f"图片未随 OCR 结果返回，已跳过: {ref}")
            continue
        b64 = uri.split(',', 1)[1] if uri.startswith('data:') else uri
        size = len(b64) * 3 // 4 - b64[-2:].count('=')
        if size > MAX_IMAGE_BYTES:
            warnings.append(f"图片超过单张上限 {MAX_IMAGE_BYTES // (1024 * 1024)}MB，已跳过: {ref}")
            continue
        if total + size > MAX_TOTAL_IMAGE_BYTES:
            warnings.append(f"图片合计超过上限 {MAX_TOTAL_IMAGE_BYTES // (1024 * 1024)}MB，已跳过: {ref}")
            continue
        total += size
        images[ref] = b64
    return images
