// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 服务端写进数据里的几个固定中文标签（账户桥接建的设备名、客户邀请模板账号的显示名、记忆空间的
// 默认名），在非中文界面里按界面语言显示——只在显示时翻译，存着的数据一个字不改（审计日志要保持
// 原样）。只认这几个固定写法，别的文字原样返回（项目名、律师起的名字不翻）。
const KNOWN = {
  '账户桥接': 'common.serverLabelAccountBridge',
  '客户(通用)': 'common.serverLabelGenericClient',
  '客户（通用）': 'common.serverLabelGenericClient',
  '个人记忆': 'common.serverLabelPersonalMemory',
  '项目记忆': 'common.serverLabelProjectMemory',
}

/** @param {Function} t  $t  @param {string} text 服务端给的标签 */
export function displayServerLabel(t, text) {
  if (text == null) return text
  const key = KNOWN[String(text).trim()]
  return key ? t(key) : text
}
