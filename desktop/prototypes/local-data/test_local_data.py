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


LEGACY_SCHEMA = """
CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE files(id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, project_id INTEGER NOT NULL REFERENCES projects(id), name TEXT NOT NULL, size INTEGER NOT NULL, generation TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(project_id,name));
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE pending(file_id INTEGER PRIMARY KEY REFERENCES files(id), stage TEXT NOT NULL, expected TEXT, generation TEXT NOT NULL, size INTEGER NOT NULL, updated_at TEXT NOT NULL);
"""
TREE_SCHEMA = LEGACY_SCHEMA.replace("name TEXT NOT NULL, size INTEGER", "parent_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, kind INTEGER NOT NULL DEFAULT 0, size INTEGER").replace("UNIQUE(project_id,name)", "UNIQUE(project_id,parent_id,name)")


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

    def seed_acl(self, selected=1):
        """Offline fixture; add columns for the frozen v2 binary's negative control too."""
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT,role TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS profile_identity(id INTEGER PRIMARY KEY CHECK(id=1),selected_user_id INTEGER NOT NULL REFERENCES users(id))")
            db.execute("CREATE TABLE IF NOT EXISTS project_members(project_id INTEGER REFERENCES projects(id),user_id INTEGER REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(project_id,user_id))")
            for table, column, declaration in (
                ("projects", "user_id", "INTEGER REFERENCES users(id)"),
                ("projects", "project_type", "TEXT NOT NULL DEFAULT 'BLANK'"),
                ("files", "user_id", "INTEGER REFERENCES users(id)"),
                ("files", "client_visible", "INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1))"),
            ):
                if column not in {row[1] for row in db.execute(f"PRAGMA table_info({table})")}:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")
            db.executemany("INSERT OR IGNORE INTO users VALUES(?,?,?,?)", [
                (1, "local", "本机用户", "USER"), (2, "other", "其他所有者", "USER"),
                (3, "reader", "只读成员", "USER"), (4, "customer", "全局客户", "CLIENT"),
                (5, "administrator", "项目管理员", "USER"), (6, "participant", "参与人", "USER"),
                (7, "named", "具名客户", "USER"), (8, "generic", "通用客户", "USER"),
                (9, "outsider", "无权限用户", "USER")])
            db.execute("UPDATE projects SET user_id=1 WHERE user_id IS NULL")
            db.execute("UPDATE files SET user_id=1 WHERE user_id IS NULL")
            db.execute("INSERT OR REPLACE INTO profile_identity VALUES(1,?)", (selected,))
            db.executemany("INSERT OR REPLACE INTO project_members VALUES(?,?,?)", [
                (self.project["id"], user, role) for user, role in
                ((3, "READ_ONLY"), (4, "ADMIN"), (5, "ADMIN"), (6, "PARTICIPANT"), (7, "CLIENT_NAMED"), (8, "CLIENT_GENERIC"))])

    def select_offline(self, user):
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("UPDATE profile_identity SET selected_user_id=? WHERE id=1", (user,))
        self.client = self.start()

    def assert_explorer_write_denied(self):
        for method, params in (
            ("files.save", dict(fileId=self.file["id"], expectedGeneration=self.file["generation"], contentBase64=encoded(b"forbidden"))),
            ("files.create", dict(name="forbidden.txt", contentBase64=encoded(b"forbidden"))),
            ("files.mkdir", dict(name="forbidden-directory")),
        ):
            self.assertError(self.client.call(method, projectId=self.project["id"], userId=1, **params), "ACCESS_DENIED")
        self.assertEqual(self.path.read_bytes(), self.original)
        self.assertFalse((self.path.parent / "forbidden.txt").exists())
        self.assertFalse((self.path.parent / "forbidden-directory").exists())

    def test_acl_fresh_profile_has_colocated_identity_and_owners(self):
        self.assertEqual(self.client.result("identity.status"), {"localMode": True, "userId": 1, "needsSelection": False})
        self.assertEqual(self.client.result("health")["identityStatus"]["userId"], 1)
        self.assertTrue(self.project["canWrite"])
        self.assertTrue(self.project["canBrowseFiles"])
        self.assertTrue(self.file["canWrite"])
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 3)
            self.assertEqual(db.execute("SELECT * FROM users").fetchall(), [(1, "local", "本机用户", "USER")])
            self.assertEqual(db.execute("SELECT user_id,project_type FROM projects").fetchall(), [(1, "BLANK")])
            self.assertEqual(db.execute("SELECT user_id,client_visible FROM files").fetchall(), [(1, 0)])

    def test_acl_projects_filter_membership_type_and_ignore_forged_subject(self):
        foreign = self.client.result("projects.create", name="另一人的秘密项目")
        loose = self.client.result("projects.create", name="不进入列表的独立文件")
        self.seed_acl(3)
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("UPDATE projects SET user_id=2 WHERE id=?", (foreign["id"],))
            db.execute("UPDATE projects SET project_type='LOOSE_FILES' WHERE id=?", (loose["id"],))
            db.execute("UPDATE projects SET project_type='LITIGATION' WHERE id=?", (self.project["id"],))
        self.client = self.start()
        cards = self.client.result("projects.list", userId=1)
        self.assertEqual([row["id"] for row in cards], [self.project["id"]])
        self.assertEqual((cards[0]["myRole"], cards[0]["projectType"], cards[0]["canWrite"]), ("READ_ONLY", "LITIGATION", False))
        self.assertError(self.client.call("projects.get", projectId=foreign["id"], userId=2), "ACCESS_DENIED")
        self.assertError(self.client.call("files.read", projectId=foreign["id"], fileId=self.file["id"], userId=2), "ACCESS_DENIED")
        self.select_offline(1)
        self.assertEqual([row["id"] for row in self.client.result("projects.list")], [self.project["id"]])
        self.assertEqual(self.client.result("projects.get", projectId=loose["id"])["projectType"], "LOOSE_FILES")

    def test_acl_read_only_member_can_read_but_cannot_write(self):
        self.seed_acl(3)
        self.client = self.start()
        self.assert_explorer_write_denied()
        self.assertFalse(self.read()["canWrite"])
        self.assertTrue(self.client.result("projects.get", projectId=self.project["id"])["canBrowseFiles"])
        self.assertEqual(base64.b64decode(self.read()["contentBase64"]), self.original)
        self.assertFalse(self.client.result("files.list", projectId=self.project["id"])[0]["canWrite"])

    def test_acl_revocation_after_read_blocks_save_without_mutating_bytes(self):
        self.seed_acl(5)
        self.client = self.start()
        current = self.read()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("DELETE FROM project_members WHERE project_id=? AND user_id=5", (self.project["id"],))
        self.assertError(self.save(b"revoked write", generation=current["generation"]), "ACCESS_DENIED")
        self.assertError(self.client.call("files.read", projectId=self.project["id"], fileId=self.file["id"]), "ACCESS_DENIED")
        self.assertEqual(self.client.result("projects.list"), [])
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_acl_owner_admin_participant_write_and_new_rows_belong_to_subject(self):
        self.seed_acl()
        for user, role in ((1, "OWNER"), (5, "ADMIN"), (6, "PARTICIPANT")):
            self.select_offline(user)
            card = self.client.result("projects.get", projectId=self.project["id"])
            self.assertEqual((card["myRole"], card["canWrite"]), (role, True))
            before = self.read()
            self.client.result("files.save", projectId=self.project["id"], fileId=self.file["id"],
                               expectedGeneration=before["generation"], contentBase64=encoded(self.original))
            folder = self.mkdir(f"member-{user}")
            created = self.client.result("files.create", projectId=self.project["id"], parentId=folder["id"],
                                         name="owned.txt", userId=2, contentBase64=encoded(b"owned"))
            project = self.client.result("projects.create", name=f"new-{user}", userId=2)
            self.assertTrue(created["canWrite"])
            self.client.close()
            with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
                self.assertEqual(db.execute("SELECT user_id FROM files WHERE id IN (?,?) ORDER BY id", (folder["id"], created["id"])).fetchall(), [(user,), (user,)])
                self.assertEqual(db.execute("SELECT user_id FROM projects WHERE id=?", (project["id"],)).fetchone(), (user,))

    def test_acl_owner_beats_customer_membership_but_global_client_does_not(self):
        self.seed_acl()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("INSERT INTO project_members VALUES(?,1,'CLIENT_NAMED')", (self.project["id"],))
        self.client = self.start()
        self.assertTrue(self.client.result("projects.get", projectId=self.project["id"])["canWrite"])
        self.assertEqual(len(self.client.result("files.list", projectId=self.project["id"])), 1)
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("UPDATE users SET role='cLiEnT' WHERE id=1")
        self.client = self.start()
        self.assertFalse(self.client.result("projects.get", projectId=self.project["id"])["canWrite"])
        self.assertFalse(self.client.result("projects.get", projectId=self.project["id"])["canBrowseFiles"])
        self.assertFalse(self.read()["canWrite"])
        self.assertError(self.client.call("files.list", projectId=self.project["id"]), "ACCESS_DENIED")
        self.assertError(self.client.call("projects.create", name="forbidden"), "ACCESS_DENIED")
        self.assert_explorer_write_denied()

    def test_acl_customers_can_only_read_owned_or_shared_files_without_paths(self):
        folder = self.mkdir("hidden-parent-sensitive")
        visible = self.client.result("files.create", projectId=self.project["id"], parentId=folder["id"], name="shared.txt", contentBase64=encoded(b"shared"))
        own = self.client.result("files.create", projectId=self.project["id"], parentId=folder["id"], name="mine.txt", contentBase64=encoded(b"mine"))
        self.seed_acl()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("UPDATE files SET client_visible=1 WHERE id=?", (visible["id"],))
        for user in (4, 7, 8):
            self.client.close()
            with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
                db.execute("UPDATE files SET user_id=? WHERE id=?", (user, own["id"]))
            self.select_offline(user)
            self.assertFalse(self.client.result("projects.get", projectId=self.project["id"])["canBrowseFiles"])
            self.assertError(self.client.call("files.list", projectId=self.project["id"]), "ACCESS_DENIED")
            for target, content in ((visible, b"shared"), (own, b"mine")):
                row = self.client.result("files.read", projectId=self.project["id"], fileId=target["id"])
                self.assertEqual(base64.b64decode(row["contentBase64"]), content)
                self.assertFalse(row["canWrite"])
                for private_key in ("filePath", "physicalPath", "parentId"):
                    self.assertNotIn(private_key, row)
                self.assertNotIn("hidden-parent-sensitive", json.dumps(row))
            denied = self.client.call("files.read", projectId=self.project["id"], fileId=self.file["id"], userId=1)
            self.assertError(denied, "NOT_FOUND")
            self.assertNotIn(self.file["name"], json.dumps(denied))
            self.assert_explorer_write_denied()
        self.select_offline(9)
        self.assertEqual(self.client.result("projects.list"), [])
        self.assertError(self.client.call("files.read", projectId=self.project["id"], fileId=visible["id"]), "ACCESS_DENIED")

    def test_acl_missing_or_dangling_selected_identity_blocks_all_business(self):
        self.seed_acl()
        for operation in ("DELETE FROM profile_identity", "INSERT OR REPLACE INTO profile_identity VALUES(1,999)"):
            self.client.close()
            with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
                db.execute(operation)
            self.client = self.start()
            self.assertEqual(self.client.result("identity.status", userId=1), {"localMode": True, "userId": None, "needsSelection": True})
            self.assertTrue(self.client.result("health")["identityStatus"]["needsSelection"])
            for method, params in (("projects.list", {}), ("projects.create", {"name": "no identity"}),
                                   ("files.read", {"projectId": self.project["id"], "fileId": self.file["id"]}),
                                   ("settings.set", {"key": "local.ui.theme", "value": "x"})):
                self.assertError(self.client.call(method, userId=1, **params), "IDENTITY_REQUIRED")
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_acl_missing_project_owner_fails_closed_even_for_member(self):
        self.seed_acl(5)
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("UPDATE projects SET user_id=NULL WHERE id=?", (self.project["id"],))
        self.client = self.start()
        self.assertEqual(self.client.result("projects.list"), [])
        self.assertError(self.client.call("projects.get", projectId=self.project["id"]), "ACCESS_DENIED")
        self.assertError(self.client.call("files.read", projectId=self.project["id"], fileId=self.file["id"]), "ACCESS_DENIED")
        self.assert_explorer_write_denied()

    def test_acl_unknown_or_null_global_role_requires_identity_without_writes(self):
        self.seed_acl()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            # Model a corrupt/future schema that no longer enforces the role's NOT NULL.
            db.execute("CREATE TABLE users_nullable(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT,role TEXT)")
            db.execute("INSERT INTO users_nullable SELECT * FROM users")
            db.execute("DROP TABLE users")
            db.execute("ALTER TABLE users_nullable RENAME TO users")
        for role in ("FUTURE_ROLE", "", None):
            self.client.close()
            with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
                db.execute("UPDATE users SET role=? WHERE id=1", (role,))
            self.client = self.start()
            self.assertTrue(self.client.result("identity.status")["needsSelection"])
            for method, params in (("projects.list", {}), ("projects.create", {"name": "invalid role"}),
                                   ("files.save", {"projectId": self.project["id"], "fileId": self.file["id"],
                                                   "expectedGeneration": self.file["generation"], "contentBase64": encoded(b"bad")})):
                self.assertError(self.client.call(method, **params), "IDENTITY_REQUIRED")
            self.assertEqual(self.path.read_bytes(), self.original)

    def test_acl_unknown_or_forged_owner_membership_cannot_grant_access(self):
        self.seed_acl(5)
        for role in ("OWNER", "FUTURE_ROLE", "", "admin"):
            self.client.close()
            with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
                db.execute("UPDATE project_members SET role=? WHERE project_id=? AND user_id=5", (role, self.project["id"]))
            self.client = self.start()
            self.assertError(self.client.call("projects.list"), "ACCESS_DENIED")
            self.assertError(self.client.call("projects.get", projectId=self.project["id"]), "ACCESS_DENIED")
            self.assertError(self.client.call("files.read", projectId=self.project["id"], fileId=self.file["id"]), "ACCESS_DENIED")
            self.assert_explorer_write_denied()

    def test_acl_recovery_finishes_previous_commit_without_current_identity(self):
        self.client.close()
        crashing = self.start("afterJournal")
        crashing.send("files.save", projectId=self.project["id"], fileId=self.file["id"], expectedGeneration=self.file["generation"], contentBase64=encoded(b"journaled by previous identity"))
        self.assertEqual(crashing.process.wait(timeout=10), 77)
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("DELETE FROM profile_identity")
        self.client = self.start()
        self.assertTrue(self.client.result("health")["ready"])
        self.assertError(self.client.call("files.read", projectId=self.project["id"], fileId=self.file["id"]), "IDENTITY_REQUIRED")
        self.assertEqual(self.path.read_bytes(), b"journaled by previous identity")
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 0)

    def v2_profile(self, name):
        profile = self.directory / name
        folder = profile / "storage" / "projects" / "7"
        folder.mkdir(parents=True)
        (profile / ".awd-local-data-prototype").write_text("isolated-native-data-prototype-v1\n")
        (folder / "old.txt").write_bytes(b"v2 original")
        with sqlite3.connect(profile / "local.sqlite") as db:
            db.executescript(TREE_SCHEMA)
            db.execute("INSERT INTO projects VALUES(7,'p7','v2','t','t')")
            db.execute("INSERT INTO files VALUES(42,'f42',7,0,'old.txt',0,11,?,1,'t')", (hashlib.sha256(b"v2 original").hexdigest(),))
            db.execute("PRAGMA user_version=2")
        return profile

    def test_acl_v2_synthetic_upgrade_preserves_data_and_sets_single_owner(self):
        profile = self.v2_profile("v2-synthetic")
        migrated = Client(BINARY, profile)
        self.clients.append(migrated)
        self.assertEqual(migrated.result("identity.status")["userId"], 1)
        self.assertTrue(migrated.result("projects.get", projectId=7)["canWrite"])
        self.assertEqual(base64.b64decode(migrated.result("files.read", projectId=7, fileId=42)["contentBase64"]), b"v2 original")
        migrated.close()
        with sqlite3.connect(profile / "local.sqlite") as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 3)
            self.assertEqual(db.execute("SELECT user_id FROM projects").fetchall(), [(1,)])
            self.assertEqual(db.execute("SELECT user_id,client_visible FROM files").fetchall(), [(1, 0)])
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_acl_v2_archive_requires_reimport_without_changing_database(self):
        profile = self.v2_profile("v2-imported")
        with sqlite3.connect(profile / "local.sqlite") as db:
            db.execute("CREATE TABLE migration_archive(name TEXT,original TEXT)")
        before = (profile / "local.sqlite").read_bytes()
        rejected = Client(BINARY, profile)
        self.clients.append(rejected)
        self.assertError(rejected.receive(), "NEEDS_REIMPORT")
        rejected.close()
        self.assertEqual((profile / "local.sqlite").read_bytes(), before)
        self.assertEqual((profile / "storage/projects/7/old.txt").read_bytes(), b"v2 original")

    def test_acl_v2_migration_failure_rolls_back_identity_and_columns(self):
        profile = self.v2_profile("v2-invalid-references")
        with sqlite3.connect(profile / "local.sqlite") as db:
            db.execute("UPDATE files SET project_id=999")
        rejected = Client(BINARY, profile)
        self.clients.append(rejected)
        self.assertError(rejected.receive(), "MIGRATION_CONFLICT")
        rejected.close()
        with sqlite3.connect(profile / "local.sqlite") as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 2)
            self.assertNotIn("user_id", {row[1] for row in db.execute("PRAGMA table_info(projects)")})
            self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE name IN ('users','profile_identity','project_members')").fetchall(), [])
            self.assertEqual(db.execute("SELECT project_id FROM files").fetchall(), [(999,)])
        self.assertEqual((profile / "storage/projects/7/old.txt").read_bytes(), b"v2 original")

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

    def prepare_last_identity(self, table):
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("UPDATE sqlite_sequence SET seq=? WHERE name=?", (9007199254740990, table))
        self.client = self.start()

    def assert_last_safe_sequence(self, table):
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            self.assertEqual(db.execute("SELECT seq FROM sqlite_sequence WHERE name=?", (table,)).fetchone()[0],
                             9007199254740991, "failed allocation must roll back the sequence")

    def test_project_creation_stops_at_safe_id_without_leftovers(self):
        self.prepare_last_identity("projects")
        last = self.client.result("projects.create", name="最后可用编号")
        self.assertEqual(last["id"], 9007199254740991)
        self.assertEqual(self.client.result("projects.get", projectId=last["id"])["uid"], last["uid"])
        parent = self.directory / "profile" / "storage" / "projects"
        before = sorted(path.name for path in parent.iterdir())
        for _ in range(2):
            self.assertError(self.client.call("projects.create", name="不能溢出"), "IDENTITY_EXHAUSTED")
        self.assertEqual(sorted(path.name for path in parent.iterdir()), before)
        self.assertEqual([row["id"] for row in self.client.result("projects.list")],
                         [self.project["id"], 9007199254740991])
        self.assert_last_safe_sequence("projects")

    def test_file_creation_stops_at_safe_id_without_leftovers(self):
        self.prepare_last_identity("files")
        last = self.client.result("files.create", projectId=self.project["id"], name="last.txt", contentBase64=encoded(b"last"))
        self.assertEqual(last["id"], 9007199254740991)
        self.assertEqual(base64.b64decode(self.client.result("files.read", projectId=self.project["id"], fileId=last["id"])["contentBase64"]), b"last")
        before = sorted(path.name for path in self.project_storage().iterdir())
        for _ in range(2):
            self.assertError(self.client.call("files.create", projectId=self.project["id"], name="overflow.txt",
                                             contentBase64=encoded(b"must not appear")), "IDENTITY_EXHAUSTED")
        self.assertEqual(sorted(path.name for path in self.project_storage().iterdir()), before)
        self.assertEqual([row["id"] for row in self.client.result("files.list", projectId=self.project["id"])],
                         [self.file["id"], 9007199254740991])
        self.assert_last_safe_sequence("files")
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM files WHERE live=0").fetchone()[0], 0)

    def test_directory_creation_stops_at_safe_id_without_leftovers(self):
        self.prepare_last_identity("files")
        last = self.client.result("files.mkdir", projectId=self.project["id"], name="last-dir")
        self.assertEqual(last["id"], 9007199254740991)
        before = sorted(path.name for path in self.project_storage().iterdir())
        for _ in range(2):
            self.assertError(self.client.call("files.mkdir", projectId=self.project["id"], name="overflow-dir"), "IDENTITY_EXHAUSTED")
        self.assertEqual(sorted(path.name for path in self.project_storage().iterdir()), before)
        self.assertEqual([row["id"] for row in self.client.result("files.list", projectId=self.project["id"])],
                         [self.file["id"], 9007199254740991])
        self.assert_last_safe_sequence("files")

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

    def mkdir(self, name, parent=None, project=None, client=None):
        params = {"projectId": (project or self.project)["id"], "name": name}
        if parent:
            params["parentId"] = parent["id"]
        return (client or self.client).result("files.mkdir", **params)

    def project_storage(self, project=None):
        return self.directory / "profile" / "storage" / "projects" / str((project or self.project)["id"])

    def test_nested_tree_create_list_read_save_reopen(self):
        docs = self.mkdir("文档")
        nested = self.mkdir("2026", parent=docs)
        self.assertTrue(docs["isFolder"])
        self.assertIsNone(docs["parentId"])
        self.assertEqual(nested["parentId"], docs["id"])
        content = docx("嵌套目录中的文件")
        created = self.client.result("files.create", projectId=self.project["id"], parentId=nested["id"],
                                     name="报告.docx", contentBase64=encoded(content))
        self.assertEqual(created["parentId"], nested["id"])
        self.assertFalse(created["isFolder"])
        self.assertEqual(created["filePath"], f"projects/{self.project['id']}/文档/2026/报告.docx")
        disk = self.project_storage() / "文档" / "2026" / "报告.docx"
        self.assertEqual(disk.read_bytes(), content)
        listing = {row["id"]: row for row in self.client.result("files.list", projectId=self.project["id"])}
        self.assertEqual(listing[docs["id"]]["filePath"], f"projects/{self.project['id']}/文档")
        self.assertEqual(listing[nested["id"]]["parentId"], docs["id"])
        self.assertEqual(listing[self.file["id"]]["filePath"], f"projects/{self.project['id']}/{self.file['name']}")
        self.client.close()
        reopened = self.start()
        relisting = {row["id"]: row for row in reopened.result("files.list", projectId=self.project["id"])}
        self.assertEqual(relisting[docs["id"]]["uid"], docs["uid"])
        self.assertEqual(relisting[nested["id"]]["uid"], nested["uid"])
        reread = reopened.result("files.read", projectId=self.project["id"], fileId=created["id"])
        self.assertEqual(reread["uid"], created["uid"])
        self.assertEqual(base64.b64decode(reread["contentBase64"]), content)
        self.assertEqual(reread["physicalPath"], str(disk))
        revised = docx("嵌套修订保留原位置")
        saved = reopened.result("files.save", projectId=self.project["id"], fileId=created["id"],
                                expectedGeneration=reread["generation"], contentBase64=encoded(revised))
        self.assertEqual(saved["id"], created["id"])
        self.assertEqual(saved["uid"], created["uid"])
        self.assertEqual(saved["filePath"], created["filePath"])
        self.assertEqual(disk.read_bytes(), revised)
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_same_name_allowed_across_directories_not_within(self):
        first = self.mkdir("甲目录")
        second = self.mkdir("乙目录")
        root_copy = self.client.result("files.create", projectId=self.project["id"], name="同名.txt",
                                       contentBase64=encoded(b"root copy"))
        in_first = self.client.result("files.create", projectId=self.project["id"], parentId=first["id"],
                                      name="同名.txt", contentBase64=encoded(b"first copy"))
        in_second = self.client.result("files.create", projectId=self.project["id"], parentId=second["id"],
                                       name="同名.txt", contentBase64=encoded(b"second copy"))
        self.assertNotEqual(in_first["uid"], in_second["uid"])
        self.assertError(self.client.call("files.create", projectId=self.project["id"], parentId=first["id"],
                                          name="同名.txt", contentBase64=encoded(b"dup")), "CONFLICT")
        self.assertError(self.client.call("files.mkdir", projectId=self.project["id"], parentId=first["id"],
                                          name="同名.txt"), "CONFLICT")
        base = self.project_storage()
        self.assertEqual((base / "同名.txt").read_bytes(), b"root copy")
        self.assertEqual((base / "甲目录" / "同名.txt").read_bytes(), b"first copy")
        self.assertEqual((base / "乙目录" / "同名.txt").read_bytes(), b"second copy")
        self.assertEqual(root_copy["filePath"], f"projects/{self.project['id']}/同名.txt")

    def test_cross_project_parent_id_rejected_without_writes(self):
        other = self.client.result("projects.create", name="其他项目")
        foreign = self.mkdir("外部目录", project=other)
        self.assertError(self.client.call("files.mkdir", projectId=self.project["id"], parentId=foreign["id"],
                                          name="逃逸目录"), "NOT_FOUND")
        self.assertError(self.client.call("files.create", projectId=self.project["id"], parentId=foreign["id"],
                                          name="逃逸.txt", contentBase64=encoded(b"bad")), "NOT_FOUND")
        self.assertEqual([p.name for p in (self.project_storage(other) / "外部目录").iterdir()], [])
        self.assertEqual([row["name"] for row in self.client.result("files.list", projectId=self.project["id"])],
                         [self.file["name"]])

    def test_directory_read_and_save_rejected(self):
        folder = self.mkdir("目录")
        self.assertError(self.client.call("files.read", projectId=self.project["id"], fileId=folder["id"]), "IS_DIRECTORY")
        self.assertError(self.client.call("files.save", projectId=self.project["id"], fileId=folder["id"],
                                          expectedGeneration="", contentBase64=encoded(b"bad")), "IS_DIRECTORY")
        self.assertTrue((self.project_storage() / "目录").is_dir())

    def test_duplicate_mkdir_and_disk_conflict_leave_no_phantom(self):
        folder = self.mkdir("唯一目录")
        self.assertError(self.client.call("files.mkdir", projectId=self.project["id"], name="唯一目录"), "CONFLICT")
        unindexed = self.project_storage() / "未索引目录"
        unindexed.mkdir()
        self.assertError(self.client.call("files.mkdir", projectId=self.project["id"], name="未索引目录"), "CONFLICT")
        self.assertEqual(list(unindexed.iterdir()), [])
        names = [row["name"] for row in self.client.result("files.list", projectId=self.project["id"])
                 if row["name"] in ("唯一目录", "未索引目录")]
        self.assertEqual(names, ["唯一目录"])
        self.assertEqual(folder["isFolder"], True)

    def test_nested_symlink_escape_rejected_at_every_level(self):
        folder = self.mkdir("真实目录")
        inner = self.client.result("files.create", projectId=self.project["id"], parentId=folder["id"],
                                   name="内部.txt", contentBase64=encoded(b"inside"))
        base = self.project_storage()
        real = base / "真实目录"
        moved = base / "moved-real"
        real.rename(moved)
        outside = self.directory / "escape-target"
        outside.mkdir()
        real.symlink_to(outside, target_is_directory=True)
        for response in (
            self.client.call("files.read", projectId=self.project["id"], fileId=inner["id"]),
            self.client.call("files.save", projectId=self.project["id"], fileId=inner["id"],
                             expectedGeneration=inner["generation"], contentBase64=encoded(b"bad")),
            self.client.call("files.mkdir", projectId=self.project["id"], parentId=folder["id"], name="新目录"),
            self.client.call("files.create", projectId=self.project["id"], parentId=folder["id"],
                             name="新文件.txt", contentBase64=encoded(b"bad")),
        ):
            self.assertError(response, "UNSAFE_PATH")
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual((moved / "内部.txt").read_bytes(), b"inside")
        names = [row["name"] for row in self.client.result("files.list", projectId=self.project["id"])]
        self.assertNotIn("新目录", names)
        self.assertNotIn("新文件.txt", names)

    def test_parent_cycle_rejected(self):
        first = self.mkdir("甲")
        second = self.mkdir("乙", parent=first)
        trapped = self.client.result("files.create", projectId=self.project["id"], parentId=second["id"],
                                     name="循环.txt", contentBase64=encoded(b"cycle"))
        self.client.close()
        db = sqlite3.connect(self.directory / "profile" / "local.sqlite")
        db.execute("UPDATE files SET parent_id=? WHERE id=?", (second["id"], first["id"]))
        db.commit()
        db.close()
        reopened = self.start()
        self.assertTrue(reopened.result("health")["ready"])
        self.assertError(reopened.call("files.read", projectId=self.project["id"], fileId=trapped["id"]), "CYCLE_DETECTED")
        self.assertError(reopened.call("files.create", projectId=self.project["id"], parentId=second["id"],
                                       name="新.txt", contentBase64=encoded(b"bad")), "CYCLE_DETECTED")
        self.assertEqual((self.project_storage() / "甲" / "乙" / "循环.txt").read_bytes(), b"cycle")

    def test_newer_schema_is_not_downgraded(self):
        self.client.close()
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            db.execute("PRAGMA user_version=99")
        before = (self.directory / "profile" / "local.sqlite").read_bytes()
        rejected = self.start()
        self.assertError(rejected.receive(), "UNSUPPORTED_SCHEMA")
        rejected.close()
        self.assertEqual((self.directory / "profile" / "local.sqlite").read_bytes(), before)
        with sqlite3.connect(self.directory / "profile" / "local.sqlite") as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 99)
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_legacy_upgrade_preserves_and_recovers_pending_save(self):
        profile = self.directory / "legacy-pending"
        folder = profile / "storage" / "projects" / "7"
        folder.mkdir(parents=True)
        (profile / ".awd-local-data-prototype").write_text("isolated-native-data-prototype-v1\n")
        old, new = b"before crash", b"durable journal after upgrade"
        (folder / "old.txt").write_bytes(old)
        (folder / ".native-legacy-stage").write_bytes(new)
        with sqlite3.connect(profile / "local.sqlite") as db:
            db.executescript(LEGACY_SCHEMA)
            db.execute("INSERT INTO projects VALUES(7,'project-uid','old','t','t')")
            db.execute("INSERT INTO files VALUES(42,'file-uid',7,'old.txt',?,?,1,'t')",
                       (len(old), hashlib.sha256(old).hexdigest()))
            db.execute("INSERT INTO pending VALUES(42,'.native-legacy-stage',?,?,?,'t')",
                       (hashlib.sha256(old).hexdigest(), hashlib.sha256(new).hexdigest(), len(new)))
            # The sequence may exceed the greatest surviving row after deletion.
            db.execute("UPDATE sqlite_sequence SET seq=99 WHERE name='files'")
        migrated = Client(BINARY, profile)
        self.clients.append(migrated)
        self.assertTrue(migrated.result("health")["ready"])
        read = migrated.result("files.read", projectId=7, fileId=42)
        self.assertEqual(read["uid"], "file-uid")
        self.assertEqual(base64.b64decode(read["contentBase64"]), new)
        self.assertFalse((folder / ".native-legacy-stage").exists())
        created = migrated.result("files.mkdir", projectId=7, name="next")
        self.assertEqual(created["id"], 100)
        migrated.close()
        with sqlite3.connect(profile / "local.sqlite") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 0)
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 3)

    def test_legacy_flat_profile_upgrades_preserving_identity_and_bytes(self):
        profile = self.directory / "legacy-profile"
        (profile / "storage" / "projects" / "7").mkdir(parents=True)
        (profile / ".awd-local-data-prototype").write_text("isolated-native-data-prototype-v1\n")
        content = docx("旧样板升级前内容")
        (profile / "storage" / "projects" / "7" / "旧文档.docx").write_bytes(content)
        db = sqlite3.connect(profile / "local.sqlite")
        db.executescript(LEGACY_SCHEMA)
        timestamp = "2026-01-01T00:00:00Z"
        db.execute("INSERT INTO projects(id,uid,name,created_at,updated_at) VALUES(7,'legacy-project-uid','旧项目',?,?)",
                   (timestamp, timestamp))
        db.execute("INSERT INTO files(id,uid,project_id,name,size,generation,live,updated_at) VALUES(42,'legacy-file-uid',7,'旧文档.docx',?,?,1,?)",
                   (len(content), hashlib.sha256(content).hexdigest(), timestamp))
        db.commit()
        db.close()
        legacy = Client(BINARY, profile)
        self.clients.append(legacy)
        self.assertTrue(legacy.result("health")["ready"])
        read = legacy.result("files.read", projectId=7, fileId=42)
        self.assertEqual(read["id"], 42)
        self.assertEqual(read["uid"], "legacy-file-uid")
        self.assertIsNone(read["parentId"])
        self.assertFalse(read["isFolder"])
        self.assertEqual(read["filePath"], "projects/7/旧文档.docx")
        self.assertEqual(base64.b64decode(read["contentBase64"]), content)
        self.assertError(legacy.call("files.create", projectId=7, name="旧文档.docx",
                                     contentBase64=encoded(b"dup")), "CONFLICT")
        folder = legacy.result("files.mkdir", projectId=7, name="新目录")
        nested_copy = legacy.result("files.create", projectId=7, parentId=folder["id"], name="旧文档.docx",
                                    contentBase64=encoded(b"nested copy"))
        self.assertEqual(nested_copy["parentId"], folder["id"])
        self.assertEqual(nested_copy["filePath"], "projects/7/新目录/旧文档.docx")
        self.assertEqual((profile / "storage" / "projects" / "7" / "旧文档.docx").read_bytes(), content)
        self.assertEqual((profile / "storage" / "projects" / "7" / "新目录" / "旧文档.docx").read_bytes(), b"nested copy")
        legacy.close()
        db = sqlite3.connect(profile / "local.sqlite")
        self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 3)
        self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        row = db.execute("SELECT uid,parent_id,kind,size,generation FROM files WHERE id=42").fetchone()
        self.assertEqual(row, ("legacy-file-uid", 0, 0, len(content), hashlib.sha256(content).hexdigest()))
        db.close()
        upgraded = Client(BINARY, profile)
        self.clients.append(upgraded)
        reread = upgraded.result("files.read", projectId=7, fileId=42)
        self.assertEqual(base64.b64decode(reread["contentBase64"]), content)
        self.assertGreater(upgraded.result("files.create", projectId=7, name="升级后.txt",
                                           contentBase64=encoded(b"after upgrade"))["id"], 42)

    def test_empty_legacy_table_does_not_reuse_deleted_file_ids(self):
        profile = self.directory / "legacy-empty"
        (profile / "storage" / "projects" / "7").mkdir(parents=True)
        (profile / ".awd-local-data-prototype").write_text("isolated-native-data-prototype-v1\n")
        with sqlite3.connect(profile / "local.sqlite") as db:
            db.executescript(LEGACY_SCHEMA)
            db.execute("INSERT INTO projects VALUES(7,'project-uid','old','t','t')")
            db.execute("INSERT INTO files VALUES(99,'deleted-file-uid',7,'old.txt',0,'',1,'t')")
            db.execute("DELETE FROM files")
        migrated = Client(BINARY, profile)
        self.clients.append(migrated)
        self.assertTrue(migrated.result("health")["ready"])
        self.assertEqual(migrated.result("files.list", projectId=7), [])
        self.assertEqual(migrated.result("files.mkdir", projectId=7, name="next")["id"], 100)

    def nested_crash_and_restart(self, phase):
        folder = self.mkdir("崩溃目录")
        nested_file = self.client.result("files.create", projectId=self.project["id"], parentId=folder["id"],
                                         name="嵌套.docx", contentBase64=encoded(self.original))
        path = self.project_storage() / "崩溃目录" / "嵌套.docx"
        self.client.close()
        crashing = self.start(phase)
        self.assertTrue(crashing.result("health")["ready"])
        crashing.send("files.save", projectId=self.project["id"], fileId=nested_file["id"],
                      expectedGeneration=nested_file["generation"], contentBase64=encoded(b"nested durable replacement"))
        self.assertEqual(crashing.process.wait(timeout=10), 77)
        db = sqlite3.connect(self.directory / "profile" / "local.sqlite")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 1)
        db.close()
        self.assertEqual(path.read_bytes(), self.original if phase == "afterJournal" else b"nested durable replacement")
        reopened = self.start()
        self.assertTrue(reopened.result("health")["ready"])
        reread = reopened.result("files.read", projectId=self.project["id"], fileId=nested_file["id"])
        self.assertEqual(reread["uid"], nested_file["uid"])
        self.assertEqual(reread["filePath"], f"projects/{self.project['id']}/崩溃目录/嵌套.docx")
        self.assertEqual(base64.b64decode(reread["contentBase64"]), b"nested durable replacement")
        db = sqlite3.connect(self.directory / "profile" / "local.sqlite")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM pending").fetchone()[0], 0)
        self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        db.close()

    def test_nested_crash_after_journal_before_rename_recovers(self):
        self.nested_crash_and_restart("afterJournal")

    def test_nested_crash_after_rename_before_metadata_recovers(self):
        self.nested_crash_and_restart("afterRename")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--filter", default="", help="Run test methods containing this substring")
    args = parser.parse_args()
    BINARY = args.binary.resolve()
    OUTPUT = args.output.resolve()
    OUTPUT.mkdir(parents=True, exist_ok=False)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(LocalDataTests)
    if args.filter:
        suite = unittest.TestSuite(test for test in suite if args.filter in test.id())
    with (OUTPUT / "tests.log").open("w") as log:
        result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
    print((OUTPUT / "tests.log").read_text(), end="")
    (OUTPUT / "summary.json").write_text(json.dumps({"tests": result.testsRun, "failures": len(result.failures),
        "errors": len(result.errors), "passed": result.wasSuccessful(), "binarySha256": hashlib.sha256(BINARY.read_bytes()).hexdigest(),
        "scope": "isolated functional subprocess/SQLite/file tests; not a full-app benchmark"}, ensure_ascii=False, indent=2) + "\n")
    raise SystemExit(0 if result.wasSuccessful() else 1)
