// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "По разделам",
    "byParty": "По сторонам"
  },
  "filter": {
    "allSections": "Все разделы",
    "allParties": "Все стороны"
  },
  "stat": {
    "total": "Всего: {count}"
  },
  "status": {
    "all": "Все",
    "active": "Активно",
    "unverified": "Не проверено",
    "stale": "Изменено",
    "orphan": "Без привязки"
  },
  "group": {
    "none": "Без категории",
    "untitled": "(Без раздела)"
  },
  "action": {
    "keep": "Сохранить связь",
    "rebind": "Переназначить",
    "confirmRebind": "Подтвердить",
    "cancelRebind": "Отмена",
    "delete": "Удалить",
    "removeTarget": "Убрать",
    "open": "Открыть источник",
    "ignore": "Игнорировать",
    "expand": "Развернуть",
    "collapse": "Свернуть"
  },
  "method": {
    "written_review": "Проверка документов",
    "written_statement": "Письменное пояснение",
    "web_check": "Проверка онлайн",
    "third_party": "Материалы третьих лиц",
    "interview": "Интервью",
    "none": "Без метода"
  },
  "relation": {
    "supports": "Подтверждает",
    "contradicts": "Противоречит",
    "partial": "Частично подтверждает"
  },
  "loc": {
    "wholeFile": "Весь файл",
    "page": "Стр. {page}",
    "quote": "«{quote}»",
    "region": "Область изображения",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "К этому документу ещё не привязаны исходные файлы",
  "emptyHint": "Перетащите файл из проводника на выделенный текст, чтобы связать его",
  "emptyFiltered": "Нет связей, соответствующих текущему фильтру",
  "fileMissing": "(файл больше не существует)",
  "fileDeleted": "(в корзине)",
  "targetsCount": "Источников: {count}",
  "rebindHint": "Выделите новый текст в документе и нажмите «Подтвердить»",
  "rebindNoSelection": "Сначала выделите текст в документе",
  "rebindFailed": "Не удалось переназначить",
  "rebindRetryHint": "Новая закладка уже создана в документе; нажмите «Подтвердить» ещё раз для повтора.",
  "keepGone": "Этого текста больше нет в документе, поэтому связь нельзя сохранить. Используйте «Переназначить» на вкладке «Источники».",
  "orphanGoto": "Якорь для этого текста больше не найден в документе. Нажмите «Переназначить», чтобы выбрать новый текст.",
  "confidence": "Достоверность {value}",
  "loading": "Загрузка…",
  "loadFailed": "Не удалось загрузить связи",
  "fileTagsLoadFailed": "Не удалось загрузить теги сторон; вид «По сторонам» может быть неточным",
  "opFailed": "Операция не выполнена",
  "deleteConfirm": "Удалить эту связь? Исходный файл удалён не будет.",
  "deleteTargetConfirm": "Убрать этот источник?",
  "staleOne": "У этого фрагмента {count} связанных источников, и текст был изменён",
  "staleMany": "Изменено связанных фрагментов: {count}",
  "stalePrefix": "Изменено: "
}
