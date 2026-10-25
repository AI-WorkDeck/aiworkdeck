<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Isolated native local-data prototype

This is a component experiment for macOS, not a replacement product backend. It runs Swift/Foundation with the system SQLite library, stores actual metadata and document bytes, and exposes a JSON-lines child-process protocol. It is not used by the production desktop entry point and does not open H2. The [offline migration helper](migration/README.md) can populate an isolated copy from a verified H2 snapshot; it does not transfer production ownership. Windows support is unchanged.

The experiment tests a concrete question: how soon can an independently owned local profile list real projects, read a document, and durably save it without starting Spring/JPA? `health` measures only that capability. It must not be presented as full-workbench readiness or as evidence that AI, versions, or collaboration still work.

## Build and run

Requires the macOS SDK/Swift compiler; no downloaded dependency or package manager is used.

```sh
sh desktop/prototypes/local-data/build.sh /absolute/artifacts/build/awd-local-data
/absolute/artifacts/build/awd-local-data --profile /absolute/isolated/profile
python3 desktop/prototypes/local-data/test_local_data.py \
  --binary /absolute/artifacts/build/awd-local-data \
  --output /absolute/artifacts/functional-run-1
```

Always supply a dedicated profile and isolated `HOME`. The service takes no implicit default, listens on no port, and refuses an existing nonempty directory without its exact prototype marker. One service process holds an exclusive ownership lock until EOF/exit. Never point Java storage or a second native writer at this profile. The caller owns process lifetime and should close stdin, await exit, then release the profile. EOF exits normally after the last complete request; malformed requests receive errors. An initialization failure emits `{ "id": null, "error": ... }` and exits with status 1. It never emits unsolicited ready events.

`build.sh` writes the binary and compiler module cache only under its output directory. Tests create independent synthetic profiles under the requested output directory and retain their databases/files for inspection. Do not use test fault variables outside isolated tests.

## JSON-lines protocol, version 1

Every input line is one UTF-8 object:

```json
{"id":1,"method":"health","params":{}}
{"id":2,"method":"projects.create","params":{"name":"Synthetic project"}}
{"id":3,"method":"files.mkdir","params":{"projectId":1,"name":"contracts"}}
{"id":4,"method":"files.create","params":{"projectId":1,"parentId":1,"name":"example.txt","contentBase64":"aGVsbG8="}}
{"id":5,"method":"files.read","params":{"projectId":1,"fileId":2}}
```

Every response preserves `id` and has either `result` or `error: {code,message}`. Stdout contains only protocol messages. The trusted desktop main process should hold this pipe; do not expose an unrestricted method dispatcher or physical file paths to untrusted renderer content.

| Method | Parameters | Actual result |
| --- | --- | --- |
| `health` | None | `ready`, `protocolVersion`, owned profile, implemented capabilities, unavailable capabilities |
| `projects.list` | None | Array of SQLite projects, ordered by numeric ID |
| `projects.get` | `projectId` | One project; missing is an error |
| `projects.create` | `name` | Persisted numeric `id`, stable UUID `uid`, name, timestamps, local-only `myRole: OWNER` |
| `files.list` | `projectId` | Flat list of persisted live entries (files and directories) with `parentId`/`isFolder`; clients assemble the tree themselves |
| `files.mkdir` | `projectId`, `name`, optional `parentId` | Persisted directory with stable numeric `id` and UUID `uid`, plus the real on-disk directory |
| `files.create` | `projectId`, `name`, optional `parentId`, `contentBase64` | Persisted file metadata after bytes have been published |
| `files.read` | `projectId`, `fileId` | Metadata, actual `contentBase64`, actual SHA-256 `generation`, `physicalPath` for a trusted native document adapter; directories return `IS_DIRECTORY` |
| `files.save` | `projectId`, `fileId`, `expectedGeneration`, `contentBase64` | Metadata after successful disk and database commit; directories return `IS_DIRECTORY` |
| `settings.get` | `key` | JSON value or null; only `local.ui.*` is accepted |
| `settings.set` | `key`, `value` | Persisted JSON value; only `local.ui.*` is accepted |

`files.read` hashes the actual bytes. `files.save` must pass the generation returned by that read (or the previous successful save); a stale fingerprint returns `CONFLICT`. A disappeared original returns `NOT_FOUND` and is never silently recreated. Numeric project and file IDs are both required; a file in another project cannot be addressed with a guessed ID. Direct creation allocates prototype identities; the offline clone preserves imported H2 IDs/UIDs and their identity high water. Text metadata, including project names and setting keys, rejects U+0000 before SQLite binding; it must never silently truncate or alias an existing key. Content is limited to 32 MiB; the base64 protocol copies buffers and is not a large-file streaming design.

Directories are first-class entries in the same `files` table (`kind=1`) with stable numeric IDs and UUIDs; a missing `parentId` means the project root (`parent_id=0` internally). Names must be unique within one directory (`UNIQUE(project_id,parent_id,name)`); the same name in different directories is allowed. A `parentId` pointing into another project, a missing directory, or a file returns `NOT_FOUND`; a corrupted cyclic or over-deep parent chain returns `CYCLE_DETECTED`. The logical `filePath` and the physical path are resolved by walking the parent chain per access — startup never scans the whole file tree. Rename, move and delete are not implemented, so cycles cannot be created through the protocol. Reading or saving a directory returns `IS_DIRECTORY`. A failed `files.mkdir` removes the just-created on-disk directory; a failed `files.create` removes its unpublished row, so neither leaves a visible phantom entry.

Old standalone v1 profiles (flat `files` table with `UNIQUE(project_id,name)`, `user_version=0`) and v2 tree profiles are migrated on open inside one SQLite transaction to schema v3. Flat files receive `parent_id=0`; IDs, UIDs, generations, sequence high water and on-disk bytes stay unchanged. Existing standalone synthetic projects/files belong to the synthetic local user 1. A failed migration rolls back the whole schema change. A v2 clone containing `migration_archive` instead returns `NEEDS_REIMPORT`: its original owners must be imported again, never replaced with the synthetic owner. Future schema versions are rejected. This is prototype-schema evolution, not a production H2 cutover.

### Fixed local identity and access checks

Schema v3 stores minimal users (`id`, `username`, `display_name`, `role`), project memberships and one `profile_identity.selected_user_id` in the same database as projects/files. `identity.status` reads that binding; no request parameter can select a different user. Missing, dangling or unsupported identity/role state blocks business calls. New standalone profiles use synthetic local user 1. Imported profiles require the source's definite persisted identity; interactive selection, login, permission management and cloud authentication remain unimplemented.

Projects retain their original type and owner. Lists include only owned/member projects and exclude `LOOSE_FILES`; `myRole`, `canWrite` and `canBrowseFiles` come from actual ACLs. Non-client owners, ADMIN and PARTICIPANT members can write. READ_ONLY members can read. Global CLIENT accounts cannot become writers through ownership; non-client owners take precedence over a conflicting customer membership, matching the Java policy. Client project roles cannot browse the Explorer. Direct customer file reads require both project membership and either their own file or explicit `client_visible`; the reply omits parent IDs and paths. Customer uploads belong to the separate due-diligence workflow, which this sample has not migrated.

Every read/save/create/mkdir checks the current same-profile identity and permissions again. Client or read-only writes fail before changing rows/bytes. The local child-process pipe remains a trusted host interface, not an authentication boundary against someone who can edit the SQLite file. Startup journal recovery finishes a previously authorized operation before accepting new requests; it does not turn the new identity into a writer.

For a save response, update the editor's generation only on success. A pipe failure or `RECOVERY_REQUIRED` leaves the outcome unknown: block further writes and close/restart the service before rereading the actual file. Do not blindly retry with a new generation or clear a save guard merely because the editor was reopened. Native editors must **export to their own temporary output and submit bytes to `files.save`**. `physicalPath` is for read access; editing it in place bypasses the generation/journal contract and is not supported by this experiment.

An example successful health response includes:

```json
{"id":1,"result":{"ready":true,"protocolVersion":1,"backend":"swift-sqlite-isolated-prototype","capabilities":["projects","flat-files","file-tree","atomic-save","ui-settings","local-identity-acl"],"identityStatus":{"localMode":true,"userId":1,"needsSelection":false},"unavailable":["h2-migration","ai","git-versions","cloud-acl","watcher","external-files"]}}
```

Additional `profile` and `elapsedMs` fields are diagnostic. Measure process launch through the received health/first successful business response externally; do not substitute the internal elapsed field for an app measurement.

## Disk and transaction contract

The profile owns `local.sqlite`, `storage/projects/{id}/...` (a real directory tree mirroring the metadata parent chain), a marker and ownership lock. No arbitrary local roots, external file grants, rename/move/delete, or hard-linked files are supported; symlinks are rejected at every resolved path level (profile, storage, project directory, each ancestor directory, and the final file). Existing file permissions are preserved on save. Stable path validation prevents ordinary symlink escapes; this is not a security boundary against a hostile process with the same OS account racing filesystem changes.

SQLite uses foreign keys, WAL and `synchronous=FULL`. For a save:

1. Read and check the expected fingerprint; create an exclusive staging file in the same directory, write and fsync it, then sync the directory.
2. Commit a pending row containing the file ID, stage name, old/new fingerprints, size and timestamp.
3. Recheck the current bytes; exclusively rename a new file or atomically replace an existing one. Sync the directory.
4. Commit new metadata and remove the pending row in one SQLite transaction. Only then send success.

Startup processes pending rows before accepting requests. If the destination already contains the new fingerprint, finish the metadata transaction. If the original fingerprint and staged bytes still match, complete the replacement. If neither matches, fail startup and preserve the bytes/journal for inspection. Once a journaled save fails, the running process reports unhealthy and blocks further business calls rather than guessing whether the save happened.

Tests inject process termination via `AWD_LOCAL_DATA_TEST_FAULT=afterJournal` and `afterRename` (exit 77), restart without that variable, inspect the actual SQLite journal, verify database integrity and reread the saved bytes. These prove the two selected process-crash boundaries; they do not prove sudden-power-loss durability or every filesystem/SQLite failure. A failed new-project directory/transaction or a pre-journal process crash can leave an orphan directory/staging file or reserved pending file row; automatic garbage collection and complete creation-transaction recovery are not implemented. The prototype does not claim production crash recovery coverage.

No filesystem API can make a SQLite transaction and file rename one shared atomic transaction. This pending journal is the explicit recovery mechanism. Uncooperative external writers can still race between fingerprint checking and rename; cross-process editor coordination and filesystem notifications remain a migration blocker.

## Existing product obligations not migrated

The contracts below were read in `ProjectController`, `ProjectFileController`, `FileController`, `ProjectStorageResolver`, `Project`/`ProjectFile`, `LocalProjectService`, `LocalRootWatchService`, `ProjectRepoService`, and the existing domain documents. No production file was changed for this experiment.

| Existing responsibility | Why this prototype cannot take ownership yet |
| --- | --- |
| Project/file identity | H2 numeric IDs, stable file UUIDs, task/evidence/checkpoint foreign keys and frontend `Number(id)` must survive migration. New SQLite IDs cannot be reused as if they were existing H2 IDs. |
| Storage addressing | Existing projects include both global managed storage and arbitrary `localRoot` projects. Selected external files are exact-file grants. This sample supports only its own managed tree storage. |
| Version records | Version recording defaults on; opt-out persists. The real Git directory is `{globalRoot}/repos/project-{id}.git`; worktree resolution and `.awd/tree.json` must agree. Local-root projects share a stable lock, including overlapping roots. SQLite metadata is not a Git checkpoint. |
| Save/checkpoint/restore | Existing prepare/export/upload leases, unresolved-write guards, precise restore IDs, editor reload and must-exist movement rules must remain one coordinated protocol. Atomic native save alone does not replace that protocol. |
| Watchers | The backend reconciles Finder changes and identity, notifies the file tree, and retains movement/deletion semantics. This sample detects content changes on read/save but does not reconcile external creates/deletes/renames or update a live UI tree. |
| Authentication/permissions | The isolated v3 clone enforces fixed imported identity, membership and file visibility. HTTP sessions, identity selection, ACL management, client upload workflows and cloud authentication remain Java-owned. The pipe is not a substitute for server authorization. |
| Settings | Provider choices and sensitive settings must retain explicit values and secure storage. The sample owns only newly created `local.ui.*` values; existing frontend preferences are not automatically imported. |
| AI/background services | AI tools, queues, orphan recovery, RAG, plugins, cloud sync and attachment writers still expect the Java repositories and locks. There is no safe dual-write mode or automatic handoff in this sample. |

The optional compatibility adapter caches observed metadata while Java remains the only writer; its first save still waits for Java. The offline clone separately preserves IDs/UIDs and enforces a fixed imported identity's permissions, but never takes ownership of originals. A full SQLite ownership change still needs a versioned cutover and rollback, complete identity/permission workflows, one writer for file+Git+AI mutations, and an explicit backend handoff. Neither sample is production-ready.

Use the same synthetic document, project/file count and OS-cache policy for Java/Swift comparisons. Report component startup/read/save timings separately from app rendering, document layout, save/close behavior, and missing capabilities. A much faster component result alone does not meet the user's “faster without reduced experience” merge gate.
