<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 自托管：最小部署 / Self-hosting: minimal deployment

本页写的是在一台自己的 Linux 服务器上跑起 AI WorkDeck **主栈**（PostgreSQL + Java 后端 + H5 前端 + nginx）的最小做法。
不依赖任何托管平台，只用 Docker（数据库）、JDK 21、Node.js 和 nginx。
This page describes the smallest way to run the AI WorkDeck main stack on your own Linux server: PostgreSQL,
the Java backend, the H5 frontend, and nginx. It needs no hosting platform, only Docker (for the database), JDK 21,
Node.js, and nginx.

> - 只想本机体验或开发：用 [`scripts/quickstart.sh`](getting-started.md#run-it-in-5-minutes--5-分钟跑起来)，那是 dev profile（免登 + 模拟 AI），**不能**用于服务器。
> - 律师个人评估：用[桌面版](firm-eval-topology-a.md)，不需要服务器。
> - 浏览器里的文档编辑器（LOWA）在纯 Web 部署下的限制见 [`deploy/web/README.md`](../deploy/web/README.md)。
> - For local trials or development use `scripts/quickstart.sh`. It runs the `dev` profile (no sign-in, mock AI) and
>   **must not** run on a server. Individual lawyers evaluating the product should use the desktop app.

## 组成 / What runs

| 组件 Component | 运行方式 How | 监听 Listens on |
|---|---|---|
| PostgreSQL 16 + pgvector | `docker-compose.dev.yml` 或你自己的实例 | `127.0.0.1:55432`（或你的端口） |
| 后端 Backend | `java -jar`，默认 profile（服务器模式，需账号登录） | `127.0.0.1:9696` |
| 前端 Frontend | `npm run build:h5` 的静态文件，由 nginx 提供 | nginx `:443` |
| nginx | 反代 `/api/` 到后端，加 TLS 与 COOP/COEP 头 | `:443` |

OCR、PPT、语音等旁路服务不在最小栈里；需要时按 [docker-sidecars.md](docker-sidecars.md) 另起，只发布到回环。
OCR, PPT, and speech sidecars are not part of the minimal stack; see docker-sidecars.md if you need them.

## 步骤 / Steps

```bash
git clone https://github.com/AI-WorkDeck/aiworkdeck.git && cd aiworkdeck

# 1. 数据库：改掉默认口令再起（只发布到 127.0.0.1）
export DB_PASSWORD='换成强口令'
docker compose -f docker-compose.dev.yml up -d --wait

# 2. 后端（JDK 21）
mvn -B -DskipTests -f backend/pom.xml package
cd backend
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:55432/checkba \
DB_PASSWORD="$DB_PASSWORD" \
AI_SKILLS_BUILTIN_DIR="$PWD/skills" \
AI_PLUGINS_BUNDLED_DIR="$PWD/../official-plugins" \
  java -jar target/backend-*.jar
cd ..

# 3. 前端静态文件（同源部署，无需设置 VITE_API_BASE_URL）
cd frontend && npm ci && npm run build:h5 && cd ..
#    产物在 frontend/dist/build/h5/，拷到 nginx 的站点目录
```

4. nginx 配置以 [`deploy/web/nginx.conf.example`](../deploy/web/nginx.conf.example) 为模板，改域名和证书。
   它把 `/api/` 反代到 `127.0.0.1:9696`，并加上编辑器需要的 COOP/COEP 头。
   Use `deploy/web/nginx.conf.example` as the nginx template; it proxies `/api/` to the backend and adds COOP/COEP headers.
5. 生产上建议用 systemd 托管后端进程（参考 `deploy/cloud/aiworkdeck-cloud.service` 的写法，按需改路径与环境变量）。
   Run the backend under systemd; `deploy/cloud/aiworkdeck-cloud.service` is a starting point.

后端默认从当前目录读写 `data/`（上传文件）、`skills/`、`plugins/`，所以第 2 步在 `backend/` 目录里启动；
也可以用 `STORAGE_LOCAL_ROOT_PATH`、`AI_PLUGINS_DIR` 指到别处。
The backend reads and writes `data/`, `skills/`, and `plugins/` relative to its working directory, so start it from
`backend/`, or point `STORAGE_LOCAL_ROOT_PATH` / `AI_PLUGINS_DIR` elsewhere.

## 首次登录与 AI / First sign-in and AI

- 默认 profile 是服务器模式：首次启动会建一个 `admin` 账号，**随机初始口令只在启动日志里出现一次**，取走后立即改密，
  再给同事开账号（见 [`deploy/web/README.md`](../deploy/web/README.md)）。
  The default profile runs in server mode. On first start it creates an `admin` account and prints a random initial
  password once in the startup log. Change it right away.
- AI 在设置页里配置供应商。当前前端对所有云端供应商（含自备 OpenRouter Key）都会要求就地登录 AI WorkDeck 账户，
  只有本地 Ollama 档免账户（只支持问答模式）。服务器上不要开 `ai.mock.enabled`：它只允许 dev profile，
  与 prod/cloud/case/desktop 同开时后端拒绝启动。
  Configure the AI provider in Settings. The frontend currently asks for an AI WorkDeck account for every cloud
  provider, including your own OpenRouter key; only local Ollama (Ask mode only) works without one. Do not enable the
  mock model on a server; it is restricted to the `dev` profile.

## 安全底线 / Security baseline

- 后端只监听 `127.0.0.1`（`server.address` 默认值），对外只经 nginx + TLS。
- 数据库、旁路服务端口只发布到回环，不对公网开放。
- 第三方出站（模型供应商、企查查、法宝等）只有在你配置了对应凭据后才会发生，范围见 [`legal/PRIVACY.md`](../legal/PRIVACY.md)。
- The backend listens on `127.0.0.1` only; expose it through nginx with TLS. Keep database and sidecar ports on loopback.
  Third-party calls happen only for services you configure; see `legal/PRIVACY.md`.
