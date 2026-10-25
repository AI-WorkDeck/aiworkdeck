<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Existing-project compatibility experiment

`createJavaAuthority` connects to one explicitly supplied loopback Java backend. It verifies desktop health/build, local identity and storage-root identity before reading real projects. Project/file IDs and UIDs, H2, original file locations and Git repositories remain unchanged. Java remains the sole writer; the separate Swift prototype never writes these files.

This is not H2 migration. SQLite is an observed directory cache, plus durable guards for writes whose outcome is unresolved. It can display last-observed project/file metadata before Java is ready, but opening authoritative bytes, saving, version operations and AI still require the original backend. The cached HTTP collection is not a transactional snapshot or a complete change stream. Source/build/identity changes invalidate it. Do not claim full interactive startup has become a millisecond SQLite read.

`clearCache()` deletes only the directory snapshot. It deliberately retains unresolved upload/restore guards. Deleting the entire database is **not** a safe recovery action for an uncertain write. Current HTTP APIs do not offer server-side compare-and-swap: the read-before-upload generation check detects prior changes but cannot eliminate simultaneous writes by another client. Production integration requires the original multi-client/save/checkpoint contracts.

The adapter's `snapshot`, `readFile`, `saveFile`, `history`, `createVersion` and `restore` call real existing APIs. Version creation first requires `editor.flush(context) === true`. Restore additionally requires `close(context)` to return `{ok:true,closed:true,operationId}` only after all affected writable models are destroyed, and `reload(context)` to acknowledge the same operation ID only after authoritative bytes have been downloaded and loaded. Ordinary project-version revert is separate from AI checkpoint restore; this adapter does not implement the latter.

The visible prototype supplies one-document callbacks. It does not establish cross-window, AI, watcher or cloud-write parity. Unknown uploads/reverts persist a guard, block automatic retry and prevent reopening stale bytes. Cache failure must never be interpreted as confirmed authority.

An upload rejected with HTTP 423 and the exact `code:-1`, `reason:VERSION_BUSY`, `writeState:not_started` contract clears only that attempted upload's guard and reports a retryable busy result. Missing fields, other statuses and errors after an accepted upload remain unknown. A pre-existing uncertain guard still prevents a new request; a later busy reply cannot clear it. The mock HTTP/real SQLite suite verifies rejection, manual retry, incomplete responses and the prior-uncertainty case.

## Tests

```sh
COMPAT_TEST_OUTPUT=/absolute/new-owned-output node --test desktop/prototypes/local-data/compatibility/java-authority.test.cjs
node desktop/prototypes/local-data/compatibility/real-java-test.cjs \
  --base-url http://127.0.0.1:OWNED_PORT \
  --expected-build EXACT_OWNED_BUILD \
  --expected-storage-root /absolute/owned/storage \
  --fixture-root /absolute/new-owned-fixture
```

The first suite uses mock HTTP and real macOS SQLite. The second requires a separately launched, isolated Java 21/H2 instance; it checks ownership before creating any synthetic project, then verifies real Git history, revert, persistent original IDs and cache clearing. No native editor is open in the API-level test, so its lifecycle callbacks cannot prove native UI restore behavior. Run the visible host separately and inspect exported files.
