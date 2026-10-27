// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "References",
  "noDoc": "No document open",
  "parse": "Full-document online verification (charges may apply)",
  "reparse": "Repeat full-document online verification (charges may apply)",
  "onlineHint": "Clicking saves this document, then verifies the saved version online. AI and external lookups may incur charges.",
  "saveRequired": "This document could not be saved. Save it successfully before online verification.",
  "running": "Verifying online…",
  "done": "Online verification complete",
  "failed": "Online verification failed",
  "loading": "Chargement…",
  "loadingDetail": "Fetching lookup details…",
  "noDetail": "No lookup details for this item",
  "loadFailed": "Could not load online verification results",
  "parseFailed": "Could not start online verification",
  "detailFailed": "Could not load the lookup details",
  "refreshFailed": "Could not re-run the lookup",
  "retry": "Réessayer",
  "goConnectAccount": "Connect account",
  "goRecharge": "Add credits",
  "hint": {
    "NO_CREDENTIAL": "This lookup channel needs a credential configured on the server by your administrator."
  },
  "tab": {
    "retrieval": "Lookups",
    "checks": "Consistency"
  },
  "kind": {
    "COMPANY": "Companies",
    "LAW": "Statutes",
    "CASE": "Cases",
    "DOC": "Documents"
  },
  "entityKind": {
    "COMPANY": "Company",
    "LAW": "Statute",
    "CASE": "Case",
    "DOC": "Document"
  },
  "openInNewTab": "Open in a new tab",
  "openDocFile": "Open file",
  "docNotFound": "No such file in this project",
  "docMissing": "That file is no longer in this project",
  "source": {
    "projectFile": "Project file",
    "qichacha": "Qichacha"
  },
  "mentions": "{count} mention(s)",
  "mentionsTitle": "Mentions dans ce document",
  "shareholders": "Actionnaires",
  "moreCandidates": "Autres candidats",
  "caseSection": {
    "ascertain": "Faits établis",
    "reason": "Motivation",
    "result": "Jugement",
    "gist": "Principale décision",
    "fullText": "Jugement intégral"
  },
  "authoritative": "Texte faisant autorité (Pkulaw)",
  "implementDate": "En vigueur depuis le {date}",
  "recognition": "Reconnaissance du numéro d'affaire",
  "openInPkulaw": "Ouvrir dans Pkulaw",
  "citation": {
    "citedText": "Article cité",
    "candidates": "Articles identifiés par le contenu",
    "article": "Article {n}"
  },
  "severity": {
    "warn": "Douteux",
    "error": "Erreur"
  },
  "unifyTo": "Tout définir sur {value}",
  "cannotFix": "Impossible de corriger automatiquement : {reason}",
  "fixNotUnique": "Impossible de trouver une correspondance unique — veuillez modifier manuellement.",
  "fixPartial": "{done} corrections effectuées ; {failed} sans correspondance unique — veuillez les modifier manuellement.",
  "fixed": "Corrigé",
  "fixedHint": "Appuyez sur Cmd+Z pour annuler ; relancez l'analyse pour actualiser les résultats.",
  "noEditor": "Activez d'abord une fenêtre d'éditeur de document",
  "empty": {
    "noRun": "Ce document n'a pas été vérifié en ligne",
    "noRunHint": "Les suggestions de rédaction courante s'exécutent localement. Seul un clic sur la vérification en ligne envoie le document enregistré pour l'extraction par IA, les recherches externes et les contrôles de cohérence.",
    "noEntity": "Aucune entité identifiable trouvée",
    "noEntityHint": "Le document ne mentionne aucun nom de société, article de loi ou numéro d'affaire.",
    "noFinding": "Aucune incohérence détectée",
    "noFindingHint": "Les quantités et les codes de crédit social unifié sont tous conformes."
  }
}
