#!/bin/zsh

# 一键启动核查宝本地开发环境：后端 + 前端（项目新建页）+ 面板（如需）
# 使用前请确保已在 backend / frontend / panel 目录下分别执行过一次 npm install / mvn 下载依赖。

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> 启动后端 (Spring Boot, 端口 8080)..."
cd "$ROOT_DIR/backend"
# 优先使用本地 mvnw，若不存在则退回系统 mvn
if [ -x "./mvnw" ]; then
  ./mvnw spring-boot:run &
else
  mvn spring-boot:run &
fi
BACKEND_PID=$!

echo "后端进程 PID: $BACKEND_PID"

echo "==> 启动前端（mobile/uni-app，新建项目页，端口 5173）..."
cd "$ROOT_DIR/frontend"
npm run dev:h5 -- --port 5173 &
FRONTEND_PID=$!
echo "前端进程 PID: $FRONTEND_PID"

echo "==> 启动管理面板（panel，可选，端口 5174）..."
cd "$ROOT_DIR/panel"
npm run dev:h5 -- --port 5174 &
PANEL_PID=$!
echo "面板进程 PID: $PANEL_PID"

cd "$ROOT_DIR"

cat <<EOF

所有服务已启动（按 Ctrl+C 可整体停止脚本，会向子进程发送终止信号）：
- 后端:    http://localhost:8080
- 前端:    http://localhost:5173
- 面板:    http://localhost:5174

提示：
- H2 数据库为内嵌模式，无需单独启动数据库进程。
- 修改后端代码后，需要重启后端；修改前端代码由 Vite/uni 自动热更新。

EOF

wait


