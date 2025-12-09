#!/bin/bash

# 核查宝项目一键部署脚本
# 使用方法：bash deploy.sh

set -e

echo "=========================================="
echo "核查宝项目部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}请使用 root 用户运行此脚本${NC}"
    exit 1
fi

# 项目目录
PROJECT_DIR="/www/wwwroot/checkba"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo -e "${GREEN}[1/8] 检查环境...${NC}"

# 检查 Java
if ! command -v java &> /dev/null; then
    echo -e "${YELLOW}Java 未安装，开始安装 Java 17...${NC}"
    apt-get update
    apt-get install -y openjdk-17-jdk
else
    echo -e "${GREEN}Java 已安装: $(java -version 2>&1 | head -n 1)${NC}"
fi

# 检查 Maven
if ! command -v mvn &> /dev/null; then
    echo -e "${YELLOW}Maven 未安装，开始安装 Maven...${NC}"
    apt-get install -y maven
else
    echo -e "${GREEN}Maven 已安装: $(mvn -version | head -n 1)${NC}"
fi

# 检查项目目录
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${YELLOW}项目目录不存在，开始克隆代码...${NC}"
    cd /www/wwwroot
    git clone https://gitee.com/hanzeweiasa/checkba.git
else
    echo -e "${GREEN}项目目录已存在，更新代码...${NC}"
    cd "$PROJECT_DIR"
    git pull
fi

echo -e "${GREEN}[2/8] 配置后端环境变量...${NC}"

# 检查生产环境配置文件
if [ ! -f "$BACKEND_DIR/src/main/resources/application-prod.yml" ]; then
    echo -e "${YELLOW}创建生产环境配置文件...${NC}"
    cp "$BACKEND_DIR/src/main/resources/application.yml" \
       "$BACKEND_DIR/src/main/resources/application-prod.yml"
    echo -e "${YELLOW}请编辑 $BACKEND_DIR/src/main/resources/application-prod.yml 配置数据库和 WPS 信息${NC}"
fi

echo -e "${GREEN}[3/8] 构建后端...${NC}"
cd "$BACKEND_DIR"
mvn clean package -DskipTests

if [ ! -f "$BACKEND_DIR/target/backend-0.0.1-SNAPSHOT.jar" ]; then
    echo -e "${RED}后端构建失败！${NC}"
    exit 1
fi

echo -e "${GREEN}后端构建成功${NC}"

echo -e "${GREEN}[4/8] 配置 systemd 服务...${NC}"

# 复制 systemd 服务文件
cp "$PROJECT_DIR/deploy/checkba-backend.service" /etc/systemd/system/

# 重载 systemd
systemctl daemon-reload

# 停止旧服务（如果存在）
systemctl stop checkba-backend 2>/dev/null || true

# 启动服务
systemctl start checkba-backend
systemctl enable checkba-backend

# 等待服务启动
sleep 3

# 检查服务状态
if systemctl is-active --quiet checkba-backend; then
    echo -e "${GREEN}后端服务启动成功${NC}"
else
    echo -e "${RED}后端服务启动失败，查看日志: journalctl -u checkba-backend -n 50${NC}"
    exit 1
fi

echo -e "${GREEN}[5/8] 检查后端健康状态...${NC}"

# 等待后端完全启动
sleep 5

if curl -f http://localhost:8080/api/projects > /dev/null 2>&1; then
    echo -e "${GREEN}后端 API 响应正常${NC}"
else
    echo -e "${YELLOW}后端 API 可能还未完全启动，请稍后手动检查${NC}"
fi

echo -e "${GREEN}[6/8] 跳过前端构建（前端在本地开发）...${NC}"
echo -e "${YELLOW}前端在本地开发，通过 VITE_API_BASE_URL 指向服务器 API${NC}"

echo -e "${GREEN}[7/8] 配置 Nginx（需要在宝塔面板手动完成）...${NC}"
echo -e "${YELLOW}请按照以下步骤在宝塔面板配置：${NC}"
echo "1. 网站 → 添加站点 → 域名: api.checkba.yourdomain.com"
echo "2. 设置 → 配置文件 → 复制 deploy/nginx-api.conf 的内容"
echo "3. 修改 server_name 为你的实际域名"
echo "4. 保存并重载 Nginx"
echo "5. 设置 → SSL → Let's Encrypt → 申请证书"

echo -e "${GREEN}[8/8] 部署完成！${NC}"
echo ""
echo -e "${GREEN}后续操作：${NC}"
echo "1. 在宝塔面板配置 Nginx 反向代理（参考上面的步骤）"
echo "2. 申请 SSL 证书（API 域名: api.checkba.yourdomain.com）"
echo "3. 前端本地开发配置："
echo "   - 在 frontend/.env.local 中设置: VITE_API_BASE_URL=https://api.checkba.yourdomain.com"
echo "   - 运行: npm run dev:h5"
echo "4. 查看后端日志: journalctl -u checkba-backend -f"
echo "5. 查看后端状态: systemctl status checkba-backend"

