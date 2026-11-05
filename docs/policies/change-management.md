# 变更管理（草稿）

> **草稿，待法务审阅。** 起草 2026-11-05；最近审阅：【待填写】。

## 一、代码变更

1. 所有改动经 Pull Request 合入 `master`（分支保护强制，禁止强推）。
2. 合并前必须通过的 CI 检查（`.github/workflows/ci.yml`，分支保护里登记为必过）：
   - `Backend (mvn test)`：后端与官方插件构建、全量测试、测试报告完整性校验；
   - `Frontend (build:h5)`：前端构建与测试；
   - `Desktop (install deps)`：桌面端依赖安装；
   - `CLAAssistant`：贡献者许可协议签署。
3. 同一 CI 中还运行但未登记为必过的检查：SPDX 文件头、配色与设计令牌、工具对拍、多语种令牌化（`SPDX header check` 等）；以及本次新增的密钥扫描与 SBOM（`.github/workflows/supply-chain.yml`）。【待确认】是否把密钥扫描加入必过检查。
4. GitHub CodeQL 默认配置已开启，覆盖 Java/Kotlin、JavaScript/TypeScript、Python、C/C++ 和 GitHub Actions。
5. 仓库的维护规则（`CLAUDE.md`、`AGENTS.md`）要求合并前：受影响的 npm 工作区 `npm audit` 为 0 漏洞，等待 CodeQL 完成，并通过 GitHub API 核对无未处理的 Dependabot / CodeQL 告警。这是写给开发者（包括 AI 编码助手）的流程要求，目前没有自动门禁强制执行。
6. **人工审阅**：分支保护目前不要求审批人数（0 人），也没有 CODEOWNERS。开发中大量使用 AI 编码助手，改动由维护者授权合并。【待确认】是否对涉及鉴权、数据流、出站请求的改动要求人工审阅。
7. 新增出站请求必须先在 `legal/PRIVACY.md` 声明；引入第三方代码须在同一 PR 补 `UPSTREAM.md` 并保留上游许可头。

## 二、发版

1. 版本号唯一来源是 `desktop/package.json`。
2. 打 `v*` 标签触发 `desktop-build.yml`，构建 macOS 与 Windows 安装包：
   - macOS：Developer ID 签名、Hardened Runtime、Apple 公证；
   - Windows：Azure Artifact Signing（OIDC 登录，GitHub 环境 `windows-signing`）。工作流注释写明组织迁移后的签名发版尚待验证【待确认】。
3. 发版、部署、客户端升级需要维护者本次明确指示，与合并 PR 分开授权（`AGENTS.md`）。
4. 发版记录：GitHub Releases。【待确认】是否保存发版审批记录、变更说明模板。

## 三、更新包的完整性

- 桌面端自动更新（`desktop/main/services/update-service.js`）先下载更新清单并用源码内嵌的 Ed25519 公钥验签，私钥只在 CI Secret `UPDATE_SIGNING_KEY` 中。
- 各组件和安装包按清单中的 sha256 与大小校验，任一不符整批丢弃。
- 整包更新：macOS 由系统校验代码签名；Windows 安装脚本再次校验 SHA256 与 Authenticode 签名。
- 插件包与资源包由 `pack-release.yml` 构建；清单签名不在 CI 中进行，私钥 `AWD_PLUGIN_SIGNING_KEY` 只存在官网服务器，由 `deploy/publish-pack.sh sign` 签名。
- 律所可以设置 `AWD_DISABLE_UPDATES=1` 关闭自动更新，自行控制升级节奏（`update-service.js`）。【待确认】是否作为面向客户的正式配置项写进部署文档。

## 四、服务端变更

- 插件云后端、案件库与桌面端是同一份 `backend.jar`，按 profile 区分；部署步骤与回滚位置记录在 `deploy/*/README.md`。
- 【待确认】服务端变更的审批、维护窗口、事前通知客户的做法，以及数据库迁移的回滚预案。

## 五、紧急变更

【待确认】目前没有书面的紧急变更流程。
