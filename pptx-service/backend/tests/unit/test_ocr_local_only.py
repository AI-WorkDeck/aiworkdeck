# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Synthetic OCR routing tests: no real local service, cloud calls, or user documents."""
import tempfile
import os
import runpy
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from flask import Flask
from services.file_parser_service import FileParserService
from services import pdf_convert_service
from controllers.pdf_convert_controller import pdf_convert_bp


class OcrLocalOnlyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pdf = Path(self.temp.name) / 'synthetic.pdf'
        self.pdf.write_bytes(b'%PDF synthetic routing fixture')
        self.app = Flask(__name__)
        self.app.register_blueprint(pdf_convert_bp)
        self.app.config.update(MINERU_FORCE_CLOUD='0', MINERU_LOCAL_URL='http://127.0.0.1:18787',
                               MINERU_TOKEN='synthetic-token', GOOGLE_API_KEY='synthetic-key',
                               OPENAI_API_KEY='synthetic-key')
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        # A missed mock must fail closed, never use a developer's configured network.
        transport = patch('requests.sessions.Session.request', side_effect=AssertionError('Unexpected network'))
        self.network = transport.start()
        self.addCleanup(transport.stop)

    def parser(self, **kwargs):
        return FileParserService(mineru_token='synthetic-token', google_api_key='synthetic-key',
                                 openai_api_key='synthetic-key', **kwargs)

    def test_cloud_is_not_the_default_provider(self):
        with patch.dict(os.environ, {}, clear=True):
            config = runpy.run_path(str(Path(__file__).parents[2] / 'config.py'))['Config']
        self.assertEqual(config.MINERU_FORCE_CLOUD, '0')

    def test_token_alone_does_not_upload_when_local_service_is_unavailable(self):
        parser = self.parser()
        with patch.object(parser, '_check_local_service', return_value=False), \
                patch.object(parser, '_get_upload_url', return_value=(None, None, 'unexpected cloud request')) as cloud:
            result = parser.parse_file(str(self.pdf), self.pdf.name)
        cloud.assert_not_called()
        self.assertIn('Local MinerU service is unavailable', result[3])
        self.assertIsNone(result[1])
        self.network.assert_not_called()

    def test_failed_local_parse_does_not_fall_back_to_cloud(self):
        parser = self.parser()
        failure = (None, None, None, 'synthetic local model failure', 0)
        with patch.object(parser, '_check_local_service', return_value=True), \
                patch.object(parser, '_parse_with_local_service', return_value=failure), \
                patch.object(parser, '_get_upload_url', return_value=(None, None, 'unexpected cloud request')) as cloud:
            result = parser.parse_file(str(self.pdf), self.pdf.name)
        cloud.assert_not_called()
        self.assertEqual(result, failure)
        self.network.assert_not_called()

    def test_local_only_overrides_force_cloud_and_disables_caption_uploads(self):
        self.app.config['MINERU_FORCE_CLOUD'] = '1'
        parser = self.parser(local_only=True)
        response = MagicMock(status_code=200)
        response.json.return_value = {'results': {'synthetic': {'md_content': 'Synthetic recognized text'}}}
        with patch.object(parser, '_check_local_service', return_value=True), \
                patch('requests.post', return_value=response) as local, \
                patch.object(parser, '_save_local_mineru_result'), \
                patch.object(parser, '_get_upload_url') as cloud, \
                patch.object(parser, '_enhance_markdown_with_captions') as caption:
            self.assertTrue(parser.local_service_available())
            result = parser.parse_file(str(self.pdf), self.pdf.name)
        self.assertEqual(result[1], 'Synthetic recognized text')
        self.assertIsNone(result[3])
        self.assertEqual(local.call_args.args[0], 'http://127.0.0.1:18787/file_parse')
        cloud.assert_not_called()
        caption.assert_not_called()
        self.assertFalse(parser._can_generate_captions())

    def test_explicit_cloud_configuration_preserves_general_parsing(self):
        self.app.config['MINERU_FORCE_CLOUD'] = '1'
        parser = self.parser()
        with patch.object(parser, '_check_local_service') as local, \
                patch.object(parser, '_get_upload_url', return_value=('batch', 'https://synthetic.invalid/upload', None)) as cloud, \
                patch.object(parser, '_upload_file', return_value=None) as upload, \
                patch.object(parser, '_poll_result', return_value=('Synthetic cloud text', 'extract', None)), \
                patch.object(parser, '_enhance_markdown_with_captions', return_value=('Captioned cloud text', 0)) as caption:
            result = parser.parse_file(str(self.pdf), self.pdf.name)
        self.assertEqual(result[1], 'Captioned cloud text')
        local.assert_not_called()
        cloud.assert_called_once_with(self.pdf.name)
        upload.assert_called_once()
        caption.assert_called_once()
        self.network.assert_not_called()

    def test_explicit_cloud_without_token_returns_configuration_error(self):
        self.app.config['MINERU_FORCE_CLOUD'] = '1'
        parser = FileParserService(mineru_token='')
        with patch.object(parser, '_get_upload_url', return_value=(None, None, 'unexpected cloud request')) as cloud:
            result = parser.parse_file(str(self.pdf), self.pdf.name)
        self.assertIn('explicitly selected', result[3])
        self.assertIn('MINERU_TOKEN', result[3])
        cloud.assert_not_called()

    def test_pdf_conversion_never_uploads_in_any_force_cloud_and_token_combination(self):
        for force_cloud in ('0', '1'):
            for token in ('', 'synthetic-token'):
                with self.subTest(force_cloud=force_cloud, has_token=bool(token)):
                    self.app.config.update(MINERU_FORCE_CLOUD=force_cloud, MINERU_TOKEN=token)
                    with patch.object(FileParserService, '_check_local_service', return_value=False), \
                            patch.object(FileParserService, '_get_upload_url') as cloud, \
                            patch.object(FileParserService, '_enhance_markdown_with_captions') as caption:
                        with self.assertRaisesRegex(pdf_convert_service.PdfConvertError, 'Local MinerU'):
                            pdf_convert_service.ocr_markdown(str(self.pdf))
                    cloud.assert_not_called()
                    caption.assert_not_called()
        self.network.assert_not_called()

    def test_pdf_conversion_keeps_local_failure_even_if_partial_text_was_returned(self):
        with patch.object(FileParserService, '_check_local_service', return_value=True), \
                patch.object(FileParserService, '_parse_with_local_service',
                             return_value=(None, 'incomplete text', None, 'synthetic incomplete OCR', 0)):
            with self.assertRaisesRegex(pdf_convert_service.PdfConvertError, 'synthetic incomplete OCR'):
                pdf_convert_service.ocr_markdown(str(self.pdf))

    def test_local_endpoint_with_force_cloud_and_keys_never_calls_cloud(self):
        self.app.config['MINERU_FORCE_CLOUD'] = '1'
        with patch.object(FileParserService, '_check_local_service', return_value=False), \
                patch.object(FileParserService, '_get_upload_url') as cloud:
            result = self.app.test_client().post('/api/pdf/ocr-markdown-local',
                                                json={'pdf_path': str(self.pdf)})
        self.assertEqual(result.status_code, 400)
        self.assertIn('Local MinerU', result.get_json()['error']['message'])
        cloud.assert_not_called()
        self.network.assert_not_called()

    def test_local_endpoint_returns_real_local_result(self):
        with patch.object(FileParserService, '_check_local_service', return_value=True), \
                patch.object(FileParserService, '_parse_with_local_service',
                             return_value=(None, 'Synthetic local text', None, None, 0)), \
                patch.object(FileParserService, '_get_upload_url') as cloud:
            result = self.app.test_client().post('/api/pdf/ocr-markdown-local',
                                                json={'pdf_path': str(self.pdf)})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.get_json()['data']['markdown'], 'Synthetic local text')
        cloud.assert_not_called()


if __name__ == '__main__':
    unittest.main()
