// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "オプションコンポーネント",
  "panelSubtitle": "これらのコンポーネントはインストーラーに同梱されていません。必要なものだけをダウンロードしてください。すべてこのコンピューター上で動作し、データが外部に送信されることはありません。",
  "installSelected": "選択した項目をダウンロード",
  "installOne": "このコンポーネントをダウンロード",
  "later": "後で",
  "laterHint": "「設定 → コンポーネント」からいつでもダウンロードできます。",
  "alreadyReady": "インストール済み：{names}。",
  "nameSeparator": "、",
  "manageTitle": "コンポーネント管理",
  "promptWithModel": "{name} のダウンロードが必要です（約 {runtime} MB、モデルを含めると約 {total} MB）。~/.aiworkdeck に保存され、「設定 → コンポーネント」から削除できます。",
  "promptNoModel": "{name} のダウンロードが必要です（約 {runtime} MB）。~/.aiworkdeck に保存され、「設定 → コンポーネント」から削除できます。",
  "promptUsage": "対象機能：{unlocks}。未導入の場合：{impact}。その他の機能は引き続き利用できます。",
  "sizeUnknown": "サイズを確認中…",
  "stateNotInstalled": "未インストール",
  "stateReady": "インストール済み（未実行）",
  "stateServiceStarted": "サービス起動済み（機能未確認）",
  "errorServiceUnavailable": "コンポーネントサービスを起動できませんでした。インストール状態を確認して再試行してください。",
  "stateDownloadingRuntime": "ランタイムをダウンロード中 {percent}%",
  "stateDownloadingModel": "モデルをダウンロード中 {percent}%",
  "stateStartingService": "コンポーネントを起動中…",
  "stateVerifyingRuntime": "ダウンロードを検証中…",
  "stateExtractingRuntime": "展開中 {percent}%",
  "stateCheckingRuntime": "ファイルを確認中…",
  "stateFinalizingRuntime": "仕上げ中…",
  "errorStalled": "長時間進行がないため待機を中止しました。再試行してください。繰り返し失敗する場合は ~/.aiworkdeck/logs のバックエンドログを確認してください。",
  "errorBackendRestarted": "バックグラウンドサービスが再起動したためダウンロードが中断されました。再試行してください。",
  "stateFailed": "準備に失敗しました：{msg}",
  "progressTotal": "全体の進捗 {done}/{count}（{percent}%）",
  "cancelDownload": "ダウンロードをキャンセル",
  "checkStartup": "起動を確認",
  "verifyRepair": "検証と修復",
  "retry": "再試行",
  "chatTitle": "コンポーネントが必要です",
  "chatConfirm": "ダウンロードして続行",
  "chatCancel": "今はしない",
  "chatInstalling": "コンポーネントを準備中…",
  "chatStage": {
    "preparing": "コンポーネントを準備中…",
    "downloading": "ダウンロード中です。「バックグラウンドでダウンロード」を押すと、その間もチャットを続けられます。",
    "verifying": "ダウンロードが完了しました。内容を検証しています…",
    "extracting": "展開・インストール中です。ファイル数が多いため数分かかる場合があります。",
    "checking": "展開したファイルを確認中…",
    "finalizing": "まもなく完了します。インストールフォルダーに書き込み中…",
    "model": "モデルをダウンロード中…",
    "starting": "コンポーネントを起動中…"
  },
  "chatResending": "コンポーネントの準備ができました。リクエストを続行しています…",
  "chatReadyRetry": "コンポーネントの準備ができました。リクエストを再送信できます。",
  "chatReadyContinue": "コンポーネントの準備ができました。直前のステップを続行できます。",
  "chatReadyContinueBtn": "続行",
  "backgroundDownload": "バックグラウンドでダウンロード",
  "backgroundStarted": "バックグラウンドでダウンロード中です。「設定 → コンポーネント」で進捗を確認できます。",
  "backgroundDone": "{name} がインストールされ起動しました。利用を開始できます。",
  "backgroundFailed": "{name} のダウンロードに失敗しました：{msg}",
  "asrRuntimeMissingAction": "オンデバイス音声認識をダウンロード",
  "pptxRuntime": {
    "name": "スライド生成と PDF から Word への変換",
    "unlocks": "AI スライド生成、PPTX の読み取り・書式設定、テキスト付き PDF のレイアウト保持 Word 変換（スキャン PDF には下の OCR エンジンも必要です）",
    "impact": "これらの機能は利用できませんが、PDF プレビューと構造変換は引き続き動作します"
  },
  "mineruRuntime": {
    "name": "スキャン文書 OCR エンジン（MinerU）",
    "unlocks": "テキスト層のないスキャン PDF の Word 変換・レイアウト認識、編集可能な PPT 書き出し（スキャン文書にのみ必要で、「スライド生成と PDF から Word への変換」が必要です）",
    "impact": "スキャン PDF を Word に変換できません（テキスト付き PDF には影響ありません）"
  },
  "kokoroRuntime": {
    "name": "音声合成",
    "unlocks": "音声パネルの「音声合成」タブ",
    "impact": "音声合成は利用できません"
  },
  "asrRuntime": {
    "name": "オンデバイス音声認識",
    "unlocks": "録音文字起こしの「音声をこの端末から出さない」モード",
    "impact": "クラウド文字起こしの 2 モードのみ利用できます"
  },
  "features": {
    "pptxGenerate": "AI スライド生成",
    "pptxFormat": "PPTX 読み取り・書式編集",
    "pdfToWordLayout": "PDF から Word への変換（レイアウト保持）",
    "scannedOcrEntry": "スキャン文書 OCR 入口（OCR エンジンも必要）",
    "scannedPdfToWord": "スキャン PDF から Word への変換",
    "ocrParse": "OCR レイアウト解析",
    "pptxEditableExport": "編集可能な PPT 書き出し",
    "ttsPanel": "音声合成パネル",
    "localTranscription": "オンデバイス文字起こし"
  }
}
