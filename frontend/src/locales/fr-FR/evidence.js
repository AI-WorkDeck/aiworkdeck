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
    "all": "Tout",
    "active": "Actif",
    "unverified": "Non vérifié",
    "stale": "Modifié",
    "orphan": "Orphelin"
  },
  "group": {
    "none": "Non attribué",
    "untitled": "(Aucune section)"
  },
  "action": {
    "keep": "Conserver le lien",
    "rebind": "Réassigner",
    "confirmRebind": "Confirmer",
    "cancelRebind": "Annuler",
    "delete": "Supprimer",
    "removeTarget": "Retirer",
    "open": "Voir la source",
    "ignore": "Ignorer",
    "expand": "Développer",
    "collapse": "Réduire"
  },
  "method": {
    "written_review": "Revue de document",
    "written_statement": "Déclaration écrite",
    "web_check": "Vérification en ligne",
    "third_party": "Document de tierce partie",
    "interview": "Entretien",
    "none": "Aucune méthode"
  },
  "relation": {
    "supports": "Corroborant",
    "contradicts": "Contredisant",
    "partial": "Partiellement"
  },
  "loc": {
    "wholeFile": "Fichier entier",
    "page": "Page {page}",
    "quote": "« {quote} »",
    "region": "Zone d'image",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "Aucun fichier source n'est encore lié à ce document",
  "emptyHint": "Faites glisser un fichier depuis l'explorateur sur le texte sélectionné pour le lier",
  "emptyFiltered": "Aucun lien ne correspond au filtre actuel",
  "fileMissing": "(le fichier n'existe plus)",
  "fileDeleted": "(dans la corbeille)",
  "targetsCount": "{count} sources",
  "rebindHint": "Sélectionnez le nouveau texte dans le document, puis appuyez sur Confirmer",
  "rebindNoSelection": "Sélectionnez d'abord du texte dans le document",
  "rebindFailed": "Échec de la réassignation",
  "rebindRetryHint": "Le nouveau signet est déjà dans le document ; appuyez à nouveau sur Confirmer pour réessayer.",
  "keepGone": "Ce texte n'est plus dans le document, le lien ne peut donc pas être conservé. Utilisez Réassigner dans l'onglet Sources.",
  "orphanGoto": "L'ancre de ce texte n'est plus dans le document. Appuyez sur Réassigner pour choisir un nouveau texte.",
  "confidence": "Confiance {value}",
  "loading": "Chargement…",
  "loadFailed": "Échec du chargement des liens",
  "fileTagsLoadFailed": "Échec du chargement des étiquettes de partie ; la vue « Par partie » peut être inexacte",
  "opFailed": "Échec de l'opération",
  "deleteConfirm": "Supprimer ce lien ? Le fichier source ne sera pas supprimé.",
  "deleteTargetConfirm": "Retirer cette source ?",
  "staleOne": "Ce texte comporte {count} sources liées et a été modifié",
  "staleMany": "{count} passages liés ont été modifiés",
  "stalePrefix": "Modifié : "
}
