#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Real-process, real SQLite/disk tests. All fixtures stay under --output."""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import select
import sqlite3
import subprocess
import time
import unittest
import zipfile


def encoded(data):
    return base64.b64encode(data).decode("ascii")


def docx(text):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr("word/document.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
    return out.getvalue()


class Client:
    def __init__(self, binary, profile, fault=None):
        self.profile = Path(profile)
        self.sequence = 0
        self.buffer = b""
        env = {**os.environ, "HOME": str(self.profile.parent / "home")}
        env.pop("AWD_LOCAL_DATA_TEST_FAULT", None)
        if fault:
            env["AWD_LOCAL_DATA_TEST_FAULT"] = fault
        Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
        self.started = time.perf_counter()
        self.process = subprocess.Popen([str(binary), "--profile", str(profile)], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)

    def receive(self):
        deadline = time.monotonic() + 10
        while b"\n" not in self.buffer:
            ready, _, _ = select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                raise AssertionError("JSONL response timed out")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise EOFError("Service exited before response")
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b"\n", 1)
        return json.loads(line)

    def send(self, method, **params):
        self.sequence += 1
        self.process.stdin.write(json.dumps({"id": self.sequence, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        return self.sequence

    def call(self, method, **params):
        ident = self.send(method, **params)
        response = self.receive()
        assert response["id"] == ident, response
        return response

    def result(self, method, **params):
        response = self.call(method, **params)
        assert "error" not in response, response
        return response["result"]

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            self.process.wait(timeout=10)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream and not stream.closed:
                stream.close()


class LocalDataTests(unittest.TestCase):
    def setUp(self):
        self.directory = OUTPUT / self._testMethodName
        self.directory.mkdir()
        self.clients = []
        self.client = self.start()
        health = self.client.result("health")
        self.assertTrue(health["ready"])
        self.project = self.client.result("projects.create", name="合成样板项目")
        self.original = docx("合成原件 Native SQLite round trip")
        self.file = self.client.result("files.create", projectId=self.project["id"], name="首份文档.docx", contentBase64=encoded(self.original))
        self.path = self.directory / "profile" / "storage" / "projects" / str(self.project["id"]) / self.file["name"]

    def start(self, fault=None):
        client = Client(BINARY, self.directory / "profile", fault)
        self.clients.append(client)
        return client

    def tearDown(self):
        for client in self.clients:
            client.close()

    def read(self, client=None):
        return (client or self.client).result("files.read", projectId=self.project["id"], fileId=self.file["id"])

    def save(self, data, client=None, generation=None):
        return (client or self.client).call("files.save", projectId=self.project["id"], fileId=self.file["id"],
                                          expectedGeneration=generation or self.file["generation"], contentBase64=encoded(data))

    def assertError(self, response, code):
        self.assertEqual(response.get("error", {}).get("code"), code, response)

    def test_real_docx_read_save_reopen_stable_ids(self):
        self.assertEqual(base64.b64decode(self.read()["contentBase64"]), self.original)
        revised = docx("合成修订之后 保留 ZIP 与正文")
        result = self.save(revised)["result"]
        self.assertEqual(result["id"], self.file["id"])
        self.assertEqual(result["uid"], self.file["uid"])
        self.assertEqual(self.path.read_bytes(), revised)
        self.client.close()
        reopened = self.start()
        self.assertEqual(reopened.result("projects.list")[0], reopened.result("projects.get", projectId=self.project["id"]))
        self.assertEqual(self.read(reopened)["generation"], hashlib.sha256(revised).hexdigest())
        self.assertEqual(self.read(reopened)["uid"], self.file["uid"])
        with zipfile.ZipFile(self.path) as archive:
            self.assertIn("合成修订之后", archive.read("word/document.xml").decode())

    def test_settings_persist_without_provider_mutation(self):
        self.client.result("settings.set", key="local.ui.theme", value={"mode": "dark", "zoom": 1.25})
        self.assertError(self.client.call("settings.set", key="asr.provider", value="local"), "UNSUPPORTED")
        self.client.close()
        reopened = self.start()
        self.assertEqual(reopened.result("settings.get", key="local.ui.theme"), {"mode": "dark", "zoom": 1.25})
        self.assertIsNone(reopened.result("settings.get", key="local.ui.missing"))

    def test_setting_key_nul_cannot_alias_an_existing_setting(self):
        self.client.result("settings.set", key="local.ui.theme", value="original")
        self.assertError(self.client.call("settings.set", key="local.ui.theme\0other", value="overwritten"), "INVALID_ARGUMENT")
        self.assertError(self.client.call("settings.get", key="local.ui.theme\0other"), "INVALID_ARGUMENT")
        self.assertEqual(self.client.result("settings.get", key="local.ui.theme"), "original")
        self.client.result("settings.set", key="local.ui.text", value="JSON value\0is escaped")
        self.assertEqual(self.client.result("settings.get", key="local.ui.text"), "JSON value\0is escaped")
        self.client.close()
        reopened = self.start()
        self.assertEqual(reopened.result("settings.get", key="local.ui.theme"), "original")

    def test_project_name_nul_is_rejected_without_truncation_or_extra_row(self):
        before = self.client.result("projects.list")
        self.assertError(self.client.call("projects.create", name="project\0truncated"), "INVALID_ARGUMENT")
        self.assertEqual(self.client.result("projects.list"), before)
        self.client.close()
        self.assertEqual(self.start().result("projects.list"), before)

    def test_two_queued_saves_old_generation_rejected(self):
        params = dict(projectId=self.project["id"], fileId=self.file["id"], expectedGeneration=self.file["generation"])
        first = self.client.send("files.save", **params, contentBase64=encoded(b"first writer"))
        second = self.client.send("files.save", **params, contentBase64=encoded(b"stale writer"))
        self.assertEqual(self.client.receive()["id"], first)
        response = self.client.receive()
        self.assertEqual(response["id"], second)
        self.assertError(response, "CONFLICT")
        self.assertEqual(self.path.read_bytes(), b"first writer")

    def test_cross_project_file_id_cannot_read_or_write(self):
        other = self.client.result("projects.create", name="其他项目")
        for method in ("files.read", "files.save"):
            self.assertError(self.client.call(method, projectId=other["id"], fileId=self.file["id"],
                                             expectedGeneration=self.file["generation"], contentBase64=encoded(b"wrong")), "NOT_FOUND")
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_external_change_conflicts_and_read_detects_it(self):
        self.path.write_bytes(b"external update")
        self.assertError(self.save(b"stale update"), "CONFLICT")
        current = self.read()
        self.assertEqual(current["generation"], hashlib.sha256(b"external update").hexdigest())
        self.assertEqual(self.save(b"acknowledged update", generation=current["generation"])["result"]["fileSize"], 19)

    def test_deleted_file_is_not_recreated_by_stale_save(self):
        self.path.unlink()
        self.assertError(self.save(b"stale update"), "NOT_FOUND")
        self.assertFalse(self.path.exists())

    def test_path_traversal_and_reserved_names_rejected(self):
        for name in ("../escape.docx", "/tmp/escape.docx", "x/y.docx", "x\\y", ".", "..", ".awd", ".native-stage", "bad\0name"):
            self.assertError(self.client.call("files.create", projectId=self.project["id"], name=name, contentBase64=""), "UNSAFE_PATH")

    def test_symlink_file_cannot_read_or_replace_target(self):
        outside = self.directory / "outside.txt"
        outside.write_bytes(b"outside preserved")
        self.path.unlink()
        self.path.symlink_to(outside)
        self.assertError(self.client.call("files.read", projectId=self.project["id"], fileId=self.file["id"]), "UNSAFE_PATH")
        self.assertError(self.save(b"bad"), "UNSAFE_PATH")
        self.assertEqual(outside.read_bytes(), b"outside preserved")

    def test_symlink_project_directory_is_rejected(self):
        directory = self.path.parent
        moved = directory.with_name("moved")
        directory.rename(moved)
        directory.symlink_to(moved, target_is_directory=True)
        self.assertError(self.save(b"bad"), "UNSAFE_PATH")
        self.assertEqual((moved / self.path.name).read_bytes(), self.original)

    def test_hardlink_is_rejected(self):
        os.link(self.path, self.directory / "linked.docx")
        self.assertError(self.save(b"bad"), "UNSAFE_PATH")
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_permission_failure_keeps_original(self):
        self.path.chmod(0o400)
        try:
            self.assertError(self.save(b"bad"), "IO_ERROR")
            self.assertEqual(self.path.read_bytes(), self.original)
        finally:
            self.path.chmod(0o600)

    def test_staging_failure_keeps_original(self):
        self.path.parent.chmod(0o500)
        try:
            self.assertError(self.save(b"bad"), "IO_ERROR")
            self.assertEqual(self.path.read_bytes(), self.original)
        finally:
            self.path.parent.chmod(0o700)
        self.assertTrue(self.client.result("health")["ready"])

    def test_save_preserves_file_permissions(self):
        self.path.chmod(0o640)
        self.assertIn("result", self.save(b"update"))
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o640)

    def test_duplicate_owner_rejected_and_release_allows_restart(self):
        other = self.start()
        self.assertError(other.receive(), "PROFILE_BUSY")
        self.assertEqual(other.process.wait(timeout=10), 1)
        self.client.close()
        self.assertTrue(self.start().result("health")["ready"])

    def test_existing_unmarked_profile_is_not_modified(self):
        profile = self.directory / "h2-profile"
        profile.mkdir()
        h2 = profile / "checkba.mv.db"
        h2.write_bytes(b"synthetic H2 sentinel")
        other = Client(BINARY, profile)
        self.clients.append(other)
        self.assertError(other.receive(), "UNSAFE_PROFILE")
        self.assertEqual(list(profile.iterdir()), [h2])
        self.assertEqual(h2.read_bytes(), b"synthetic H2 sentinel")

    def test_storage_symlink_rejected_before_any_external_creation(self):
        self.client.close()
        storage = self.directory / "profile" / "storage"
        storage.rename(storage.with_name("original-storage"))
        outside = self.directory / "outside-empty"
        outside.mkdir()
        storage.symlink_to(outside, target_is_directory=True)
        other = self.start()
        self.assertError(other.receive(), "UNSAFE_PATH")
        self.assertEqual(list(outside.iterdir()), [])

    def test_storage_swapped_after_start_cannot_create_external_project(self):
        storage = self.directory / "profile" / "storage"
        storage.rename(storage.with_name("original-storage"))
        outside = self.directory / "outside-live"
        outside.mkdir()
        (outside / "projects").mkdir()
        storage.symlink_to(outside, target_is_directory=True)
        self.assertError(self.client.call("projects.create", name="must not escape"), "UNSAFE_PATH")
        self.assertEqual(list((outside / "projects").iterdir()), [])

    def test_dangling_sqlite_and_sidecar_links_rejected_without_external_writes(self):
        for suffix in ("", "-wal", "-shm"):
            profile = self.directory / ("dangling" + (suffix or "-main"))
            profile.mkdir()
            (profile / ".awd-local-data-prototype").write_text("isolated-native-data-prototype-v1\n")
            outside = self.directory / ("outside-db" + suffix)
            (profile / ("local.sqlite" + suffix)).symlink_to(outside)
            other = Client(BINARY, profile)
            self.clients.append(other)
            self.assertError(other.receive(), "UNSAFE_PATH")
            self.assertFalse(outside.exists())

    def crash_and_restart(self, phase):
        self.client.close()
        crashing = self.start(phase)
        self.assertTrue(crashing.result("health")["ready"])
        crashing.send("files.save", projectId=self.project["id"], fileId=self.file["id"],
                      expectedGeneration=self.file["generation"], contentBase64=encoded(b"durable replacement"))
        self.assertEqual(crashing.process.wait(timeout=10), 77)
        db = sqlite3.connect(self.directory / "profile" / "local.sqlite")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 1)
        db.close()
        self.assertEqual(self.path.read_bytes(), self.original if phase == "afterJournal" else b"durable replacement")
        reopened = self.start()
        self.assertTrue(reopened.result("health")["ready"])
        self.assertEqual(base64.b64decode(self.read(reopened)["contentBase64"]), b"durable replacement")
        db = sqlite3.connect(self.directory / "profile" / "local.sqlite")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 0)
        self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        db.close()

    def test_crash_after_journal_before_rename_recovers_before_ready(self):
        self.crash_and_restart("afterJournal")

    def test_crash_after_rename_before_metadata_recovers_before_ready(self):
        self.crash_and_restart("afterRename")

    def test_recovery_conflict_refuses_ready_preserves_external_bytes(self):
        self.client.close()
        crashing = self.start("afterJournal")
        crashing.send("files.save", projectId=self.project["id"], fileId=self.file["id"],
                      expectedGeneration=self.file["generation"], contentBase64=encoded(b"replacement"))
        self.assertEqual(crashing.process.wait(timeout=10), 77)
        self.path.write_bytes(b"external after crash")
        recovery = self.start()
        self.assertError(recovery.receive(), "CONFLICT")
        self.assertEqual(recovery.process.wait(timeout=10), 1)
        self.assertEqual(self.path.read_bytes(), b"external after crash")

    def test_duplicate_name_keeps_original(self):
        self.assertError(self.client.call("files.create", projectId=self.project["id"], name=self.file["name"], contentBase64=encoded(b"bad")), "CONFLICT")
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_unindexed_existing_file_is_not_overwritten(self):
        target = self.path.parent / "existing.txt"
        target.write_bytes(b"external")
        self.assertError(self.client.call("files.create", projectId=self.project["id"], name=target.name, contentBase64=encoded(b"bad")), "CONFLICT")
        self.assertEqual(target.read_bytes(), b"external")

    def test_unsupported_ai_is_explicit(self):
        self.assertError(self.client.call("ai.chat", message="hello"), "UNSUPPORTED")
        self.assertIn("git-versions", self.client.result("health")["unavailable"])

    def test_invalid_id_and_malformed_json_do_not_mutate(self):
        for value in (True, -1, "1", 1.5, 9007199254740992):
            self.assertError(self.client.call("files.list", projectId=value), "INVALID_ARGUMENT")
        self.client.process.stdin.write("{bad json\n")
        self.client.process.stdin.flush()
        self.assertIn("error", self.client.receive())
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_large_or_invalid_payload_rejected_without_overwrite(self):
        for content in ("not base64!", encoded(b"x" * (32 * 1024 * 1024 + 1))):
            self.assertError(self.client.call("files.save", projectId=self.project["id"], fileId=self.file["id"],
                                             expectedGeneration=self.file["generation"], contentBase64=content), "INVALID_ARGUMENT")
        self.assertEqual(self.path.read_bytes(), self.original)
        self.assertTrue(self.client.result("health")["ready"])

    def test_eof_exits_normally_after_completed_save(self):
        self.assertIn("result", self.save(b"final save"))
        self.client.process.stdin.close()
        self.assertEqual(self.client.process.wait(timeout=10), 0)
        self.assertEqual(self.path.read_bytes(), b"final save")

    def test_invalid_database_refuses_ready_and_preserves_bytes(self):
        self.client.close()
        path = self.directory / "profile" / "local.sqlite"
        path.write_bytes(b"invalid SQLite sentinel")
        other = self.start()
        self.assertError(other.receive(), "DATABASE_ERROR")
        self.assertEqual(other.process.wait(timeout=10), 1)
        self.assertEqual(path.read_bytes(), b"invalid SQLite sentinel")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    BINARY = args.binary.resolve()
    OUTPUT = args.output.resolve()
    OUTPUT.mkdir(parents=True, exist_ok=False)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(LocalDataTests)
    with (OUTPUT / "tests.log").open("w") as log:
        result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
    print((OUTPUT / "tests.log").read_text(), end="")
    (OUTPUT / "summary.json").write_text(json.dumps({"tests": result.testsRun, "failures": len(result.failures),
        "errors": len(result.errors), "passed": result.wasSuccessful(), "binarySha256": hashlib.sha256(BINARY.read_bytes()).hexdigest(),
        "scope": "isolated functional subprocess/SQLite/file tests; not a full-app benchmark"}, ensure_ascii=False, indent=2) + "\n")
    raise SystemExit(0 if result.wasSuccessful() else 1)
