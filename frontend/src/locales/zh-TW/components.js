// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "可選組件",
  "panelSubtitle": "這些組件不隨安裝包分發，用到哪個下哪個。全部在本機運行，內容不出這台電腦。",
  "installSelected": "立即下載所選",
  "installOne": "下載此組件",
  "later": "稍後再說",
  "laterHint": "隨時可以在「設置 → 組件管理」裡下載。",
  "alreadyReady": "已安裝：{names}。",
  "nameSeparator": "、",
  "manageTitle": "組件管理",
  "promptWithModel": "需要下載{name}（約 {runtime} MB；含模型約 {total} MB）。落盤於 ~/.aiworkdeck，可在「設置→組件管理」卸載釋放。",
  "promptNoModel": "需要下載{name}（約 {runtime} MB）。落盤於 ~/.aiworkdeck，可在「設置→組件管理」卸載釋放。",
  "promptUsage": "它用於：{unlocks}。不下載則：{impact}；其餘功能不受影響。",
  "sizeUnknown": "體積獲取中…",
  "stateNotInstalled": "未安裝",
  "stateReady": "已安裝（尚未驗證運行）",
  "stateServiceStarted": "服務已啓動（功能待使用驗證）",
  "errorServiceUnavailable": "組件服務未能啓動，請檢查組件是否完整後重試。",
  "stateDownloadingRuntime": "正在下載運行時 {percent}%",
  "stateDownloadingModel": "正在下載模型 {percent}%",
  "stateStartingService": "正在啓動組件…",
  "stateVerifyingRuntime": "正在校驗下載內容…",
  "stateExtractingRuntime": "正在解壓 {percent}%",
  "stateCheckingRuntime": "正在核對文件…",
  "stateFinalizingRuntime": "正在寫入…",
  "errorStalled": "長時間沒有進展，已停止等待。請重試；仍失敗可查看 ~/.aiworkdeck/logs 下的後端日誌。",
  "errorBackendRestarted": "後台服務已重啓，下載被中斷，請重試。",
  "stateFailed": "準備失敗：{msg}",
  "progressTotal": "總進度 {done}/{count}（{percent}%）",
  "cancelDownload": "取消下載",
  "checkStartup": "檢查啓動",
  "verifyRepair": "校驗並修復",
  "retry": "重試",
  "chatTitle": "需要下載組件",
  "chatConfirm": "下載並繼續",
  "chatCancel": "暫不下載",
  "chatInstalling": "正在準備組件…",
  "chatStage": {
    "preparing": "正在準備組件…",
    "downloading": "正在下載，可以點「後台下載」先繼續對話。",
    "verifying": "下載完成，正在校驗內容…",
    "extracting": "正在解壓安裝，文件較多，可能需要幾分鐘。",
    "checking": "正在核對解壓出的文件…",
    "finalizing": "即將完成，正在寫入安裝目錄…",
    "model": "正在下載模型…",
    "starting": "正在啓動組件…"
  },
  "chatResending": "組件已就緒，正在繼續剛才的請求…",
  "chatReadyRetry": "組件已就緒，可以重新發送剛才的請求。",
  "chatReadyContinue": "組件已就緒，可以繼續剛才那一步",
  "chatReadyContinueBtn": "繼續",
  "backgroundDownload": "後台下載",
  "backgroundStarted": "已轉入後台下載，可在「設置 → 組件管理」查看進度。",
  "backgroundDone": "{name}已安裝並啟動，可嘗試使用。",
  "backgroundFailed": "{name}下載失敗：{msg}",
  "asrRuntimeMissingAction": "下載本機語音辨識元件",
  "pptxRuntime": {
    "name": "PPT 生成與 PDF 轉 Word",
    "unlocks": "AI 生成 PPT、PPTX 讀取與轉換格式、含文字層的 PDF 轉 Word（保留版面）；掃描件還需要下方的 OCR 引擎",
    "impact": "這些功能無法使用；PDF 預覽與結構級轉換不受影響"
  },
  "mineruRuntime": {
    "name": "掃描件 OCR 引擎（MinerU）",
    "unlocks": "無文字層的掃描件 PDF 轉 Word、版面辨識、PPT 可編輯匯出；只有在處理掃描件時才需要，並且要先安裝「PPT 生成與 PDF 轉 Word」",
    "impact": "掃描件 PDF 無法轉 Word；含文字層的 PDF 不受影響"
  },
  "kokoroRuntime": {
    "name": "語音合成",
    "unlocks": "語音面板的「語音合成」",
    "impact": "語音合成無法使用"
  },
  "asrRuntime": {
    "name": "本機語音辨識",
    "unlocks": "錄音轉寫的「錄音不出本機」選項",
    "impact": "只能使用雲端聽悟兩個方案"
  },
  "features": {
    "pptxGenerate": "AI 生成 PPT",
    "pptxFormat": "PPTX 讀取/轉換格式",
    "pdfToWordLayout": "PDF 轉 Word（版面級）",
    "scannedOcrEntry": "掃描件 OCR 入口（還需 OCR 引擎）",
    "scannedPdfToWord": "掃描件 PDF 轉 Word",
    "ocrParse": "OCR 版面解析",
    "pptxEditableExport": "PPT 可編輯匯出",
    "ttsPanel": "語音合成面板",
    "localTranscription": "錄音不出本機的轉寫"
  }
}
