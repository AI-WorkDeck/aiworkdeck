# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode = True
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('model_fetch', Path(__file__).parents[1] / 'main/services/model-fetch.py')
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)

class ModelFetchTests(unittest.TestCase):
    def test_same_size_corrupt_cache_is_replaced_using_expected_sha(self):
        with tempfile.TemporaryDirectory() as root:
            data = b'correct'; digest = hashlib.sha256(data).hexdigest(); revision = 'a' * 40
            store = Path(root) / 'hub/models--org--model'
            blob = store / 'blobs' / digest; blob.parent.mkdir(parents=True); blob.write_bytes(b'corrupt')
            snap = store / 'snapshots' / revision / 'model.bin'; snap.parent.mkdir(parents=True); snap.symlink_to(blob)
            entry = dict(Path='model.bin', Size=len(data), Sha256=digest, Revision=revision)
            response = io.BytesIO(data); response.status = 200
            with patch.object(fetch, 'list_files', return_value=(revision, [entry])), patch.object(fetch, '_open', return_value=response) as opened:
                fetch.fetch_repo('org/model', root)
            self.assertEqual(snap.read_bytes(), data)
            self.assertIn('/resolve/' + revision + '/', opened.call_args.args[0])
            self.assertEqual((store / 'refs/main').read_text(), revision)

    def test_correct_cached_sha_requires_no_network(self):
        with tempfile.TemporaryDirectory() as root:
            data = b'correct'; digest = hashlib.sha256(data).hexdigest(); revision = 'a' * 40
            snap = Path(root) / 'hub/models--org--model/snapshots' / revision / 'model.bin'
            snap.parent.mkdir(parents=True); snap.write_bytes(data)
            entry = dict(Path='model.bin', Size=len(data), Sha256=digest)
            with patch.object(fetch, 'list_files', return_value=(revision, [entry])), patch.object(fetch, '_open') as opened:
                fetch.fetch_repo('org/model', root)
            opened.assert_not_called()

    def test_metadata_path_cannot_escape_component_directory(self):
        with tempfile.TemporaryDirectory() as root:
            for name in ['../escape', 'C:/escape', 'file:stream']:
                with self.subTest(name=name), patch.object(fetch, 'list_files', return_value=('a' * 40, [dict(Path=name, Size=3)])):
                    with self.assertRaises(ValueError): fetch.fetch_repo('org/model', root)

if __name__ == '__main__':
    unittest.main()
