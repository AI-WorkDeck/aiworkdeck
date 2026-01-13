#!/bin/bash

echo "=== 当前Cpolar隧道URL ==="
echo ""

# 从cpolar Web UI获取URL
URL=$(curl -s http://localhost:6060/http/in | grep -o 'https://[^"]*cpolar\.io' | head -1 | sed 's/\\$//')

if [ -n "$URL" ]; then
    echo "✅ 当前URL: $URL"
    echo ""
    echo "=== 数据库中的URL ==="
    PGPASSWORD=checkba123 /opt/homebrew/Cellar/postgresql@15/15.13/bin/psql -h localhost -U checkba -d checkba -t -c "SELECT value FROM system_setting WHERE config_key = 'external.wps.callbackBaseUrl';" 2>/dev/null | sed 's/^[ \t]*//'
    
    echo ""
    echo "=== 测试外网访问 ==="
    echo "测试命令: curl -s ${URL}/v3/3rd/files/test/permission | jq ."
    RESULT=$(curl -s -m 5 "${URL}/v3/3rd/files/test/permission" 2>/dev/null)
    if echo "$RESULT" | jq -e '.code == 0' > /dev/null 2>&1; then
        echo "✅ 外网访问正常"
    else
        echo "❌ 外网访问失败"
    fi
    
    echo ""
    echo "=== 需要更新吗？ ==="
    DB_URL=$(PGPASSWORD=checkba123 /opt/homebrew/Cellar/postgresql@15/15.13/bin/psql -h localhost -U checkba -d checkba -t -c "SELECT value FROM system_setting WHERE config_key = 'external.wps.callbackBaseUrl';" 2>/dev/null | sed 's/^[ \t]*//')
    
    if [ "$URL" != "$DB_URL" ]; then
        echo "⚠️  URL不一致！"
        echo "Cpolar URL: $URL"
        echo "数据库URL: $DB_URL"
        echo ""
        echo "运行以下命令更新:"
        echo "PGPASSWORD=checkba123 /opt/homebrew//Cellar/postgresql@15/15.13/bin/psql -h localhost -U checkba -d checkba -c \"UPDATE system_setting SET value = '$URL' WHERE config_key = 'external.wps.callbackBaseUrl';\""
        echo "然后重启: ./restart-backend.sh"
    else
        echo "✅ URL一致，无需更新"
    fi
else
    echo "❌ 无法获取Cpolar URL，请检查cpolar是否运行"
    echo "在浏览器中打开: http://localhost:6060"
fi
