#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Clone an H2 JSONL snapshot into an isolated Swift SQLite prototype profile.

This is an offline test-copy tool, not a production cutover:
  * it never opens H2, never touches the original sources, old Git data or any client;
  * every legacy row is archived verbatim into a migration_archive SQLite table;
  * the archive is not presented as a writable business table or feature parity;
  * the clone is built in a fresh sibling staging directory, independently
    re-read through the real Swift JSON-lines protocol, and only then
    atomically published to --output. Failures keep the staging directory
    plus a failure report and never expose a half-built output.

Usage:
  clone_snapshot.py --snapshot /abs/file.jsonl --project-roots /abs/map.json \
      --output /abs/new-profile --binary /abs/awd-local-data
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
import re
import secrets
import select
import sqlite3
import stat
import subprocess
import sys
import time

SNAPSHOT_FORMAT = "awd-h2-snapshot-v1"
MAX_FILE_SIZE = 32 * 1024 * 1024
CORE_PROJECT = "project"
CORE_FILE = "project_file"
# Actual H2 columns of backend/src/main/java/com/checkba/model/entity/Project.java
PROJECT_COLUMNS = {"id", "uid", "name", "project_type", "listed_company_name", "target_company_name",
                   "listed_company_info_json", "target_company_info_json", "user_id", "local_root",
                   "version_opt_out", "created_at", "updated_at"}
# Actual H2 columns of backend/src/main/java/com/checkba/model/entity/ProjectFile.java
FILE_COLUMNS = {"id", "uid", "project_id", "parent_id", "is_folder", "name", "file_type", "file_size",
                "file_path", "external_path", "wps_file_id", "sort_order", "user_id", "client_visible",
                "created_at", "updated_at", "is_deleted", "meta_json", "deleted_at"}
REQUIRED_PROJECT_COLUMNS = {"id", "uid", "name", "created_at", "updated_at", "local_root", "user_id"}
REQUIRED_FILE_COLUMNS = {"id", "uid", "project_id", "parent_id", "is_folder", "name", "file_path",
                         "file_size", "updated_at", "is_deleted", "external_path"}
SAFE_INT = 9007199254740991  # Swift integer() helper bound for JSON protocol IDs
UNAVAILABLE = ["git-versions", "ai", "cloud-acl", "watcher", "external-files", "h2-cutover",
               "project-acl-roles"]
INT_RE = re.compile(r"^[0-9]+$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


class CloneError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code, message):
    raise CloneError(code, message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


# ---------------------------------------------------------------- snapshot parsing

def _reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON object key: {key}")
        result[key] = value
    return result


def load_record(line, lineno):
    try:
        return json.loads(line, object_pairs_hook=_reject_duplicate_keys)
    except ValueError as exc:
        fail("SNAPSHOT_FORMAT", f"Line {lineno} is not a JSON object with unique keys: {exc}")


def parse_snapshot(path):
    header = None
    ddl_count = 0
    tables = {}
    identities = {}
    rows = []
    footer = None
    seen_table = False
    raw_records = []
    try:
        handle = open(path, "r", encoding="utf-8")
    except OSError as exc:
        fail("INVALID_ARGUMENT", f"Cannot read snapshot: {exc}")
    with handle:
        for lineno, line in enumerate(handle, 1):
            line = line.rstrip("\n").rstrip("\r")
            if not line.strip():
                fail("SNAPSHOT_FORMAT", f"Blank line {lineno} is not part of the snapshot format")
            record = load_record(line, lineno)
            if not isinstance(record, dict):
                fail("SNAPSHOT_FORMAT", f"Line {lineno} is not a JSON object")
            kind = record.get("kind")
            raw_records.append((kind, record.get("table"), line))
            if footer is not None:
                fail("SNAPSHOT_FORMAT", f"Content after the complete record (line {lineno})")
            if lineno == 1:
                if kind != "header":
                    fail("SNAPSHOT_FORMAT", "First record must be the header")
                if record.get("format") != SNAPSHOT_FORMAT:
                    fail("SNAPSHOT_FORMAT", f"Unsupported snapshot format: {record.get('format')!r}")
                if not isinstance(record.get("sourceSha256"), str) or not SHA_RE.match(record["sourceSha256"]):
                    fail("SNAPSHOT_FORMAT", "Header is missing a valid sourceSha256")
                if not isinstance(record.get("h2Version"), str) or not record["h2Version"]:
                    fail("SNAPSHOT_FORMAT", "Header is missing h2Version")
                header = record
                continue
            if header is None:
                fail("SNAPSHOT_FORMAT", "First record must be the header")
            if kind == "source-ddl":
                if seen_table:
                    fail("SNAPSHOT_FORMAT", "source-ddl after table declarations")
                if not isinstance(record.get("sql"), str):
                    fail("SNAPSHOT_FORMAT", "source-ddl is missing sql")
                ddl_count += 1
            elif kind == "table":
                # The exporter emits one table declaration immediately followed
                # by its rows, then the next table; interleaving is the format.
                seen_table = True
                name = record.get("name")
                if not isinstance(name, str) or not name:
                    fail("SNAPSHOT_FORMAT", "table record is missing a name")
                if name in tables:
                    fail("SNAPSHOT_FORMAT", f"Duplicate table declaration: {name}")
                columns = record.get("columns")
                if not isinstance(columns, list) or not columns:
                    fail("SNAPSHOT_FORMAT", f"Table {name} is missing columns")
                names = []
                for column in columns:
                    # JDBC metadata dictionaries from H2Snapshot.metadata(): each
                    # entry maps metadata labels (COLUMN_NAME, ...) to strings
                    # or SQL NULL, e.g. BUFFER_LENGTH and COLUMN_DEF.
                    if not isinstance(column, dict) or not isinstance(column.get("COLUMN_NAME"), str) \
                            or not column["COLUMN_NAME"]:
                        fail("SNAPSHOT_FORMAT",
                             f"Table {name} column entries must be JDBC metadata objects with COLUMN_NAME")
                    for key, value in column.items():
                        if not isinstance(key, str) or (value is not None and not isinstance(value, str)):
                            fail("SNAPSHOT_FORMAT",
                                 f"Table {name} column metadata must map labels to strings or null ({key!r})")
                    if column["COLUMN_NAME"] in names:
                        fail("SNAPSHOT_FORMAT",
                             f"Table {name} declares duplicate column name: {column['COLUMN_NAME']}")
                    names.append(column["COLUMN_NAME"])
                tables[name] = names
                if name in (CORE_PROJECT, CORE_FILE):
                    identities[name] = record.get("identityColumns")
            elif kind == "row":
                table = record.get("table")
                if table not in tables:
                    fail("SNAPSHOT_FORMAT", f"Row for undeclared table: {table!r}")
                values = record.get("values")
                if not isinstance(values, dict):
                    fail("SNAPSHOT_FORMAT", f"Row for {table} is missing values")
                if set(values.keys()) != set(tables[table]):
                    fail("SNAPSHOT_FORMAT", f"Row for {table} does not match the declared columns")
                for key, value in values.items():
                    if value is not None and not isinstance(value, str):
                        fail("SNAPSHOT_FORMAT", f"Row {table}.{key} must be a string or null")
                rows.append((table, values))
            elif kind == "complete":
                if record.get("sourceSha256") != header["sourceSha256"]:
                    fail("SNAPSHOT_INCOMPLETE", "Footer sourceSha256 does not match the header")
                counts = record.get("counts")
                if not isinstance(counts, dict) or any(
                        not isinstance(k, str) or not isinstance(v, int) or isinstance(v, bool) or v < 0
                        for k, v in counts.items()):
                    fail("SNAPSHOT_FORMAT", "Footer counts must map table names to non-negative integers")
                footer = record
            else:
                fail("SNAPSHOT_FORMAT", f"Unknown record kind: {kind!r}")
    if header is None:
        fail("SNAPSHOT_FORMAT", "Snapshot is empty")
    if footer is None:
        fail("SNAPSHOT_INCOMPLETE", "Snapshot is missing the complete footer")
    observed = {}
    for table, _ in rows:
        observed[table] = observed.get(table, 0) + 1
    if set(footer["counts"]) != set(tables):
        missing = sorted(set(tables) - set(footer["counts"]))
        extra = sorted(set(footer["counts"]) - set(tables))
        fail("COUNTS_MISMATCH",
             f"Footer counts must cover exactly the declared tables (missing: {missing}, undeclared: {extra})")
    for table, count in footer["counts"].items():
        if observed.get(table, 0) != count:
            fail("COUNTS_MISMATCH", f"Footer count for {table} is {count} but {observed.get(table, 0)} rows were read")
    for core, required in ((CORE_PROJECT, REQUIRED_PROJECT_COLUMNS), (CORE_FILE, REQUIRED_FILE_COLUMNS)):
        if core not in tables:
            fail("SNAPSHOT_FORMAT", f"Core table {core} is not declared")
        missing = sorted(required - set(tables[core]))
        if missing:
            fail("SNAPSHOT_FORMAT", f"Core table {core} is missing required column(s): {missing}")
    next_ids = {table: parse_identity(table, identities[table]) for table in (CORE_PROJECT, CORE_FILE)}
    return {"header": header, "tables": tables, "rows": rows, "footer": footer,
            "raw": raw_records, "ddlCount": ddl_count, "nextIds": next_ids}


def parse_identity(table, identities):
    if identities is None:
        fail("IDENTITY_METADATA_MISSING",
             f"Table {table} has no structured identity metadata; create a fresh H2Snapshot export")
    if not isinstance(identities, list) or len(identities) != 1 or not isinstance(identities[0], dict):
        fail("UNSUPPORTED_IDENTITY", f"Table {table} must have exactly one id identity column")
    identity = identities[0]
    if identity.get("column") != "id":
        fail("UNSUPPORTED_IDENTITY", f"Table {table} identity must be its id column")
    values = {}
    for field in ("start", "next", "increment", "minimum", "maximum"):
        raw = identity.get(field)
        if not isinstance(raw, str) or not INT_RE.fullmatch(raw) or int(raw) <= 0:
            fail("UNSUPPORTED_IDENTITY", f"Table {table} identity {field} must be a positive integer string")
        values[field] = int(raw)
    # The current desktop entities use default, ascending BIGINT identities.
    # SQLite AUTOINCREMENT cannot reproduce cycling, descending, custom bounds
    # or increment semantics, so reject those instead of silently changing them.
    if (identity.get("cycle") != "NO" or values["increment"] != 1
            or values["start"] != 1 or values["minimum"] != 1
            or values["maximum"] != 9223372036854775807 or values["next"] > SAFE_INT):
        fail("UNSUPPORTED_IDENTITY", f"Table {table} identity is outside the supported default ascending BIGINT range")
    return values["next"]


# ---------------------------------------------------------------- core model

def parse_pos_int(value, field):
    if not isinstance(value, str) or not INT_RE.match(value):
        fail("INVALID_ROW", f"{field} must be a positive integer string")
    number = int(value)
    if number <= 0:
        fail("INVALID_ROW", f"{field} is out of range")
    if number > SAFE_INT:
        fail("INVALID_ROW",
             f"{field} is {number}, above the safe integer range ({SAFE_INT}) supported by the Swift protocol; "
             "the row cannot be imported with its exact ID")
    return number


def parse_size(value, field):
    if not isinstance(value, str) or not INT_RE.match(value):
        fail("INVALID_ROW", f"{field} must be a non-negative integer string")
    return int(value)


def parse_flag(value, field):
    if value is None:
        return False
    lowered = value.lower()
    if lowered in ("1", "true"):
        return True
    if lowered in ("0", "false"):
        return False
    fail("INVALID_ROW", f"{field} must be a boolean flag")


def require_text(value, field):
    if not isinstance(value, str) or not value or "\0" in value:
        fail("INVALID_ROW", f"{field} must be a non-empty string without U+0000")
    return value


def validate_name(name, field):
    require_text(name, field)
    if (len(name.encode("utf-8")) > 240 or name in (".", "..") or name.startswith(".awd")
            or name.startswith(".native-") or "/" in name or "\\" in name):
        fail("UNSAFE_PATH", f"{field} is not a single safe file name: {name!r}")
    return name


def check_unknown_fields(table, values, known, live):
    for column, value in values.items():
        if column not in known and value not in (None, "") and live:
            fail("UNSUPPORTED_FIELD",
                 f"{table}.{column} carries data this prototype cannot interpret; "
                 "the row stays available only in the raw snapshot, refusing to guess")


def build_model(snapshot):
    projects = {}
    project_uids = {}
    files = {}
    file_uids = {}
    for table, values in snapshot["rows"]:
        if table == CORE_PROJECT:
            pid = parse_pos_int(values["id"], "project.id")
            uid = require_text(values["uid"], "project.uid")
            if pid in projects:
                fail("DUPLICATE_ID", f"Duplicate project id {pid}")
            if uid in project_uids:
                fail("DUPLICATE_UID", f"Duplicate project uid {uid}")
            check_unknown_fields(table, values, PROJECT_COLUMNS, live=True)
            projects[pid] = {
                "id": pid, "uid": uid,
                "name": validate_name_len(values["name"], "project.name"),
                "created_at": require_text(values["created_at"], "project.created_at"),
                "updated_at": require_text(values["updated_at"], "project.updated_at"),
                "local_root": values.get("local_root") or "",
                "user_id": values.get("user_id"),
            }
            project_uids[uid] = pid
    for table, values in snapshot["rows"]:
        if table != CORE_FILE:
            continue
        fid = parse_pos_int(values["id"], "project_file.id")
        uid = require_text(values["uid"], "project_file.uid")
        if fid in files:
            fail("DUPLICATE_ID", f"Duplicate project_file id {fid}")
        if uid in file_uids:
            fail("DUPLICATE_UID", f"Duplicate project_file uid {uid}")
        project_id = parse_pos_int(values["project_id"], "project_file.project_id")
        if project_id not in projects:
            fail("ORPHAN_FILE", f"project_file {fid} references missing project {project_id}")
        deleted = parse_flag(values.get("is_deleted"), "project_file.is_deleted")
        check_unknown_fields(table, values, FILE_COLUMNS, live=not deleted)
        parent_raw = values.get("parent_id")
        parent_id = 0 if parent_raw in (None, "", "0") else parse_pos_int(parent_raw, "project_file.parent_id")
        row = {
            "id": fid, "uid": uid, "project_id": project_id, "parent_id": parent_id,
            "is_folder": parse_flag(values.get("is_folder"), "project_file.is_folder"),
            "name": values.get("name"), "file_path": values.get("file_path") or "",
            "file_size": values.get("file_size"), "updated_at": values.get("updated_at"),
            "deleted": deleted, "external_path": values.get("external_path") or "",
        }
        files[fid] = row
        file_uids[uid] = fid
    live = {fid: row for fid, row in files.items() if not row["deleted"]}
    for fid, row in live.items():
        validate_name(row["name"], f"project_file {fid} name")
        require_text(row["updated_at"], f"project_file {fid} updated_at")
        if row["external_path"]:
            fail("UNSUPPORTED", f"project_file {fid} uses external_path; standalone external files are not supported")
    # parent chain: same project, live folder, acyclic, depth-limited
    chains = {}
    for fid, row in live.items():
        chain = []
        seen = {fid}
        current = row
        while current["parent_id"] != 0:
            parent = live.get(current["parent_id"])
            if parent is None:
                if current["parent_id"] in files:
                    fail("PARENT_DELETED",
                         f"Active project_file {current['id']} hangs under deleted parent {current['parent_id']}")
                fail("ORPHAN_FILE", f"Active project_file {fid} references missing parent {current['parent_id']}")
            if parent["project_id"] != row["project_id"]:
                fail("CROSS_PROJECT", f"project_file {fid} has a parent in another project")
            if not parent["is_folder"]:
                fail("INVALID_ROW", f"project_file {fid} parent {parent['id']} is not a folder")
            if parent["id"] in seen:
                fail("CYCLE_DETECTED", f"project_file {fid} has a cyclic parent chain")
            seen.add(parent["id"])
            if len(chain) >= 63:
                fail("CYCLE_DETECTED", f"project_file {fid} parent chain is too deep")
            chain.insert(0, parent["name"])
            current = parent
        chains[fid] = chain
    # per-directory live name uniqueness and normalized source keys
    taken = {}
    for fid, row in sorted(live.items()):
        key = (row["project_id"], row["parent_id"], row["name"])
        if key in taken:
            fail("NAME_CONFLICT", f"Name {row['name']!r} is duplicated in one directory (ids {taken[key]}, {fid})")
        taken[key] = fid
        expected = f"projects/{row['project_id']}/" + "/".join(chains[fid] + [row["name"]])
        if row["file_path"]:
            if row["file_path"] != expected:
                fail("SOURCE_KEY_MISMATCH",
                     f"project_file {fid} file_path {row['file_path']!r} does not match the metadata chain {expected!r}")
        elif not row["is_folder"]:
            fail("INVALID_ROW", f"Active project_file {fid} is missing file_path")
        row["relative"] = "/".join(chains[fid] + [row["name"]])
        if not row["is_folder"]:
            row["size"] = parse_size(row["file_size"], f"project_file {fid} file_size")
    return projects, files, live


def identity_floors(snapshot, projects, files):
    floors = {}
    for source, target, rows in ((CORE_PROJECT, "projects", projects), (CORE_FILE, "files", files)):
        floor = max(max(rows, default=0), snapshot["nextIds"][source] - 1)
        if floor >= SAFE_INT:
            fail("UNSUPPORTED_IDENTITY", f"Table {source} has no next identity within the Swift protocol's safe integer range")
        floors[target] = floor
    return floors


def validate_name_len(name, field):
    require_text(name, field)
    if len(name.encode("utf-8")) > 240:
        fail("INVALID_ROW", f"{field} is too long")
    return name


# ---------------------------------------------------------------- source reading

def read_roots_map(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            mapping = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        fail("INVALID_ARGUMENT", f"Cannot read --project-roots map: {exc}")
    if not isinstance(mapping, dict):
        fail("INVALID_ARGUMENT", "--project-roots must map project ids to absolute directories")
    roots = {}
    for key, value in mapping.items():
        if not isinstance(key, str) or not INT_RE.match(key):
            fail("INVALID_ARGUMENT", f"Invalid project id key in --project-roots: {key!r}")
        if not isinstance(value, str) or not value.startswith("/"):
            fail("INVALID_ARGUMENT", f"Source root for project {key} must be an absolute path")
        roots[int(key)] = os.path.normpath(value)
    return roots


def require_real_dir_chain(path, label):
    """Every component of `path` (including `path` itself) must be a real,
    non-symlink directory. lstat() alone would miss a symlink above the leaf."""
    current = os.path.normpath(path)
    chain = [current]
    while current != "/":
        current = os.path.dirname(current)
        chain.append(current)
    for component in reversed(chain):
        try:
            info = os.lstat(component)
        except OSError:
            fail("NOT_FOUND", f"{label} path component does not exist: {component}")
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            fail("UNSAFE_PATH", f"{label} path component is not a real non-symlink directory: {component}")


def resolve_roots(projects, live, roots):
    resolved = {}
    for pid in projects:
        if pid not in roots:
            fail("NO_SOURCE_ROOT",
                 f"Project {pid} has no explicit authorized source root in --project-roots; "
                 "every declared project needs one, including empty or directory-only projects")
        root = roots[pid]
        require_real_dir_chain(root, f"authorized source root for project {pid}")
        local_root = os.path.normpath(projects[pid]["local_root"]) if projects[pid]["local_root"] else ""
        if local_root and local_root != root:
            fail("SOURCE_ROOT_MISMATCH",
                 f"Project {pid} local_root {local_root!r} does not match the authorized root {root!r}; "
                 "refusing to widen read scope from raw metadata")
        resolved[pid] = root
    return resolved


def check_source_directory(root, relative):
    """A metadata folder must correspond to a real non-symlink source directory."""
    path = root
    for part in relative.split("/"):
        path = os.path.join(path, part)
        try:
            info = os.lstat(path)
        except OSError:
            fail("NOT_FOUND", f"Source directory for declared folder is missing: {path}")
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            fail("UNSAFE_PATH", f"Source path component is not a real non-symlink directory: {path}")


def read_source(root, relative):
    """Read one source file with per-level symlink checks and stability hashing."""
    path = root
    parts = relative.split("/")
    for part in parts[:-1]:
        path = os.path.join(path, part)
        try:
            info = os.lstat(path)
        except OSError:
            fail("NOT_FOUND", f"Missing source directory: {path}")
        if not stat.S_ISDIR(info.st_mode):
            fail("UNSAFE_PATH", f"Source path component is not a real directory: {path}")
    path = os.path.join(path, parts[-1])
    try:
        before = os.lstat(path)
    except OSError:
        fail("NOT_FOUND", f"Missing source file: {path}")
    if not stat.S_ISREG(before.st_mode):
        fail("UNSAFE_PATH", f"Source is not a regular file: {path}")
    if before.st_nlink != 1:
        fail("UNSAFE_PATH", f"Hard-linked source files are not supported: {path}")
    if before.st_size > MAX_FILE_SIZE:
        fail("UNSUPPORTED", f"Source file exceeds the 32 MiB prototype limit: {path}")
    data = _read_stable(path, before)
    return data, stat.S_IMODE(before.st_mode), before.st_size


def _read_once(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        chunks = []
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                break
            chunks.append(chunk)
    finally:
        os.close(fd)
    return b"".join(chunks)


def _read_stable(path, before):
    data = _read_once(path)
    if len(data) != before.st_size:
        fail("SOURCE_CHANGED", f"Source file changed size while reading: {path}")
    after = os.lstat(path)
    if (after.st_ino, after.st_size, after.st_mtime_ns) != (before.st_ino, before.st_size, before.st_mtime_ns):
        fail("SOURCE_CHANGED", f"Source file changed while reading: {path}")
    if _read_once(path) != data:
        fail("SOURCE_CHANGED", f"Source file bytes changed while reading: {path}")
    return data


def write_target(target, data, mode):
    directory = os.path.dirname(target)
    if os.path.lexists(target):
        fail("CONFLICT", f"Target already exists in staging: {target}")
    temp = os.path.join(directory, ".native-clone-" + secrets.token_hex(8))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.chmod(temp, mode)
    os.rename(temp, target)
    fsync_dir(directory)
    info = os.lstat(target)
    if not stat.S_ISREG(info.st_mode) or sha256(_read_once(target)) != sha256(data):
        fail("IO_ERROR", f"Copied file failed verification: {target}")


# ---------------------------------------------------------------- Swift protocol client

class SwiftClient:
    def __init__(self, binary, profile):
        env = dict(os.environ)
        env.pop("AWD_LOCAL_DATA_TEST_FAULT", None)
        env["HOME"] = os.path.join(os.path.dirname(profile), "home")
        os.makedirs(env["HOME"], exist_ok=True)
        self.process = subprocess.Popen([binary, "--profile", profile], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        self.buffer = b""
        self.sequence = 0

    def receive(self):
        deadline = time.monotonic() + 30
        while b"\n" not in self.buffer:
            if self.process.poll() is not None and not self.buffer:
                fail("VERIFY_MISMATCH", f"Swift process exited early: {self.process.stderr.read()[:400]}")
            ready, _, _ = select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                fail("VERIFY_MISMATCH", "Swift protocol response timed out")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                fail("VERIFY_MISMATCH", "Swift process closed the protocol pipe")
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b"\n", 1)
        return json.loads(line)

    def call(self, method, **params):
        self.sequence += 1
        self.process.stdin.write(json.dumps({"id": self.sequence, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        response = self.receive()
        if response.get("id") != self.sequence:
            fail("VERIFY_MISMATCH", f"Swift protocol id mismatch: {response}")
        if "error" in response:
            fail("VERIFY_MISMATCH", f"Swift {method} failed: {response['error']}")
        return response["result"]

    def close(self):
        try:
            if self.process.poll() is None:
                self.process.stdin.close()
                try:
                    self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait(timeout=5)
                    fail("VERIFY_MISMATCH", "Swift process did not close normally")
            if self.process.returncode != 0:
                fail("VERIFY_MISMATCH", f"Swift process exited with {self.process.returncode}")
        finally:
            for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
                if stream and not stream.closed:
                    stream.close()


# ---------------------------------------------------------------- build + verify

def initialize_profile(binary, staging):
    client = SwiftClient(binary, staging)
    try:
        health = client.call("health")
        if not health.get("ready"):
            fail("VERIFY_MISMATCH", "Swift prototype did not become ready on a fresh profile")
    finally:
        client.close()


def build_clone(binary, staging, projects, files, live, roots, snapshot, source_hashes):
    initialize_profile(binary, staging)
    lock_fd = os.open(os.path.join(staging, "owner.lock"), os.O_RDWR)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fail("PROFILE_BUSY", "Cannot take the staging profile ownership lock")
    try:
        storage = os.path.join(staging, "storage", "projects")
        for pid in sorted(projects):
            target = os.path.join(storage, str(pid))
            if os.path.lexists(target):
                fail("CONFLICT", f"Project storage already exists in staging: {target}")
            os.mkdir(target, 0o700)
        fsync_dir(storage)
        folders = sorted((row for row in live.values() if row["is_folder"]),
                         key=lambda row: row["relative"].count("/"))
        for row in folders:
            check_source_directory(roots[row["project_id"]], row["relative"])
            target = os.path.join(storage, str(row["project_id"]), *row["relative"].split("/"))
            if os.path.lexists(target):
                fail("CONFLICT", f"Directory already exists in staging: {target}")
            os.mkdir(target, 0o700)
            fsync_dir(os.path.dirname(target))
        imported_files = 0
        for row in sorted(live.values(), key=lambda row: row["id"]):
            if row["is_folder"]:
                continue
            root = roots[row["project_id"]]
            data, mode, actual_size = read_source(root, row["relative"])
            if actual_size != row["size"]:
                fail("SIZE_MISMATCH",
                     f"project_file {row['id']} declares size {row['size']} but the source has {actual_size}")
            digest = sha256(data)
            row["generation"] = digest
            target = os.path.join(storage, str(row["project_id"]), *row["relative"].split("/"))
            write_target(target, data, mode)
            source_hashes[row["id"]] = digest
            imported_files += 1
        database = sqlite3.connect(os.path.join(staging, "local.sqlite"))
        try:
            database.execute("PRAGMA foreign_keys=ON")
            database.execute("PRAGMA busy_timeout=5000")
            database.execute("BEGIN IMMEDIATE")
            for pid in sorted(projects):
                project = projects[pid]
                database.execute(
                    "INSERT INTO projects(id,uid,name,created_at,updated_at) VALUES(?,?,?,?,?)",
                    (pid, project["uid"], project["name"], project["created_at"], project["updated_at"]))
            for row in sorted(live.values(), key=lambda row: row["id"]):
                database.execute(
                    "INSERT INTO files(id,uid,project_id,parent_id,name,kind,size,generation,live,updated_at) "
                    "VALUES(?,?,?,?,?,?,?,?,1,?)",
                    (row["id"], row["uid"], row["project_id"], row["parent_id"], row["name"],
                     1 if row["is_folder"] else 0, 0 if row["is_folder"] else row["size"],
                     "" if row["is_folder"] else row["generation"], row["updated_at"]))
            database.execute(
                "CREATE TABLE migration_archive(seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, "
                "table_name TEXT, imported INTEGER NOT NULL DEFAULT 0, note TEXT, payload TEXT NOT NULL)")
            live_ids = set(live)
            project_ids = set(projects)
            for kind, table, raw in snapshot["raw"]:
                imported = 0
                note = "non-core snapshot record archived verbatim"
                if kind == "row" and table == CORE_PROJECT:
                    record = json.loads(raw)
                    if int(record["values"]["id"]) in project_ids:
                        imported, note = 1, "imported as a live prototype project; local_root/user_id stay archive-only"
                elif kind == "row" and table == CORE_FILE:
                    record = json.loads(raw)
                    fid = int(record["values"]["id"])
                    if fid in live_ids:
                        imported, note = 1, "imported as a live prototype file entry"
                    else:
                        note = "deleted legacy row archived only, never imported as live data"
                database.execute(
                    "INSERT INTO migration_archive(kind,table_name,imported,note,payload) VALUES(?,?,?,?,?)",
                    (str(kind), table if isinstance(table, str) else None, imported, note, raw))
            # Preserve the source identity high water, including permanently
            # purged rows and consumed/rolled-back IDs absent from row snapshots.
            for table, floor in snapshot["identityFloors"].items():
                database.execute(
                    "INSERT INTO sqlite_sequence(name,seq) SELECT ?,? "
                    "WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?)", (table, floor, table))
                database.execute(
                    "UPDATE sqlite_sequence SET seq=? WHERE name=? AND seq<?", (floor, table, floor))
            database.execute("COMMIT")
        except BaseException:
            database.execute("ROLLBACK")
            raise
        integrity = database.execute("PRAGMA integrity_check").fetchone()[0]
        database.close()
        if integrity != "ok":
            fail("DATABASE_ERROR", f"Staging database failed integrity_check: {integrity}")
        return imported_files
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        os.close(lock_fd)


def verify_clone(binary, staging, projects, live, source_hashes):
    client = SwiftClient(binary, staging)
    try:
        health = client.call("health")
        listed = client.call("projects.list")
        by_id = {entry["id"]: entry for entry in listed}
        if set(by_id) != set(projects):
            fail("VERIFY_MISMATCH", "Swift projects.list does not match the imported project ids")
        for pid, project in projects.items():
            entry = by_id[pid]
            for key, expected in (("uid", project["uid"]), ("name", project["name"]),
                                  ("createdAt", project["created_at"]), ("updatedAt", project["updated_at"])):
                if entry[key] != expected:
                    fail("VERIFY_MISMATCH", f"Project {pid} {key} mismatch after re-read: {entry[key]!r} != {expected!r}")
        per_project = {}
        for row in live.values():
            per_project.setdefault(row["project_id"], {})[row["id"]] = row
        verified_bytes = 0
        for pid, rows in per_project.items():
            listing = {entry["id"]: entry for entry in client.call("files.list", projectId=pid)}
            if set(listing) != set(rows):
                fail("VERIFY_MISMATCH", f"Swift files.list for project {pid} does not match the imported ids")
            for fid, row in rows.items():
                entry = listing[fid]
                expected_path = f"projects/{pid}/{row['relative']}"
                checks = (("uid", row["uid"]), ("name", row["name"]), ("isFolder", row["is_folder"]),
                          ("filePath", expected_path),
                          ("parentId", None if row["parent_id"] == 0 else row["parent_id"]))
                for key, expected in checks:
                    if entry[key] != expected:
                        fail("VERIFY_MISMATCH", f"File {fid} {key} mismatch after re-read")
                if not row["is_folder"]:
                    read = client.call("files.read", projectId=pid, fileId=fid)
                    payload = base64.b64decode(read["contentBase64"])
                    if sha256(payload) != source_hashes[fid] or read["generation"] != source_hashes[fid]:
                        fail("VERIFY_MISMATCH", f"File {fid} bytes differ from the verified source hash")
                    if read["uid"] != row["uid"] or read["fileSize"] != len(payload):
                        fail("VERIFY_MISMATCH", f"File {fid} metadata mismatch after re-read")
                    verified_bytes += len(payload)
        return {"healthCapabilities": health.get("capabilities", []),
                "healthUnavailable": health.get("unavailable", []),
                "projectsVerified": len(projects), "entriesVerified": len(live),
                "filesVerified": len(source_hashes), "bytesVerified": verified_bytes}
    finally:
        client.close()


# ---------------------------------------------------------------- entry point

def recheck_against_sources(live, roots, source_hashes):
    """Final gate after protocol readback, before publish: re-read every source
    file (stability-checked) and every copied staging file and compare against
    the hash recorded when the file was copied."""
    for row in sorted(live.values(), key=lambda row: row["id"]):
        if row["is_folder"]:
            continue
        data, _, _ = read_source(roots[row["project_id"]], row["relative"])
        if sha256(data) != source_hashes[row["id"]]:
            fail("SOURCE_CHANGED", f"Source file changed after it was copied: project_file {row['id']}")


def recheck_copied_files(staging, live, source_hashes):
    for row in sorted(live.values(), key=lambda row: row["id"]):
        if row["is_folder"]:
            continue
        target = os.path.join(staging, "storage", "projects", str(row["project_id"]),
                              *row["relative"].split("/"))
        if sha256(_read_once(target)) != source_hashes[row["id"]]:
            fail("IO_ERROR", f"Copied file no longer matches the source hash: {target}")


def reject_source_overlap(write_paths, source_roots):
    # Compare ancestry in both directions. samefile also catches case aliases on
    # the usual macOS case-insensitive volume; realpath resolves existing aliases.
    for source in source_roots:
        source = os.path.realpath(source)
        for target in write_paths:
            target = os.path.realpath(target)
            for descendant, ancestor in ((target, source), (source, target)):
                cursor = descendant
                while True:
                    same = cursor == ancestor
                    if not same and os.path.exists(cursor) and os.path.exists(ancestor):
                        same = os.path.samefile(cursor, ancestor)
                    if same:
                        fail("SOURCE_OVERLAP", "Output, staging and helper HOME must stay outside all source trees")
                    parent = os.path.dirname(cursor)
                    if parent == cursor:
                        break
                    cursor = parent


def run(arguments):
    for label, value in (("snapshot", arguments.snapshot), ("project-roots", arguments.project_roots),
                         ("output", arguments.output), ("binary", arguments.binary)):
        if not os.path.isabs(value):
            fail("INVALID_ARGUMENT", f"--{label} must be an absolute path")
    if any(part in (".", "..") for part in arguments.output.split(os.sep)):
        fail("UNSAFE_PATH", "--output must not contain . or .. path components")
    if not os.path.isfile(arguments.snapshot):
        fail("INVALID_ARGUMENT", f"Snapshot does not exist: {arguments.snapshot}")
    if not os.path.isfile(arguments.binary) or not os.access(arguments.binary, os.X_OK):
        fail("INVALID_ARGUMENT", f"Swift binary is not executable: {arguments.binary}")
    if os.path.lexists(arguments.output):
        fail("CONFLICT", f"Output already exists; refusing to touch it: {arguments.output}")
    parent = os.path.dirname(arguments.output)
    if not os.path.isdir(parent):
        fail("INVALID_ARGUMENT", f"Output parent directory does not exist: {parent}")
    require_real_dir_chain(parent, "output parent")
    staging = arguments.output + ".staging"
    if os.path.lexists(staging):
        fail("CONFLICT", f"Staging directory already exists: {staging}")
    roots_map = read_roots_map(arguments.project_roots)
    snapshot = parse_snapshot(arguments.snapshot)
    projects, files, live = build_model(snapshot)
    snapshot["identityFloors"] = identity_floors(snapshot, projects, files)
    roots = resolve_roots(projects, live, roots_map)
    reject_source_overlap((arguments.output, staging, os.path.join(parent, "home")), roots_map.values())
    os.mkdir(staging, 0o700)
    try:
        source_hashes = {}
        imported_files = build_clone(arguments.binary, staging, projects, files, live, roots,
                                     snapshot, source_hashes)
        verification = verify_clone(arguments.binary, staging, projects, live, source_hashes)
        recheck_against_sources(live, roots, source_hashes)
        recheck_copied_files(staging, live, source_hashes)
        report = {
            "tool": "clone_snapshot.py", "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "sourceSha256": snapshot["header"]["sourceSha256"], "h2Version": snapshot["header"]["h2Version"],
            "scope": "isolated offline clone of a synthetic snapshot; not a production cutover",
            "identityFloors": snapshot["identityFloors"],
            "projectsImported": len(projects),
            "filesImported": imported_files,
            "foldersImported": sum(1 for row in live.values() if row["is_folder"]),
            "rowsArchived": sum(1 for kind, _, _ in snapshot["raw"] if kind == "row"),
            "deletedRowsArchivedOnly": sum(1 for row in files.values() if row["deleted"]),
            "archiveOnlyFields": [
                "project.local_root", "project.user_id", "project.project_type",
                "project.listed_company_name", "project.target_company_name",
                "project.listed_company_info_json", "project.target_company_info_json",
                "project.version_opt_out",
                "project_file.file_type", "project_file.wps_file_id", "project_file.sort_order",
                "project_file.user_id", "project_file.client_visible", "project_file.created_at",
                "project_file.meta_json", "project_file.deleted_at", "project_file.external_path",
            ],
            "unusedAuthorizedRoots": sorted(str(pid) for pid in roots_map if pid not in roots),
            "unavailableCapabilities": UNAVAILABLE,
            "archiveNotice": "migration_archive preserves raw legacy rows for audit only; it is not a "
                             "writable business table and not feature parity with H2, Git, AI, ACL or watchers",
            "verification": verification,
        }
        report_path = os.path.join(staging, "migration-report.json")
        with open(report_path, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        fsync_dir(staging)
        if os.path.lexists(arguments.output):
            fail("CONFLICT", f"Output appeared during the import: {arguments.output}")
        os.rename(staging, arguments.output)
        fsync_dir(parent)
        return {"ok": True, "output": arguments.output, "report": report}
    except BaseException as exc:
        failure = {"tool": "clone_snapshot.py", "phase": "import",
                   "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        if isinstance(exc, CloneError):
            failure["error"] = {"code": exc.code, "message": exc.message}
        else:
            failure["error"] = {"code": "INTERNAL_ERROR", "message": repr(exc)}
        try:
            with open(os.path.join(staging, "migration-failure-report.json"), "w", encoding="utf-8") as handle:
                handle.write(json.dumps(failure, ensure_ascii=False, indent=2) + "\n")
        except OSError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description="Clone an H2 JSONL snapshot into an isolated prototype profile")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--project-roots", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--binary", required=True)
    arguments = parser.parse_args()
    try:
        result = run(arguments)
    except CloneError as error:
        print(json.dumps({"ok": False, "error": {"code": error.code, "message": error.message},
                          "output": arguments.output}, ensure_ascii=False))
        return 1
    except Exception as error:  # never leak a half-built output on unexpected errors
        print(json.dumps({"ok": False, "error": {"code": "INTERNAL_ERROR", "message": repr(error)},
                          "output": arguments.output}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
