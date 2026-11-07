// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 外部 Agent（MCP propose_revision）待审修订：角标、编辑器顶栏与审阅列表
export default {
  bannerCount: "{count} 条外部修订待审",
  review: "审阅",
  collapse: "收起",
  source: "来源：{source}",
  reason: "理由：{reason}",
  accept: "接受并套用为修订",
  reject: "拒绝",
  stale: "已过期",
  staleHint: "文档在提案之后已被修改，无法套用；仍可查看或拒绝。",
  applied: "已套用为修订痕迹，请在文档中逐条接受或拒绝。",
  editorNotReady: "编辑器尚未就绪或文档为只读，暂时无法套用修订。",
  failed: "操作失败：{message}",
  noMatch: "第 {index} 条修订在当前文档中已找不到原文，未套用任何修订；可拒绝该提案。",
  partial: "已套用 {done}/{total} 条后中断（{message}）。再次点击接受将从未套用的一条继续。",
  progress: "已套用 {done}/{total} 条",
}
