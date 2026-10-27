// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "按章節",
    "byParty": "按主體"
  },
  "filter": {
    "allSections": "全部章節",
    "allParties": "全部主體"
  },
  "stat": {
    "total": "共 {count} 條"
  },
  "status": {
    "all": "全部",
    "active": "正常",
    "unverified": "待核",
    "stale": "已變",
    "orphan": "失聯"
  },
  "group": {
    "none": "未歸屬",
    "untitled": "（無章節）"
  },
  "action": {
    "keep": "保留關聯",
    "rebind": "重新指定",
    "confirmRebind": "確認指定",
    "cancelRebind": "取消",
    "delete": "刪除",
    "removeTarget": "移除",
    "open": "查看底稿",
    "ignore": "忽略",
    "expand": "展開",
    "collapse": "收起"
  },
  "method": {
    "written_review": "書面審查",
    "written_statement": "書面說明",
    "web_check": "網絡核查",
    "third_party": "第三方材料",
    "interview": "訪談",
    "none": "未標方法"
  },
  "relation": {
    "supports": "支持",
    "contradicts": "矛盾",
    "partial": "部分支持"
  },
  "loc": {
    "wholeFile": "整個文件",
    "page": "第 {page} 頁",
    "quote": "「{quote}」",
    "region": "圖中區域",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "這份文檔還沒有關聯底稿",
  "emptyHint": "把文件從左側目錄拖到選中的文字上即可建立關聯",
  "emptyFiltered": "沒有符合篩選條件的關聯",
  "fileMissing": "（文件已不存在）",
  "fileDeleted": "（已移入回收站）",
  "targetsCount": "{count} 份底稿",
  "rebindHint": "在文檔里選中新的文字，然後點「確認指定」",
  "rebindNoSelection": "請先在文檔里選中文字",
  "rebindFailed": "重新指定失敗",
  "rebindRetryHint": "新書簽已在文檔里，再點一次「確認指定」即可重試。",
  "keepGone": "這段文字已不在文檔里，不能保留關聯；請在底稿頁「重新指定」。",
  "orphanGoto": "這段文字的錨點已不在文檔里，請點「重新指定」選擇新的文字。",
  "confidence": "置信 {value}",
  "loading": "載入中…",
  "loadFailed": "加載關聯失敗",
  "fileTagsLoadFailed": "加載主體標籤失敗，「按主體」視圖可能不準確",
  "opFailed": "操作未成功",
  "deleteConfirm": "刪除這條關聯？底稿文件不會被刪除。",
  "deleteTargetConfirm": "移除這份底稿？",
  "staleOne": "這段文字有 {count} 份底稿，文字已改動",
  "staleMany": "{count} 段文字已改動",
  "stalePrefix": "已改動："
}
