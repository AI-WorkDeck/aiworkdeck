#!/bin/bash
set -e

# 获取当前脚本所在目录的绝对路径
PROJECT_ROOT=$(pwd)

echo "=================================================="
echo "   Checkba Project One-Click Start"
echo "=================================================="

# ==========================================
# 1. 启动后端 (Backend)
# ==========================================
echo ""
echo ">>> [1/3] 启动后端 (Backend)..."
cd backend

# 调用现有的 restart-backend.sh
# 注意：该脚本包含 mvn clean package 打包过程
if [ -f "./restart-backend.sh" ]; then
    chmod +x ./restart-backend.sh
    ./restart-backend.sh
else
    echo "Error: backend/restart-backend.sh not found!"
    exit 1
fi

cd "$PROJECT_ROOT"

# ==========================================
# 2. 启动前端 H5 (Frontend)
# ==========================================
echo ""
echo ">>> [2/3] 启动前端 H5 (Frontend)..."

# 检查端口 5173 是否被占用
if lsof -ti:5173 >/dev/null 2>&1; then
    echo "Frontend H5 端口 5173 已被占用，跳过启动。"
    echo "若需重启，请使用 restart-all.sh"
else
    cd frontend
    echo "执行启动命令: nohup npm run dev:h5 > h5.log 2>&1 &"
    nohup npm run dev:h5 > h5.log 2>&1 &
    
    echo "等待前端 H5 启动 (检查端口 5173)..."
    # 循环检查端口，最多等待 30 秒
    for i in {1..30}; do
        if lsof -ti:5173 >/dev/null 2>&1; then
            echo "✓ 前端 H5 启动成功！"
            break
        fi
        sleep 1
    done
    
    # 二次确认
    if ! lsof -ti:5173 >/dev/null 2>&1; then
        echo "⚠ 警告：30秒内未检测到端口 5173，请检查 frontend/h5.log"
    fi
    cd "$PROJECT_ROOT"
fi

# 增加一点延迟，确保前端资源加载
sleep 2

# ==========================================
# 3. 启动桌面端 (Desktop)
# ==========================================
echo ""
echo ">>> [3/3] 启动桌面端 (Desktop)..."
cd desktop

echo "执行启动命令: nohup npm run dev > desktop.log 2>&1 &"
nohup npm run dev > desktop.log 2>&1 &

cd "$PROJECT_ROOT"

echo ""
echo "=================================================="
echo "   所有服务启动流程执行完毕！"
echo "=================================================="
echo "后端日志: backend/app.log"
echo "前端日志: frontend/h5.log"
echo "桌面日志: desktop/desktop.log"
