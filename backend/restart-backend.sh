#!/bin/bash
set -e

cd /www/wwwroot/checkba/backend

echo "== 1. 打包 =="
mvn clean package -DskipTests

echo "== 2. 停止旧进程（端口 9696） =="
PID=$(lsof -ti:9696 || true)
if [ -n "$PID" ]; then
  echo "找到进程 PID=${PID}，kill..."
  kill $PID
  sleep 5
else
  echo "端口 9696 没有正在运行的进程"
fi

echo "== 3. 启动新 Jar（prod 配置） =="
JAR=$(ls target | grep '\.jar$' | head -n 1)
if [ -z "$JAR" ]; then
  echo "ERROR: target 目录下没有找到 jar，请检查构建是否成功"
  exit 1
fi

nohup java -jar "target/$JAR" --spring.profiles.active=prod > /www/wwwroot/checkba/backend/app.log 2>&1 &

echo "新进程已启动，PID=$!"