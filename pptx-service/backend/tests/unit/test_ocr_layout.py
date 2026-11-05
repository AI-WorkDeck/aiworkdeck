# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""
[checkba] /api/pdf/ocr-markdown-local 的 "layout": true 选项：

主后端拿 pages（每页尺寸 + 逐行文字与 bbox）做可检索 PDF 的隐形文字层，
拿 images（markdown 引用的图片 base64）做保留印章/插图的 Word。
MinerU 的 HTTP 调用全部 mock；fixture 是 MinerU 3.4.3 pipeline 对虚构扫描件的真实 middle.json 裁剪版。
"""
import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask
from services.file_parser_service import FileParserService
from services import pdf_convert_service
from controllers.pdf_convert_controller import pdf_convert_bp

FIXTURE = Path(__file__).parent / 'fixtures' / 'mineru_scan_middle.json'
SEAL = '59bd7a7db9090b1b5591e1037e897d65b057563944bc742f1a53dbf53957240b.jpg'
TABLE_IMG = '2c4c2e6a72d6a623bc8e04cb9d5c30db03d4720680f45de3774e50b513378c79.jpg'
MARKDOWN = f'# 股权转让协议\n\n<table><tr><td>期次</td></tr></table>\n\n![](images/{SEAL})\n\n## 第三条 陈述与保证\n'


def data_uri(raw: bytes) -> str:
    return 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()


class OcrLayoutTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pdf = Path(self.temp.name) / 'scan.pdf'
        self.pdf.write_bytes(b'%PDF synthetic fixture')
        self.app = Flask(__name__)
        self.app.register_blueprint(pdf_convert_bp)
        self.app.config.update(MINERU_FORCE_CLOUD='1', MINERU_LOCAL_URL='http://127.0.0.1:18787',
                               MINERU_TOKEN='synthetic-token', OPENAI_API_KEY='synthetic-key')
        ctx = self.app.app_context()
        ctx.push()
        self.addCleanup(ctx.pop)
        transport = patch('requests.sessions.Session.request', side_effect=AssertionError('Unexpected network'))
        transport.start()
        self.addCleanup(transport.stop)
        self.seal_bytes = b'\xff\xd8seal-jpeg-bytes'
        self.table_bytes = b'\xff\xd8table-jpeg-bytes'

    def mineru_response(self, images=None):
        """mineru-api 3.4.x /file_parse 的响应：middle_json 以字符串下发，images 以文件名为键的 data URI。"""
        result = {'md_content': MARKDOWN, 'content_list': '[]', 'middle_json': FIXTURE.read_text(encoding='utf-8')}
        if images is not None:
            result['images'] = images
        resp = MagicMock(status_code=200)
        resp.json.return_value = {'backend': 'pipeline', 'version': '3.4.3', 'results': {'scan': result}}
        return resp

    def post(self, body, images=None):
        if images is None:
            images = {SEAL: data_uri(self.seal_bytes), TABLE_IMG: data_uri(self.table_bytes)}
        with patch.object(FileParserService, '_check_local_service', return_value=True), \
                patch.object(FileParserService, '_save_local_mineru_result'), \
                patch.object(FileParserService, '_get_upload_url') as cloud, \
                patch.object(FileParserService, '_enhance_markdown_with_captions') as caption, \
                patch('requests.post', return_value=self.mineru_response(images)) as mineru:
            resp = self.app.test_client().post('/api/pdf/ocr-markdown-local', json=body)
        cloud.assert_not_called()
        caption.assert_not_called()
        return resp, mineru

    # ---- 不带 flag：老客户端响应不变 ----

    def test_flag_absent_response_unchanged(self):
        resp, mineru = self.post({'pdf_path': str(self.pdf)})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {'success': True, 'message': 'Success', 'data': {'markdown': MARKDOWN}})
        self.assertNotIn('return_images', mineru.call_args.kwargs['data'])

    def test_flag_false_response_unchanged(self):
        resp, mineru = self.post({'pdf_path': str(self.pdf), 'layout': False})
        self.assertEqual(resp.get_json()['data'], {'markdown': MARKDOWN})
        self.assertNotIn('return_images', mineru.call_args.kwargs['data'])

    # ---- 带 flag ----

    def test_layout_pages_and_lines(self):
        resp, mineru = self.post({'pdf_path': str(self.pdf), 'layout': True})
        self.assertEqual(resp.status_code, 200, resp.get_data(as_text=True))
        self.assertEqual(mineru.call_args.kwargs['data']['return_images'], 'true')
        data = resp.get_json()['data']
        self.assertEqual(data['markdown'], MARKDOWN)
        self.assertEqual(data['warnings'], [])
        pages = data['pages']
        self.assertEqual(len(pages), 2)
        self.assertEqual((pages[0]['width'], pages[0]['height']), (594, 841))
        self.assertEqual((pages[1]['width'], pages[1]['height']), (594, 841))

        p0 = pages[0]['lines']
        self.assertEqual(p0[0], {'text': '股权转让协议', 'bbox': [218, 71, 372, 95]})
        self.assertEqual(p0[1], {'text': '协议编号:XQ-2026-0815签署地:江州市临川区', 'bbox': [177, 113, 421, 127]})
        # 表格块：blocks[].lines[] 嵌套，文字只在 span.html 里 → 去标签后按单元格拼成一行
        table = p0[2]
        self.assertEqual(table['bbox'], [62, 351, 533, 478])
        for cell in ('期次', '付款条件', '1,260,000', '2026年12月31日', '合计', '4,200,000'):
            self.assertIn(cell, table['text'])
        self.assertNotIn('<', table['text'])
        # 印章图片块没有文字，不出行；页眉页脚（discarded_blocks）不在 para_blocks 里
        self.assertEqual(len(p0), 3)

        self.assertEqual([l['text'] for l in pages[1]['lines']], [
            '第三条 陈述与保证',
            '3.1甲方保证其合法持有标的股权，该股',
            '权之上不存在质押、查封、冻结或其他权利限',
            '制，亦不存在任何权属争议。',
        ])
        self.assertEqual(pages[1]['lines'][1]['bbox'], [84, 104, 289, 120])

    def test_layout_images_only_markdown_references(self):
        resp, _ = self.post({'pdf_path': str(self.pdf), 'layout': True})
        images = resp.get_json()['data']['images']
        self.assertEqual(list(images), [f'images/{SEAL}'])
        self.assertEqual(base64.b64decode(images[f'images/{SEAL}']), self.seal_bytes)

    def test_layout_missing_image_is_warned(self):
        resp, _ = self.post({'pdf_path': str(self.pdf), 'layout': True}, images={})
        data = resp.get_json()['data']
        self.assertEqual(data['images'], {})
        self.assertEqual(len(data['warnings']), 1)
        self.assertIn(SEAL, data['warnings'][0])

    def test_single_image_cap(self):
        with patch.object(pdf_convert_service, 'MAX_IMAGE_BYTES', len(self.seal_bytes) - 1):
            resp, _ = self.post({'pdf_path': str(self.pdf), 'layout': True})
        data = resp.get_json()['data']
        self.assertEqual(data['images'], {})
        self.assertEqual(len(data['warnings']), 1)
        self.assertIn(SEAL, data['warnings'][0])
        self.assertTrue(data['pages'], '图片超限不影响文字层')

    def test_total_images_cap(self):
        md = MARKDOWN + f'\n![](images/{TABLE_IMG})\n'
        a, b = b'a' * 100, b'b' * 100
        images = {SEAL: data_uri(a), TABLE_IMG: data_uri(b)}
        resp_mock = self.mineru_response(images)
        resp_mock.json.return_value['results']['scan']['md_content'] = md
        with patch.object(pdf_convert_service, 'MAX_TOTAL_IMAGE_BYTES', 150), \
                patch.object(FileParserService, '_check_local_service', return_value=True), \
                patch.object(FileParserService, '_save_local_mineru_result'), \
                patch('requests.post', return_value=resp_mock):
            resp = self.app.test_client().post('/api/pdf/ocr-markdown-local',
                                               json={'pdf_path': str(self.pdf), 'layout': True})
        data = resp.get_json()['data']
        self.assertEqual(list(data['images']), [f'images/{SEAL}'])
        self.assertEqual(len(data['warnings']), 1)
        self.assertIn(TABLE_IMG, data['warnings'][0])

    def test_non_boolean_flag_rejected(self):
        for bad in ('true', 1, None, [], {}):
            with self.subTest(layout=bad):
                with patch.object(FileParserService, '_check_local_service', return_value=True), \
                        patch.object(FileParserService, '_save_local_mineru_result'), \
                        patch('requests.post', return_value=self.mineru_response({})) as mineru:
                    resp = self.app.test_client().post('/api/pdf/ocr-markdown-local',
                                                       json={'pdf_path': str(self.pdf), 'layout': bad})
                self.assertEqual(resp.status_code, 400)
                self.assertEqual(resp.get_json()['error']['code'], 'INVALID_REQUEST')
                mineru.assert_not_called()

    def test_layout_still_validates_path(self):
        resp = self.app.test_client().post('/api/pdf/ocr-markdown-local',
                                           json={'pdf_path': str(Path(self.temp.name) / 'nope.pdf'), 'layout': True})
        self.assertEqual(resp.status_code, 400)


if __name__ == '__main__':
    unittest.main()
