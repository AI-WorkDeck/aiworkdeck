# AI Agent 记忆系统设置指南

## 一、系统概述

本次升级为 AI Agent 添加了智能记忆系统，包括：

1. **三层记忆架构**
   - 短期记忆（Session）：当前对话的即时信息
   - 中期记忆（Conversation）：对话摘要和关键决策
   - 长期记忆（Project/User）：项目核心信息和用户偏好

2. **智能上下文压缩**
   - 自动压缩超长对话历史
   - 法律关键信息保护机制
   - Token 预算管理

3. **向量语义检索**
   - 基于 pgvector 的语义搜索
   - 混合检索（关键词 + 向量）

## 二、数据库迁移

### 2.1 安装 PostgreSQL 和 pgvector

```bash
# macOS
brew install postgresql@16
brew install pgvector

# Ubuntu/Debian
sudo apt install postgresql-16
sudo apt install postgresql-16-pgvector
```

### 2.2 创建数据库

```bash
# 连接 PostgreSQL
psql -U postgres

# 创建数据库和用户
CREATE DATABASE checkba;
CREATE USER checkba WITH PASSWORD 'checkba123';
GRANT ALL PRIVILEGES ON DATABASE checkba TO checkba;

# 连接到 checkba 数据库
\c checkba

# 启用 pgvector 扩展
CREATE EXTENSION vector;

# 退出
\q
```

### 2.3 执行初始化脚本

```bash
cd /path/to/17-checkba_cloud
psql -U checkba -d checkba -f database/init_postgres.sql
```

### 2.4 数据迁移（从 MySQL）

如果需要从现有 MySQL 数据库迁移：

```bash
# 使用 pgloader（推荐）
pgloader mysql://checkba:checkba123@localhost/checkba \
         postgresql://checkba:checkba123@localhost/checkba

# 或者手动导出/导入
# 参考 database/migrate_mysql_to_postgres.sql
```

## 三、配置说明

### 3.1 应用配置

配置文件已更新为使用 PostgreSQL：

```yaml
# application.yml
spring:
  datasource:
    driver-class-name: org.postgresql.Driver
    url: jdbc:postgresql://localhost:5432/checkba
    username: checkba
    password: checkba123
  jpa:
    database-platform: org.hibernate.dialect.PostgreSQLDialect
```

### 3.2 Embedding 模型配置

默认使用 Ollama 的 nomic-embed-text 模型：

```yaml
langchain4j:
  ollama:
    embedding-model:
      base-url: http://localhost:11434
      model-name: nomic-embed-text
```

如需使用 OpenAI embedding，请修改 `PgVectorConfig.java` 中的维度配置（1536）。

## 四、新增功能

### 4.1 记忆工具

Agent 现在可以使用以下工具：

| 工具名称 | 功能描述 |
|---------|---------|
| `save_memory` | 保存重要信息到项目记忆 |
| `query_memory` | 查询项目相关记忆 |
| `get_project_context` | 获取项目核心信息 |
| `update_project_info` | 更新项目信息 |
| `search_knowledge_base` | 语义搜索知识库 |
| `get_conversation_summary` | 获取对话摘要 |

### 4.2 记忆类型

支持的记忆类型：
- `decision`：决策
- `conclusion`：结论
- `fact`：事实
- `reference`：法律引用
- `preference`：用户偏好

### 4.3 法律信息保护

以下信息在压缩时会被自动保护：
- 法律法规引用（《xxx》第x条）
- 日期（2024年1月15日）
- 金额（10.5亿元）
- 当事人信息
- 合同编号
- 股权比例

## 五、API 变更

### 5.1 上下文组装

`ContextAssemblerService.assemble()` 现在会自动：
1. 注入项目记忆
2. 检索相关的结构化记忆
3. 压缩超长对话历史
4. 保护法律关键信息

### 5.2 对话结束后处理

新增 `postConversationUpdate()` 方法：
- 自动生成对话摘要
- 提取并保存重要记忆
- 更新项目记忆

## 六、运行测试

```bash
cd backend
mvn test -Dtest=LegalInfoProtectorTest
mvn test -Dtest=ContextCompressorTest
mvn test -Dtest=ProjectMemoryExtractorTest
```

## 七、监控指标

关键日志：

```
# 压缩日志
Context compressed: 100 messages, estimated 50000 tokens -> 10000 tokens

# 记忆保存日志
Saving memory: projectId=1, type=conclusion, key=核查结论, protected=true

# 语义搜索日志
Semantic search: projectId=1, query=公司法相关规定, limit=5
```

## 八、故障排查

### 8.1 向量检索不工作

检查 pgvector 扩展是否正确安装：
```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### 8.2 压缩导致信息丢失

检查 `LegalInfoProtector` 的保护模式是否覆盖了所需的信息类型。

### 8.3 内存使用过高

调整 `ContextCompressor` 中的 Token 预算配置。

## 九、后续优化

1. **性能优化**
   - 添加 Redis 缓存热点记忆
   - 异步压缩处理

2. **功能增强**
   - 跨项目知识检索
   - 用户画像分析
   - 自动清理过期记忆

