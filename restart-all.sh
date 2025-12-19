#!/bin/bash
set -e

PROJECT_ROOT=$(pwd)

echo "=================================================="
echo "   Checkba Project One-Click RESTART"
echo "=================================================="

# ==========================================
# 1. 停止桌面端 (Stop Desktop)
# ==========================================
echo ""
echo ">>> [1/3] 停止桌面端..."
# 尝试通过打开的文件找到 Electron 进程
if [ -f "desktop/main/main.js" ]; then
    DESKTOP_PIDS=$(lsof -t "desktop/main/main.js" 2>/dev/null || true)
    if [ -n "$DESKTOP_PIDS" ]; then
        echo "找到桌面端进程 (PIDS: $DESKTOP_PIDS)，正在停止..."
        kill -9 $DESKTOP_PIDS || true
        sleep 1
    else
        echo "未找到运行中的桌面端进程 (基于 desktop/main/main.js 检测)。"
    fi
else
    echo "Warning: desktop/main/main.js not found, skipping desktop stop."
fi

# ==========================================
# 2. 停止前端 H5 (Stop Frontend)
# ==========================================
echo ""
echo ">>> [2/3] 停止前端 H5..."
H5_PID=$(lsof -ti:5173 || true)
if [ -n "$H5_PID" ]; then
    echo "找到前端进程 (PID: $H5_PID, Port: 5173)，正在停止..."
    kill -9 $H5_PID || true
    sleep 1
else
    echo "端口 5173 未被占用。"
fi

# ==========================================
# 3. 执行启动脚本 (Start All)
# ==========================================
echo ""
echo ">>> [3/3] 准备重新启动所有服务..."
echo "等待 2 秒以确保端口释放..."
sleep 2

if [ -f "./start-all.sh" ]; then
    chmod +x ./start-all.sh
    ./start-all.sh
else
    echo "Error: ./start-all.sh not found!"
    exit 1
fi
