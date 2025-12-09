# 核查宝项目部署文档

## 前置条件

1. **ECS 已购买并配置好宝塔面板**
2. **域名已解析到 ECS 公网 IP**
   - 主域名：`checkba.yourdomain.com`（前端）
   - API 子域名：`api.checkba.yourdomain.com`（后端）
3. **宝塔面板已安装以下软件：**
   - Nginx
   - MySQL 8.0（或先用 H2，后续再切 MySQL）
   - Java 17（或通过脚本安装）

## 部署步骤

### 第 1 步：在 ECS 上克隆代码

```bash
# SSH 登录到 ECS
ssh root@你的ECS_IP

# 进入网站目录（宝塔默认是 /www/wwwroot）
cd /www/wwwroot

# 克隆代码
git clone https://github.com/zeweihan/checkba.git

cd checkba
```

### 第 2 步：安装 Java 17 和 Maven

```bash
# 安装 Java 17
apt-get update
apt-get install -y openjdk-17-jdk

# 验证安装
java -version

# 安装 Maven
apt-get install -y maven

# 验证安装
mvn -version
```

### 第 3 步：配置后端环境变量

```bash
cd /www/wwwroot/checkba/backend

# 复制环境变量模板
cp src/main/resources/application.yml src/main/resources/application-prod.yml

# 编辑生产环境配置（用 vi 或 nano）
nano src/main/resources/application-prod.yml
```

需要修改的配置：
- 数据库配置（如果要用 MySQL）
- WPS AppId 和 AppSecret（从 WPS 控制台获取）
- 服务器端口（默认 8080）

### 第 4 步：构建后端

```bash
cd /www/wwwroot/checkba/backend

# 构建项目
mvn clean package -DskipTests

# 验证 jar 包生成
ls -lh target/backend-0.0.1-SNAPSHOT.jar
```

### 第 5 步：配置后端自启动（systemd）

```bash
# 创建 systemd 服务文件
sudo nano /etc/systemd/system/checkba-backend.service
```

将 `deploy/checkba-backend.service` 的内容复制进去，然后：

```bash
# 重载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start checkba-backend

# 设置开机自启
sudo systemctl enable checkba-backend

# 查看状态
sudo systemctl status checkba-backend
```

### 第 6 步：在宝塔创建网站（前端）

1. 登录宝塔面板
2. 网站 → 添加站点
3. 域名：`checkba.yourdomain.com`
4. 根目录：`/www/wwwroot/checkba/frontend/dist`（需要先构建前端）
5. PHP 版本：纯静态（不需要 PHP）

### 第 7 步：配置 Nginx 反向代理（API）

在宝塔面板：
1. 网站 → 找到 `api.checkba.yourdomain.com`（如果没有就创建一个）
2. 设置 → 配置文件
3. 将 `deploy/nginx-api.conf` 的内容复制进去
4. 修改 `proxy_pass` 中的端口（默认 8080）
5. 保存并重载 Nginx

### 第 8 步：配置 SSL 证书

在宝塔面板：
1. 网站 → 找到你的两个域名
2. 设置 → SSL → Let's Encrypt
3. 申请证书并开启强制 HTTPS

### 第 9 步：构建前端

```bash
cd /www/wwwroot/checkba/frontend

# 安装依赖
npm install

# 构建生产版本
npm run build:h5

# 构建产物在 dist 目录
```

### 第 10 步：配置前端环境变量

编辑 `frontend/.env.production`（需要创建）：

```bash
VITE_API_BASE_URL=https://api.checkba.yourdomain.com
```

然后重新构建前端。

## 验证部署

1. **检查后端是否运行：**
   ```bash
   curl http://localhost:8080/api/projects
   ```

2. **检查前端是否可访问：**
   浏览器打开 `https://checkba.yourdomain.com`

3. **检查 API 是否可访问：**
   浏览器打开 `https://api.checkba.yourdomain.com/api/projects`

## 常见问题

### 后端启动失败
- 检查日志：`sudo journalctl -u checkba-backend -n 50`
- 检查端口是否被占用：`netstat -tlnp | grep 8080`
- 检查 Java 版本：`java -version`

### Nginx 502 错误
- 检查后端是否运行：`sudo systemctl status checkba-backend`
- 检查 Nginx 配置中的 `proxy_pass` 地址是否正确

### SSL 证书申请失败
- 确认域名已正确解析到 ECS IP
- 确认 80 端口已开放
- 等待 DNS 解析生效（可能需要几分钟）

## 后续维护

### 更新代码
```bash
cd /www/wwwroot/checkba
git pull
cd backend
mvn clean package -DskipTests
sudo systemctl restart checkba-backend
```

### 查看日志
```bash
# 后端日志
sudo journalctl -u checkba-backend -f

# Nginx 日志
tail -f /www/wwwlogs/checkba.yourdomain.com.log
```

