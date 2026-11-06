<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# Stella 对齐：律所业务能力差距分析（lawfirm-plugin）

> 2026-11-05。前提（用户明确）：律所管理功能**通过插件实现，不进核心**。对照对象是
> Stella `apps/api/src/handlers` 下的律所业务 handler 和 `packages/{invoicing,money,calculations}`，
> 只读参考。现有插件为 `official-plugins/lawfirm-management` v0.1.3。

## 1. 现状

- 插件 v0.1.3 已有四个模块：收案立项、利冲检索与云端协作放行、发票与收费台账（数电票、6%/3%/1% 税率、手动核销、金蝶/用友 CSV）、工作负荷与决策看板。
- 业务数据由宿主 `LawFirmManagementService`（桥 `lawfirm.request`）提供，只支持固定的一组 action。插件不能自己加表。
- 插件新增的数据只能存三处：插件 `storage`（每插件每设备 localStorage，64 KB）、宿主已有服务，或新增宿主 action（这会改核心）。
- **计时已有，不重做**。AWD 的「工作记录」按打开文件或网页的会话自动计时，扣除空闲，每天上报，可导出 Excel，团队周报引用它。位置：
  - 前端：`frontend/src/utils/activityTracker.js`、`frontend/src/components/userprofile/PersonalWorkLogPanel.vue`、`frontend/src/components/admin/TeamWeekBoard.vue`
  - 后端：`ActivityLogController`（`/api/activity/log`、`/api/activity/history`）、`UserActivityLogService`
  - 缺口：插件桥目前**读不到**工作记录，所以「工作记录 → 计时账单」需要一个只读服务（见第 2 节第 2 行）。

## 2. 差距矩阵（按优先级排序）

图例：✅ 已有　◐ 部分已有　✗ 缺失。中国适用性：高、中、低。

| 优先级 | Stella 能力（handler/package） | AWD 现状 | 中国律所适用性 | 需要的宿主插件 API | 建议 |
|---|---|---|---|---|---|
| **P0（本 PR）** | expenses：办案费用，按类别记录，可转入账单 | ✗ | **高**。诉讼费、保全费、鉴定费、差旅等不属于律师费，由委托人另付。《律师服务收费管理办法》要求结算时提供代付清单和有效凭证，缺凭证部分委托人可以拒付 | `storage` 即可（已够） | 本 PR 实现「办案费用」台账 |
| P1 | time-entries / time-timers / desktop-time-entries / suggestions | ✅ 已有（工作记录，位置见第 1 节）。没有计费标记、费率快照、审批流 | 高。计时收费和常年顾问超时计费都要用 | 新增只读服务 `services.request('worklog','list',{from,to,projectId})`。返回需复用 `/api/activity/history` 的结果并按权限过滤 | 宿主先开只读服务；插件据此做「工作记录 → 计时账单草稿」 |
| P1 | saved-time-narratives / polish-narrative（AI 润色工时描述） | ✗ | 高。账单描述需要「动词开头、写具体工作」 | `ai.request`（已有）+ 上一行的 worklog 服务 | 依赖 P1 worklog 服务 |
| P1 | rates / billing-codes（按人、角色、活动的费率表，生效期，费率快照） | ◐ 收案时可选「计时收费」，但没有费率表 | 中高。律所按合伙人或律师级别定小时费率，部分客户要求 LEDES/UTBMS（外资客户） | `storage` 够用于本机费率表。跨所共享需要新增 `lawfirm.request` action（改核心） | 和计时账单一起做 |
| P2 | invoices / client-invoices：从已审批工时和费用预填发票，贷项通知 | ◐ 有发票申请、开票确认、作废、核销，但不能从工时或费用预填 | 高。数电票已覆盖；红字发票（对应 credit note）未做 | 要给 `submitInvoice` 增加明细行参数（改核心） | 先做费用结算清单导出，再评估是否改宿主 |
| P2 | vat-rates / packages/invoicing（税率期间、逐行舍入） | ◐ 有 6%/3%/1% 选择，整单价税分离 | 中。小规模纳税人减按 1% 有期限，需要税率生效期 | 不需要（宿主已有） | 低优先级 |
| P2 | number-series（{YYYY}{SEQ} 编号规则） | ◐ 宿主固定生成 LF-/INV- 编号 | 低中。律所多有自定义案号规则 | 需要改核心 | 等用户反馈再定 |
| P2 | contacts / entities / business-registries | ◐ 收案登记委托人、对方、关联方和信用代码；宿主有企查查通道（doc-insight） | 高。利冲需要主体库 | 需要把企查查查询开成插件服务（`services`），目前未开放 | 另立卡 |
| P3 | tasks / work-obligations（期限、确认、队列） | ✅ 已有：我的待办、日历（`/api/tasks`、`/api/calendar`），插件可通过 `services.request('calendar', …)` 调用 | 高（诉讼时效、举证期限） | 已有 `calendar` 服务 | 不重复做 |
| P3 | reports（内置报表、导出队列） | ◐ 看板已有负荷、回款、账龄，并可导出财务 CSV | 中 | 不需要 | 不做 |
| P3 | seller-profiles（开票主体、银行账户） | ◐ 发票只有购买方信息，没有多开票主体 | 中。分所各自独立开票 | 需要改核心 | 等需求 |
| P4 | sanctions（EU/UN/OFAC/UK 制裁名单筛查） | ✗ | 低中。只涉外业务需要；国内更关注失信被执行人、不可靠实体清单 | 需要外部数据源，`connections`/`mcp` 可接入，但涉及新出站请求，须先在 PRIVACY 中声明 | 暂不做 |
| — | money / calculations（整数分、币种分账） | ✅ 插件和宿主金额都用分（`*Cents`） | — | — | 无差距 |

### 风险代理与律协要求（插件已有）

收案预检会提示风险代理上限，包括 30% 封顶和分段递减上限（宿主 `LawFirmManagementService` 的 `feeComplianceWarning`）。Stella 没有对应能力，这部分是 AWD 的优势，无需对齐。

## 3. 本 PR：办案费用台账（P0）

**为什么选它。** 计时已有（工作记录），所以剩下的缺口里，它是价值最高且宿主 API 已经够用的一项：
- 中国律所每个诉讼或仲裁案件都会产生代垫费用；
- 法规对凭证有明确要求；
- 只需要插件 `storage`，不改宿主核心。

**功能（只在插件内）。**
- 「办案费用」标签页。登记字段：日期、事项、类别（8 类）、金额、支付方（律所代垫 / 委托人直付）、凭证号。
- 按事项汇总四个金额：律所代垫、待向委托人结算、其中缺凭证、委托人直付。
- 逐笔可标记或撤回「已结算」，可删除。

**约束。**
- 金额按字符串解析成整数分，不用浮点。
- 本机台账存在插件 `storage`，宿主上限 64 KB。写满时提示用户，原数据不受影响。
- 不上传云端，不进入发票台账（办案费用不是律师服务费）。
- 文案走 `l10n/*.json` 的 `expense.*` 键，覆盖 20 个语种。`build.sh` 据此生成 `web/expenses-l10n.js`，测试校验两者一致。

**测试。** `tests/expenses.mjs`，jsdom 合成沙箱，覆盖：
- 金额解析与非法输入；
- 分级汇总（含 0.1 + 0.2 无浮点漂移）；
- 结算切换；
- 委托人直付不可结算；
- 删除；
- 恢复已存数据；
- 存储写满；
- 英文令牌。

CI 的 frontend job 新增一步，运行该插件的全部测试。这些测试此前不在 CI 中。

**宿主改动：无。**

**待核对。** 「不能提供有效凭证的部分，委托人可不予支付」引自《律师服务收费管理办法》（发改价格〔2006〕611 号），需要律师核对现行条文。

## 4. 未做 / 后续

- 费用结算清单导出（PDF/CSV）：插件桥没有写文件或下载方法。`services.sensitive/download` 只接受恢复包。需要宿主提供通用 `download` 服务。
- P1「工作记录 → 计时账单」：需要宿主先开只读 `worklog` 服务（第 2 节）。
- 本机台账不跨设备、不跨同事共享。要做律所级共享，必须新增 `lawfirm.request` action，属于核心改动，需要用户决定。
