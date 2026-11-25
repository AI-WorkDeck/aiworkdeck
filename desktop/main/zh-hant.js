// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X-S2 / X5: native menus, the About window and shell dialogs were Simplified for zh-TW users,
// because t() fell back to the zh string. Convert with the backend's table (zh-hant-table.json,
// generated from ZhHantConverter.java by scripts/gen-zh-hant.js) — phrase first, then
// character — plus the Taiwan wording of macOS/Windows shell terms, which a character map
// cannot produce (退出→結束, 窗口→視窗, 最小化→縮到最小 …).
const TABLE = require('./zh-hant-table.json')

// Shell vocabulary (longest first). These follow the Traditional-Chinese macOS menus.
const SHELL_PHRASES = [
  ['前置全部窗口', '全部移到最前'],
  ['文件夹', '資料夾'],
  // 必须排在「退出→結束」之前：退出登录是「登出」，不是「結束登入」
  ['退出登录', '登出'],
  ['日志', '日誌'],
  ['浏览器标签', '瀏覽器分頁'],
  ['隐私与安全性', '隱私權與安全性'],
  ['完全磁盘访问权限', '完整磁碟取用權限'],
  ['录屏与系统录音', '螢幕錄製與系統錄音'],
  ['粘贴并匹配样式', '貼上並符合樣式'],
  ['开发者工具', '開發者工具'],
  ['偏好设置', '偏好設定'],
  ['系统设置', '系統設定'],
  ['辅助功能', '輔助使用'],
  ['源代码', '原始碼'],
  ['重新加载', '重新載入'],
  ['界面', '介面'],
  ['标签页', '分頁'],
  ['最小化', '縮到最小'],
  ['全屏', '全螢幕'],
  ['屏幕', '螢幕'],
  ['麦克风', '麥克風'],
  ['图标', '圖像'],
  ['关于', '關於'],
  ['隐藏', '隱藏'],
  ['退出', '結束'],
  ['窗口', '視窗'],
  ['视图', '檢視'],
  ['帮助', '說明'],
  ['撤销', '還原'],
  ['剪切', '剪下'],
  ['单击', '按一下'],
  ['点击', '按一下'],
  ['打开', '開啟'],
  ['保存', '儲存'],
  ['文件', '檔案'],
  // 必须排在「文件→檔案」之后：大陆的「文档」在台湾叫「文件」
  ['文档', '文件'],
  ['新建', '新增'],
  ['项目', '專案'],
  ['反馈', '意見回饋'],
  ['当前', '目前'],
  ['转到', '前往'],
  ['快捷键', '快速鍵'],
  ['分屏', '分割畫面'],
  ['加载', '載入'],
  ['镜像', '鏡像'],
]

const PHRASES = [...SHELL_PHRASES, ...TABLE.phrases]

function toTraditional(text) {
  if (!text) return text
  let s = String(text)
  for (const [from, to] of PHRASES) if (s.includes(from)) s = s.split(from).join(to)
  let out = ''
  for (const ch of s) out += TABLE.chars[ch] || ch
  return out
}

module.exports = { toTraditional, SHELL_PHRASES }
