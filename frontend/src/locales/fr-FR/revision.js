// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 外部 Agent（MCP propose_revision）待审修订：角标、编辑器顶栏与审阅列表
export default {
  bannerCount: "{count} révision(s) externe(s) à examiner",
  review: "Examiner",
  collapse: "Réduire",
  source: "Source : {source}",
  reason: "Motif : {reason}",
  accept: "Accepter et appliquer en suivi des modifications",
  reject: "Refuser",
  stale: "Obsolète",
  staleHint: "Le document a changé après cette proposition ; elle ne peut pas être appliquée. Vous pouvez toujours la consulter ou la refuser.",
  applied: "Appliquée en suivi des modifications. Acceptez ou refusez-les dans le document.",
  editorNotReady: "L'éditeur n'est pas prêt ou le document est en lecture seule ; la révision ne peut pas encore être appliquée.",
  failed: "Échec : {message}",
  noMatch: "La modification {index} ne correspond plus au document ; rien n'a été appliqué. Vous pouvez refuser cette proposition.",
  partial: "Interrompu après {done} modification(s) sur {total} ({message}). Accepter de nouveau reprend à la première non appliquée.",
  progress: "{done} sur {total} appliquée(s)",
}
