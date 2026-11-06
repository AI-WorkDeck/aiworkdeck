# AI WorkDeck 制度包（草稿）

> **状态：草稿，待法务审阅。** 起草日期 2026-11-05。
> 本目录描述 AI WorkDeck（下称 AWD）**当前实际的做法**，每条尽量附上代码或文档出处，
> 不是对外合同承诺，也不是认证结论（AWD 目前未取得 SOC 2 / ISO 27001 等认证【待确认】）。
> 标【待确认】的地方是代码与现有文档读不出、需要维护者核实或决定的内容。
> 对外提供前，以 `legal/PRIVACY.md` 为准；两者冲突时以 `legal/PRIVACY.md` 和代码为准，并回头修正本目录。

面向对象：律所信息技术部门、采购与风控部门。

| 文件 | 内容 |
|---|---|
| [procurement-faq.md](procurement-faq.md) | 律所采购问答：数据存在哪、模型调用经过谁、如何自托管、如何删除数据 |
| [data-classification.md](data-classification.md) | 数据分级：AWD 处理哪几类数据、各存在哪里 |
| [data-retention.md](data-retention.md) | 数据保留与删除：各类数据保留多久、怎么删 |
| [access-control.md](access-control.md) | 访问控制：产品内的身份认证与权限、代码仓库与生产环境的访问 |
| [change-management.md](change-management.md) | 变更管理：代码如何进入主干、如何发版、更新包如何验证 |
| [vulnerability-mgmt.md](vulnerability-mgmt.md) | 漏洞管理：漏洞报告渠道、扫描手段、历史审计 |
| [vendor-management.md](vendor-management.md) | 供应商（次级处理者）清单 |
| [asset-management.md](asset-management.md) | 资产管理：软件物料清单（SBOM）、第三方组件、基础设施 |

## 维护方式

- 本目录在仓库的 `docs/` 下（该目录被 `.gitignore` 忽略，新增文件需 `git add -f`）。
- 改动产品的数据流、留存规则、出站请求或供应商时，同一个 PR 里更新 `legal/PRIVACY.md` 和本目录对应文件。
- 每份文件的「最近审阅」日期由审阅人填写。审阅周期：【待确认】（建议每年一次，以及重大变更时）。
- 制度负责人：【待确认】（北京京微资易科技有限公司指定的负责人）。
