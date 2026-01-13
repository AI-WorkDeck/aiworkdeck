#!/bin/bash

echo "=== Cpolar URL管理工具 ==="
echo ""

# 从cpolar Web UI获取当前URL
CURRENT_URL=$(curl -s http://localhost:6060/http/in 2>/dev/null | grep -o '"PublicUrl":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's|https://||' | sed 's|http://||')

if [ -z "$CURRENT_URL" ]; then
    echo "❌ 无法获取Cpolar URL，请确保cpolar正在运行"
    echo ""
    echo "请手动输入当前的Cpolar URL（例如：2fca4849.cpolar.io）"
    read -p "Cpolar URL: " CURRENT_URL
fi

# 添加https前缀
HTTPS_URL="https://$CURRENT_URL"
HTTP_URL="http://$CURRENT_URL"

echo "📍 当前Cpolar URL: $HTTPS_URL"
echo ""

# 更新配置文件
echo "📝 更新配置文件..."
sed -i.bak "s|callback-base-url:.*|callback-base-url: $HTTPS_URL  # 使用 cpolar 内网穿透地址（当前实际URL，每次重启会变化）|" \
  src/main/resources/application.yml \
  src/main/resources/application-prod.yml

echo "✅ 配置文件已更新"
echo ""

# 更新数据库
echo "📊 更新数据库设置..."
if command -v psql > /dev/null 2>&1; then
    # PostgreSQL
    PGPASSWORD=checkba123 psql -h localhost -U checkba -d checkba << EOFSQL
-- 更新WPS回调URL
UPDATE system_settings SET value = '$HTTPS_URL' 
WHERE key = 'external.wps.callbackBaseUrl';

-- 如果不存在则插入
INSERT INTO system_settings (key, value, updated_at) 
VALUES ('external.wps.callbackBaseUrl', '$HTTPS_URL', NOW())
ON CONFLICT (key) DO UPDATE SET value = '$HTTPS_URL', updated_at = NOW();

-- 显示当前设置
SELECT key, value FROM system_settings WHERE key LIKE '%wps%';
EOFSQL
elif command -v mysql > /dev/null 2>&1; then
    # MySQL
    mysql -h localhost -u checkba -pcheckba123 checkba << EOFSQL
-- 更新WPS回调URL
UPDATE system_settings SET value = '$HTTPS_URL' 
WHERE key = 'external.wps.callbackBaseUrl';

-- 如果不存在则插入
INSERT INTO system_settings (key, value, updated_at) 
VALUES ('external.wps.callbackBaseUrl', '$HTTPS_URL', NOW())
ON DUPLICATE KEY UPDATE value = '$HTTPS_URL', updated_at = NOW();

-- 显示当前设置
SELECT key, value FROM system_settings WHERE key LIKE '%wps%';
EOFSQL
else
    echo "⚠️  未找到数据库客户端，请手动更新数据库"
    echo "SQL语句:"
    echo ""
    echo "PostgreSQL:"
    echo "UPDATE system_settings SET value = '$HTTPS_URL' WHERE key = 'external.wps.callbackBaseUrl';"
    echo ""
    echo "MySQL:"
    echo "UPDATE system_settings SET value = '$HTTPS_URL' WHERE key = 'external.wps.callbackBaseUrl';"
fi

echo ""
echo "♻️  正在重新编译和重启后端..."
./restart-backend.sh > /dev/null 2>&1 &

sleep 10

echo ""
echo "=== 验证更新 ==="
curl -s http://localhost:9696/v3/3rd/files/test | jq -r '.data.download_url'

echo ""
echo "✅ 完成！"
