// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Verwijzingen",
  "noDoc": "No document open",
  "parse": "Full-document online verification (charges may apply)",
  "reparse": "Repeat full-document online verification (charges may apply)",
  "onlineHint": "Clicking saves this document, then verifies the saved version online. AI and external lookups may incur charges.",
  "saveRequired": "This document could not be saved. Save it successfully before online verification.",
  "running": "Verifying online…",
  "done": "Online verification complete",
  "failed": "Online verification failed",
  "loading": "Loading…",
  "loadingDetail": "Fetching lookup details…",
  "noDetail": "No lookup details for this item",
  "loadFailed": "Could not load online verification results",
  "parseFailed": "Could not start online verification",
  "detailFailed": "Could not load the lookup details",
  "refreshFailed": "Could not re-run the lookup",
  "retry": "Opnieuw proberen",
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
  "mentionsTitle": "Mentions in this document",
  "shareholders": "Shareholders",
  "moreCandidates": "Other candidates",
  "caseSection": {
    "ascertain": "Facts found",
    "reason": "Reasoning",
    "result": "Judgment",
    "gist": "Key holding",
    "fullText": "Full judgment"
  },
  "authoritative": "Authoritative text (Pkulaw)",
  "implementDate": "In force from {date}",
  "recognition": "Case number recognition",
  "openInPkulaw": "Open in Pkulaw",
  "citation": {
    "citedText": "Cited article",
    "candidates": "Articles matched by content",
    "article": "Article {n}"
  },
  "severity": {
    "warn": "Questionable",
    "error": "Error"
  },
  "unifyTo": "Set all to {value}",
  "cannotFix": "Cannot fix automatically: {reason}",
  "fixNotUnique": "Could not locate a unique match — please edit manually.",
  "fixPartial": "Fixed {done}; {failed} had no unique match — please edit those manually.",
  "fixed": "Fixed",
  "fixedHint": "Druk op Cmd+Z om ongedaan te maken; analyseer opnieuw om de bevindingen te verversen.",
  "noEditor": "Activeer eerst een documenteditor-venster",
  "empty": {
    "noRun": "Dit document is niet online geverifieerd",
    "noRunHint": "Alledaagse schrijftips worden lokaal uitgevoerd. Pas wanneer u op online verificatie klikt, wordt het opgeslagen document verzonden voor AI-extractie, externe opzoekingen en consistentiecontroles.",
    "noEntity": "Geen opzoekbare entiteiten gevonden",
    "noEntityHint": "Het document vermeldt geen bedrijfsnaam, wetsartikel of zaaknummer.",
    "noFinding": "Geen inconsistenties gevonden",
    "noFindingHint": "Hoeveelheidsvermeldingen en uniforme sociale creditcodes kloppen allemaal."
  }
}
