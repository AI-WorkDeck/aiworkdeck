// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Ссылки",
  "noDoc": "Документ не открыт",
  "parse": "Онлайн-проверка всего документа (может взиматься плата)",
  "reparse": "Повторная онлайн-проверка всего документа (может взиматься плата)",
  "onlineHint": "При нажатии документ будет сохранён, после чего сохранённая версия будет проверена онлайн. За использование AI и внешних запросов может взиматься плата.",
  "saveRequired": "Не удалось сохранить этот документ. Успешно сохраните его перед онлайн-проверкой.",
  "running": "Выполняется онлайн-проверка…",
  "done": "Онлайн-проверка завершена",
  "failed": "Онлайн-проверка не удалась",
  "loading": "Загрузка…",
  "loadingDetail": "Получение сведений о проверке…",
  "noDetail": "Сведения о проверке для этого элемента отсутствуют",
  "loadFailed": "Could not load online verification results",
  "parseFailed": "Could not start online verification",
  "detailFailed": "Could not load the lookup details",
  "refreshFailed": "Could not re-run the lookup",
  "retry": "Повторить",
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
  "fixedHint": "Press Cmd+Z to undo; re-analyze to refresh the findings.",
  "noEditor": "Activate a document editor window first",
  "empty": {
    "noRun": "This document has not been verified online",
    "noRunHint": "Everyday writing hints run locally. Only clicking online verification sends the saved document for AI extraction, external lookups and consistency checks.",
    "noEntity": "No lookupable entities found",
    "noEntityHint": "The document mentions no company name, statute article or case number.",
    "noFinding": "No inconsistencies found",
    "noFindingHint": "Quantity statements and unified social credit codes all check out."
  }
}
