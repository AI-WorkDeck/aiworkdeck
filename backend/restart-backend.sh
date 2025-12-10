#!/bin/bash
set -e

echo "== 1. 打包 =="
mvn clean package -DskipTests

echo "== 2. 停止旧进程（端口 9696） =="
PID=$(lsof -ti:9696 || true)
if [ -n "$PID" ]; then
  echo "找到进程 PID=${PID}，kill..."
  # 使用 kill -0 检查进程是否存在，避免 kill 失败导致脚本退出
  if kill -0 $PID 2>/dev/null; then
    kill $PID || true
    sleep 2
    # 如果进程还在，强制杀死
    if kill -0 $PID 2>/dev/null; then
      echo "进程仍在运行，强制杀死..."
      kill -9 $PID || true
      sleep 2
    fi
  fi
else
  echo "端口 9696 没有正在运行的进程"
fi

echo "== 3. 启动新 Jar（prod 配置） =="
JAR=$(ls target | grep '\.jar$' | head -n 1)
if [ -z "$JAR" ]; then
  echo "ERROR: target 目录下没有找到 jar，请检查构建是否成功"
  exit 1
fi

echo "启动命令: java -jar target/$JAR"
nohup java -jar "target/$JAR" > app.log 2>&1 &
NEW_PID=$!

echo "新进程已启动，PID=$NEW_PID"

# 等待一下，确保进程启动
sleep 3

# 检查进程是否还在运行
if kill -0 $NEW_PID 2>/dev/null; then
  echo "✓ 进程 $NEW_PID 正在运行"
  # 检查端口是否被监听
  if lsof -ti:9696 >/dev/null 2>&1; then
    echo "✓ 端口 9696 已被监听"
    echo "启动成功！"
  else
    echo "⚠ 警告：进程在运行，但端口 9696 未被监听，请检查日志 app.log"
  fi
else
  echo "✗ 错误：进程 $NEW_PID 启动失败，请查看 app.log 获取错误信息"
  echo "最后 20 行日志："
  tail -20 app.log
  exit 1
fi