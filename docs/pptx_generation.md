# PPTX 生成能力

## 概述

本项目集成了 [banana-slides](https://github.com/Anionex/banana-slides) 开源项目，为 AI Agent 提供了完整的 PPTX 演示文稿生成能力。

### 功能特点

- **AI 驱动**: 根据主题自动生成大纲、内容描述和幻灯片图片
- **一键生成**: Agent 可以通过单个工具调用生成完整 PPT
- **Docker 隔离**: Python 服务运行在独立容器中，不影响 Java 主系统
- **WPS 集成**: 生成的 PPTX 文件自动注册到项目文件库，可通过 WPS 编辑

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Java 后端 (9696)                        │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   Agent     │──│   PptxTools     │──│ PptxServiceClient│  │
│  │ Orchestrator│  │   (工具类)       │  │   (HTTP客户端)   │  │
│  └─────────────┘  └─────────────────┘  └────────┬────────┘  │
└────────────────────────────────────────────────│───────────┘
                                                  │ HTTP
                                                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Docker: pptx-service (5001)                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              banana-slides (Flask)                   │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐ │   │
│  │  │ 生成大纲 │──│ 生成描述 │──│ 生成图片 │──│ 导出PPTX│ │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 快速开始

### 1. 配置 API Key

编辑 `pptx-service/.env` 文件，配置 Google Gemini API Key：

```bash
GOOGLE_API_KEY=your_gemini_api_key_here
```

> 注意：banana-slides 使用 Gemini 的图像生成能力 (Imagen)，需要确保 API Key 有访问权限。

### 2. 启动 PPTX 服务

```bash
# 使用启动脚本
./start-pptx-service.sh

# 或手动使用 docker-compose
docker-compose up -d pptx-service
```

### 3. 验证服务

```bash
curl http://localhost:5001/health
# 应返回: {"status": "ok", "message": "Banana Slides API is running"}
```

### 4. 重启 Java 后端

```bash
cd backend
./restart-backend.sh
```

## Agent 工具

### pptx_check_service

检查 PPTX 生成服务是否可用。

```
工具: pptx_check_service
参数: 无
返回: 服务状态描述
```

### pptx_generate

一键生成完整的 PPTX 演示文稿。

```
工具: pptx_generate
参数:
  - topic: PPT 主题或详细描述
  - projectId: 项目 ID
  - style: (可选) 风格描述，如 "科技风"、"商务简约"
  - language: (可选) 输出语言，zh/en/ja
返回: 生成结果，包含文件路径和 ID
```

### pptx_generate_outline

仅生成 PPT 大纲，供用户审阅修改后再生成完整 PPT。

```
工具: pptx_generate_outline
参数:
  - topic: PPT 主题或详细描述
  - language: (可选) 输出语言
返回: 大纲结构，包含每页标题和要点
```

## 使用示例

用户可以直接对 Agent 说：

> "帮我生成一个关于'AI 在法律行业的应用'的 PPT，风格要科技感一些"

Agent 会：
1. 调用 `pptx_check_service` 检查服务状态
2. 调用 `pptx_generate` 生成完整 PPT
3. 返回生成结果，用户可通过 `wps_open_file` 打开编辑

## 文件结构

```
checkba_cloud/
├── pptx-service/           # banana-slides 项目 (git clone)
│   ├── backend/            # Flask 后端
│   ├── frontend/           # React 前端 (可选)
│   ├── .env                # 配置文件
│   └── docker-compose.yml  # 原始 docker-compose
├── docker-compose.yml      # 项目主 docker-compose
├── start-pptx-service.sh   # 启动脚本
└── backend/
    └── src/main/java/com/checkba/service/ai/
        ├── PptxServiceClient.java   # HTTP 客户端
        └── tools/PptxTools.java     # Agent 工具
```

## 配置说明

### application.yml

```yaml
external:
  pptx-service:
    base-url: http://localhost:5001
    timeout: 120
```

### pptx-service/.env

```bash
# AI 提供商配置
AI_PROVIDER_FORMAT=google
GOOGLE_API_KEY=your_api_key
GOOGLE_API_BASE=https://generativelanguage.googleapis.com/v1beta

# 服务配置
PORT=5000
CORS_ORIGINS=*
LOG_LEVEL=INFO
OUTPUT_LANGUAGE=zh
IN_DOCKER=1
```

## 故障排除

### 服务启动失败

```bash
# 查看日志
docker-compose logs pptx-service

# 检查端口占用
lsof -i :5001
```

### 图片生成失败

确保 Google API Key 有 Imagen 访问权限。如果使用的是普通 Gemini API Key，可能需要升级或申请 Imagen 访问。

### 连接超时

检查 Java 后端的 `application.yml` 中 `timeout` 设置，生成 PPT 可能需要较长时间（尤其是生成图片阶段）。

## 参考

- [banana-slides GitHub](https://github.com/Anionex/banana-slides)
- [Google Gemini API](https://ai.google.dev/)
- [python-pptx 文档](https://python-pptx.readthedocs.io/)

