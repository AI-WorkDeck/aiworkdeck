// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Références",
  "noDoc": "Aucun document ouvert",
  "parse": "Vérification en ligne du document complet (des frais peuvent s’appliquer)",
  "reparse": "Relancer la vérification en ligne du document complet (des frais peuvent s’appliquer)",
  "onlineHint": "Un clic enregistre ce document, puis vérifie en ligne la version enregistrée. L’IA et les recherches externes peuvent entraîner des frais.",
  "saveRequired": "Ce document n’a pas pu être enregistré. Enregistrez-le avant de lancer la vérification en ligne.",
  "running": "Vérification en ligne…",
  "done": "Vérification en ligne terminée",
  "failed": "Échec de la vérification en ligne",
  "loading": "Chargement…",
  "loadingDetail": "Récupération des détails…",
  "noDetail": "Aucun détail de recherche pour cet élément",
  "loadFailed": "Impossible de charger les résultats de la vérification en ligne",
  "parseFailed": "Impossible de démarrer la vérification en ligne",
  "detailFailed": "Impossible de charger les détails de la recherche",
  "refreshFailed": "Impossible de relancer la recherche",
  "retry": "Réessayer",
  "goConnectAccount": "Connecter un compte",
  "goRecharge": "Ajouter des crédits",
  "hint": {
    "NO_CREDENTIAL": "Ce canal de recherche nécessite des identifiants configurés sur le serveur par votre administrateur."
  },
  "tab": {
    "retrieval": "Recherches",
    "checks": "Cohérence"
  },
  "kind": {
    "COMPANY": "Sociétés",
    "LAW": "Textes de loi",
    "CASE": "Jurisprudence",
    "DOC": "Documents liés"
  },
  "entityKind": {
    "COMPANY": "Société",
    "LAW": "Texte de loi",
    "CASE": "Décision",
    "DOC": "Document lié"
  },
  "openInNewTab": "Ouvrir dans un nouvel onglet",
  "openDocFile": "Ouvrir le fichier",
  "docNotFound": "Fichier introuvable dans ce projet",
  "docMissing": "Ce fichier ne fait plus partie du projet",
  "source": {
    "projectFile": "Fichier du projet",
    "qichacha": "Qichacha"
  },
  "mentions": "{count} occurrence(s)",
  "mentionsTitle": "Occurrences dans ce document",
  "shareholders": "Actionnaires",
  "moreCandidates": "Autres résultats possibles",
  "caseSection": {
    "ascertain": "Faits constatés",
    "reason": "Motifs",
    "result": "Dispositif",
    "gist": "Sommaire",
    "fullText": "Texte intégral de la décision"
  },
  "authoritative": "Texte faisant foi (Pkulaw)",
  "implementDate": "En vigueur depuis le {date}",
  "recognition": "Identification du numéro d’affaire",
  "openInPkulaw": "Ouvrir dans Pkulaw",
  "citation": {
    "citedText": "Article cité",
    "candidates": "Articles correspondant au contenu",
    "article": "Article n° {n}"
  },
  "severity": {
    "warn": "À vérifier",
    "error": "Erreur"
  },
  "unifyTo": "Uniformiser en {value}",
  "cannotFix": "Correction automatique impossible : {reason}",
  "fixNotUnique": "Impossible d’identifier une occurrence unique — veuillez modifier manuellement.",
  "fixPartial": "{done} corrigé(s) ; {failed} sans correspondance unique — veuillez les modifier manuellement.",
  "fixed": "Corrigé",
  "fixedHint": "Appuyez sur Cmd+Z pour annuler ; relancez l’analyse pour actualiser les résultats.",
  "noEditor": "Activez d’abord une fenêtre d’édition de document",
  "empty": {
    "noRun": "Ce document n’a pas encore été vérifié en ligne",
    "noRunHint": "Les suggestions d’écriture courantes s’exécutent localement. Seul un clic sur la vérification en ligne envoie le document enregistré pour l’extraction IA, les recherches externes et les contrôles de cohérence.",
    "noEntity": "Aucune entité vérifiable détectée",
    "noEntityHint": "Le document ne mentionne aucun nom de société, article de loi ni numéro d’affaire.",
    "noFinding": "Aucune incohérence détectée",
    "noFindingHint": "Les montants, quantités et codes d’identification concordent."
  }
}
