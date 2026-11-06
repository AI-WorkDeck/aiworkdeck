<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Getting started

> Originally contributed by @AzazelSensei in #730; refreshed 2026-09-29; quickstart added 2026-11.

This is the from-source path for contributors and self-hosters. If you only want to try the product, download a [desktop release](https://github.com/AI-WorkDeck/aiworkdeck/releases/latest) instead; it bundles the backend, a JRE, and a local database, so none of the prerequisites below are needed.

## Run it in 5 minutes / 5 分钟跑起来

You need **Docker**, **JDK 21**, **Maven 3**, and **Node.js 20+** (npm). No AI key, no account.

```bash
git clone https://github.com/AI-WorkDeck/aiworkdeck.git
cd aiworkdeck
./scripts/quickstart.sh
```

One command does the rest:

1. starts PostgreSQL (pgvector) in Docker on `127.0.0.1:55432` ([`docker-compose.dev.yml`](../docker-compose.dev.yml));
2. builds the backend and starts it on `127.0.0.1:9696` with the `dev` profile: no sign-in, **mock AI on**;
3. creates a demo project, 「演示案件：买卖合同纠纷」, with four fictional case documents ([`fixtures/evidence-demo-1076`](../fixtures/evidence-demo-1076));
4. installs frontend dependencies on first run, starts the H5 dev server on `http://localhost:5173`, and opens the demo project's workbench in your browser. (In a plain browser the H5 root page is the sign-in page, which the desktop shell skips. The `dev` profile needs no sign-in, so the script opens the workbench URL directly.)

The first run downloads Maven and npm dependencies, so it takes longer than later runs. `Ctrl-C` stops the backend and frontend. The database keeps running; stop it with `docker compose -f docker-compose.dev.yml down` (add `-v` to delete the data). Logs, uploaded files, and the backend's isolated home directory are kept in `.quickstart/` (git-ignored), not in your desktop app's `~/.aiworkdeck`.

**Mock AI.** With the `dev` profile the chat uses a deterministic fake model (`MockChatModel`). In Agent mode it calls one read-only tool (`doc_list_project_files`), then answers with an excerpt of the result. In Ask mode it echoes your message. Each reply says it is a mock. This lets you work on the chat UI, tool calls, and SSE stream without a key. The mock only starts with the `dev` profile. If `ai.mock.enabled=true` is combined with `prod`, `cloud`, `case`, or `desktop`, the backend refuses to start. The mock cannot be selected in Settings.

| Variable | Effect |
|---|---|
| `AI_MOCK_ENABLED=false` | Use a real provider instead (configure it in Settings; cloud models require signing in) |
| `AWD_SKIP_BUILD=1` | Reuse the existing backend jar |
| `AWD_NO_OPEN=1` | Do not open the browser |
| `AWD_DB_PORT=55432` | Host port for PostgreSQL |

The quickstart starts only the minimal stack. OCR (MinerU), PPT generation, speech, and other sidecars are not started, and features that depend on them report that the component is unavailable. To run the full contributor stack, use `restart-all.sh` below. For a server deployment, see [self-hosting](self-hosting.md).

## Full stack (sidecars and desktop shell)

> **Root `docker-compose.yml` is not a full stack / 根目录 compose 不是全栈.** It only starts the MinerU and PPTX sidecars; the backend, frontend, and PostgreSQL run on the host via `restart-all.sh`. See [docker-sidecars.md](docker-sidecars.md). Law-firm evaluators should start with [firm-eval-topology-a.md](firm-eval-topology-a.md) (desktop release, no prerequisites).

### Prerequisites

| Requirement | Version |
|---|---|
| Docker Desktop | Latest (MinerU and PPTX sidecars; the rest of the stack starts without it) |
| Java | JDK 21 (what CI builds with; the plugin SPI is compiled for 21). Newer JDKs such as 25 have crashed the Maven build on macOS. |
| Maven | 3.x |
| Node.js | 18+ (CI uses 20) |
| PostgreSQL | 14+ |
| npm | Use npm, not pnpm |

`restart-all.sh` is a bash script that relies on `lsof`; it is written for macOS and Linux.

### Run the stack

```bash
git clone https://github.com/AI-WorkDeck/aiworkdeck.git
cd aiworkdeck

cp backend/.env.example backend/.env.production
cp pptx-service/.env.example pptx-service/.env

# Create a PostgreSQL database named `checkba`
# (or point the backend env at your own database name)

chmod +x restart-all.sh
./restart-all.sh
```

The script starts the Docker sidecars, builds and starts the backend, starts the H5 dev server, and opens a dev Electron window.

| Service | URL |
|---|---|
| Frontend (H5 dev server) | http://localhost:5173 |
| Backend | http://localhost:9696 |
| PPTX service | http://localhost:5001 |
| MinerU service | http://localhost:8001 |

Running the parts one at a time:

| Part | Command | Notes |
|---|---|---|
| Backend | `cd backend && ./restart-backend.sh` | `mvn package -DskipTests`, then restarts the jar on 9696; log in `backend/app.log` |
| Frontend | `cd frontend && npm run dev:h5` | Port 5173. The end-to-end suites use a separate dev server on 5174 (`npx uni --port 5174`). |
| Desktop | `cd desktop && npm run dev` | Dev Electron window; reuses the backend already running on 9696 |

Text-to-speech is on-device (bundled Kokoro). `restart-all.sh` does not start the legacy EasyVoice container.

OpenRouter, Gemini, Qichacha, Tushare, PKULaw, Aliyun OCR/Tingwu, and object storage are optional. You can inspect the code and run the basic workbench without them.

## What you should see

The app opens straight into the workbench with a **Welcome** tab; there is no sign-in or unlock step at startup. You can create a project and open, edit, and save documents without an account. AI, paid Marketplace content, the team case library, and mobile sync ask you to sign in, in place, the first time you use them.

## Tests

- Backend: `cd backend && mvn -B test` (JDK 21).
- Frontend: `frontend/package.json` lists the suites (`npm run test:commands`, `npm run test:lowa-e2e`, `npm run test:app-e2e`, and others). The end-to-end suites need the backend on 9696 and a dev server on 5174.

## Contributing

1. Fork the repo, branch from `master`.
2. Read [CONTRIBUTING.md](../.github/CONTRIBUTING.md). Code PRs need a [CLA](../legal/CLA.md); the bot asks you to sign on the first PR.
3. Keep changes focused. Substantial API or plugin-SDK changes should start as an [RFC](../rfcs/0000-template.md).
4. New first-party source files carry the two-line SPDX header used across the repo (`SPDX-FileCopyrightText` plus `SPDX-License-Identifier: AGPL-3.0-or-later`); CI checks newly added files.
5. `docs/` is listed in `.gitignore`. To add a document there, use `git add -f`.
6. The app version has a single source: `desktop/package.json`. Do not bump versions in other files.

Useful first patches: setup notes for another OS, `.env` examples, plugin samples, tests around parsing / tool calls / frontend flows, bilingual docs.

See also [architecture](architecture.md) and the [plugin guide](plugin-guide.md).
