# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dpia_environment', Path(__file__).parents[1] / 'runtime/environment-check.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class EnvironmentTests(TestCase):
    def test_missing_libraries_remain_actionable_and_no_installation(self):
        with patch.object(module.importlib, 'import_module', side_effect=ImportError):
            result = module.check()
        for item in result['checks'][1:5]:
            self.assertEqual(item['status'], 'needs_attention')
            self.assertIn('requirements.txt', item['message'])

    def test_wrong_version_and_missing_comments_are_not_ready(self):
        versions = {'python-docx': '1.2.0', 'pypdf': '0.0.1', 'pypdfium2': '4.30.0', 'reportlab': '4.4.3'}
        with patch.object(module.importlib, 'import_module', return_value=SimpleNamespace(Document=lambda: object())), \
                patch.object(module.importlib.metadata, 'version', side_effect=versions.get):
            checks = {item['id']: item for item in module.check()['checks']}
        self.assertIn('原生批注', checks['python-docx']['message'])
        self.assertIn('6.1.1', checks['pypdf']['message'])
        self.assertEqual(checks['pypdf']['status'], 'needs_attention')

    def test_missing_font_never_claims_coverage(self):
        with patch.object(module.Path, 'is_file', return_value=False):
            result = module.check()
        font = next(item for item in result['checks'] if item['id'] == 'font')
        self.assertEqual(font['status'], 'needs_attention')
        self.assertIn('TTF/TTC', font['message'])

if __name__ == '__main__': main()
