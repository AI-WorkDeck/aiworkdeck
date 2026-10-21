# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import importlib.util
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dpia_render', Path(__file__).parents[1] / 'runtime/render.py')
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)


class OfficeDiscoveryTest(unittest.TestCase):
    def test_windows_cli_preferred_and_exe_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            program = Path(folder) / 'LibreOffice/program'
            program.mkdir(parents=True)
            cli, gui = program / 'soffice.com', program / 'soffice.exe'
            cli.touch(); gui.touch()
            with patch.dict(render.os.environ, {'PROGRAMFILES': folder}, clear=True), \
                    patch.object(sys, 'platform', 'win32'), \
                    patch.object(render.shutil, 'which', return_value=None):
                self.assertEqual(render.office(), str(cli))
                cli.unlink()
                self.assertEqual(render.office(), str(gui))
                with patch.dict(render.os.environ, {'AWD_DPIA_SOFFICE': str(gui)}):
                    self.assertEqual(render.office(), str(gui))

    def test_windows_path_uses_console_entry(self):
        with patch.dict(render.os.environ, {}, clear=True), \
                patch.object(sys, 'platform', 'win32'), \
                patch.object(render.shutil, 'which', side_effect=lambda name: 'cli-path' if name == 'soffice.com' else 'gui-path'):
            self.assertEqual(render.office(), 'cli-path')


if __name__ == '__main__':
    unittest.main()
