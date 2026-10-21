# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
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


# Optional integration coverage uses the actual installed huggingface_hub SDK. Network is
# replaced only at the metadata/transport boundary; its cache and download code run unchanged.
class HuggingFaceRepairTests(unittest.TestCase):
    def test_hf_rejects_corrupt_download_before_publishing_revision(self):
        with tempfile.TemporaryDirectory() as root:
            revision = 'a' * 40
            good = b'expected'
            entry = SimpleNamespace(rfilename='model.bin', size=len(good),
                                    lfs=SimpleNamespace(sha256=hashlib.sha256(good).hexdigest()))
            info = SimpleNamespace(sha=revision, siblings=[entry])
            target = Path(root) / 'hub/models--org--model/snapshots' / revision / 'model.bin'
            def download(*args, **kwargs):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'BADBYTES')
                return str(target)
            sdk = SimpleNamespace(HfApi=lambda: SimpleNamespace(model_info=lambda *a, **k: info),
                                  hf_hub_download=download)
            with patch.dict(sys.modules, {'huggingface_hub': sdk}):
                with self.assertRaises(fetch.ChecksumError):
                    fetch.fetch_hf_repo('org/model', root)
            self.assertFalse((Path(root) / 'hub/models--org--model/refs/main').exists())

    @unittest.skipUnless(importlib.util.find_spec('huggingface_hub'), 'huggingface_hub SDK not installed')
    def test_real_sdk_repairs_bad_cache_and_preserves_valid_files(self):
        from huggingface_hub import HfApi, hf_hub_download
        from huggingface_hub.hf_api import ModelInfo
        import huggingface_hub.file_download as sdk
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        good = b'correct model bytes'
        config = b'{}'
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                data = good if self.path == '/model.bin' else config
                self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as root:
                repo = 'org/model'; revision = 'a' * 40
                store = Path(root) / 'hub/models--org--model'
                snap = store / 'snapshots' / revision
                snap.mkdir(parents=True)
                weight = snap / 'model.bin'; weight.write_bytes(b'x' * len(good))
                valid = snap / 'config.json'; valid.write_bytes(config)
                valid_mtime = valid.stat().st_mtime_ns
                info = ModelInfo(id=repo, sha=revision, siblings=[
                    dict(rfilename='model.bin', size=len(good), lfs=dict(sha256=hashlib.sha256(good).hexdigest(), size=len(good), pointerSize=1)),
                    dict(rfilename='config.json', size=len(config), blobId=hashlib.sha1(b'blob 2\0' + config).hexdigest())])
                def metadata(**kw):
                    data = good if kw['filename'] == 'model.bin' else config
                    return (f'http://127.0.0.1:{server.server_port}/' + kw['filename'], hashlib.sha256(data).hexdigest(), revision, len(data), None, None)
                with patch.object(HfApi, 'model_info', return_value=info), patch.object(sdk, '_get_metadata_or_catch_error', side_effect=metadata):
                    fetch.fetch_hf_repo(repo, root)
                self.assertEqual(weight.read_bytes(), good)
                self.assertEqual(valid.stat().st_mtime_ns, valid_mtime)
                self.assertEqual(requests, ['/model.bin'])
                self.assertEqual((store / 'refs/main').read_text(), revision)
                # A new snapshot can reuse the verified shared blob without downloading it again.
                weight.unlink()
                with patch.object(HfApi, 'model_info', return_value=info), patch.object(sdk, '_get_metadata_or_catch_error', side_effect=metadata):
                    fetch.fetch_hf_repo(repo, root)
                self.assertEqual(weight.read_bytes(), good)
                self.assertEqual(requests, ['/model.bin'])
                # A truncated shared blob must be replaced, including its snapshot symlink.
                weight.write_bytes(b'bad')
                with patch.object(HfApi, 'model_info', return_value=info), patch.object(sdk, '_get_metadata_or_catch_error', side_effect=metadata):
                    fetch.fetch_hf_repo(repo, root)
                self.assertEqual(weight.read_bytes(), good)
                self.assertEqual(requests, ['/model.bin', '/model.bin'])
        finally:
            server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__':
    unittest.main()
