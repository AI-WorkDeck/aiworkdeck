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
        with tempfile.TemporaryDirectory() as folder:
            cli, exe = Path(folder) / 'soffice.com', Path(folder) / 'soffice.exe'
            for file in (cli, exe):
                file.touch(); file.chmod(0o755)
            with patch.dict(render.os.environ, {'Path': f';"{folder}";'}, clear=True), \
                    patch.object(sys, 'platform', 'win32'):
                self.assertEqual(render.office(), str(cli))

    def test_windows_portable_path_exe_precedes_default_console(self):
        with tempfile.TemporaryDirectory() as folder:
            portable = Path(folder) / 'portable'
            program = Path(folder) / 'system/LibreOffice/program'
            portable.mkdir(); program.mkdir(parents=True)
            exe, cli = portable / 'soffice.exe', program / 'soffice.com'
            exe.touch(); exe.chmod(0o755); cli.touch()
            with patch.dict(render.os.environ, {'PATH': str(portable), 'PROGRAMFILES': str(Path(folder) / 'system')}, clear=True), \
                    patch.object(sys, 'platform', 'win32'), \
                    patch.object(render.shutil, 'which', side_effect=lambda name: str(exe) if name == 'soffice' else None):
                self.assertEqual(render.office(), str(exe))

    def test_windows_first_path_exe_precedes_later_path_console(self):
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / 'first', Path(folder) / 'second'
            first.mkdir(); second.mkdir()
            exe, cli = first / 'soffice.exe', second / 'soffice.com'
            for file in (exe, cli):
                file.touch(); file.chmod(0o755)
            with patch.dict(render.os.environ, {'PATH': f'"{first}";{second}', 'PROGRAMFILES': folder}, clear=True), \
                    patch.object(sys, 'platform', 'win32'), \
                    patch.object(render.shutil, 'which', side_effect=lambda name: str(cli) if name == 'soffice.com' else str(exe)):
                self.assertEqual(render.office(), str(exe))


if __name__ == '__main__':
    unittest.main()
