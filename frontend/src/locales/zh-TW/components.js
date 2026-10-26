// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "可选组件",
  "panelSubtitle": "这些组件不随安装包分发，用到哪个下哪个。全部在本机运行，内容不出这台电脑。",
  "installSelected": "立即下载所选",
  "installOne": "下载此组件",
  "later": "稍后再说",
  "laterHint": "随时可以在「设置 → 组件管理」里下载。",
  "alreadyReady": "已安装：{names}。",
  "nameSeparator": "、",
  "manageTitle": "组件管理",
  "promptWithModel": "需要下载{name}（约 {runtime} MB；含模型约 {total} MB）。落盘于 ~/.aiworkdeck，可在「设置→组件管理」卸载释放。",
  "promptNoModel": "需要下载{name}（约 {runtime} MB）。落盘于 ~/.aiworkdeck，可在「设置→组件管理」卸载释放。",
  "promptUsage": "它用于：{unlocks}。不下载则：{impact}；其余功能不受影响。",
  "sizeUnknown": "体积获取中…",
  "stateNotInstalled": "未安装",
  "stateReady": "已安装（尚未验证运行）",
  "stateServiceStarted": "服务已启动（功能待使用验证）",
  "errorServiceUnavailable": "组件服务未能启动，请检查组件是否完整后重试。",
  "stateDownloadingRuntime": "正在下载运行时 {percent}%",
  "stateDownloadingModel": "正在下载模型 {percent}%",
  "stateStartingService": "正在启动组件…",
  "stateVerifyingRuntime": "正在校验下载内容…",
  "stateExtractingRuntime": "正在解压 {percent}%",
  "stateCheckingRuntime": "正在核对文件…",
  "stateFinalizingRuntime": "正在写入…",
  "errorStalled": "长时间没有进展，已停止等待。请重试；仍失败可查看 ~/.aiworkdeck/logs 下的后端日志。",
  "errorBackendRestarted": "后台服务已重启，下载被中断，请重试。",
  "stateFailed": "准备失败：{msg}",
  "progressTotal": "总进度 {done}/{count}（{percent}%）",
  "cancelDownload": "取消下载",
  "checkStartup": "检查启动",
  "verifyRepair": "校验并修复",
  "retry": "重試",
  "chatTitle": "需要下载组件",
  "chatConfirm": "下载并继续",
  "chatCancel": "暂不下载",
  "chatInstalling": "正在准备组件…",
  "chatStage": {
    "preparing": "正在准备组件…",
    "downloading": "正在下载，可以点「后台下载」先继续对话。",
    "verifying": "下载完成，正在校验内容…",
    "extracting": "正在解压安装，文件较多，可能需要几分钟。",
    "checking": "正在核对解压出的文件…",
    "finalizing": "即将完成，正在写入安装目录…",
    "model": "正在下载模型…",
    "starting": "正在启动组件…"
  },
  "chatResending": "组件已就绪，正在继续刚才的请求…",
  "chatReadyRetry": "组件已就绪，可以重新发送刚才的请求。",
  "chatReadyContinue": "组件已就绪，可以继续刚才那一步",
  "chatReadyContinueBtn": "继续",
  "backgroundDownload": "后台下载",
  "backgroundStarted": "已转入后台下载，可在「设置 → 组件管理」查看进度。",
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
