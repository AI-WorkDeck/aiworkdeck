# Stella 对齐：合规材料与供应链卫生（compliance）

起草 2026-11-05。对应对比报告第 6 节「面向律所采购的合规材料」。

## 目标

1. CI 中加入密钥扫描，并对全部历史做一次扫描、如实记录结果，不改写历史。
2. CI 自动生成 SBOM（CycloneDX），覆盖 Java/Maven、npm、Python 等，作为 CI 产物。
3. 起草 `docs/policies/` 制度包和「律所采购问答」，内容以代码和现有文档为准，读不出依据的标【待确认】。

## 参考

Stella：`docs/policies/*`（七份制度 + `evidence.json`）、`.gitleaks.toml`、`.provenance.yml` + `provenance/`、`SECURITY.md`。

## 方案

### 密钥扫描

- 新增 `.github/workflows/supply-chain.yml` 的 `secret-scan` 任务：下载固定版本的 gitleaks（8.30.1，校验 sha256），扫描 PR 的 `base..head` 或主干推送的 `before..after`；没有可用基准时（手动触发）扫当前工作树。
- 不用 `gitleaks/gitleaks-action`：该 action 对组织仓库要求许可证。
- 不做全历史阻断：历史中已有真实密钥（见 `docs/policies/vulnerability-mgmt.md` 第四节），且按要求不改写历史，只能在服务商侧吊销。
- `.gitleaks.toml` 沿用默认规则，逐值放行 6 处测试合成值，不按目录放行。
- GitHub 自带的密钥扫描与推送保护已开启，gitleaks 是补充（覆盖服务商模式以外的通用规则）。

### SBOM

- `sbom` 任务：
  - `cyclonedx-maven-plugin`（命令行调用，不改 `pom.xml`）对 `backend/pom.xml` 生成含传递依赖的 BOM；
  - `syft`（固定 1.55.0，校验 sha256）扫全仓库，覆盖 npm 锁文件、Python 锁文件、其余 `pom.xml`。
- 两份 JSON 打包为 `sbom-<sha>` 产物，保留 90 天，不入库。
- 没有像 Stella 那样把 SBOM 与第三方声明提交进仓库：AWD 已有人工维护的 `legal/THIRD-PARTY-COMPONENTS.md` 与 `REUSE.toml`，再入库一份生成物会带来大量噪声 diff。是否在发版时把 SBOM 挂到 Release 上，留给维护者决定。

### 制度包

`docs/policies/`：README（索引）、数据分级、数据保留、访问控制、变更管理、漏洞管理、供应商管理、资产管理、律所采购问答。全部是草稿，由用户（律师）审阅定稿。

未照搬 Stella 的 `evidence.json`（制度条款与代码锚点的自动核对）：先让用户定稿制度文本，再决定是否值得做。

## 全历史扫描结果（摘要）

gitleaks 8.30.1，3,988 个提交，47 条命中。去重后：Google/Gemini、OpenRouter、企查查、Tushare、北大法宝、ElevenLabs、MinerU 云 Token 七类真实凭据（均在 `master` 历史中）；Edge TTS 公开常量 1 处；测试合成值 6 处。GitHub 密钥扫描对 Google 与 OpenRouter 两条告警于 2026-06-11 标记为已吊销；其余是否轮换待维护者确认。人工抽查还发现历史中企查查 `secret` 与 WPS `app-secret` 未被规则识别。详表见 `docs/policies/vulnerability-mgmt.md`。

## 起草中发现的需决策事项

- `cdn.zetaoffice.net`（文档编辑器引擎）是桌面端默认访问的外部地址，`legal/PRIVACY.md` 中未找到声明，与仓库「不新增未声明出站请求」的红线有出入。
- PRIVACY 与应用内提示称会议录音存储桶有 24 小时生命周期规则，仓库中找不到对应配置（`deploy/cloud/setup-relay-oss.py` 只配置了中转桶的 35 天规则）。
- 分支保护不要求人工审批（0 人），管理员不受约束；`.github/SECURITY.md` 写 `main` 分支而默认分支是 `master`，且无响应时限。
- 管理员填写的服务 Key 在本地数据库明文存放；桌面日志没有轮转。
- 案件库部署文档记载「零备份状态」，仓库中没有落地的备份脚本。

## 验证

- 本地：`gitleaks dir .`（带 `.gitleaks.toml`）无命中；全历史扫描结果如上。
- CI：本 PR 上 `Supply chain` 工作流的两个任务通过，SBOM 产物可下载、组件数非零。
