// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "根拠",
  "noDoc": "ドキュメントが開かれていません",
  "parse": "全文オンライン検証（料金が発生する場合があります）",
  "reparse": "全文オンライン検証を再実行（料金が発生する場合があります）",
  "onlineHint": "クリックすると現在のドキュメントを保存し、保存済みバージョンをオンラインで検証します。AIおよび外部照会には料金が発生する場合があります。",
  "saveRequired": "現在のドキュメントを保存できませんでした。保存してからオンライン検証を行ってください。",
  "running": "オンライン検証中…",
  "done": "オンライン検証が完了しました",
  "failed": "オンライン検証に失敗しました",
  "loading": "読み込み中…",
  "loadingDetail": "照会詳細を取得中…",
  "noDetail": "この項目には照会詳細がありません",
  "loadFailed": "オンライン検証結果の読み込みに失敗しました",
  "parseFailed": "オンライン検証の開始に失敗しました",
  "detailFailed": "照会詳細の取得に失敗しました",
  "refreshFailed": "再照会に失敗しました",
  "retry": "再試行",
  "goConnectAccount": "アカウントを接続",
  "goRecharge": "クレジットを追加",
  "hint": {
    "NO_CREDENTIAL": "この照会チャネルの認証情報は、管理者がサーバー側で設定する必要があります。"
  },
  "tab": {
    "retrieval": "外部照会",
    "checks": "整合性チェック"
  },
  "kind": {
    "COMPANY": "企業",
    "LAW": "法令",
    "CASE": "判例",
    "DOC": "文書"
  },
  "entityKind": {
    "COMPANY": "企業",
    "LAW": "法令",
    "CASE": "判例",
    "DOC": "文書"
  },
  "openInNewTab": "新しいタブで開く",
  "openDocFile": "ファイルを開く",
  "docNotFound": "プロジェクト内に該当ファイルが見つかりません",
  "docMissing": "ファイルはすでにプロジェクト内にありません",
  "source": {
    "projectFile": "プロジェクトファイル",
    "qichacha": "Qichacha（企査査）"
  },
  "mentions": "{count} 箇所",
  "mentionsTitle": "本文中の出現箇所",
  "shareholders": "株主・出資情報",
  "moreCandidates": "その他の候補",
  "caseSection": {
    "ascertain": "認定事実",
    "reason": "判断理由",
    "result": "主文・結論",
    "gist": "判示事項",
    "fullText": "判決全文"
  },
  "authoritative": "公式条文（Pkulaw）",
  "implementDate": "施行日 {date}",
  "recognition": "事件番号の認識",
  "openInPkulaw": "Pkulawで開く",
  "citation": {
    "citedText": "引用された条文",
    "candidates": "内容から特定された条文",
    "article": "第{n}条"
  },
  "severity": {
    "warn": "要確認",
    "error": "エラー"
  },
  "unifyTo": "{value} に統一",
  "cannotFix": "一括修正できません：{reason}",
  "fixNotUnique": "一意に特定できなかったため、手動で修正してください。",
  "fixPartial": "{done} 箇所を修正しました。残り {failed} 箇所は一意に特定できなかったため手動で修正してください。",
  "fixed": "修正済み",
  "fixedHint": "Cmd+Z で元に戻せます。再解析すると結果を更新できます。",
  "noEditor": "先にドキュメント編集ウィンドウをアクティブにしてください",
  "empty": {
    "noRun": "このドキュメントはまだオンライン検証されていません",
    "noRunHint": "通常の執筆ヒントはローカルで動作します。上のオンライン検証をクリックしたときのみ、保存済みドキュメントに対してAI抽出・外部照会・整合性チェックを実行します。",
    "noEntity": "照会可能なエンティティが見つかりませんでした",
    "noEntityHint": "文書内に企業名、法令条文、事件番号が含まれていません。",
    "noFinding": "矛盾は見つかりませんでした",
    "noFindingHint": "数量の記述および統一社会信用コードはすべて整合しています。"
  }
}
