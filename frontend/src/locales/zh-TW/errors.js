// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "網路連線中斷，請求沒有送出。請檢查網路後點「重試」。",
  "timeout": "等待太久，服務沒有及時回應。請稍後重試；檔案較大時可以拆成幾份再處理。",
  "localServiceDown": "本機服務還沒準備好或已停止。請稍候幾秒；如果持續發生，請重新啟動 AI WorkDeck。",
  "signInRequired": "這項功能需要登入 AI WorkDeck 帳戶。登入後會自動回到這裡。",
  "sessionExpired": "登入已過期，請重新登入。尚未儲存的內容不會遺失。",
  "forbidden": "你沒有這項操作的權限。如需開通，請聯絡專案負責人或事務所管理員。",
  "balanceLow": "AI 額度已用完，這次沒有扣費。請到「設定 → 帳戶與餘額」儲值。",
  "rateLimited": "請求太頻繁，模型服務暫時限流。請等一分鐘再試。",
  "modelUnavailable": "所選模型暫時無法使用。請稍後重試，或在輸入框下方換一個模型。",
  "modelKeyInvalid": "這台電腦仍在使用舊版設定中的模型 Key，已被模型服務拒絕。請登入 AI WorkDeck 帳戶，改用官方 AI 通道。",
  "accountReconnect": "AI 帳戶連線需要重新整理，所以這一輪沒有送出。點「重新登入」重新整理連線後再試；不會遺失任何內容。",
  "streamInterrupted": "回答中途中斷了，已收到的內容保留在上方。點「重試」重新產生。",
  "streamInterruptedResumable": "回答中途中斷了，已收到的內容保留在上方。點「繼續」接著寫，或點「重試」重新產生。",
  "streamInterruptedTwice": "又中斷了。點「重試」重新產生整個回答。",
  "serverError": "服務出了點問題，這次操作沒有完成。請稍後重試；如果反覆發生，請點「回饋」告訴我們。",
  "conflict": "內容在別處被修改過，或上一個操作還沒結束。請重新整理後再試。",
  "fileTooLarge": "檔案太大，超過了上限 {limit}。請壓縮或拆分後再上傳。",
  "fileUnreadable": "這個檔案無法開啟，可能已損毀或設有密碼。請用原程式另存一份再試。",
  "notFound": "找不到這項內容，可能已被移動或刪除。請重新整理清單。",
  "marketplaceUnavailable": "暫時連不上外掛市集，已安裝的外掛不受影響。請檢查網路後點「重新整理」。",
  "pluginInstallFailed": "外掛「{name}」沒能安裝，你現有的內容沒有變化。請稍後重試；如果仍失敗，請點「回饋」並附上詳情。",
  "unknown": "操作沒有完成。請重試；如果反覆發生，請點「回饋」並附上詳情。",
  "actions": {
    "retry": "重試",
    "details": "詳情",
    "hideDetails": "收起詳情",
    "continue": "繼續",
    "continueTooltip": "從中斷處接著寫，不重新產生已有內容",
    "refresh": "重新整理",
    "signIn": "登入",
    "reconnect": "重新登入",
    "feedback": "回饋"
  }
}
