#!/bin/bash
# Cpolar启动脚本

# 检查cpolar是否已安装
if ! command -v cpolar &> /dev/null; then
    echo "❌ Cpolar未安装，请先安装"
    echo "访问: https://dashboard.cpolar.com/get-started/install"
    exit 1
fi

# 检查是否已登录
if ! cpolar status &> /dev/null; then
    echo "⚠️  请先登录cpolar:"
    echo "1. 访问 https://dashboard.cpolar.com/signup 注册账号"
    echo "2. 获取authtoken"
    echo "3. 运行: cpolar authtoken <your-token>"
    exit 1
fi

echo "🚀 启动Cpolar隧道..."
echo "后端地址: http://localhost:9696"
echo "外网地址: https://zuolinya.cpolar.top"
echo ""

# 后台启动cpolar
nohup cpolar http 9696 --subdomain=zuolinya --region=cn > cpolar.log 2>&1 &

sleep 2

# 显示日志
echo "✅ Cpolar已启动！"
echo ""
echo "查看日志: tail -f cpolar.log"
echo "停止: pkill cpolar"
echo ""
echo "访问信息:"
tail -n 20 cpolar.log | grep -E "Tunnel established|https://"
