// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "章・節別",
    "byParty": "当事者別"
  },
  "filter": {
    "allSections": "すべての章・節",
    "allParties": "すべての当事者"
  },
  "stat": {
    "total": "計 {count} 件"
  },
  "status": {
    "all": "すべて",
    "active": "有効",
    "unverified": "未確認",
    "stale": "変更あり",
    "orphan": "リンク切れ"
  },
  "group": {
    "none": "未割り当て",
    "untitled": "（章なし）"
  },
  "action": {
    "keep": "関連付けを維持",
    "rebind": "再指定",
    "confirmRebind": "指定を確定",
    "cancelRebind": "キャンセル",
    "delete": "削除する",
    "removeTarget": "解除",
    "open": "原資料を表示",
    "ignore": "無視する",
    "expand": "展開する",
    "collapse": "折りたたむ"
  },
  "method": {
    "written_review": "書面審査",
    "written_statement": "書面説明",
    "web_check": "オンライン確認",
    "third_party": "第三者資料",
    "interview": "ヒアリング",
    "none": "方法未指定"
  },
  "relation": {
    "supports": "裏付け",
    "contradicts": "相反",
    "partial": "一部裏付け"
  },
  "loc": {
    "wholeFile": "ファイル全体",
    "page": "{page} ページ",
    "quote": "「{quote}」",
    "region": "画像内の領域",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "この文書にはまだ原資料が関連付けられていません",
  "emptyHint": "左側のツリーから選択したテキストへファイルをドラッグすると関連付けられます",
  "emptyFiltered": "フィルター条件に一致する関連付けはありません",
  "fileMissing": "（ファイルが存在しません）",
  "fileDeleted": "（ゴミ箱に移動済み）",
  "targetsCount": "{count} 件の原資料",
  "rebindHint": "文書内で新しいテキストを選択してから「指定を確定」をクリックしてください",
  "rebindNoSelection": "先に文書内でテキストを選択してください",
  "rebindFailed": "再指定に失敗しました",
  "rebindRetryHint": "新しいブックマークは文書内に作成済みです。もう一度「指定を確定」をクリックして再試行してください。",
  "keepGone": "このテキストは文書内に残っていないため、関連付けを維持できません。原資料タブで「再指定」を行ってください。",
  "orphanGoto": "このテキストのアンカーが文書内に見つかりません。「再指定」をクリックして新しいテキストを選択してください。",
  "confidence": "信頼度 {value}",
  "loading": "読み込み中…",
  "loadFailed": "関連付けの読み込みに失敗しました",
  "fileTagsLoadFailed": "当事者タグの読み込みに失敗しました。「当事者別」表示が正確でない可能性があります",
  "opFailed": "操作に失敗しました",
  "deleteConfirm": "この関連付けを削除しますか？原資料ファイル自体は削除されません。",
  "deleteTargetConfirm": "この原資料の関連付けを解除しますか？",
  "staleOne": "このテキストには {count} 件の原資料があり、本文が変更されています",
  "staleMany": "{count} 箇所のテキストが変更されています",
  "stalePrefix": "変更済み："
}
