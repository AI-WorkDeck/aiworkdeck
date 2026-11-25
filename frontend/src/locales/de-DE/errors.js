// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Sie sind offline, die Anfrage wurde deshalb nicht gesendet. Prüfen Sie Ihre Verbindung und wählen Sie dann „Erneut versuchen“.",
  "timeout": "Der Dienst hat zu lange nicht geantwortet. Versuchen Sie es gleich noch einmal; teilen Sie große Dateien in kleinere Teile auf.",
  "localServiceDown": "Der lokale Dienst ist nicht bereit oder wurde beendet. Warten Sie einige Sekunden; tritt das weiterhin auf, starten Sie AI WorkDeck neu.",
  "signInRequired": "Diese Funktion erfordert ein AI WorkDeck-Konto. Melden Sie sich an, dann kehren Sie direkt hierher zurück.",
  "sessionExpired": "Ihre Anmeldung ist abgelaufen. Melden Sie sich erneut an; nicht gespeicherte Arbeit bleibt erhalten.",
  "forbidden": "Sie haben dafür keine Berechtigung. Bitten Sie die verantwortliche Person des Projekts oder die Administration Ihrer Kanzlei um Zugriff.",
  "balanceLow": "Ihr KI-Guthaben ist aufgebraucht; diese Anfrage wurde nicht berechnet. Laden Sie es unter Einstellungen → Konto & Guthaben auf.",
  "rateLimited": "Derzeit gibt es zu viele Anfragen, daher drosselt der Modelldienst. Warten Sie eine Minute und versuchen Sie es erneut.",
  "modelUnavailable": "Das ausgewählte Modell ist derzeit nicht verfügbar. Versuchen Sie es später erneut oder wählen Sie unter dem Nachrichtenfeld ein anderes Modell.",
  "modelKeyInvalid": "Der Modellanbieter hat den Schlüssel abgelehnt, den dieses Gerät noch aus einer älteren Einrichtung verwendet. Melden Sie sich an, um stattdessen die KI von AI WorkDeck zu nutzen.",
  "streamInterrupted": "Die Antwort wurde abgebrochen; der bisher eingetroffene Teil bleibt oben erhalten. Wählen Sie „Erneut versuchen“, um sie neu zu erstellen.",
  "streamInterruptedResumable": "Die Antwort wurde abgebrochen; der bisher eingetroffene Teil bleibt oben erhalten. Wählen Sie „Fortfahren“, um dort weiterzumachen, wo sie abgebrochen wurde, oder „Erneut versuchen“, um neu zu beginnen.",
  "streamInterruptedTwice": "Sie wurde erneut abgebrochen. Wählen Sie „Erneut versuchen“, um die gesamte Antwort neu zu erstellen.",
  "serverError": "Auf unserer Seite ist ein Fehler aufgetreten, die Aktion wurde nicht abgeschlossen. Versuchen Sie es später erneut; tritt das weiterhin auf, senden Sie uns Feedback.",
  "conflict": "Dies wurde an anderer Stelle geändert, oder die vorherige Aktion läuft noch. Aktualisieren Sie und versuchen Sie es erneut.",
  "fileTooLarge": "Die Datei ist zu groß (Limit {limit}). Komprimieren oder teilen Sie sie und laden Sie sie erneut hoch.",
  "fileUnreadable": "Diese Datei lässt sich nicht öffnen; sie ist möglicherweise beschädigt oder passwortgeschützt. Speichern Sie in der Originalanwendung eine neue Kopie und versuchen Sie es erneut.",
  "notFound": "Dieser Eintrag wurde nicht gefunden; er wurde möglicherweise verschoben oder gelöscht. Aktualisieren Sie die Liste.",
  "marketplaceUnavailable": "Der Plugin-Marktplatz ist derzeit nicht erreichbar; installierte Plugins funktionieren weiterhin. Prüfen Sie Ihre Verbindung und wählen Sie dann „Aktualisieren“.",
  "pluginInstallFailed": "„{name}“ konnte nicht installiert werden; sonst wurde nichts geändert. Versuchen Sie es später erneut; schlägt es weiter fehl, senden Sie Feedback mit den Details.",
  "unknown": "Das hat nicht funktioniert. Versuchen Sie es erneut; tritt es weiterhin auf, senden Sie Feedback mit den Details.",
  "actions": {
    "retry": "Erneut versuchen",
    "details": "Details",
    "hideDetails": "Details ausblenden",
    "continue": "Fortfahren",
    "continueTooltip": "Dort weitermachen, wo es abgebrochen wurde, ohne das bereits Vorhandene neu zu erstellen",
    "refresh": "Aktualisieren",
    "signIn": "Anmelden",
    "feedback": "Feedback"
  }
}
