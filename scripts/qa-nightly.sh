#!/bin/zsh
# SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# 每日全量 QA / daily QA run — 由用户 crontab 经 ~/aiworkdeck-qa/run.sh 调起。
# 在专用克隆（~/aiworkdeck-qa/repo）上跑，绝不碰维护者的工作 checkout。
#
# 跑什么（两项都是必需检查，not_run 不得写成通过）：
#   1) tests/lowa-e2e  —— 真实 LOWA 引擎 + 覆盖层键盘链路（自包含）
#   2) tests/app-e2e   —— 全应用真人模拟（打包版后端 + 隔离 user.home，端口 19685）
# 产出：~/aiworkdeck-qa/reports/YYYY-MM-DD.md；结果同步到一条滚动 issue（标签 bug，见文末）。
#
# 引擎来源：打包版 /Applications/AI WorkDeck.app 内置的 lowa/ + cjk 字体（离线、稳定，
# 免 CDN；build:zetaoffice 会清空 dist，故引擎复制必须在 build 之后）。

set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

QA_HOME="${QA_HOME:-$HOME/aiworkdeck-qa}"
APP="${QA_APP:-/Applications/AI WorkDeck.app}"
REPO="$QA_HOME/repo"
REPORTS="$QA_HOME/reports"
APP_RES="$APP/Contents/Resources/frontend/dist/zetaoffice"
DAY=$(date +%F)
REPORT="$REPORTS/$DAY.md"
PORT="${QA_FRONTEND_PORT:-5199}"
mkdir -p "$REPORTS"

FAILED=0
LOWA_RESULT="not_run"
APP_RESULT="not_run"
log() { echo "$(date +%T) $*" }
section() { echo "\n## $*" >> "$REPORT" }

echo "# AI WorkDeck 每日 QA — $DAY" > "$REPORT"

# 可选：机器级重活锁（QA_SLOT_CMD 指向 heavy-slot.sh）；无空位就跳过今晚，不和录屏/其他重活抢机器
if [[ -n "${QA_SLOT_CMD:-}" ]]; then
  if ! SLOT_DIR=$("$QA_SLOT_CMD" acquire "qa-nightly" "nightly QA" 90 2>&1); then
    echo "未运行：无空闲重活槽位（$SLOT_DIR）" >> "$REPORT"
    echo "\n**结论：not_run，不能视为通过**" >> "$REPORT"
    exit 2
  fi
  trap '"$QA_SLOT_CMD" release qa-nightly >/dev/null 2>&1' EXIT
fi

# ---- 更新专用克隆 ----
if [[ ! -d "$REPO/.git" ]]; then
  git clone --depth 20 https://github.com/AI-WorkDeck/aiworkdeck.git "$REPO" || { echo "clone 失败" >> "$REPORT"; exit 1 }
fi
cd "$REPO"
git fetch origin master --depth 20 && git reset --hard origin/master >> /dev/null || {
  echo "更新专用克隆失败；本轮 not_run" >> "$REPORT"; exit 1
}
echo "commit: $(git log -1 --format='%h %s')" >> "$REPORT"

# ---- 前端依赖与构建 ----
cd "$REPO/frontend"
npm ci --no-audit --no-fund --loglevel=error > /dev/null 2>&1 || {
  echo "npm ci 失败；不得复用旧依赖冒充本轮通过" >> "$REPORT"; FAILED=1
}
npx vite build --config vite.zetaoffice.config.js > /dev/null 2>&1 || { echo "build:zetaoffice 失败" >> "$REPORT"; FAILED=1 }

# ---- 引擎：从打包版复制（build 之后！）----
if [[ -f "$APP_RES/lowa/soffice.js" ]]; then
  cp -R "$APP_RES/lowa" dist/zetaoffice/
  cp "$APP_RES/cjk.ttc" dist/zetaoffice/ 2>/dev/null
else
  echo "打包版引擎缺失（$APP_RES），lowa-e2e not_run" >> "$REPORT"
fi

# ---- 1) LOWA 编辑器键盘链路 ----
section "lowa-e2e（编辑器键盘/IME 链路）"
if [[ -f dist/zetaoffice/lowa/soffice.js ]]; then
  if npm run test:lowa-e2e > "$QA_HOME/lowa-e2e.log" 2>&1; then
    LOWA_RESULT="passed"
    tail -3 "$QA_HOME/lowa-e2e.log" >> "$REPORT"
  else
    LOWA_RESULT="failed"
    FAILED=1
    echo '```' >> "$REPORT"; tail -30 "$QA_HOME/lowa-e2e.log" >> "$REPORT"; echo '```' >> "$REPORT"
  fi
else
  FAILED=1
  echo "not_run（无引擎）；必需检查未执行，不能判为通过" >> "$REPORT"
fi

# ---- 2) 全应用真人模拟 ----
# 只用打包版内置的 JRE + 后端起隔离 desktop 后端（独立 user.home、空库、未连账户），
# 内置技能 / 插件取专用克隆里的最新源码。不得回退到个人默认后端或真实工作区。
section "app-e2e（全应用真人模拟）"
APP_BACKEND_PORT="${QA_BACKEND_PORT:-19685}"
APP_BE="$APP/Contents/Resources/backend"
APP_JAVA="$APP/Contents/Resources/jre/bin/java"
E2E_BACKEND_PORT=""
E2E_BACKEND_PID=""
if [[ -x "$APP_JAVA" && -f "$APP_BE/app.jar" ]]; then
  E2E_HOME="$QA_HOME/e2e-home"
  rm -rf "$E2E_HOME"; mkdir -p "$E2E_HOME"
  SPRING_PROFILES_ACTIVE=desktop \
  AI_SKILLS_BUILTIN_DIR="$REPO/backend/skills" \
  AI_PLUGINS_BUNDLED_DIR="$REPO/official-plugins" \
  AWD_APP_VERSION=$(node -p "require('$REPO/desktop/package.json').version") \
  "$APP_JAVA" -Duser.home="$E2E_HOME" -Dserver.port=$APP_BACKEND_PORT \
    -cp "$APP_BE/app.jar:$APP_BE/lib/*" com.checkba.CheckbaApplication > "$QA_HOME/e2e-backend.log" 2>&1 &
  E2E_BACKEND_PID=$!
  for i in {1..60}; do
    curl -s "http://127.0.0.1:$APP_BACKEND_PORT/api/account/status" 2>/dev/null | grep -q '"code":0' && { E2E_BACKEND_PORT=$APP_BACKEND_PORT; break }
    sleep 3
  done
fi
if [[ -n "$E2E_BACKEND_PORT" ]]; then
  (VITE_API_BASE_URL="http://127.0.0.1:$E2E_BACKEND_PORT" npx uni --port $PORT > "$QA_HOME/dev.log" 2>&1 &)
  for i in {1..40}; do curl -s -o /dev/null "http://127.0.0.1:$PORT" && break; sleep 3; done
  CHROME_FT=$(ls -d /Users/Shared/claude-work/browsers/chrome/*/chrome-mac-arm64/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" 2>/dev/null | tail -1)
  [[ -n "$CHROME_FT" ]] && export PUPPETEER_EXECUTABLE_PATH="$CHROME_FT"
  if APP_E2E_BASE="http://127.0.0.1:$PORT" APP_E2E_BACKEND="http://127.0.0.1:$E2E_BACKEND_PORT" \
     npm run test:app-e2e > "$QA_HOME/app-e2e.log" 2>&1; then
    APP_RESULT="passed"
    tail -3 "$QA_HOME/app-e2e.log" >> "$REPORT"
  else
    APP_RESULT="failed"
    FAILED=1
    echo '```' >> "$REPORT"; tail -40 "$QA_HOME/app-e2e.log" >> "$REPORT"; echo '```' >> "$REPORT"
  fi
  pkill -f "uni --port $PORT" 2>/dev/null
else
  APP_RESULT="not_run"
  FAILED=1
  echo "app-e2e not_run：隔离打包版后端不可用（见 $QA_HOME/e2e-backend.log）；不得使用个人默认后端兜底" >> "$REPORT"
fi
[[ -n "$E2E_BACKEND_PID" ]] && kill "$E2E_BACKEND_PID" 2>/dev/null

# ---- 汇报：逐项公开状态；只有两项都 passed 才能写全部通过 ----
section "必需检查结果"
echo "| 检查 | 状态 |" >> "$REPORT"
echo "|---|---|" >> "$REPORT"
echo "| lowa-e2e | $LOWA_RESULT |" >> "$REPORT"
echo "| app-e2e | $APP_RESULT |" >> "$REPORT"
if [[ $FAILED -ne 0 || "$LOWA_RESULT" != "passed" || "$APP_RESULT" != "passed" ]]; then
  FAILED=1
  echo "\n**结论：未全部通过；failed 与 not_run 均不计为通过 ❌**" >> "$REPORT"
else
  echo "\n**结论：两项必需检查全部通过 ✅**" >> "$REPORT"
fi

# 只维护一条滚动 issue，不再每天新开：失败时在它下面追加当天报告（已关闭则重开），
# 恢复全绿时留言并关闭。按固定标题精确匹配，取最近一条。
GH_REPO=AI-WorkDeck/aiworkdeck
ROLLING_TITLE="每日 QA 滚动报告 / nightly QA (rolling)"
ROLLING=$(gh issue list -R $GH_REPO --state all --limit 5 \
  --search "\"$ROLLING_TITLE\" in:title sort:created-desc" --json number,title,state \
  -q ".[] | select(.title == \"$ROLLING_TITLE\") | \"\\(.number) \\(.state)\"" 2>/dev/null | head -1)
ROLLING_NUM=${ROLLING%% *}
ROLLING_STATE=${ROLLING##* }
if [[ $FAILED -ne 0 ]]; then
  if [[ -z "$ROLLING_NUM" ]]; then
    gh issue create -R $GH_REPO --title "$ROLLING_TITLE" --label bug \
      --body-file "$REPORT" 2>> "$REPORT" || true
  else
    [[ "$ROLLING_STATE" == "CLOSED" ]] && gh issue reopen "$ROLLING_NUM" -R $GH_REPO 2>> "$REPORT"
    gh issue comment "$ROLLING_NUM" -R $GH_REPO --body-file "$REPORT" 2>> "$REPORT" || true
  fi
elif [[ -n "$ROLLING_NUM" && "$ROLLING_STATE" == "OPEN" ]]; then
  gh issue comment "$ROLLING_NUM" -R $GH_REPO --body "$DAY 每日 QA 全部通过，自动关闭；再次失败时会重开本 issue。" 2>> "$REPORT" \
    && gh issue close "$ROLLING_NUM" -R $GH_REPO 2>> "$REPORT"
fi
exit $FAILED
