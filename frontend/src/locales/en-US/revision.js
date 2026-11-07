// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 外部 Agent（MCP propose_revision）待审修订：角标、编辑器顶栏与审阅列表
export default {
  bannerCount: "{count} external revision(s) awaiting review",
  review: "Review",
  collapse: "Collapse",
  source: "From: {source}",
  reason: "Reason: {reason}",
  accept: "Accept and apply as tracked changes",
  reject: "Reject",
  stale: "Outdated",
  staleHint: "The document changed after this proposal, so it cannot be applied. You can still view or reject it.",
  applied: "Applied as tracked changes. Accept or reject them in the document.",
  editorNotReady: "The editor is not ready or the document is read-only, so the revision cannot be applied yet.",
  failed: "Failed: {message}",
  noMatch: "Edit {index} no longer matches the document, so nothing was applied. You can reject this proposal.",
  partial: "Stopped after applying {done} of {total} edits ({message}). Accept again to resume from the first unapplied edit.",
  progress: "{done} of {total} applied",
}
