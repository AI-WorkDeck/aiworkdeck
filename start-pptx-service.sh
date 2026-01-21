#!/bin/bash
# 启动 PPTX 生成服务 (banana-slides Docker 容器)

set -e

echo "🍌 启动 PPTX 生成服务..."

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")"

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

# 构建并启动服务
echo "📦 构建 Docker 镜像..."
docker-compose up -d --build pptx-service

# 等待服务启动
echo "⏳ 等待服务启动..."
for i in {1..30}; do
    if curl -s http://localhost:5001/health > /dev/null 2>&1; then
        echo "✅ PPTX 服务已启动: http://localhost:5001"
        echo ""
        echo "🎯 可用 API:"
        echo "   - POST /api/projects - 创建项目"
        echo "   - POST /api/projects/{id}/generate/outline - 生成大纲"
        echo "   - POST /api/projects/{id}/generate/descriptions - 生成描述"
        echo "   - POST /api/projects/{id}/generate/images - 生成幻灯片图片"
        echo "   - GET /api/projects/{id}/export/pptx - 导出 PPTX"
        echo ""
        echo "💡 Java 后端 Agent 将自动调用此服务来生成 PPT"
        exit 0
    fi
    sleep 1
done

echo "❌ 服务启动超时，请检查 Docker 日志:"
echo "   docker-compose logs pptx-service"
exit 1

