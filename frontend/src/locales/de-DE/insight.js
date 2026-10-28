// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Belege & Nachweise",
  "noDoc": "Kein Dokument geöffnet",
  "parse": "Gesamtes Dokument online prüfen (ggf. kostenpflichtig)",
  "reparse": "Gesamtes Dokument erneut online prüfen (ggf. kostenpflichtig)",
  "onlineHint": "Durch Klicken wird das aktuelle Dokument gespeichert und anschließend die gespeicherte Version online geprüft. KI- und externe Abfragen können Kosten verursachen.",
  "saveRequired": "Dieses Dokument konnte nicht gespeichert werden. Bitte speichern Sie es erfolgreich vor der Online-Prüfung.",
  "running": "Online-Prüfung läuft…",
  "done": "Online-Prüfung abgeschlossen",
  "failed": "Online-Prüfung fehlgeschlagen",
  "loading": "Wird geladen…",
  "loadingDetail": "Abfragedetails werden geladen…",
  "noDetail": "Keine Abfragedetails für diesen Eintrag",
  "loadFailed": "Ergebnisse der Online-Prüfung konnten nicht geladen werden",
  "parseFailed": "Online-Prüfung konnte nicht gestartet werden",
  "detailFailed": "Abfragedetails konnten nicht geladen werden",
  "refreshFailed": "Abfrage konnte nicht erneut ausgeführt werden",
  "retry": "Erneut versuchen",
  "goConnectAccount": "Konto verbinden",
  "goRecharge": "Guthaben aufladen",
  "hint": {
    "NO_CREDENTIAL": "Für diesen Abfragekanal müssen Zugangsdaten vom Administrator auf dem Server hinterlegt werden."
  },
  "tab": {
    "retrieval": "Externe Abfragen",
    "checks": "Konsistenzprüfung"
  },
  "kind": {
    "COMPANY": "Unternehmen",
    "LAW": "Gesetze",
    "CASE": "Rechtsprechung",
    "DOC": "Dokumente"
  },
  "entityKind": {
    "COMPANY": "Unternehmen",
    "LAW": "Gesetz",
    "CASE": "Urteil",
    "DOC": "Dokument"
  },
  "openInNewTab": "In neuem Tab öffnen",
  "openDocFile": "Datei öffnen",
  "docNotFound": "Datei in diesem Projekt nicht gefunden",
  "docMissing": "Diese Datei befindet sich nicht mehr im Projekt",
  "source": {
    "projectFile": "Projektdatei",
    "qichacha": "Qichacha"
  },
  "mentions": "{count} Fundstelle(n)",
  "mentionsTitle": "Fundstellen im Dokument",
  "shareholders": "Gesellschafter",
  "moreCandidates": "Weitere Treffer",
  "caseSection": {
    "ascertain": "Festgestellter Sachverhalt",
    "reason": "Entscheidungsgründe",
    "result": "Tenor",
    "gist": "Leitsatz",
    "fullText": "Volltext der Entscheidung"
  },
  "authoritative": "Maßgeblicher Wortlaut (Pkulaw)",
  "implementDate": "In Kraft seit {date}",
  "recognition": "Aktenzeichenerkennung",
  "openInPkulaw": "In Pkulaw öffnen",
  "citation": {
    "citedText": "Zitierter Paragraph",
    "candidates": "Inhaltlich passende Paragraphen",
    "article": "Artikel {n}"
  },
  "severity": {
    "warn": "Fraglich",
    "error": "Fehler"
  },
  "unifyTo": "Alle vereinheitlichen auf {value}",
  "cannotFix": "Automatische Korrektur nicht möglich: {reason}",
  "fixNotUnique": "Keine eindeutige Textstelle gefunden — bitte manuell bearbeiten.",
  "fixPartial": "{done} korrigiert; {failed} nicht eindeutig zuordenbar — bitte manuell bearbeiten.",
  "fixed": "Korrigiert",
  "fixedHint": "Mit Cmd+Z rückgängig machen; erneut analysieren, um die Ergebnisse zu aktualisieren.",
  "noEditor": "Bitte aktivieren Sie zuerst ein Dokumenteditor-Fenster",
  "empty": {
    "noRun": "Dieses Dokument wurde noch nicht online geprüft",
    "noRunHint": "Alltägliche Schreibhinweise laufen lokal. Erst beim Klick auf die Online-Prüfung wird das gespeicherte Dokument zur KI-Extraktion, externen Abfrage und Konsistenzprüfung gesendet.",
    "noEntity": "Keine abfragbaren Entitäten gefunden",
    "noEntityHint": "Das Dokument enthält keine Unternehmensnamen, Gesetzesartikel oder Aktenzeichen.",
    "noFinding": "Keine Widersprüche gefunden",
    "noFindingHint": "Mengenangaben und einheitliche Sozialkreditcodes sind konsistent."
  }
}
