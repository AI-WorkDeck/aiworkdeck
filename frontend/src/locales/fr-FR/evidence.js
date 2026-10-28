// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "Par section",
    "byParty": "Par partie"
  },
  "filter": {
    "allSections": "Toutes les sections",
    "allParties": "Toutes les parties"
  },
  "stat": {
    "total": "{count} au total"
  },
  "status": {
    "all": "Tous",
    "active": "Actif",
    "unverified": "Non vérifié",
    "stale": "Modifié",
    "orphan": "Orphelin"
  },
  "group": {
    "none": "Non attribué",
    "untitled": "(Sans section)"
  },
  "action": {
    "keep": "Conserver le lien",
    "rebind": "Réattribuer",
    "confirmRebind": "Confirmer",
    "cancelRebind": "Annuler",
    "delete": "Supprimer",
    "removeTarget": "Retirer",
    "open": "Voir la pièce",
    "ignore": "Ignorer",
    "expand": "Développer",
    "collapse": "Réduire"
  },
  "method": {
    "written_review": "Examen documentaire",
    "written_statement": "Déclaration écrite",
    "web_check": "Vérification en ligne",
    "third_party": "Document tiers",
    "interview": "Entretien",
    "none": "Aucune méthode"
  },
  "relation": {
    "supports": "Corrobore",
    "contradicts": "Contredit",
    "partial": "Corrobore partiellement"
  },
  "loc": {
    "wholeFile": "Fichier entier",
    "page": "Page n° {page}",
    "quote": "« {quote} »",
    "region": "Zone de l’image",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "Aucune pièce justificative liée à ce document pour le moment",
  "emptyHint": "Faites glisser un fichier depuis l’explorateur sur le texte sélectionné pour créer un lien",
  "emptyFiltered": "Aucun lien ne correspond au filtre actuel",
  "fileMissing": "(le fichier n’existe plus)",
  "fileDeleted": "(dans la corbeille)",
  "targetsCount": "{count} pièces",
  "rebindHint": "Sélectionnez le nouveau texte dans le document, puis cliquez sur Confirmer",
  "rebindNoSelection": "Sélectionnez d’abord du texte dans le document",
  "rebindFailed": "Échec de la réattribution",
  "rebindRetryHint": "Le nouveau signet est déjà dans le document ; cliquez à nouveau sur Confirmer pour réessayer.",
  "keepGone": "Ce texte ne figure plus dans le document, le lien ne peut donc pas être conservé. Utilisez Réattribuer dans l’onglet Pièces.",
  "orphanGoto": "L’ancre de ce texte ne figure plus dans le document. Cliquez sur Réattribuer pour choisir un nouveau texte.",
  "confidence": "Confiance {value}",
  "loading": "Chargement…",
  "loadFailed": "Échec du chargement des liens",
  "fileTagsLoadFailed": "Échec du chargement des étiquettes de parties ; la vue « Par partie » peut être inexacte",
  "opFailed": "Échec de l’opération",
  "deleteConfirm": "Supprimer ce lien ? Le fichier source ne sera pas supprimé.",
  "deleteTargetConfirm": "Retirer cette pièce ?",
  "staleOne": "Ce passage compte {count} pièces liées et a été modifié",
  "staleMany": "{count} passages liés ont été modifiés",
  "stalePrefix": "Modifié : "
}
