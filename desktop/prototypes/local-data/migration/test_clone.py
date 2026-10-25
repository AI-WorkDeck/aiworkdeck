#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Real-process tests for the isolated snapshot clone tool.

All fixtures (snapshots, source trees, clone profiles) are synthetic and stay
under --output. The clone under test is driven through the real Swift
JSON-lines subprocess protocol, never by inspecting SQLite alone.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import shutil
import sqlite3
import subprocess
import sys
import time
import unittest

PROJECT_COLUMNS = ["id", "name", "project_type", "listed_company_name", "target_company_name",
                   "listed_company_info_json", "target_company_info_json", "user_id", "local_root",
                   "version_opt_out", "created_at", "updated_at", "uid"]
FILE_COLUMNS = ["id", "project_id", "parent_id", "is_folder", "name", "file_type", "file_size",
                "file_path", "external_path", "wps_file_id", "sort_order", "user_id",
                "client_visible", "created_at", "updated_at", "is_deleted", "uid", "meta_json",
                "deleted_at"]
SETTING_COLUMNS = ["key", "value"]
SNAPSHOT_FORMAT = "awd-h2-snapshot-v1"
SOURCE_SHA = "a" * 64


def encoded(data):
    return base64.b64encode(data).decode("ascii")


def jdbc_columns(names):
    """JDBC metadata dictionaries exactly as H2Snapshot.metadata() emits them."""
    return [{"TABLE_CAT": "SNAP", "TABLE_SCHEM": "PUBLIC", "TABLE_NAME": "",
             "COLUMN_NAME": name, "DATA_TYPE": "12", "TYPE_NAME": "VARCHAR",
             "COLUMN_SIZE": "256", "IS_NULLABLE": "YES", "REMARKS": "",
             "BUFFER_LENGTH": None, "COLUMN_DEF": None} for name in names]


def project_row(pid, uid, name, created="2026-01-02 03:04:05", updated="2026-02-03 04:05:06",
                local_root=None, user_id="1", project_type="MAJOR_ASSET_RESTRUCTURING",
                listed="上市公司甲", target="标的公司乙", listed_info=None, target_info=None,
                version_opt_out=None, extra=None):
    values = {"id": str(pid), "uid": uid, "name": name, "project_type": project_type,
              "listed_company_name": listed, "target_company_name": target,
              "listed_company_info_json": listed_info, "target_company_info_json": target_info,
              "user_id": user_id, "local_root": local_root or None,
              "version_opt_out": version_opt_out, "created_at": created, "updated_at": updated}
    if extra:
        values.update(extra)
    return values


def file_row(fid, uid, pid, parent, folder, name, file_path, size, updated="2026-03-04 05:06:07",
             deleted="FALSE", external=None, file_type=None, wps_file_id=None, sort_order="0",
             user_id="1", client_visible="FALSE", created="2026-03-01 05:06:07", meta_json=None,
             deleted_at=None):
    return {"id": str(fid), "uid": uid, "project_id": str(pid),
            "parent_id": None if parent == 0 else str(parent),
            "is_folder": "TRUE" if folder else "FALSE", "name": name, "file_type": file_type,
            "file_size": None if folder else str(size), "file_path": file_path,
            "external_path": external, "wps_file_id": wps_file_id, "sort_order": sort_order,
            "user_id": user_id, "client_visible": client_visible, "created_at": created,
            "updated_at": updated, "is_deleted": deleted, "meta_json": meta_json,
            "deleted_at": deleted_at if deleted == "TRUE" else None}


def write_snapshot(path, projects, files, extra_tables=None, fmt=SNAPSHOT_FORMAT,
                   include_footer=True, counts=None, trailing=None, extra_records=None,
                   project_columns=None, file_columns=None):
    """Mirror the real exporter: header, all DDL, then per table its declaration
    immediately followed by its rows, then the complete footer."""
    extra_tables = extra_tables or {}
    extra_records = extra_records or {}
    lines = [{"kind": "header", "format": fmt, "sourceSha256": SOURCE_SHA, "h2Version": "2.3.232"}]
    lines.append({"kind": "source-ddl", "sql": 'CREATE CACHED TABLE "PUBLIC"."PROJECT"(ID BIGINT PRIMARY KEY)'})
    lines.append({"kind": "source-ddl", "sql": 'CREATE CACHED TABLE "PUBLIC"."PROJECT_FILE"(ID BIGINT PRIMARY KEY)'})
    table_rows = [
        ("project", project_columns or PROJECT_COLUMNS, projects),
        ("project_file", file_columns or FILE_COLUMNS, files),
    ] + [(name, columns, extra_records.get(name, [])) for name, columns in extra_tables.items()]
    observed = {}
    for name, columns, rows in table_rows:
        lines.append({"kind": "table", "name": name, "columns": jdbc_columns(columns),
                      "primaryKeys": [{"COLUMN_NAME": "id"}], "foreignKeys": [], "indexes": [],
                      "identityColumns": ([{"column": "id", "start": "1", "next": "1", "increment": "1",
                                           "minimum": "1", "maximum": "9223372036854775807", "cycle": "NO"}]
                                          if name in ("project", "project_file") else [])})
        for values in rows:
            lines.append({"kind": "row", "table": name, "values": values})
        observed[name] = len(rows)
    if include_footer:
        lines.append({"kind": "complete", "sourceSha256": SOURCE_SHA,
                      "counts": counts if counts is not None else observed})
    if trailing:
        lines.extend(trailing)
    path.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines), encoding="utf-8")
    return path


class Client:
    """Minimal independent Swift JSON-lines protocol client."""

    def __init__(self, binary, profile):
        env = dict(os.environ)
        env.pop("AWD_LOCAL_DATA_TEST_FAULT", None)
        env["HOME"] = str(Path(profile).parent / "home")
        Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
        self.process = subprocess.Popen([str(binary), "--profile", str(profile)], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        self.buffer = b""
        self.sequence = 0

    def receive(self):
        deadline = time.monotonic() + 15
        while b"\n" not in self.buffer:
            ready, _, _ = select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                raise AssertionError("Swift protocol response timed out")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise EOFError("Swift process closed the protocol pipe")
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b"\n", 1)
        return json.loads(line)

    def call(self, method, **params):
        self.sequence += 1
        self.process.stdin.write(json.dumps({"id": self.sequence, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        response = self.receive()
        assert response["id"] == self.sequence, response
        return response

    def result(self, method, **params):
        response = self.call(method, **params)
        assert "error" not in response, response
        return response["result"]

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            self.process.wait(timeout=15)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream and not stream.closed:
                stream.close()


class CloneTests(unittest.TestCase):
    def setUp(self):
        self.directory = OUTPUT / self._testMethodName
        self.directory.mkdir(parents=True)
        self.snapshot = self.directory / "snapshot.jsonl"
        self.roots_map = self.directory / "roots.json"
        self.output = self.directory / "clone-profile"
        self.clients = []
        self.source_counter = 0

    def tearDown(self):
        for client in self.clients:
            client.close()

    def client(self, profile):
        client = Client(BINARY, profile)
        self.clients.append(client)
        return client

    def run_tool(self, snapshot=None, output=None, roots=None, binary=None):
        proc = subprocess.run(
            [sys.executable, str(CLONE), "--snapshot", str(snapshot or self.snapshot),
             "--project-roots", str(roots or self.roots_map),
             "--output", str(output or self.output), "--binary", str(binary or BINARY)],
            capture_output=True, text=True, timeout=300)
        line = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "{}"
        return proc.returncode, json.loads(line)

    def write_roots(self, mapping):
        self.roots_map.write_text(json.dumps({str(key): str(value) for key, value in mapping.items()}))
        return self.roots_map

    def make_source(self, name, tree):
        """tree: {relative dir: {file name: bytes}}; returns (root, {relative path: bytes})."""
        self.source_counter += 1
        root = self.directory / f"{name}-{self.source_counter}"
        root.mkdir()
        files = {}
        for directory, entries in tree.items():
            target_dir = root / directory if directory != "." else root
            target_dir.mkdir(parents=True, exist_ok=True)
            for filename, data in entries.items():
                (target_dir / filename).write_bytes(data)
                files[str((Path(directory) / filename) if directory != "." else Path(filename))] = data
        return root, files

    def assertRejected(self, code, snapshot=None, output=None):
        returncode, result = self.run_tool(snapshot=snapshot, output=output)
        self.assertEqual(returncode, 1, result)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], code, result)
        target = Path(output or self.output)
        self.assertFalse(target.exists(), "rejected imports must not publish an output")
        return result

    # ---------------------------------------------------------- happy paths

    def standard_fixture(self):
        src1, files1 = self.make_source("src-p7", {
            ".": {"说明.txt": b"root readme v1"},
            "合同": {"备忘.txt": b"memo bytes"},
            "合同/2026": {"报告.docx": b"%DOCX report bytes 2026"},
        })
        src2, files2 = self.make_source("src-p9", {
            "合同": {"说明.txt": b"same nested name, other project"},
        })
        (src1 / "合同" / "备忘.txt").chmod(0o640)
        projects = [
            project_row(7, "uid-project-7", "甲项目", created="2026-01-02 03:04:05",
                        updated="2026-01-05T10:00:00Z", local_root=str(src1)),
            project_row(9, "uid-project-9", "乙项目", local_root=""),
        ]
        files = [
            file_row(101, "uid-file-101", 7, 0, True, "合同", "projects/7/合同", 0),
            file_row(102, "uid-file-102", 7, 101, True, "2026", "projects/7/合同/2026", 0),
            file_row(103, "uid-file-103", 7, 102, False, "报告.docx",
                     "projects/7/合同/2026/报告.docx", len(files1["合同/2026/报告.docx"]),
                     meta_json='{"docketNo":"(2026)京01民初1号"}', wps_file_id="project_7_doc_103_v1"),
            file_row(104, "uid-file-104", 7, 101, False, "备忘.txt",
                     "projects/7/合同/备忘.txt", len(files1["合同/备忘.txt"])),
            file_row(105, "uid-file-105", 7, 0, False, "说明.txt",
                     "projects/7/说明.txt", len(files1["说明.txt"])),
            file_row(106, "uid-file-106", 7, 0, False, "已删除旧稿.txt",
                     "projects/7/已删除旧稿.txt", 12, deleted="TRUE",
                     deleted_at="2026-04-01 00:00:00"),
            file_row(201, "uid-file-201", 9, 0, True, "合同", "projects/9/合同", 0),
            file_row(202, "uid-file-202", 9, 201, False, "说明.txt",
                     "projects/9/合同/说明.txt", len(files2["合同/说明.txt"])),
        ]
        write_snapshot(self.snapshot, projects, files,
                       extra_tables={"app_setting": SETTING_COLUMNS},
                       extra_records={"app_setting": [{"key": "theme", "value": "dark"}]})
        self.write_roots({7: src1, 9: src2})
        expected = {
            7: {row["id"]: row for row in files if row["project_id"] == "7"},
            9: {row["id"]: row for row in files if row["project_id"] == "9"},
        }
        sources = {7: (src1, files1), 9: (src2, files2)}
        return projects, files, expected, sources

    def test_nested_clone_preserves_ids_uids_bytes_and_permissions(self):
        projects, files, expected, sources = self.standard_fixture()
        before = {}
        for root, tree in sources.values():
            for rel in tree:
                path = root / rel
                before[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 0, result)
        self.assertTrue(result["ok"], result)
        self.assertFalse(Path(str(self.output) + ".staging").exists(), "staging must be consumed by the publish")
        report = json.loads((self.output / "migration-report.json").read_text())
        self.assertIn("git-versions", report["unavailableCapabilities"])
        self.assertEqual(report["projectsImported"], 2)
        self.assertEqual(report["deletedRowsArchivedOnly"], 1)
        self.assertEqual(report["verification"]["filesVerified"], 4)

        client = self.client(self.output)
        self.assertTrue(client.result("health")["ready"])
        listed = {entry["id"]: entry for entry in client.result("projects.list")}
        self.assertEqual(set(listed), {7, 9})
        self.assertEqual(listed[7]["uid"], "uid-project-7")
        self.assertEqual(listed[7]["name"], "甲项目")
        self.assertEqual(listed[7]["createdAt"], "2026-01-02 03:04:05")
        self.assertEqual(listed[7]["updatedAt"], "2026-01-05T10:00:00Z")
        self.assertEqual(listed[9]["uid"], "uid-project-9")

        live7 = {int(fid): row for fid, row in expected[7].items() if row["is_deleted"] == "FALSE"}
        listing = {entry["id"]: entry for entry in client.result("files.list", projectId=7)}
        self.assertEqual(set(listing), set(live7))
        self.assertNotIn(106, listing, "deleted rows must never be listed as live")
        self.assertEqual(listing[102]["parentId"], 101)
        self.assertIsNone(listing[101]["parentId"])
        self.assertTrue(listing[101]["isFolder"])
        self.assertEqual(listing[103]["filePath"], "projects/7/合同/2026/报告.docx")
        self.assertEqual(listing[103]["uid"], "uid-file-103")
        listing9 = {entry["id"]: entry for entry in client.result("files.list", projectId=9)}
        self.assertEqual(listing9[202]["filePath"], "projects/9/合同/说明.txt")

        for fid, rel in ((103, "合同/2026/报告.docx"), (104, "合同/备忘.txt"), (105, "说明.txt")):
            read = client.result("files.read", projectId=7, fileId=fid)
            self.assertEqual(base64.b64decode(read["contentBase64"]), sources[7][1][rel])
            self.assertEqual(read["uid"], f"uid-file-{fid}")
        read9 = client.result("files.read", projectId=9, fileId=202)
        self.assertEqual(base64.b64decode(read9["contentBase64"]), sources[9][1]["合同/说明.txt"])
        clone_file = self.output / "storage" / "projects" / "7" / "合同" / "备忘.txt"
        self.assertEqual(clone_file.stat().st_mode & 0o777, 0o640, "Unix permissions must be preserved")
        client.close()

        database = sqlite3.connect(self.output / "local.sqlite")
        total = database.execute("SELECT COUNT(*) FROM migration_archive").fetchone()[0]
        self.assertEqual(total, 1 + 2 + 3 + len(projects) + len(files) + 1 + 1,
                         "every raw snapshot record (header, ddl, tables, rows, footer) must be archived verbatim")
        archived_deleted = database.execute(
            "SELECT imported, note, payload FROM migration_archive WHERE kind='row' AND table_name='project_file' "
            "AND payload LIKE '%已删除旧稿.txt%'").fetchone()
        self.assertEqual(archived_deleted[0], 0)
        self.assertIn("deleted", archived_deleted[1])
        self.assertIn('"uid": "uid-file-106"', archived_deleted[2])
        archived_setting = database.execute(
            "SELECT imported FROM migration_archive WHERE kind='row' AND table_name='app_setting'").fetchone()
        self.assertEqual(archived_setting[0], 0, "non-core rows are archive-only, not business data")
        archived_project = database.execute(
            "SELECT payload FROM migration_archive WHERE kind='row' AND table_name='project' "
            "AND payload LIKE '%uid-project-7%'").fetchone()[0]
        self.assertIn('"project_type": "MAJOR_ASSET_RESTRUCTURING"', archived_project,
                      "current non-path metadata fields must be archived losslessly")
        self.assertIn('"listed_company_name": "上市公司甲"', archived_project)
        archived_meta = database.execute(
            "SELECT payload FROM migration_archive WHERE kind='row' AND table_name='project_file' "
            "AND payload LIKE '%uid-file-103%'").fetchone()[0]
        self.assertIn('\\"docketNo\\":\\"(2026)京01民初1号\\"', archived_meta)
        self.assertIn('"wps_file_id": "project_7_doc_103_v1"', archived_meta)
        self.assertIn("project.project_type", report["archiveOnlyFields"])
        self.assertIn("project_file.meta_json", report["archiveOnlyFields"])
        self.assertEqual(database.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        database.close()

        for path_text, digest in before.items():
            self.assertEqual(hashlib.sha256(Path(path_text).read_bytes()).hexdigest(), digest,
                             "source bytes must remain untouched")

    def test_clone_save_changes_only_the_clone(self):
        _, _, _, sources = self.standard_fixture()
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 0, result)
        source = sources[7][0] / "说明.txt"
        original = source.read_bytes()
        clone_path = self.output / "storage" / "projects" / "7" / "说明.txt"
        client = self.client(self.output)
        read = client.result("files.read", projectId=7, fileId=105)
        saved = client.result("files.save", projectId=7, fileId=105,
                              expectedGeneration=read["generation"], contentBase64=encoded(b"clone-only edit"))
        self.assertEqual(saved["id"], 105)
        self.assertEqual(saved["uid"], "uid-file-105")
        self.assertEqual(clone_path.read_bytes(), b"clone-only edit")
        self.assertEqual(source.read_bytes(), original, "saving the clone must never touch the source")
        restored = client.result("files.save", projectId=7, fileId=105,
                                 expectedGeneration=saved["generation"], contentBase64=encoded(original))
        self.assertEqual(restored["generation"], read["generation"])
        self.assertEqual(source.read_bytes(), original)
        client.close()

    # ---------------------------------------------------------- rejections

    def rejection_fixture(self, mutate_files=None, mutate_projects=None, **snapshot_kwargs):
        src, tree = self.make_source("src-p1", {".": {"a.txt": b"alpha"}, "dir": {"b.txt": b"beta"}})
        projects = [project_row(1, "uid-p1", "项目一", local_root=str(src))]
        if mutate_projects:
            projects = mutate_projects(projects)
        files = [
            file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0),
            file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt", len(tree["a.txt"])),
            file_row(13, "uid-f13", 1, 11, False, "b.txt", "projects/1/dir/b.txt", len(tree["dir/b.txt"])),
        ]
        if mutate_files:
            files = mutate_files(files)
        write_snapshot(self.snapshot, projects, files, **snapshot_kwargs)
        self.write_roots({1: src})
        return src, tree

    def test_missing_footer_rejected(self):
        self.rejection_fixture(include_footer=False)
        self.assertRejected("SNAPSHOT_INCOMPLETE")

    def test_counts_mismatch_rejected(self):
        self.rejection_fixture(counts={"project": 1, "project_file": 99})
        self.assertRejected("COUNTS_MISMATCH")

    def test_unknown_kind_and_old_format_rejected(self):
        self.rejection_fixture()
        lines = self.snapshot.read_text().splitlines()
        lines.insert(1, json.dumps({"kind": "mystery", "payload": 1}))
        self.snapshot.write_text("\n".join(lines) + "\n")
        self.assertRejected("SNAPSHOT_FORMAT")
        self.rejection_fixture(fmt="awd-h2-snapshot-v0")
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_trailing_content_after_complete_rejected(self):
        self.rejection_fixture(trailing=[{"kind": "row", "table": "project",
                                          "values": project_row(2, "uid-p2", "late")}])
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_row_columns_must_match_declaration_rejected(self):
        broken = project_row(1, "uid-p1", "项目一")
        del broken["user_id"]
        self.rejection_fixture(mutate_projects=lambda _: [broken])
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_duplicate_id_and_uid_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: rows + [
            file_row(12, "uid-f99", 1, 0, False, "c.txt", "projects/1/c.txt", 1)])
        self.assertRejected("DUPLICATE_ID")
        self.rejection_fixture(mutate_files=lambda rows: rows + [
            file_row(99, "uid-f12", 1, 0, False, "c.txt", "projects/1/c.txt", 1)])
        self.assertRejected("DUPLICATE_UID")

    def test_missing_uid_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(12, None, 1, 0, False, "a.txt", "projects/1/a.txt", 5)])
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 1)
        self.assertEqual(result["error"]["code"], "INVALID_ROW")
        self.assertFalse(self.output.exists())

    def test_orphan_file_and_missing_parent_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: rows + [
            file_row(14, "uid-f14", 999, 0, False, "x.txt", "projects/999/x.txt", 1)])
        self.assertRejected("ORPHAN_FILE")
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(13, "uid-f13", 1, 555, False, "b.txt", "projects/1/dir/b.txt", 4)])
        self.assertRejected("ORPHAN_FILE")

    def test_active_child_under_deleted_parent_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0, deleted="1"),
            file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt", 5),
            file_row(13, "uid-f13", 1, 11, False, "b.txt", "projects/1/dir/b.txt", 4),
        ])
        result = self.assertRejected("PARENT_DELETED")
        staging = Path(str(self.output) + ".staging")
        if staging.exists():
            failure = json.loads((staging / "migration-failure-report.json").read_text())
            self.assertEqual(failure["error"]["code"], "PARENT_DELETED")
        self.assertEqual(result["error"]["code"], "PARENT_DELETED")

    def test_cycle_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(11, "uid-f11", 1, 13, True, "dir", "projects/1/inner/dir", 0),
            file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt", 5),
            file_row(13, "uid-f13", 1, 11, True, "inner", "projects/1/inner", 0),
        ])
        self.assertRejected("CYCLE_DETECTED")

    def test_cross_project_parent_rejected(self):
        def mutate(rows):
            rows[0] = file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0)
            rows[2] = file_row(13, "uid-f13", 1, 21, False, "b.txt", "projects/1/dir/b.txt", 4)
            rows.append(file_row(21, "uid-f21", 2, 0, True, "dir", "projects/2/dir", 0))
            return rows
        self.rejection_fixture(mutate_files=mutate,
                               mutate_projects=lambda rows: rows + [project_row(2, "uid-p2", "项目二")])
        self.assertRejected("CROSS_PROJECT")

    def test_source_key_mismatch_and_traversal_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/../escape.txt", 5)])
        self.assertRejected("SOURCE_KEY_MISMATCH")
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(12, "uid-f12", 1, 0, False, "../a.txt", "projects/1/a.txt", 5)])
        self.assertRejected("UNSAFE_PATH")
        self.rejection_fixture(mutate_files=lambda rows: [
            rows[0], rows[1],
            file_row(13, "uid-f13", 1, 11, False, "b.txt", "projects/1/b.txt", 4)])
        self.assertRejected("SOURCE_KEY_MISMATCH")

    def test_same_directory_name_conflict_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: rows + [
            file_row(14, "uid-f14", 1, 11, False, "b.txt", "projects/1/dir/b.txt", 4)])
        self.assertRejected("NAME_CONFLICT")

    def test_external_path_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt", 5,
                     external="/somewhere/else/a.txt")])
        self.assertRejected("UNSUPPORTED")

    def test_unknown_populated_core_field_rejected(self):
        columns = PROJECT_COLUMNS + ["tenant_id"]
        self.rejection_fixture(mutate_projects=lambda rows: [
            project_row(1, "uid-p1", "项目一", extra={"tenant_id": "tenant-9"})],
            project_columns=columns)
        self.assertRejected("UNSUPPORTED_FIELD")
        file_columns = FILE_COLUMNS + ["future_flag"]
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0),
            rows[1],
            rows[2]],
            file_columns=file_columns)
        self.assertRejected("SNAPSHOT_FORMAT")  # rows must carry the declared future_flag too
        self.rejection_fixture(mutate_files=lambda rows: [
            {**rows[0], "future_flag": None},
            {**rows[1], "future_flag": "TRUE"},
            {**rows[2], "future_flag": None}],
            file_columns=file_columns)
        self.assertRejected("UNSUPPORTED_FIELD")

    # --------------------------------------------- actual exporter format rules

    def test_string_columns_rejected(self):
        src, _ = self.rejection_fixture()
        write_snapshot(self.snapshot,
                       [project_row(1, "uid-p1", "项目一", local_root=str(src))],
                       [file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0)],
                       project_columns=None)
        lines = self.snapshot.read_text().splitlines()
        table_index = next(i for i, line in enumerate(lines)
                           if json.loads(line).get("kind") == "table"
                           and json.loads(line).get("name") == "project")
        table = json.loads(lines[table_index])
        table["columns"] = PROJECT_COLUMNS  # invented name-only format
        lines[table_index] = json.dumps(table, ensure_ascii=False)
        self.snapshot.write_text("\n".join(lines) + "\n")
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_wrong_column_schema_key_rejected(self):
        src, _ = self.rejection_fixture()
        write_snapshot(self.snapshot,
                       [project_row(1, "uid-p1", "项目一", local_root=str(src))],
                       [file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0)])
        lines = self.snapshot.read_text().splitlines()
        table_index = next(i for i, line in enumerate(lines)
                           if json.loads(line).get("kind") == "table"
                           and json.loads(line).get("name") == "project")
        table = json.loads(lines[table_index])
        table["columns"] = [{"name": column} for column in PROJECT_COLUMNS]  # lowercase invented key
        lines[table_index] = json.dumps(table, ensure_ascii=False)
        self.snapshot.write_text("\n".join(lines) + "\n")
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_duplicate_column_name_rejected(self):
        src, _ = self.rejection_fixture()
        write_snapshot(self.snapshot,
                       [project_row(1, "uid-p1", "项目一", local_root=str(src))],
                       [file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0)],
                       project_columns=PROJECT_COLUMNS + ["name"])
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_duplicate_json_object_key_rejected(self):
        self.rejection_fixture()
        lines = self.snapshot.read_text().splitlines()
        lines.insert(2, '{"kind":"table","name":"t","name":"t","columns":[]}')
        self.snapshot.write_text("\n".join(lines) + "\n")
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_missing_required_core_column_rejected(self):
        src, _ = self.rejection_fixture()
        write_snapshot(self.snapshot,
                       [project_row(1, "uid-p1", "项目一", local_root=str(src))],
                       [file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0)],
                       project_columns=[column for column in PROJECT_COLUMNS if column != "created_at"])
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_footer_must_cover_exactly_declared_tables(self):
        src, _ = self.rejection_fixture()
        projects = [project_row(1, "uid-p1", "项目一", local_root=str(src))]
        files = [file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0),
                 file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt", 5)]
        # zero-row declared table omitted from the footer -> rejected
        write_snapshot(self.snapshot, projects, files,
                       extra_tables={"app_setting": SETTING_COLUMNS},
                       counts={"project": 1, "project_file": 2})
        self.assertRejected("COUNTS_MISMATCH")
        # undeclared zero-count entry in the footer -> rejected (used to pass)
        write_snapshot(self.snapshot, projects, files,
                       counts={"project": 1, "project_file": 2, "ghost_table": 0})
        self.assertRejected("COUNTS_MISMATCH")
        # exact coverage of a zero-row declared table -> accepted
        write_snapshot(self.snapshot, projects, files,
                       extra_tables={"app_setting": SETTING_COLUMNS},
                       counts={"project": 1, "project_file": 2, "app_setting": 0})
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 0, result)

    def test_ddl_after_table_declaration_rejected(self):
        self.rejection_fixture()
        lines = self.snapshot.read_text().splitlines()
        first_table = next(i for i, line in enumerate(lines)
                           if json.loads(line).get("kind") == "table")
        lines.insert(first_table + 1, json.dumps({"kind": "source-ddl", "sql": "CREATE TABLE LATE"}))
        self.snapshot.write_text("\n".join(lines) + "\n")
        self.assertRejected("SNAPSHOT_FORMAT")

    def test_interleaved_table_and_row_records_accepted(self):
        # write_snapshot already mirrors the exporter: table, its rows, next table
        self.rejection_fixture()
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 0, result)

    def test_row_before_its_table_declaration_rejected(self):
        self.rejection_fixture()
        lines = [json.loads(line) for line in self.snapshot.read_text().splitlines()]
        # Move the first project_file row ahead of its table declaration.
        project_file_decl = next(i for i, line in enumerate(lines)
                                 if line.get("kind") == "table" and line.get("name") == "project_file")
        row = lines.pop(project_file_decl + 1)
        lines.insert(project_file_decl, row)
        self.snapshot.write_text("".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines))
        self.assertRejected("SNAPSHOT_FORMAT")

    # ------------------------------------------------------- source root safety

    def test_ancestor_symlink_rejected_for_root_and_output(self):
        src, _ = self.rejection_fixture()
        real_parent = self.directory / "real-parent"
        real_parent.mkdir()
        (real_parent / "src").symlink_to(src, target_is_directory=True)
        self.write_roots({1: str(real_parent / "src")})
        self.assertRejected("UNSAFE_PATH")
        staging = Path(str(self.output) + ".staging")
        if staging.exists():
            shutil.rmtree(staging)
        # same rule for the output parent directory
        self.write_roots({1: str(src)})
        output_parent = self.directory / "via-link"
        output_parent.symlink_to(self.directory, target_is_directory=True)
        self.assertRejected("UNSAFE_PATH", output=output_parent / "clone-profile")

    def test_missing_source_directory_for_declared_folder_rejected(self):
        src, _ = self.rejection_fixture()
        shutil.rmtree(src / "dir")  # declared in metadata but absent on disk
        self.assertRejected("NOT_FOUND")

    def test_empty_project_still_requires_real_root(self):
        empty = self.directory / "empty-project"
        empty.mkdir()
        write_snapshot(self.snapshot,
                       [project_row(3, "uid-p3", "空项目", local_root=str(empty))],
                       [file_row(31, "uid-f31", 3, 0, True, "子目录", "projects/3/子目录", 0)])
        (empty / "子目录").mkdir()
        self.write_roots({})  # no root at all -> rejected even with zero files
        self.assertRejected("NO_SOURCE_ROOT")
        self.write_roots({3: self.directory / "not-there"})
        self.assertRejected("NOT_FOUND")
        self.write_roots({3: empty})
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 0, result)
        self.assertEqual(result["report"]["foldersImported"], 1)

    def test_unsafe_integer_id_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0),
            file_row(9223372036854775807, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt", 5),
            rows[2]])
        self.assertRejected("INVALID_ROW")

    def rewrite_identity(self, table_name, identity):
        records = [json.loads(line) for line in self.snapshot.read_text().splitlines()]
        table = next(row for row in records if row.get("kind") == "table" and row.get("name") == table_name)
        if identity is None:
            table.pop("identityColumns")
        else:
            table["identityColumns"] = identity
        self.snapshot.write_text("".join(json.dumps(row) + "\n" for row in records))

    def test_missing_identity_metadata_requires_fresh_export(self):
        self.rejection_fixture()
        self.rewrite_identity("project", None)
        self.assertRejected("IDENTITY_METADATA_MISSING")

    def test_unsupported_identity_semantics_rejected(self):
        self.rejection_fixture()
        baseline = {"column": "id", "start": "1", "next": "1", "increment": "1",
                    "minimum": "1", "maximum": "9223372036854775807", "cycle": "NO"}
        for changed in ({"cycle": "YES"}, {"increment": "-1"}, {"increment": "2"},
                        {"next": None}, {"next": "0"}, {"next": "9007199254740992"},
                        {"next": 3}, {"maximum": "100"}, {"column": "uid"}):
            with self.subTest(identity=changed):
                self.rewrite_identity("project", [{**baseline, **changed}])
                self.assertRejected("UNSUPPORTED_IDENTITY")
        for entries in ([], [baseline, baseline], {}):
            with self.subTest(entries=entries):
                self.rewrite_identity("project", entries)
                self.assertRejected("UNSUPPORTED_IDENTITY")

    def test_identity_high_water_survives_empty_core_tables(self):
        write_snapshot(self.snapshot, [], [])
        self.write_roots({})
        for table, next_value in (("project", "71"), ("project_file", "83")):
            self.rewrite_identity(table, [{"column": "id", "start": "1", "next": next_value,
                "increment": "1", "minimum": "1", "maximum": "9223372036854775807", "cycle": "NO"}])
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 0, result)
        client = self.client(self.output)
        project = client.result("projects.create", name="新项目")
        self.assertEqual(project["id"], 71)
        entry = client.result("files.create", projectId=71, name="新文件.txt", contentBase64=encoded(b"new"))
        self.assertEqual(entry["id"], 83)
        client.close()

    def test_output_dot_components_rejected_before_writes(self):
        self.rejection_fixture()
        outside = self.directory / "outside"
        nested = outside / "nested"
        nested.mkdir(parents=True)
        link = self.directory / "link"
        link.symlink_to(nested, target_is_directory=True)
        for output in (str(self.directory) + "/./dot-profile",
                       str(self.directory) + "/outside/../dotdot-profile",
                       str(link) + "/../escaped-profile"):
            with self.subTest(output=output):
                self.assertRejected("UNSAFE_PATH", output=output)
                self.assertFalse(Path(output + ".staging").exists())
        self.assertEqual(list(outside.iterdir()), [nested])

    def test_deleted_max_file_id_never_reused(self):
        src, tree = self.make_source("src-seq", {"子目录": {"a.txt": b"alpha"}})
        projects = [project_row(1, "uid-p1", "项目一", local_root=str(src))]
        files = [
            file_row(11, "uid-f11", 1, 0, True, "子目录", "projects/1/子目录", 0),
            file_row(12, "uid-f12", 1, 11, False, "a.txt", "projects/1/子目录/a.txt", 5),
            file_row(500, "uid-f500", 1, 11, False, "旧稿.txt", "projects/1/子目录/旧稿.txt", 9,
                     deleted="TRUE", deleted_at="2026-04-01 00:00:00"),
        ]
        write_snapshot(self.snapshot, projects, files)
        self.write_roots({1: src})
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 0, result)
        client = self.client(self.output)
        created = client.result("files.create", projectId=1, parentId=11, name="新文件.txt",
                                contentBase64=encoded(b"new"))
        self.assertGreater(created["id"], 500,
                           "new file IDs must never reuse or collide with archived deleted legacy IDs")
        client.close()

    def test_source_mutation_after_copy_detected_before_publish(self):
        src, _ = self.rejection_fixture()
        spec = importlib.util.spec_from_file_location("clone_under_test", CLONE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original_verify = module.verify_clone

        def mutating_verify(*args, **kwargs):
            result = original_verify(*args, **kwargs)
            (src / "a.txt").write_bytes(b"mutated after copy")
            return result

        module.verify_clone = mutating_verify
        arguments = argparse.Namespace(snapshot=str(self.snapshot), project_roots=str(self.roots_map),
                                       output=str(self.output), binary=str(BINARY))
        with self.assertRaises(module.CloneError) as raised:
            module.run(arguments)
        self.assertEqual(raised.exception.code, "SOURCE_CHANGED")
        self.assertFalse(self.output.exists(), "mutated sources must never publish an output")
        staging = Path(str(self.output) + ".staging")
        self.assertTrue(staging.exists(), "failed imports keep the staging directory for inspection")
        failure = json.loads((staging / "migration-failure-report.json").read_text())
        self.assertEqual(failure["error"]["code"], "SOURCE_CHANGED")

    def test_existing_output_rejected(self):
        self.rejection_fixture()
        self.output.mkdir()
        returncode, result = self.run_tool()
        self.assertEqual(returncode, 1)
        self.assertEqual(result["error"]["code"], "CONFLICT")
        self.assertEqual(list(self.output.iterdir()), [], "pre-existing output must stay untouched")
        output2 = self.directory / "clone-2"
        returncode, result = self.run_tool(output=output2)
        self.assertEqual(returncode, 0, result)
        returncode, result = self.run_tool(output=output2)
        self.assertEqual(returncode, 1)
        self.assertEqual(result["error"]["code"], "CONFLICT")

    def test_cloned_last_safe_identity_rejects_later_creations(self):
        write_snapshot(self.snapshot, [], [])
        self.write_roots({})
        last_id = 9007199254740991
        for table in ("project", "project_file"):
            self.rewrite_identity(table, [{"column": "id", "start": "1", "next": str(last_id),
                "increment": "1", "minimum": "1", "maximum": "9223372036854775807", "cycle": "NO"}])
        code, result = self.run_tool()
        self.assertEqual(code, 0, result)
        client = self.client(self.output)
        project = client.result("projects.create", name="最后编号")
        self.assertEqual(project["id"], last_id)
        entry = client.result("files.create", projectId=last_id, name="last.txt", contentBase64=encoded(b"last"))
        self.assertEqual(entry["id"], last_id)
        self.assertEqual(client.result("files.read", projectId=last_id, fileId=last_id)["uid"], entry["uid"])
        for method, params in (("projects.create", {"name": "overflow"}),
                               ("files.mkdir", {"projectId": last_id, "name": "overflow-dir"}),
                               ("files.create", {"projectId": last_id, "name": "overflow.txt", "contentBase64": encoded(b"no")})):
            response = client.call(method, **params)
            self.assertEqual(response.get("error", {}).get("code"), "IDENTITY_EXHAUSTED", response)
        self.assertEqual([row["id"] for row in client.result("projects.list")], [last_id])
        self.assertEqual([row["id"] for row in client.result("files.list", projectId=last_id)], [last_id])
        directory = self.output / "storage" / "projects" / str(last_id)
        self.assertEqual(sorted(path.name for path in directory.iterdir()), ["last.txt"])
        self.assertEqual((directory / "last.txt").read_bytes(), b"last")
        client.close()
        with sqlite3.connect(self.output / "local.sqlite") as db:
            self.assertEqual(db.execute("SELECT name,seq FROM sqlite_sequence WHERE name IN ('projects','files') ORDER BY name").fetchall(),
                             [("files", last_id), ("projects", last_id)])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 0)

    def test_output_staging_and_home_cannot_overlap_source_tree(self):
        cases = [
            ("nested-output", "source", "source/clone", "SOURCE_OVERLAP"),
            ("unused-source", "source", "unimported/clone", "SOURCE_OVERLAP"),
            ("case-alias", "CaseSource", "casesource/clone", "SOURCE_OVERLAP"),
            ("home-is-source", "home", "clone", "SOURCE_OVERLAP"),
            ("home-contains-source", "home/project", "clone", "SOURCE_OVERLAP"),
            ("staging-is-source", "clone.staging", "clone", "CONFLICT"),
            ("staging-contains-source", "clone.staging/project", "clone", "CONFLICT"),
            ("output-contains-source", "clone/project", "clone", "CONFLICT"),
        ]
        for label, source_name, output_name, expected in cases:
            with self.subTest(case=label):
                case = self.directory / label
                source = case / source_name
                source.mkdir(parents=True)
                (source / "a.txt").write_bytes(b"alpha")
                write_snapshot(self.snapshot, [project_row(1, "uid-p1", "项目", local_root=str(source))],
                               [file_row(11, "uid-f11", 1, 0, False, "a.txt", "projects/1/a.txt", 5)])
                mapped = {1: source}
                if label == "unused-source":
                    extra = case / "unimported"
                    extra.mkdir()
                    mapped[99] = extra
                if label == "case-alias" and not (case / "casesource").exists():
                    self.skipTest("Case aliases require a case-insensitive filesystem")
                self.write_roots(mapped)
                def tree():
                    return sorted((str(path.relative_to(case)), "dir" if path.is_dir()
                                   else hashlib.sha256(path.read_bytes()).hexdigest())
                                  for path in case.rglob("*"))
                before = tree()
                code, result = self.run_tool(output=case / output_name)
                self.assertEqual(code, 1, result)
                self.assertEqual(result["error"]["code"], expected, result)
                self.assertEqual(tree(), before, "rejection must not modify the source or create helper paths")

    def test_abnormal_swift_exit_does_not_publish(self):
        self.rejection_fixture()
        wrapper = self.directory / "exits-after-real-server"
        wrapper.write_text(f"#!{sys.executable}\nimport subprocess,sys\n"
                           f"subprocess.run([{str(BINARY)!r}, *sys.argv[1:]], check=True)\n"
                           "sys.exit(67)\n")
        wrapper.chmod(0o700)
        code, result = self.run_tool(binary=wrapper)
        self.assertEqual(code, 1, result)
        self.assertEqual(result["error"]["code"], "VERIFY_MISMATCH", result)
        self.assertIn("67", result["error"]["message"])
        self.assertFalse(self.output.exists())
        self.assertTrue(Path(str(self.output) + ".staging").is_dir())

    def test_missing_source_root_and_local_root_mismatch_rejected(self):
        src, _ = self.rejection_fixture()
        self.write_roots({})
        self.assertRejected("NO_SOURCE_ROOT")
        self.write_roots({1: self.directory / "elsewhere"})
        (self.directory / "elsewhere").mkdir()
        self.assertRejected("SOURCE_ROOT_MISMATCH")

    def test_missing_source_file_rejected(self):
        src, _ = self.rejection_fixture()
        (src / "dir" / "b.txt").unlink()
        self.assertRejected("NOT_FOUND")
        self.assertFalse(self.output.exists())
        staging = Path(str(self.output) + ".staging")
        self.assertTrue(staging.exists(), "failed imports keep the staging directory for inspection")
        failure = json.loads((staging / "migration-failure-report.json").read_text())
        self.assertEqual(failure["error"]["code"], "NOT_FOUND")

    def test_size_mismatch_rejected(self):
        self.rejection_fixture(mutate_files=lambda rows: [
            file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt", 999)])
        self.assertRejected("SIZE_MISMATCH")

    def test_source_symlink_rejected(self):
        src, _ = self.rejection_fixture()
        target = src / "a.txt"
        target.unlink()
        target.symlink_to(src / "dir" / "b.txt")
        self.assertRejected("UNSAFE_PATH")
        self.assertEqual((src / "dir" / "b.txt").read_bytes(), b"beta", "symlink target must stay untouched")
        # intermediate directory symlink is rejected at the same per-level check
        shutil.rmtree(str(self.output) + ".staging")  # retained failure staging from scenario one
        src2, _ = self.rejection_fixture()
        real = src2 / "dir"
        moved = src2 / "real-dir"
        real.rename(moved)
        real.symlink_to(moved, target_is_directory=True)
        self.assertRejected("UNSAFE_PATH")

    def test_hardlink_source_rejected(self):
        src, _ = self.rejection_fixture()
        os.link(src / "a.txt", self.directory / "a-link.txt")
        self.assertRejected("UNSAFE_PATH")

    def test_oversize_source_rejected(self):
        src, tree = self.rejection_fixture()
        big = src / "a.txt"
        big.write_bytes(b"\0" * (32 * 1024 * 1024 + 1))
        write_snapshot(self.snapshot,
                       [project_row(1, "uid-p1", "项目一", local_root=str(src))],
                       [file_row(11, "uid-f11", 1, 0, True, "dir", "projects/1/dir", 0),
                        file_row(12, "uid-f12", 1, 0, False, "a.txt", "projects/1/a.txt",
                                 big.stat().st_size),
                        file_row(13, "uid-f13", 1, 11, False, "b.txt", "projects/1/dir/b.txt",
                                 len(tree["dir/b.txt"]))])
        self.assertRejected("UNSUPPORTED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    BINARY = args.binary.resolve()
    CLONE = (Path(__file__).resolve().parent / "clone_snapshot.py")
    OUTPUT = args.output.resolve()
    OUTPUT.mkdir(parents=True, exist_ok=False)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(CloneTests)
    with (OUTPUT / "tests.log").open("w") as log:
        result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
    print((OUTPUT / "tests.log").read_text(), end="")
    (OUTPUT / "summary.json").write_text(json.dumps({
        "tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
        "passed": result.wasSuccessful(),
        "binarySha256": hashlib.sha256(BINARY.read_bytes()).hexdigest(),
        "scope": "isolated offline snapshot-clone tests with real Swift subprocesses; synthetic data only"},
        ensure_ascii=False, indent=2) + "\n")
    raise SystemExit(0 if result.wasSuccessful() else 1)
