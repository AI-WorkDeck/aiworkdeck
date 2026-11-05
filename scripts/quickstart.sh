#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 一条命令在本机跑起最小开发栈：PostgreSQL（Docker）+ 后端（dev profile，模拟 AI）+ H5 前端，
# 灌入演示项目并打开浏览器。不需要任何 AI Key，也不起 OCR / ASR / PPT 等旁路服务。
# Ctrl-C 停止后端与前端；数据库容器保留（docker compose -f docker-compose.dev.yml down 关掉）。
#
# 可选环境变量：
#   AI_MOCK_ENABLED=false   改用真实模型（需自行在设置页配置供应商）
#   AWD_SKIP_BUILD=1        跳过后端 mvn package（jar 已是最新时省时间）
#   AWD_NO_OPEN=1           不自动打开浏览器
#   AWD_DB_PORT=55432       Postgres 宿主端口
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.quickstart"
BACKEND_PORT=9696   # 前端本地开发固定连 9696（frontend/src/services/api.js）
WEB_PORT=5173
export AWD_DB_PORT="${AWD_DB_PORT:-55432}"
mkdir -p "$DATA/home" "$DATA/storage"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# ---- 1. 前置检查 ----
say "检查依赖"
command -v docker >/dev/null || die "未找到 docker。请安装 Docker Desktop（或 Docker Engine + compose 插件）"
docker info >/dev/null 2>&1 || die "Docker 没在运行，先启动 Docker"
docker compose version >/dev/null 2>&1 || die "需要 docker compose v2（docker compose 子命令）"
command -v mvn >/dev/null || die "未找到 mvn。请安装 Maven 3.x"
command -v node >/dev/null && command -v npm >/dev/null || die "未找到 node/npm。请安装 Node.js 20+"
if [ -x /usr/libexec/java_home ] && /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
fi
JAVA="${JAVA_HOME:+$JAVA_HOME/bin/}java"
JAVA_MAJOR="$("$JAVA" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "$JAVA_MAJOR" = "21" ] || die "需要 JDK 21（当前：${JAVA_MAJOR:-未找到}）。可设 JAVA_HOME 指向 JDK 21"
for port in "$BACKEND_PORT" "$WEB_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    die "端口 $port 已被占用（可能是另一份 AWD 后端/前端）。先停掉它再运行"
  fi
done

# ---- 2. 数据库 ----
say "启动 PostgreSQL（127.0.0.1:${AWD_DB_PORT}）"
docker compose -f "$ROOT/docker-compose.dev.yml" up -d --wait

# ---- 3. 后端 ----
cd "$ROOT/backend"
if [ "${AWD_SKIP_BUILD:-0}" != "1" ] || ! ls target/backend-*.jar >/dev/null 2>&1; then
  say "构建后端（首次需要下载依赖，可能要几分钟）"
  mvn -q -B -DskipTests package
fi
JAR="$(ls target/backend-*.jar | head -1)"

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  [ ${#PIDS[@]} -gt 0 ] && kill "${PIDS[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
  printf '\n已停止后端与前端。数据库仍在运行：docker compose -f docker-compose.dev.yml down\n'
}
trap cleanup INT TERM EXIT

say "启动后端（dev profile，日志 .quickstart/backend.log）"
# user.home、存储、已装插件目录都指到 .quickstart/：不碰本机桌面版的 ~/.aiworkdeck，也不往源码树里写
SPRING_PROFILES_ACTIVE=dev \
STORAGE_LOCAL_ROOT_PATH="$DATA/storage" \
AI_PLUGINS_DIR="$DATA/plugins" \
AI_SKILLS_BUILTIN_DIR="$ROOT/backend/skills" \
AI_PLUGINS_BUNDLED_DIR="$ROOT/official-plugins" \
  "$JAVA" -Duser.home="$DATA/home" -jar "$JAR" > "$DATA/backend.log" 2>&1 &
BACKEND_PID=$!
PIDS+=("$BACKEND_PID")
for i in $(seq 1 120); do
  curl -sf "http://127.0.0.1:$BACKEND_PORT/api/admin/wizard" >/dev/null 2>&1 && break
  kill -0 "$BACKEND_PID" 2>/dev/null || { tail -30 "$DATA/backend.log"; die "后端启动失败，见 .quickstart/backend.log"; }
  [ "$i" = 120 ] && die "后端 240 秒内未就绪，见 .quickstart/backend.log"
  sleep 2
done

say "灌入演示数据"
SEED_OUT="$(node "$ROOT/scripts/quickstart/seed-demo.mjs" "http://127.0.0.1:$BACKEND_PORT")"
printf '%s\n' "$SEED_OUT" | sed '$d'
DEMO_ID="$(printf '%s\n' "$SEED_OUT" | tail -1)"

# ---- 4. 前端 ----
cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  say "安装前端依赖（npm ci）"
  npm ci --no-audit --no-fund
fi
say "启动前端（日志 .quickstart/frontend.log）"
npx uni --port "$WEB_PORT" > "$DATA/frontend.log" 2>&1 &
PIDS+=("$!")
for i in $(seq 1 120); do
  curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && break
  [ "$i" = 120 ] && die "前端 240 秒内未就绪，见 .quickstart/frontend.log"
  sleep 2
done

# 纯浏览器 H5 的启动页是登录页（桌面壳才直进工作台）；dev profile 免登，直接打开演示项目的工作台
URL="http://localhost:$WEB_PORT/#/pages/project-overview/project-overview?id=$DEMO_ID"
if [ "${AWD_NO_OPEN:-0}" != "1" ]; then
  if command -v open >/dev/null; then open "$URL"; elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
fi
printf '\n✓ AI WorkDeck 已就绪：%s\n  AI：%s\n  按 Ctrl-C 停止\n' "$URL" \
  "$([ "${AI_MOCK_ENABLED:-true}" = "false" ] && echo '真实模型（需在设置页配置）' || echo '模拟 AI（无需 Key）')"
wait
