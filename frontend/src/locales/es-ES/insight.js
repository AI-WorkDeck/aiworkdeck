// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Referencias",
  "noDoc": "Ningún documento abierto",
  "parse": "Verificación en línea de todo el documento (puede generar cargos)",
  "reparse": "Repetir verificación en línea de todo el documento (puede generar cargos)",
  "onlineHint": "Al hacer clic se guarda este documento y luego se verifica en línea la versión guardada. La IA y las consultas externas pueden generar cargos.",
  "saveRequired": "No se pudo guardar este documento. Guárdalo correctamente antes de verificarlo en línea.",
  "running": "Verificando en línea…",
  "done": "Verificación en línea completada",
  "failed": "Error en la verificación en línea",
  "loading": "Cargando…",
  "loadingDetail": "Obteniendo detalles de la consulta…",
  "noDetail": "No hay detalles de consulta para este elemento",
  "loadFailed": "No se pudieron cargar los resultados de la verificación en línea",
  "parseFailed": "No se pudo iniciar la verificación en línea",
  "detailFailed": "No se pudieron cargar los detalles de la consulta",
  "refreshFailed": "No se pudo repetir la consulta",
  "retry": "Reintentar",
  "goConnectAccount": "Conectar cuenta",
  "goRecharge": "Añadir créditos",
  "hint": {
    "NO_CREDENTIAL": "Este canal de consulta requiere credenciales configuradas en el servidor por el administrador."
  },
  "tab": {
    "retrieval": "Consultas externas",
    "checks": "Coherencia"
  },
  "kind": {
    "COMPANY": "Empresas",
    "LAW": "Normativa",
    "CASE": "Jurisprudencia",
    "DOC": "Documentos"
  },
  "entityKind": {
    "COMPANY": "Empresa",
    "LAW": "Norma",
    "CASE": "Caso",
    "DOC": "Documento"
  },
  "openInNewTab": "Abrir en una pestaña nueva",
  "openDocFile": "Abrir archivo",
  "docNotFound": "No se encontró ese archivo en este proyecto",
  "docMissing": "Ese archivo ya no está en este proyecto",
  "source": {
    "projectFile": "Archivo del proyecto",
    "qichacha": "Qichacha"
  },
  "mentions": "{count} mención(es)",
  "mentionsTitle": "Menciones en este documento",
  "shareholders": "Accionistas",
  "moreCandidates": "Otros candidatos",
  "caseSection": {
    "ascertain": "Hechos probados",
    "reason": "Fundamentos de derecho",
    "result": "Fallo",
    "gist": "Doctrina clave",
    "fullText": "Sentencia completa"
  },
  "authoritative": "Texto oficial (Pkulaw)",
  "implementDate": "En vigor desde {date}",
  "recognition": "Reconocimiento de número de expediente",
  "openInPkulaw": "Abrir en Pkulaw",
  "citation": {
    "citedText": "Artículo citado",
    "candidates": "Artículos coincidentes por contenido",
    "article": "Artículo {n}"
  },
  "severity": {
    "warn": "Dudoso",
    "error": "Error de coherencia"
  },
  "unifyTo": "Unificar todo como {value}",
  "cannotFix": "No se puede corregir automáticamente: {reason}",
  "fixNotUnique": "No se pudo localizar una coincidencia única; edítalo manualmente.",
  "fixPartial": "Se corrigieron {done}; {failed} no tenían coincidencia única; edítalos manualmente.",
  "fixed": "Corregido",
  "fixedHint": "Pulsa Cmd+Z para deshacer; vuelve a analizar para actualizar las conclusiones.",
  "noEditor": "Activa primero una ventana de edición de documentos",
  "empty": {
    "noRun": "Este documento aún no se ha verificado en línea",
    "noRunHint": "Las sugerencias habituales de escritura se ejecutan localmente. Solo al pulsar la verificación en línea se envía el documento guardado para extracción con IA, consultas externas y revisión de coherencia.",
    "noEntity": "No se encontraron entidades consultables",
    "noEntityHint": "El documento no menciona nombres de empresas, artículos legales ni números de caso.",
    "noFinding": "No se encontraron incoherencias",
    "noFindingHint": "Las declaraciones de cantidades y los códigos de crédito social unificado son coherentes."
  }
}
