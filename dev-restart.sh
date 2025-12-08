#!/bin/zsh

# 一键重启本地开发环境：尝试杀掉常用端口上的进程，然后重新调用 dev-start.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

PORTS=(8080 5173 5174)

echo "==> 尝试关闭端口 ${PORTS[*]} 上的已有进程..."
for p in "${PORTS[@]}"; do
  PIDS="$(lsof -ti tcp:$p 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    echo "  - 端口 $p: 终止进程 $PIDS"
    kill $PIDS 2>/dev/null || true
  else
    echo "  - 端口 $p: 无正在监听的进程"
  fi
done

sleep 2

echo "==> 重新启动所有服务..."
cd "$ROOT_DIR"
bash "$ROOT_DIR/dev-start.sh"


