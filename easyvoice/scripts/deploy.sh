#!/bin/bash

# 定义颜色代码用于输出
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# 设置脚本的工作目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "working directory: ${SCRIPT_DIR}"

# 检查 docker-compose.yml 是否存在
if [ ! -f "docker-compose.yml" ]; then
  echo -e "${RED}Error: docker-compose.yml not found in scripts directory${NC}"
  exit 1
fi

# 执行部署步骤
echo "Starting deployment..."

# 拉取最新镜像
sudo docker-compose pull || {
  echo -e "${RED}Error: Failed to pull images${NC}"
  exit 1
}

# 停止现有容器
sudo docker-compose stop || {
  echo -e "${RED}Error: Failed to stop containers${NC}"
  exit 1
}

# 启动容器（后台模式）
sudo docker-compose up -d || {
  echo -e "${RED}Error: Failed to start containers${NC}"
  exit 1
}

# 检查容器状态
echo "Verifying container status..."
sleep 2 # 等待几秒以确保容器启动
sudo docker-compose ps

# 完成提示
echo -e "${GREEN}Deployment completed successfully!${NC}"
