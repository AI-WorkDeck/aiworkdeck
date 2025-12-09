#!/bin/bash

# 修复 apt 仓库警告的脚本
# 如果遇到 "Repository changed its 'Label' value" 错误，运行此脚本

echo "修复 apt 仓库配置..."

# 方法 1：接受仓库变更
apt-get update --allow-releaseinfo-change

# 方法 2：如果还有问题，清理并重新配置
# apt-get clean
# apt-get update

echo "修复完成，可以继续安装 Java"

