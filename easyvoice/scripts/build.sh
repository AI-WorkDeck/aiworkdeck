#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "错误：必须提供 TAG 参数"
  echo "用法：./build.sh <TAG>"
  exit 1
fi

# 将传入的第一个参数赋值给 TAG 变量
TAG=$1

sudo docker build . -t easyvoice:"$TAG"
sudo docker tag easyvoice:"$TAG" cosincox/easyvoice:"$TAG"
sudo docker tag easyvoice:"$TAG" cosincox/easyvoice:latest
sudo docker push cosincox/easyvoice:"$TAG"
sudo docker push cosincox/easyvoice:latest

echo "完成！镜像已构建并推送为 cosincox/easyvoice:$TAG"
