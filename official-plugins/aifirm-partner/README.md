<!-- SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
# AI Firm 律师端（aifirm-partner）

美国合作律师在 AI WorkDeck 里接收并办理来自 AI Firm（硅谷，ai-firm.aiworkdeck.com/sv）的审阅请求：
客户在网站上与 AI 对话、生成初稿后，申请任何一家律所的执业律师审阅；律师在这里查看事实、风险提示与各版本，
与客户沟通、安排通话，在 AI WorkDeck 编辑器中修改并把关；最终由客户决定（律师审阅，客户决定，当事各方签署）。

- 视图：工作区「律师端」+ 侧栏卡片，均为全局视图（不打开项目也能用）。
- 连接：`https://ai-firm.aiworkdeck.com` 的 `/api/portal/*`（办公室 sv 作参数，16 个操作，宿主上限 30）。
  律师以 AI WorkDeck 账号登录，由该服务批准后可见事项。
- JAR 工具（仅面板 `tools.invoke` 调用，`agent:false`，AI 对话不可调用）：
  - `aifirmPartnerPutDocx`：把案件最新版本的 .docx 放进当前项目（同名不覆盖）；
  - `aifirmPartnerReadDocx`：读回律师在编辑器中改过的 .docx，存为新版本。
  均经 `PluginHost.files()`，宿主逐次校验项目成员权限。
- 「在 AI WorkDeck 中编辑」依赖宿主 0.88.2 起的 `openProjectId` 与 `ui.openWorkspace({ projectId })`（见 PLUGIN_SPEC）；
  旧宿主上这两个按钮隐藏，其余操作照常。
- 文案：`l10n/` 20 种语言（与其他官方插件同一口径），`scripts/sync-panel-l10n.mjs` 生成 `web/panel-l10n.js`。

构建与测试：`./official-plugins/aifirm-partner/build.sh`（node 测试 + `mvn verify` + 打包 `dist/aifirm-partner-<版本>.zip`）。
上架走 `docs/PLUGIN_DISTRIBUTION.md` 的审核签名流程。

- 框架沟通（1.1.0，仅美国办公室）：`web/framing.js` 及 `index.html`、`matters.js` 中 `us-framing:start` … `us-framing:end` 标记之间的代码，加上 manifest 的 `speech` 权限与 `operations.svConfig`。白标品牌构建可按标记整块删除。
