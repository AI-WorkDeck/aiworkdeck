// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "依據",
  "noDoc": "未打開文檔",
  "parse": "全文在線核驗（可能產生費用）",
  "reparse": "再次全文在線核驗（可能產生費用）",
  "onlineHint": "點擊後先保存當前文檔，再在線核驗已保存版本。AI 與外部檢索可能產生費用。",
  "saveRequired": "當前文檔未能完成保存，請保存成功後再在線核驗。",
  "running": "正在在線核驗…",
  "done": "在線核驗完成",
  "failed": "在線核驗失敗",
  "loading": "載入中…",
  "loadingDetail": "正在取檢索詳情…",
  "noDetail": "這一條沒有檢索詳情",
  "loadFailed": "讀取在線核驗結果失敗",
  "parseFailed": "發起在線核驗失敗",
  "detailFailed": "取檢索詳情失敗",
  "refreshFailed": "重新檢索失敗",
  "retry": "重試",
  "goConnectAccount": "去連接賬戶",
  "goRecharge": "去充值",
  "hint": {
    "NO_CREDENTIAL": "該檢索通道的憑據需要由部署管理員在服務端配置。"
  },
  "tab": {
    "retrieval": "外部檢索",
    "checks": "一致性校驗"
  },
  "kind": {
    "COMPANY": "公司",
    "LAW": "法規",
    "CASE": "案例",
    "DOC": "文檔"
  },
  "entityKind": {
    "COMPANY": "公司",
    "LAW": "法規",
    "CASE": "案例",
    "DOC": "文檔"
  },
  "openInNewTab": "在新標籤頁打開",
  "openDocFile": "打開文件",
  "docNotFound": "項目中未找到該文件",
  "docMissing": "文件已不在項目中",
  "source": {
    "projectFile": "項目文件",
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
  "openInPkulaw": "在法寶打開",
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
  "fixedHint": "可用 Cmd+Z 撤銷；重新解析可刷新結論。",
  "noEditor": "請先激活一個文檔編輯窗口",
  "empty": {
    "noRun": "這份文檔尚未在線核驗",
    "noRunHint": "日常寫作提示在本地進行。點擊上方在線核驗後，AI 才會通讀已保存文檔、抽取實體、查詢外部資料並檢查前後一致性。",
    "noEntity": "沒有抽到可檢索的實體",
    "noEntityHint": "文檔里沒有出現公司名、法規條號或案號。",
    "noFinding": "沒有發現前後矛盾",
    "noFindingHint": "數量陳述與統一社會信用代碼都校驗通過了。"
  }
}
