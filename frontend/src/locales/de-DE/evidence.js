// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "Nach Abschnitt",
    "byParty": "Nach Partei"
  },
  "filter": {
    "allSections": "Alle Abschnitte",
    "allParties": "Alle Parteien"
  },
  "stat": {
    "total": "{count} gesamt"
  },
  "status": {
    "all": "Alle",
    "active": "Aktiv",
    "unverified": "Ungeprüft",
    "stale": "Geändert",
    "orphan": "Verwaist"
  },
  "group": {
    "none": "Nicht zugewiesen",
    "untitled": "(Kein Abschnitt)"
  },
  "action": {
    "keep": "Verknüpfung behalten",
    "rebind": "Neu zuordnen",
    "confirmRebind": "Bestätigen",
    "cancelRebind": "Abbrechen",
    "delete": "Löschen",
    "removeTarget": "Entfernen",
    "open": "Beleg öffnen",
    "ignore": "Ignorieren",
    "expand": "Ausklappen",
    "collapse": "Einklappen"
  },
  "method": {
    "written_review": "Dokumentenprüfung",
    "written_statement": "Schriftliche Stellungnahme",
    "web_check": "Online-Prüfung",
    "third_party": "Drittunterlagen",
    "interview": "Befragung",
    "none": "Keine Methode"
  },
  "relation": {
    "supports": "Stützt",
    "contradicts": "Widerspricht",
    "partial": "Stützt teilweise"
  },
  "loc": {
    "wholeFile": "Gesamte Datei",
    "page": "Seite {page}",
    "quote": "„{quote}“",
    "region": "Bildbereich",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "Mit diesem Dokument sind noch keine Belege verknüpft",
  "emptyHint": "Ziehen Sie eine Datei aus dem Explorer auf den markierten Text, um sie zu verknüpfen",
  "emptyFiltered": "Keine Verknüpfungen entsprechen dem aktuellen Filter",
  "fileMissing": "(Datei existiert nicht mehr)",
  "fileDeleted": "(im Papierkorb)",
  "targetsCount": "{count} Belege",
  "rebindHint": "Markieren Sie den neuen Text im Dokument und klicken Sie dann auf Bestätigen",
  "rebindNoSelection": "Bitte markieren Sie zuerst Text im Dokument",
  "rebindFailed": "Neuzuordnung fehlgeschlagen",
  "rebindRetryHint": "Das neue Lesezeichen befindet sich bereits im Dokument; klicken Sie erneut auf Bestätigen, um es noch einmal zu versuchen.",
  "keepGone": "Dieser Text ist nicht mehr im Dokument enthalten, daher kann die Verknüpfung nicht beibehalten werden. Verwenden Sie im Reiter Belege die Option Neu zuordnen.",
  "orphanGoto": "Der Anker für diesen Text ist nicht mehr im Dokument vorhanden. Klicken Sie auf Neu zuordnen, um neuen Text auszuwählen.",
  "confidence": "Konfidenz {value}",
  "loading": "Wird geladen…",
  "loadFailed": "Verknüpfungen konnten nicht geladen werden",
  "fileTagsLoadFailed": "Partei-Tags konnten nicht geladen werden; die Ansicht „Nach Partei“ ist möglicherweise ungenau",
  "opFailed": "Vorgang fehlgeschlagen",
  "deleteConfirm": "Diese Verknüpfung löschen? Die Quelldatei wird nicht gelöscht.",
  "deleteTargetConfirm": "Diesen Beleg entfernen?",
  "staleOne": "Dieser Text hat {count} verknüpfte Belege und wurde geändert",
  "staleMany": "{count} verknüpfte Textstellen wurden geändert",
  "stalePrefix": "Geändert: "
}
