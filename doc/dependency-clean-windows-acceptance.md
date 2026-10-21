<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Windows 依赖隔离验收（dev-board #1394）

PR 的 Desktop Build 在相关依赖、DPIA runtime 或本验收脚本改动时上传 `windows-pr-dependency-installer`，再调用 `dependency-clean-windows.yml`。不发布或签名，无部署凭据；无关 PR 不增加这一轮下载安装。旧 PR1171 的 run39532309387 未上传安装器，不能据其构建绿灯声称做过本验收；本流程必须重新构建同一 PR 的源码并运行。

验收使用全新的 GitHub `windows-2022`（Windows Server）主机，**不是 Windows 11 消费版裸机**。保存 ImageOS/ImageVersion、镜像清单入口、原 PATH 和预装工具路径。先正规卸载 runner Node MSI，再把产品可发现位置里的遗留 Node、LibreOffice、Docker 目录隔离；其他开发工具没有全部卸载。真实新建标准账户、验证非管理员 token 和新 profile，测试子进程 PATH 只有 Windows 系统目录，清除 Python/Node/Java/依赖覆盖变量。宿主的模块路径不注入 Windows PowerShell 子进程；不改永久系统策略。只能在 GitHub 托管一次性 runner 运行。

| 阶段 | 实际执行与判据 | 不代表 |
|---|---|---|
| 安装应用 | 标准账户真实执行本 PR 未签名 NSIS，检查应用、JRE、Python、后端产物 | SmartScreen、可视安装向导或真实 Electron 窗口验收 |
| 缺依赖 | 安装器随包 JRE 加载安装器内真实 `LibreOfficePdfConverter`、`PythonTools`、`TmeetCliService`；LO/Docker=MISSING，tmeet 不可用；缺 LO 转换类别为 NOT_INSTALLED | 整个 Spring HTTP 端点/工作台链路 |
| 随包 Python | 无系统 Python/Node PATH，随包 Python 真实加载 ssl/sqlite3/json | OCR/ASR/TTS 模型推理 |
| 系统安装 | 官网固定版本 MSI 的固定 SHA256 与 Windows Authenticode 均通过后安装；标准账户先尝试 machine-wide Node MSI，必须被拒绝；管理员再安装 | UAC 弹窗、第三方企业管控策略所有情况 |
| 同进程恢复 | 原 Java 进程与生产服务实例保持运行；MSI 安装后重检 LO、Node+tmeet 可用，tmeet 未登录；无 OAuth | 账号登录、会议操作 |
| Word→PDF | 真实生产转换器+真实 LO，合成两页中文 DOCX 含表格；PDFBox 断言两页及中英锚点，输出 PDF 和两页 PNG | 文本与页数通过不等于所有字形视觉正确；PNG 仍应人工抽查 |
| Graphviz | 真实 NativePackService 下载并验证已发布签名 pack；真实 dot.exe 输出合成 SVG | 其它 pack/所有 DLL 或模型的业务验收 |
| DPIA | 随包 Python 建新 venv，先运行缺包检测，再按四项锁定 requirements 安装；真实字体环境检查与现有 lifecycle 测试（Python、DOCX、LO/PDFium 页图、冻结/部分答复/逐页 gate） | 插件代码来自同 PR 源码，非已发布插件包；host AI 明确为合成替身，无付费模型 |
| Docker | 缺 CLI 真实分类与宿主虚拟化信息 | 未安装 Docker Desktop、未改 WSL/Hyper-V/系统策略、未运行容器；daemon 可用性须后续适合环境验收 |

固定版本是可复现兼容性夹具，不是向用户推荐的最新安装版本。来源于 2026-10-21 实际读取的官方公开元数据：

- Node 22.23.3：`https://nodejs.org/dist/v22.23.3/SHASUMS256.txt`，`node-v22.23.3-x64.msi` SHA256 `1c0efc8449987e7da5d184786a0a96da83ffa11d334421201e5c09b93017cb8d`。
- LibreOffice 25.8.4.2：`https://downloadarchive.documentfoundation.org/libreoffice/old/25.8.4.2/win/x86_64/LibreOffice_25.8.4.2_Win_x86-64.msi.sha256`，SHA256 `b2b23d91bda5ad6e97b38008b082060a55d2a3c7c269b2c0e78daca865133d48`。
- `@tencentcloud/tmeet@1.0.19`：npm 官方 registry 元数据的 repository 为 `https://github.com/TencentCloud/tencentmeeting-cli`；脚本核对该 repository 与固定 integrity，并由 npm 校验 tarball。与产品现有安装指引一致；不进行用户授权登录。

`clean-windows-dependency-evidence` 仅保留合成文档、页图、SVG、状态、安装/测试日志。新账户密码只存当前进程内存，不写脚本、日志、Actions 输出或 artifact；不上传用户 profile、安装器、npm/venv、packs、任何凭据。`core-passed.json` 只表示 Java/转换/pack 完成，`passed.json` 还要求 DPIA 子进程成功。失败日志仍上传，不能以存在部分产物标成功。

本机只能验证 Java 编译、工作流/脚本静态契约；Windows 结果必须以实际 Actions run 与 artifact 为准。本流程未调用 release、签名、mirror、发布包或部署。
