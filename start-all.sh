#!/bin/bash
set -e

# 获取当前脚本所在目录的绝对路径
PROJECT_ROOT=$(cd "$(dirname "$0")" && pwd)

echo "=================================================="
echo "   Checkba Project One-Click Start"
echo "=================================================="
echo "项目根目录: $PROJECT_ROOT"
echo ""

# ==========================================
# 0. 前置检查
# ==========================================
echo ">>> [检查] 验证必要依赖..."

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "⚠️ Docker 未运行！PPTX 服务需要 Docker。"
    echo "   请启动 Docker 后重试，或继续启动其他服务..."
    DOCKER_AVAILABLE=false
else
    echo "✓ Docker 运行正常"
    DOCKER_AVAILABLE=true
fi

# 检查 PostgreSQL 是否运行 (端口 5432)
if lsof -ti:5432 >/dev/null 2>&1; then
    echo "✓ PostgreSQL 运行正常 (端口 5432)"
else
    echo "⚠️ 警告：PostgreSQL 未运行 (端口 5432)，后端服务可能无法正常工作"
    echo "   请确保 PostgreSQL 已启动"
fi

# ==========================================
# 1. 启动 PPTX 服务 (Docker)
# ==========================================
echo ""
echo ">>> [1/4] 启动 PPTX 服务 (Docker)..."
if [ "$DOCKER_AVAILABLE" = true ]; then
    cd "$PROJECT_ROOT"
    
    # 检查容器是否已在运行
    if docker ps -q -f name=checkba-pptx-service 2>/dev/null | grep -q .; then
        echo "PPTX 服务容器已在运行，跳过启动"
    else
        # 确保 .env 文件存在
        if [ ! -f pptx-service/.env ]; then
            echo "⚠️ pptx-service/.env 不存在，正在创建..."
            cat > pptx-service/.env << 'EOF'
# banana-slides 配置文件
AI_PROVIDER_FORMAT=google
GOOGLE_API_KEY=YOUR_GEMINI_API_KEY
GOOGLE_API_BASE=https://generativelanguage.googleapis.com/v1beta
PORT=5000
CORS_ORIGINS=*
LOG_LEVEL=INFO
OUTPUT_LANGUAGE=zh
IN_DOCKER=1
EOF
            echo "⚠️ 请编辑 pptx-service/.env 配置 GOOGLE_API_KEY"
        fi
        
        # 使用 docker-compose 启动 PPTX 服务
        echo "📦 启动 PPTX 服务容器..."
        docker-compose up -d pptx-service
        
        # 等待服务启动
        echo "⏳ 等待 PPTX 服务启动 (最多 30 秒)..."
        for i in {1..30}; do
            if curl -s http://localhost:5001/health > /dev/null 2>&1; then
                echo "✓ PPTX 服务已启动: http://localhost:5001"
                break
            fi
            sleep 1
        done
        
        # 检查是否启动成功
        if ! curl -s http://localhost:5001/health > /dev/null 2>&1; then
            echo "⚠️ PPTX 服务启动超时，请检查 Docker 日志:"
            echo "   docker-compose logs pptx-service"
        fi
    fi
else
    echo "Docker 不可用，跳过 PPTX 服务启动..."
fi

# ==========================================
# 2. 启动后端 (Backend)
# ==========================================
echo ""
echo ">>> [2/4] 启动后端 (Backend)..."

# 检查端口 9696 是否被占用
if lsof -ti:9696 >/dev/null 2>&1; then
    echo "后端端口 9696 已被占用，跳过启动"
    echo "若需重启，请使用 restart-all.sh"
else
    cd "$PROJECT_ROOT/backend"
    
    # 调用现有的 restart-backend.sh
    if [ -f "./restart-backend.sh" ]; then
        chmod +x ./restart-backend.sh
        ./restart-backend.sh
    else
        echo "Error: backend/restart-backend.sh not found!"
        exit 1
    fi
    
    cd "$PROJECT_ROOT"
fi

# ==========================================
# 3. 启动前端 H5 (Frontend)
# ==========================================
echo ""
echo ">>> [3/4] 启动前端 H5 (Frontend)..."

# 检查端口 5173 是否被占用
if lsof -ti:5173 >/dev/null 2>&1; then
    echo "前端 H5 端口 5173 已被占用，跳过启动"
    echo "若需重启，请使用 restart-all.sh"
else
    cd "$PROJECT_ROOT/frontend"
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
        echo "⚠️ 警告：30秒内未检测到端口 5173，请检查 frontend/h5.log"
    fi
    cd "$PROJECT_ROOT"
fi

# 增加一点延迟，确保前端资源加载
sleep 2

# ==========================================
# 4. 启动桌面端 (Desktop)
# ==========================================
echo ""
echo ">>> [4/4] 启动桌面端 (Desktop)..."
cd "$PROJECT_ROOT/desktop"

echo "执行启动命令: nohup npm run dev > desktop.log 2>&1 &"
nohup npm run dev > desktop.log 2>&1 &

cd "$PROJECT_ROOT"

# ==========================================
# 输出汇总
# ==========================================
echo ""
echo "=================================================="
echo "   🎉 所有服务启动流程执行完毕！"
echo "=================================================="
echo ""
echo "服务状态汇总:"
echo "────────────────────────────────────────────────────"

# 检查各服务状态
if lsof -ti:9696 >/dev/null 2>&1; then
    echo "✓ 后端 Java 服务:   http://localhost:9696"
else
    echo "✗ 后端 Java 服务:   未启动 (端口 9696)"
fi

if lsof -ti:5173 >/dev/null 2>&1; then
    echo "✓ 前端 H5:          http://localhost:5173"
else
    echo "✗ 前端 H5:          未启动 (端口 5173)"
fi

if [ "$DOCKER_AVAILABLE" = true ]; then
    if curl -s http://localhost:5001/health > /dev/null 2>&1; then
        echo "✓ PPTX 服务:        http://localhost:5001"
    else
        echo "✗ PPTX 服务:        未启动 (端口 5001)"
    fi
else
    echo "- PPTX 服务:        Docker 不可用"
fi

echo "✓ 桌面端:           已启动 (Electron)"
echo "────────────────────────────────────────────────────"
echo ""
echo "日志文件位置:"
echo "  后端日志: backend/app.log"
echo "  前端日志: frontend/h5.log"
echo "  桌面日志: desktop/desktop.log"
if [ "$DOCKER_AVAILABLE" = true ]; then
    echo "  PPTX 日志: docker-compose logs pptx-service"
fi
echo ""
