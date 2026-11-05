<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Stella 对齐：贡献者一条命令跑起来（dev-onboarding）

## 目标

参照 Stella 的 `bun run dev`（装依赖、起 Docker、建库、起服务、开浏览器，`USE_MOCK_AI` 默认开）：
贡献者 clone 后一条命令在本机跑起 AWD，**不需要任何 AI Key 或账户**。

## 做了什么

| 部分 | 文件 | 要点 |
|---|---|---|
| 模拟 AI | `backend/.../service/ai/MockChatModel.java` | 确定性假模型，同时实现同步与流式接口。Agent 模式：本轮首次调用 `doc_list_project_files`（只读），拿到结果后 `<final>` 摘录收尾；无工具时回显。只要本轮出现过工具请求就收尾，不会循环。 |
| 路由 | `ChatModelFactory`、`AiModelProperties.Provider.MOCK` | `ai.mock.enabled=true` 时 `resolveProvider()` 恒为 MOCK，先于 local-mode 的平台通道短路；同步/流式/辅助/限时入口都返回模拟模型，不走账户、计费、平台目录。 |
| 生产防误开 | `MockAiGuard` | 必须激活 `dev` 且不含 prod/cloud/case/desktop，否则**拒绝启动**；`ai.model.provider=mock` 启动即失败；设置页不能保存 MOCK；库里存的 MOCK 被忽略。 |
| 前端 | `requireAccountCore.js` | `requiresAiAccount('MOCK')` 为假：免账户，不像 Ollama 那样收成问答模式。 |
| dev profile | `application-dev.yml` | local-mode 免登 + Postgres（55432）+ 模拟 AI 默认开（`AI_MOCK_ENABLED=false` 关）+ 关自动打标签。 |
| 最小栈 | `docker-compose.dev.yml`、`scripts/quickstart.sh` | 只起 Postgres(pgvector) 容器；后端、H5 前端在宿主上跑。数据、日志、隔离的 user.home、已装插件目录都放 `.quickstart/`。端口被占直接报错，不杀别人的进程。 |
| 演示数据 | `scripts/quickstart/seed-demo.mjs` | 经公开 HTTP 接口建「演示案件：买卖合同纠纷」，导入 `fixtures/evidence-demo-1076` 四份虚构材料；同名跳过；新项目首个上传的 `VERSION_BUSY` 重试。 |
| 文档 | `docs/getting-started.md`、`docs/self-hosting.md`、`docs/docker-sidecars.md` | 开头改成「5 分钟跑起来」；新增自托管最小部署（Postgres + 后端 + H5 + nginx，不依赖托管平台）。 |

## 取舍

- **后端与前端在宿主上跑，不全容器化**：dev profile 是 local-mode，后端必须只听 127.0.0.1（容器里要监听 0.0.0.0，会被启动检查拒绝）；而且贡献者本来就要 JDK/Node 才能改代码。所以和 Stella 一样，用户需要装好 Docker、JDK 21、Maven、Node 20+。
- **用 Postgres 而不是 H2**：按任务要求，并和服务器部署同一种库；H2 是桌面版的路径。
- **演示数据走 HTTP、不写种子 SQL**：不往生产代码里加种子逻辑，接口变更时脚本会直接报错而不是悄悄写坏库。
- **浏览器直开演示项目工作台**：纯浏览器 H5 的启动页是登录页（桌面壳才直进工作台），dev profile 免登，所以脚本打开工作台地址。
- **不改 `restart-all.sh`**：维护者日常用它连真实模型，行为不变。

## 验证（2026-11-05，macOS arm64）

1. 全新 `git clone` 到空目录（无 node_modules、无 `.quickstart/`、全新 Docker 卷），`AWD_NO_OPEN=1 ./scripts/quickstart.sh`：
   Postgres 健康 → 后端构建并启动 → 演示项目创建（4 份材料）→ `npm ci` → 前端就绪。Maven/npm 本地缓存是热的，首次下载耗时未计。
2. 无头 Chrome 打开演示项目工作台：资源管理器列出 4 份材料；AI 面板（智能体模式）发送「列出项目里的材料」，
   过程显示「已执行 1 项操作」，回复为模拟 AI 摘录的 4 个文件；无登录弹层，无页面错误。
3. 第二次运行（`AWD_SKIP_BUILD=1`）：演示数据跳过，重复聊天正常；Ctrl-C 后 9696/5173 均释放。
4. `SPRING_PROFILES_ACTIVE=dev,prod AI_MOCK_ENABLED=true` 启动：抛 `IllegalStateException` 拒绝启动。
5. 自托管文档的默认 profile：同一 Postgres 新库启动，`activeProvider=OPENROUTER`（模拟未开），未登录接口回 4010，日志打印 admin 随机初始口令。nginx/TLS 部分未实测。
6. 单测：`MockChatModelTest`、`ChatModelFactoryTest`（含 2 条新用例）、`OrchestratorReplayEvalTest`、`paid-service.test.mjs` 通过；`check:locales` 通过。

## 已知问题与未做

- 模型选择器仍显示真实模型名（如「智能 · DeepSeek」），实际回复由模拟模型给出，每条回复都写明「模拟 AI」。是否在模拟模式下只展示一个「模拟模型」条目，待定。
- 现有缺陷（与本改动无关）：Postgres 下日历接口 `ProjectTaskService.listAcrossProjects` 报 `could not determine data type of parameter $2`（H2 正常）。
- Windows 原生 shell 不支持（脚本是 bash；WSL 未测）。
- 未做 Stella 那样的一键托管部署按钮（按要求不新增托管平台依赖）。
