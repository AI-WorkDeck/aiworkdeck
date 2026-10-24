<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Isolated native local-data prototype

This is a component experiment for macOS, not a replacement product backend. It runs Swift/Foundation with the system SQLite library, stores actual metadata and document bytes, and exposes a JSON-lines child-process protocol. It is not used by the production desktop entry point, does not open H2, and does not migrate existing projects. Windows support is unchanged.

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
{"id":3,"method":"files.create","params":{"projectId":1,"name":"example.txt","contentBase64":"aGVsbG8="}}
{"id":4,"method":"files.read","params":{"projectId":1,"fileId":1}}
```

Every response preserves `id` and has either `result` or `error: {code,message}`. Stdout contains only protocol messages. The trusted desktop main process should hold this pipe; do not expose an unrestricted method dispatcher or physical file paths to untrusted renderer content.

| Method | Parameters | Actual result |
| --- | --- | --- |
| `health` | None | `ready`, `protocolVersion`, owned profile, implemented capabilities, unavailable capabilities |
| `projects.list` | None | Array of SQLite projects, ordered by numeric ID |
| `projects.get` | `projectId` | One project; missing is an error |
| `projects.create` | `name` | Persisted numeric `id`, stable UUID `uid`, name, timestamps, local-only `myRole: OWNER` |
| `files.list` | `projectId` | Flat list of persisted live files; no fabricated folder tree |
| `files.create` | `projectId`, `name`, `contentBase64` | Persisted file metadata after bytes have been published |
| `files.read` | `projectId`, `fileId` | Metadata, actual `contentBase64`, actual SHA-256 `generation`, `physicalPath` for a trusted native document adapter |
| `files.save` | `projectId`, `fileId`, `expectedGeneration`, `contentBase64` | Metadata after successful disk and database commit |
| `settings.get` | `key` | JSON value or null; only `local.ui.*` is accepted |
| `settings.set` | `key`, `value` | Persisted JSON value; only `local.ui.*` is accepted |

`files.read` hashes the actual bytes. `files.save` must pass the generation returned by that read (or the previous successful save); a stale fingerprint returns `CONFLICT`. A disappeared original returns `NOT_FOUND` and is never silently recreated. Numeric project and file IDs are both required; a file in another project cannot be addressed with a guessed ID. These are new prototype identities, not imported H2 identities. Text metadata, including project names and setting keys, rejects U+0000 before SQLite binding; it must never silently truncate or alias an existing key. Content is limited to 32 MiB; the base64 protocol copies buffers and is not a large-file streaming design.

For a save response, update the editor's generation only on success. A pipe failure or `RECOVERY_REQUIRED` leaves the outcome unknown: block further writes and close/restart the service before rereading the actual file. Do not blindly retry with a new generation or clear a save guard merely because the editor was reopened. Native editors must **export to their own temporary output and submit bytes to `files.save`**. `physicalPath` is for read access; editing it in place bypasses the generation/journal contract and is not supported by this experiment.

An example successful health response includes:

```json
{"id":1,"result":{"ready":true,"protocolVersion":1,"backend":"swift-sqlite-isolated-prototype","capabilities":["projects","flat-files","atomic-save","ui-settings"],"unavailable":["h2-migration","ai","git-versions","cloud-acl","watcher","folders","external-files"]}}
```

Additional `profile` and `elapsedMs` fields are diagnostic. Measure process launch through the received health/first successful business response externally; do not substitute the internal elapsed field for an app measurement.

## Disk and transaction contract

The profile owns `local.sqlite`, `storage/projects/{id}/{name}`, a marker and ownership lock. No arbitrary local roots, external file grants, nested folders, symlinks, or hard-linked files are supported. Existing file permissions are preserved on save. Stable path validation prevents ordinary symlink escapes; this is not a security boundary against a hostile process with the same OS account racing filesystem changes.

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
| Storage addressing | Existing projects include both global managed storage and arbitrary `localRoot` projects. Selected external files are exact-file grants. This sample supports only its own managed, flat storage. |
| Version records | Version recording defaults on; opt-out persists. The real Git directory is `{globalRoot}/repos/project-{id}.git`; worktree resolution and `.awd/tree.json` must agree. Local-root projects share a stable lock, including overlapping roots. SQLite metadata is not a Git checkpoint. |
| Save/checkpoint/restore | Existing prepare/export/upload leases, unresolved-write guards, precise restore IDs, editor reload and must-exist movement rules must remain one coordinated protocol. Atomic native save alone does not replace that protocol. |
| Watchers | The backend reconciles Finder changes and identity, notifies the file tree, and retains movement/deletion semantics. This sample detects content changes on read/save but does not reconcile external creates/deletes/renames or update a live UI tree. |
| Authentication/permissions | Current HTTP APIs enforce session and project/file ACLs. This is a trusted single-profile pipe; `OWNER` is only the synthetic local owner, not a substitute for server authorization. |
| Settings | Provider choices and sensitive settings must retain explicit values and secure storage. The sample owns only newly created `local.ui.*` values; existing frontend preferences are not automatically imported. |
| AI/background services | AI tools, queues, orphan recovery, RAG, plugins, cloud sync and attachment writers still expect the Java repositories and locks. There is no safe dual-write mode or automatic handoff in this sample. |

An eventual read-model option may cache existing H2 project/file metadata with a source revision while Java remains the only writer. It would improve early reads but still need Java ready for the first save. A full SQLite ownership change needs a versioned offline migration and rollback, preserved IDs/UIDs/permissions, one writer for file+Git+AI mutations, and an explicit backend handoff. Neither option is implemented or represented as production-ready here.

Use the same synthetic document, project/file count and OS-cache policy for Java/Swift comparisons. Report component startup/read/save timings separately from app rendering, document layout, save/close behavior, and missing capabilities. A much faster component result alone does not meet the user's “faster without reduced experience” merge gate.
