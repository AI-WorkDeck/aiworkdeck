# Cpolar内网穿透状态报告

生成时间: 2026-01-10 10:47

## ✅ 当前状态

### 服务运行状态
- **后端服务**: ✅ 运行中 (端口 9696, PID: 22264)
- **Cpolar进程**: ✅ 运行中 (PID: 22007)
- **数据库**: PostgreSQL (端口 5432)

### 当前 Cpolar URL
```
https://6e783f5e.r3.cpolar.cn
```

### WPS 回调 URL 配置
- **配置文件**: ✅ `https://6e783f5e.r3.cpolar.cn`
- **数据库**: ✅ `https://6e783f5e.r3.cpolar.cn`
- **外网访问**: ✅ 测试通过

## 🎯 验证结果

```bash
# 本地访问测试
✅ curl http://localhost:9696/v3/3rd/files/test/permission
   返回: {"code":0,"message":"","data":{...}}

# 外网访问测试  
✅ curl https://6e783f5e.r3.cpolar.cn/v3/3rd/files/test/permission
   返回: {"code":0,"message":"","data":{...}}
```

## 📝 重要说明

### 关于旧文件的问题
- 旧文件（如 `project_39_doc_1768011873650_563ac7v`）使用的是已失效的回调地址 `kingide500.cpolar.top`
- WPS 服务器缓存了文件创建时的回调地址，无法通过更新配置来修复
- **解决方案**: 重新创建文件，新文件会使用当前正确的回调地址

### 重新创建文件步骤
1. 在前端删除旧文件（`newdocument.docx`）
2. 创建新的 Word 文档
3. 新文件会自动使用 `https://6e783f5e.r3.cpolar.cn` 作为回调地址
4. 不再出现 Json 解析失败错误

## 🔧 下次 cpolar 地址过期时的操作步骤

### 快速重启脚本
```bash
# 1. 停止所有服务
pkill -9 cpolar && pkill -9 java

# 2. 启动 cpolar
nohup /tmp/cpolar http 9696 --region=cn > cpolar.log 2>&1 &
sleep 10

# 3. 获取新 URL
NEW_URL=$(curl -s http://localhost:6060/http/in | grep -o 'https://[^"]*cpolar\.[^"]*' | head -1 | sed 's/\\$//')
echo "新 URL: $NEW_URL"

# 4. 更新数据库
PGPASSWORD=checkba123 /opt/homebrew/Cellar/postgresql@15/15.13/bin/psql -h localhost -U checkba -d checkba \
  -c "UPDATE system_setting SET value = '$NEW_URL' WHERE config_key = 'external.wps.callbackBaseUrl';"

# 5. 更新配置文件
sed -i.bak "s|callback-base-url:.*|callback-base-url: $NEW_URL  # 使用 cpolar 内网穿透地址|g" \
  src/main/resources/application.yml \
  src/main/resources/application-prod.yml

# 6. 重启后端
./restart-backend.sh
```

### 自动化脚本
运行 `get-cpolar-url.sh` 可以自动完成上述所有步骤。

## 📞 故障排查

### 如果外网无法访问
1. 检查 cpolar 是否运行: `ps aux | grep cpolar`
2. 检查后端是否运行: `lsof -i :9696`
3. 查看 cpolar 日志: `tail -f cpolar.log`
4. 查看后端日志: `tail -f backend/backend.log`

### 如果文件无法打开/编辑
1. 清除浏览器缓存 (Cmd+Shift+Delete)
2. 重新创建文件（使用新的 fileId）
3. 确认前端使用的是最新的回调地址

## 📝 可用脚本

- `check-cpolar-url.sh`: 检查当前 cpolar URL 和数据库配置是否一致
- `get-cpolar-url.sh`: 获取并更新 cpolar URL 的自动化脚本
- `restart-backend.sh`: 重启后端服务
- `start-cpolar.sh`: 启动 cpolar 隧道

