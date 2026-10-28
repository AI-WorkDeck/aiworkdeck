// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "依據",
  "noDoc": "未開啟文件",
  "parse": "全文線上核驗（可能產生費用）",
  "reparse": "再次全文線上核驗（可能產生費用）",
  "onlineHint": "點擊後先儲存目前文件，再線上核驗已儲存版本。AI 與外部檢索可能產生費用。",
  "saveRequired": "目前文件未能完成儲存，請儲存成功後再線上核驗。",
  "running": "正在線上核驗…",
  "done": "線上核驗完成",
  "failed": "線上核驗失敗",
  "loading": "載入中…",
  "loadingDetail": "正在取得檢索詳情…",
  "noDetail": "這一條沒有檢索詳情",
  "loadFailed": "讀取線上核驗結果失敗",
  "parseFailed": "發起線上核驗失敗",
  "detailFailed": "取得檢索詳情失敗",
  "refreshFailed": "重新檢索失敗",
  "retry": "重試",
  "goConnectAccount": "去連接帳戶",
  "goRecharge": "去儲值",
  "hint": {
    "NO_CREDENTIAL": "該檢索通道的憑據需要由部署管理員在伺服器端設定。"
  },
  "tab": {
    "retrieval": "外部檢索",
    "checks": "一致性校驗"
  },
  "kind": {
    "COMPANY": "公司",
    "LAW": "法規",
    "CASE": "案例",
    "DOC": "文件"
  },
  "entityKind": {
    "COMPANY": "公司",
    "LAW": "法規",
    "CASE": "案例",
    "DOC": "文件"
  },
  "openInNewTab": "在新分頁開啟",
  "openDocFile": "開啟檔案",
  "docNotFound": "專案中未找到該檔案",
  "docMissing": "檔案已不在專案中",
  "source": {
    "projectFile": "專案檔案",
    "qichacha": "企查查"
  },
  "mentions": "{count} 處",
  "mentionsTitle": "文中出處",
  "shareholders": "股東出資",
  "moreCandidates": "其餘候選",
  "caseSection": {
    "ascertain": "查明事實",
    "reason": "裁判理由",
    "result": "裁判結果",
    "gist": "裁判要旨",
    "fullText": "判決書全文"
  },
  "authoritative": "權威原文（北大法寶）",
  "implementDate": "施行日期 {date}",
  "recognition": "案號識別",
  "openInPkulaw": "在法寶開啟",
  "citation": {
    "citedText": "引用條文",
    "candidates": "按內容定位到的條文",
    "article": "第 {n} 條"
  },
  "severity": {
    "warn": "存疑",
    "error": "錯誤"
  },
  "unifyTo": "統一為 {value}",
  "cannotFix": "不能一鍵修改：{reason}",
  "fixNotUnique": "未能唯一定位，請手動修改。",
  "fixPartial": "已修改 {done} 處，另有 {failed} 處未能唯一定位，請手動修改。",
  "fixed": "已修改",
  "fixedHint": "可用 Cmd+Z 復原；重新解析可重新整理結論。",
  "noEditor": "請先啟用一個文件編輯視窗",
  "empty": {
    "noRun": "這份文件尚未線上核驗",
    "noRunHint": "日常寫作提示在本機進行。點擊上方線上核驗後，AI 才會通讀已儲存文件、抽取實體、查詢外部資料並檢查前後一致性。",
    "noEntity": "沒有抽到可檢索的實體",
    "noEntityHint": "文件裡沒有出現公司名、法規條號或案號。",
    "noFinding": "沒有發現前後矛盾",
    "noFindingHint": "數量陳述與統一社會信用代碼都校驗通過了。"
  }
}
