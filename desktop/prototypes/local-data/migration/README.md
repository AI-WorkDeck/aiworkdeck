<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Offline migration source snapshot

`H2Snapshot.java` reads an **offline desktop H2 database** without starting Spring,
Hibernate, plugins, or startup callbacks. It is the source-export step for the
lightweight-data migration, not a new writer, a completed SQLite migration, or a
production startup path. The source database and original file locations remain
unchanged. Do not point an experimental writer at original project files.

Supply an existing absolute `.mv.db` path and a new output directory. The helper
uses the desktop profile's PostgreSQL mode/lowercase identifier options, `sa`
with the existing desktop empty password, `IFEXISTS=TRUE`, read-only data access,
and `AUTO_SERVER=FALSE`. It must fail when the original backend still holds the
database. A caller-supplied JDBC URL is deliberately unsupported. Symlink source
paths and an existing destination are rejected.

Compile/run with Java 21 and the **same H2 version as the source backend** plus
its Jackson Core dependency. The helper uses only JDBC and streaming JSON; it
does not instantiate any application beans. For example, with absolute paths in
`H2_JAR`, `JACKSON_CORE_JAR`, and a dedicated `BUILD` directory:

```sh
"$JAVA_HOME/bin/javac" -cp "$H2_JAR:$JACKSON_CORE_JAR" -d "$BUILD" \
  desktop/prototypes/local-data/migration/H2Snapshot.java
"$JAVA_HOME/bin/java" -cp "$BUILD:$H2_JAR:$JACKSON_CORE_JAR" H2Snapshot \
  /absolute/isolated/source.mv.db /absolute/new-export
```

The export contains original DDL, JDBC column/index/key metadata, rows, and a
completion record with counts and the original database SHA256. Numeric and
temporal cell values are strings: 64-bit IDs and precise decimals never pass
through JavaScript numbers. SQL NULL remains JSON null; binary cells are base64,
identified by their JDBC column type. The original DDL is evidence, not portable
SQLite SQL. Defaults, types, constraints, sequences, and transaction behavior
still require an explicit destination-schema migration and validation.

The file is written as `snapshot.jsonl.pending`, flushed to disk, and renamed to
`snapshot.jsonl` only after the source digest is rechecked. A failure preserves
the staging directory for inspection and does not publish the final filename.
This is a process-level completion protocol; power-loss durability of the parent
directory and interrupted-export recovery have not been established. Retrying
requires a new destination.

Snapshots can contain private project data and settings. Keep them in a private
local artifact directory, outside Git and logs. This directory's tests generate
only synthetic data; they never discover or read a user's default profile.

```sh
JAVA_HOME=/absolute/jdk-21 \
H2_JAR=/absolute/h2-2.2.224.jar \
JACKSON_CORE_JAR=/absolute/jackson-core-2.15.4.jar \
TEST_OUTPUT=/absolute/new-test-output \
python3 desktop/prototypes/local-data/migration/test_snapshot.py
```

Six real-JDBC cases cover value/schema preservation, source-file identity,
refusal of a live writer, no implicit database creation, no destination overwrite,
path/URL-option refusal, and identity high water after physically deleting the
highest project and file IDs. The identity case additionally requires
`SWIFT_BINARY=/absolute/awd-local-data` and runs the real snapshot clone and Swift
create/read protocol; without that variable it is explicitly skipped.
An additional isolated backend-created database
exported all 97 tables and 26 synthetic rows with its source hash unchanged.
These checks do not establish migration of original file bytes, local-root or
external-file permissions, Git/watcher/AI ownership, or SQLite business behavior.

## Isolated clone into the lightweight data service

`clone_snapshot.py` copies explicitly mapped project folders into a **new test
profile** and imports project/file IDs, UIDs, parent relationships and bytes into
its SQLite schema. It rejects existing outputs, paths containing `.` or `..`,
symlink directory ancestors, live external-file references, incomplete snapshots
and unsupported metadata. Source roots are explicit; the tool never discovers a
user's default data directory or changes ownership of the original project.

```sh
python3 desktop/prototypes/local-data/migration/clone_snapshot.py \
  --snapshot /absolute/new-export/snapshot.jsonl \
  --project-roots /absolute/project-roots.json \
  --output /absolute/new-clone-profile \
  --binary /absolute/awd-local-data
```

The roots JSON maps each project ID to its authorized absolute source directory,
including empty projects. A nonempty legacy `local_root` must match that mapping.
Output, staging and the helper HOME must not intersect any explicitly mapped
source tree in either ancestor direction. This is checked before creating helper
paths, including existing symlink and case aliases. Every declared directory
must exist, and every live file is copied and checked through the actual Swift protocol. All legacy rows and schema records are also
archived for audit; archived ACL, Git, AI, watcher and project-specific fields are
not implemented as active business behavior. This clone does not complete the
production migration and must not replace the original data authority.

Fresh exports include `identityColumns` from H2's structured metadata. For the
project and file tables the clone preserves the greater of the original next
identity minus one and the greatest existing/archived ID. It therefore does not
reuse IDs consumed by physically purged rows or rolled-back inserts. The current
migration supports the backend's default ascending BIGINT identities: start and
minimum 1, increment 1, maximum 9223372036854775807, and no cycling. Exhausted,
nondefault or JavaScript-unsafe next identities are rejected. Older snapshots
without identity metadata require a fresh export; DDL is never parsed to guess
identity state or translated into destination SQL. The Swift creation paths can
allocate the final safe ID (9007199254740991), then reject later project, file
and directory creation inside the insertion transaction before writing bytes or
creating directories; failed allocations do not leave rows or advance the sequence.

Clones are built in a new sibling `.staging` directory and published only after
Swift readback and final source/copy hashes match. Failures retain staging and a
failure report. Sources must remain offline: the checks detect observed changes,
but are not a filesystem-wide atomic snapshot or protection against concurrent
adversarial directory replacement. The final existence check plus rename is not
a cross-process exclusive destination claim.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 desktop/prototypes/local-data/migration/test_clone.py \
  --binary /absolute/awd-local-data --output /absolute/new-clone-test-output
```

Fixtures include nullable JDBC metadata, preserved deleted-ID floors, empty-table
identity high water, missing/unsupported identity rejection and output-path
normalization attacks. The real H2 integration test in `test_snapshot.py` remains
the compatibility check for the exporter and importer together.
