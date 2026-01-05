# MinerU 本地服务

基于 [MinerU](https://github.com/opendatalab/MinerU) 官方文档构建的本地文档解析服务。

## 功能

- 使用官方 `mineru-api` 命令启动 HTTP API 服务器
- 支持 PDF、图片文档解析
- 提取文字、表格、图片等内容
- 输出 Markdown 格式

## API 端点

服务启动后，访问 `http://localhost:8001/docs` 查看完整 API 文档。

主要端点：
- `POST /file_parse` - 上传并解析文件

## 部署方式

### 使用 Docker Compose（推荐）

```bash
cd /path/to/checkba_cloud
docker-compose up -d mineru-service
```

### 手动构建

```bash
cd mineru-service
docker build -t checkba-mineru .
docker run -d -p 8001:8000 checkba-mineru
```

## 配置说明

环境变量：
- `MINERU_DEVICE_MODE`: 推理设备，默认 `cpu`
- `MINERU_MODEL_SOURCE`: 模型来源，默认 `modelscope`（国内用户推荐）

## 注意事项

1. **首次启动较慢**：需要下载模型文件（约 2-3GB）
2. **内存需求**：建议至少 8GB 内存
3. **CPU 模式**：纯 CPU 运行，解析速度较慢但无需 GPU

## 与 pptx-service 集成

pptx-service 会自动检测本地 MinerU 服务：
1. 优先使用本地服务（无需 token）
2. 如本地服务不可用，回退到云服务（需要配置 MINERU_TOKEN）

配置 `.env`：
```
MINERU_LOCAL_URL=http://mineru-service:8000
```


