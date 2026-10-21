# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""
[checkba] PDF 转换服务：

- to_docx: 文本型 PDF 的版式级转 Word（pdf2docx：段落/表格/图片/分栏尽量保留原排版）
- ocr_markdown: 扫描件经本地 mineru-service 解析出 markdown；失败不转云端，
  不生成云端图片描述。即使配置 MINERU_FORCE_CLOUD 或云端凭据，也保持本地处理。

供主仓 backend PdfTools.pdf_to_word 调用（本地同机部署，传本地文件路径）。
"""
import logging
import os

import fitz  # pymupdf（pdf2docx 依赖自带）
from pdf2docx import Converter

from services.file_parser_service import FileParserService

logger = logging.getLogger(__name__)


class PdfConvertError(Exception):
    """转换错误（带上下文信息，控制器直接回给调用方）"""


def _validate(pdf_path: str):
    if not pdf_path or not os.path.exists(pdf_path):
        raise PdfConvertError(f"文件不存在: {pdf_path}")
    if not pdf_path.lower().endswith('.pdf'):
        raise PdfConvertError(f"仅支持 .pdf 文件: {pdf_path}")


def to_docx(pdf_path: str, output_path: str) -> dict:
    """版式级 PDF→docx。仅适用于有文本层的未加密 PDF；扫描件请走 ocr_markdown。"""
    _validate(pdf_path)
    if not output_path or not output_path.lower().endswith('.docx'):
        raise PdfConvertError(f"output_path 必须是 .docx 路径: {output_path}")

    doc = fitz.open(pdf_path)
    try:
        if doc.needs_pass:
            raise PdfConvertError("PDF 已加密，无法转换")
        pages = doc.page_count
        text_chars = sum(len(page.get_text()) for page in doc)
    finally:
        doc.close()

    if text_chars < 20:
        raise PdfConvertError("该 PDF 没有文本层（扫描件），版式级转换不适用，请改用 /api/pdf/ocr-markdown")

    parent = os.path.dirname(output_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    logger.info(f"pdf2docx converting: {pdf_path} -> {output_path} ({pages} pages)")
    cv = Converter(pdf_path)
    try:
        cv.convert(output_path)
    finally:
        cv.close()

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise PdfConvertError("pdf2docx 转换未产出有效文件")
    return {'output_path': output_path, 'pages': pages}


def ocr_markdown(pdf_path: str) -> dict:
    """扫描件 OCR：只使用本地 MinerU，不隐式上传或生成云端图片描述。"""
    _validate(pdf_path)

    parser = FileParserService(
        mineru_token="",
        local_only=True,
    )

    _batch_id, markdown, _extract_id, error, _failed = parser.parse_file(
        pdf_path, os.path.basename(pdf_path))

    if error or not markdown or not markdown.strip():
        raise PdfConvertError(
            error or "本地 OCR 未返回解析内容，请检查本机扫描件 OCR 组件与模型后重试；未转用云端 OCR。")
    return {'markdown': markdown}
