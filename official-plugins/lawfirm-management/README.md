<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# 律所管理

官方律所全业务管理 Web 插件，需具备 `lawfirm.request`、`im.request` 的 AI WorkDeck 0.61.0 或更新宿主。通过桌面端每个律师/成员工作台（`Unit`）与律所业务管理引擎闭环联动，提供四大核心模块：

1. **收案与立项（Case Intake & Progress）**：登记委托人、对方当事人、关联方/控股股东/一致行动人、主办负责人、所属业务部门与收费模式（固定收费、按标的额比例、风险代理、计时收费、常年法律顾问），支持提交前实时利冲与收费合规预检，并在插件与个人中心同步展示五步利冲进展（`提交收案申请` → `自动利冲检索` → `关联律师站内信放行` → `利冲委员终审` → `正式立案并建项`）。
2. **利冲审查中心（Conflict Clearance & Committee Center）**：依据《中华人民共和国律师法》第 39、50 条、中华全国律师协会《律师执业行为规范》第 50–56 条及《律师服务收费管理办法》第 11–13 条自动执行红（直接利冲禁止代理）、黄（潜在利冲需征询豁免与信息隔离墙）、绿（无利冲审查通过）三级判定。命中潜在冲突时自动通过内置站内信（`ImService`）向关联案件承办律师发起放行征询，支持「同意放行 / 附条件放行（信息隔离墙）/ 拒绝放行」与利冲委员会终审立案。
3. **发票与财务收费（Invoicing & Fee Collection Ledger）**：支持数电专票、数电普票、增值税专票/普票申请与开票确认；在未接通外部 ERP 前支持手动登记收费到账与发票核销，同时提供金蝶/用友标准财务台账同步接口。
4. **决策与团队看板（Decision-Maker & Workload Dashboard）**：聚合桌面端个体（`Unit`）、团队负责人（合伙人）与各业务部门在办案件、Workload 忙闲负荷指数（空闲 / 适中 / 饱和 / 超负荷）、签约合同额、已开票额、已到账实收、待收账款 AR、开票率、账单回收率、合同回款率及应收账款账龄分布（`<30天`、`30–90天`、`>90天`）。

## 构建与验证

执行 `./official-plugins/lawfirm-management/build.sh`。测试复用 `frontend` 安装的 `jsdom` 运行合成沙箱回归，并将仓库 `sdk/plugin-sdk/awd-plugin-sdk.js` 打包输出至 `dist/lawfirm-management-0.1.0.zip`。
