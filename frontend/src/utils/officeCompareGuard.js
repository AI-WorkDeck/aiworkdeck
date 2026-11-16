// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 版本比对 / 三方合并的入口守卫：这两条路径用隐藏引擎直接装后端字节，带打开密码的
// Office 文件在那里只会被引擎安全拒收，用户看到的是笼统的「生成失败」。入口先判，
// 抛带稳定错误码的异常，由界面层换成明确的本地化说明。
// 这里只读字节头、不解密、不落盘——明文永远不会出现。
import { isPasswordProtectedOffice, DIAG_DOC_ENCRYPTED } from './editorLoadFailure.js'
import { detectLegacyEncryption } from './legacyOfficeDecrypt.js'

/**
 * 任一份字节带打开密码就抛 Error{code:'DOC_ENCRYPTED'}。
 * @param {string} path 文件路径/名（取扩展名判定格式）
 * @param {...(Uint8Array|ArrayBuffer|null|undefined)} byteLists 参与比对/合并的各版本字节
 */
export function assertNotPasswordProtected(path, ...byteLists) {
  for (const bytes of byteLists) {
    if (bytes && isPasswordProtectedOffice(bytes, path, detectLegacyEncryption)) {
      throw Object.assign(new Error('document is password protected'), { code: DIAG_DOC_ENCRYPTED })
    }
  }
}

/** 界面层用：是不是上面抛的那种错。 */
export function isPasswordProtectedError(e) {
  return !!e && e.code === DIAG_DOC_ENCRYPTED
}
