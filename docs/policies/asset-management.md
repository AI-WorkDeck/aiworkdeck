# 资产管理（草稿）

> **草稿，待法务审阅。** 起草 2026-11-05；最近审阅：【待填写】。

## 一、软件资产：依赖清单与 SBOM

AWD 的依赖分布在以下清单文件中（不含 `node_modules`）：

| 生态 | 清单 |
|---|---|
| Java / Maven | `backend/pom.xml`、`backend/plugin-api/pom.xml`、`official-plugins/{dpia-workbench,tencent-meeting,baoqingtian}/backend/pom.xml`、`examples/*/pom.xml` |
| npm（有锁文件） | `frontend/`、`desktop/`、`office-addin/`、`pptx-service/frontend/`、`official-plugins/dpia-workbench/`、`docs/marketing/launch-video/pipeline/` |
| Python | `pptx-service/`（`uv.lock`、`requirements.lock`）、`kokoro-service/`、`asr-service/`、`mineru-service/`（`requirements.lock`）、`official-plugins/dpia-workbench/runtime/requirements.txt` |
| 容器 | `mineru-service/Dockerfile`、`pptx-service/backend/Dockerfile`、`pptx-service/frontend/Dockerfile` |

**SBOM**：`.github/workflows/supply-chain.yml` 在每个 PR 和主干推送时生成 CycloneDX JSON，作为 CI 产物 `sbom-<提交号>` 保存 90 天：

- `backend-maven.cdx.json`：后端 Maven 依赖，含传递依赖（cyclonedx-maven-plugin，不含 test 作用域）；
- `repo.cdx.json`：全仓库扫描（syft），覆盖各 npm 锁文件、Python 锁文件、插件与示例的 `pom.xml` 等。

已知局限：

- 官方插件后端的 Maven 依赖在 `repo.cdx.json` 中只有直接依赖，未解析传递依赖。
- 桌面安装包内置的 JRE、LibreOffice WASM 引擎、原生二进制没有清单文件，SBOM 中不出现。它们列在 `legal/THIRD-PARTY-COMPONENTS.md`。
- 正式发版的安装包尚未附带 SBOM。【待确认】是否在发版流程中把 SBOM 作为 Release 附件长期保存。

**第三方组件与许可**：人读清单 `legal/THIRD-PARTY-COMPONENTS.md`；机读的逐文件许可标注 `REUSE.toml`；上游代码来源记录 `UPSTREAM.md` 与各目录下的 `UPSTREAM.md`；许可全文在 `LICENSES/`。

## 二、基础设施资产

| 资产 | 说明 | 出处 |
|---|---|---|
| 域名 | aiworkdeck.com（含 www、addin、case 子域，发信域名 dm、send）；workdeck.ai（国际站，含 addin、case 子域） | `application*.yml`、`deploy/*/README.md` |
| 北京服务器 | 官网、插件云后端、PostgreSQL、案件库共机 | `deploy/case/README.md` |
| 新加坡服务器 | 国际站官网、插件云后端、案件库 | 同上 |
| 对象存储 | `awd-mobile-relay`（北京）、`awd-mobile-relay-intl`（新加坡） | `deploy/cloud/README.md` |
| 代码仓库与 CI | GitHub 组织 AI-WorkDeck | — |
| 签名凭据 | Apple Developer ID、Azure Artifact Signing、更新清单签名密钥、插件包签名密钥 | `change-management.md` |

【待确认】是否有集中维护的资产台账（含负责人、到期日，例如证书与域名续期）。

## 三、终端设备

【待确认】开发与运维人员使用的电脑是否有磁盘加密、屏幕锁定、终端管理要求。
