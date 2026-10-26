// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "By Section",
    "byParty": "By Party"
  },
  "filter": {
    "allSections": "All sections",
    "allParties": "All parties"
  },
  "stat": {
    "total": "{count} total"
  },
  "status": {
    "all": "Todo",
    "active": "Activa",
    "unverified": "Unverified",
    "stale": "Changed",
    "orphan": "Orphaned"
  },
  "group": {
    "none": "Unassigned",
    "untitled": "(No section)"
  },
  "action": {
    "keep": "Keep Link",
    "rebind": "Reassign",
    "confirmRebind": "Confirm",
    "cancelRebind": "Cancelar",
    "delete": "Eliminar",
    "removeTarget": "Eliminar",
    "open": "View Source",
    "ignore": "Ignore",
    "expand": "Expand",
    "collapse": "Collapse"
  },
  "method": {
    "written_review": "Document Review",
    "written_statement": "Written Statement",
    "web_check": "Online Check",
    "third_party": "Third-Party Material",
    "interview": "Interview",
    "none": "No method"
  },
  "relation": {
    "supports": "Supports",
    "contradicts": "Contradicts",
    "partial": "Partial"
  },
  "loc": {
    "wholeFile": "Whole file",
    "page": "Page {page}",
    "quote": "\"{quote}\"",
    "region": "Image region",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "No source files linked to this document yet",
  "emptyHint": "Drag a file from the explorer onto selected text to link it",
  "emptyFiltered": "Ningún enlace coincide con el filtro actual",
  "fileMissing": "(el archivo ya no existe)",
  "fileDeleted": "(en la papelera de reciclaje)",
  "targetsCount": "{count} fuentes",
  "rebindHint": "Selecciona el nuevo texto en el documento y luego pulsa Confirmar",
  "rebindNoSelection": "Selecciona primero el texto en el documento",
  "rebindFailed": "Error al reasignar",
  "rebindRetryHint": "El nuevo marcador ya está en el documento; pulsa Confirmar de nuevo para reintentarlo.",
  "keepGone": "Este texto ya no está en el documento, por lo que no se puede mantener el enlace. Usa Reasignar en la pestaña de Fuentes.",
  "orphanGoto": "El ancla de este texto ya no está en el documento. Pulsa Reasignar para elegir un texto nuevo.",
  "confidence": "Confianza {value}",
  "loading": "Cargando…",
  "loadFailed": "Error al cargar los enlaces",
  "fileTagsLoadFailed": "Error al cargar las etiquetas de partes; la vista \"Por parte\" puede ser inexacta",
  "opFailed": "Error en la operación",
  "deleteConfirm": "¿Eliminar este enlace? El archivo de origen no se eliminará.",
  "deleteTargetConfirm": "¿Quitar esta fuente?",
  "staleOne": "Este texto tiene {count} fuentes vinculadas y ha sido modificado",
  "staleMany": "Se han modificado {count} pasajes vinculados",
  "stalePrefix": "Modificado: "
}
