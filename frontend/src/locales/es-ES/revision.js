// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 外部 Agent（MCP propose_revision）待审修订：角标、编辑器顶栏与审阅列表
export default {
  bannerCount: "{count} revisión(es) externa(s) pendiente(s) de revisar",
  review: "Revisar",
  collapse: "Contraer",
  source: "Origen: {source}",
  reason: "Motivo: {reason}",
  accept: "Aceptar y aplicar como control de cambios",
  reject: "Rechazar",
  stale: "Obsoleta",
  staleHint: "El documento cambió después de esta propuesta y no se puede aplicar. Aún puede verla o rechazarla.",
  applied: "Aplicada como control de cambios. Acéptela o recházala en el documento.",
  editorNotReady: "El editor no está listo o el documento es de solo lectura, por lo que aún no se puede aplicar la revisión.",
  failed: "Error: {message}",
  noMatch: "La edición {index} ya no coincide con el documento, por lo que no se aplicó nada. Puede rechazar esta propuesta.",
  partial: "Se detuvo tras aplicar {done} de {total} ediciones ({message}). Al aceptar de nuevo se reanuda desde la primera sin aplicar.",
  progress: "{done} de {total} aplicadas",
}
