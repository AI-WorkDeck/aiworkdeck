// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// POLISH D21：JDK 21 的 CDS 归档按 dump 时的 class path 字符串校验，绝对路径不可搬迁
// （装到 /Applications 或换个安装目录就失效）。所以 dump 和运行都用同一个相对前缀
// .awd-backend/lib/*，在各自的 cwd 下放一个同名链接指向 resources/backend：
// mac/Linux 是符号链接，Windows 是目录联接（junction，不需要管理员权限）。
// 运行时 cwd 仍是数据目录，后端一切相对路径的解析不变。
const fs = require('fs')
const path = require('path')

const LINK_NAME = '.awd-backend'

/**
 * 确保 <dir>/.awd-backend 指向 target（每次启动调用；应用被搬走后会重新指过去）。
 * 返回链接路径；建不了（同名的真实目录/文件、权限问题）返回 null，调用方退回不带归档启动。
 */
function ensureBackendLink(dir, target) {
  const link = path.join(dir, LINK_NAME)
  try {
    fs.mkdirSync(dir, { recursive: true })
    let st = null
    try { st = fs.lstatSync(link) } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (st && !st.isSymbolicLink()) return null // 不是我们建的：不动它
    if (st) {
      let current = null
      try { current = fs.realpathSync(link) } catch (e) { /* 悬空：旧安装位置已不存在 */ }
      if (current === fs.realpathSync(target)) return link
      fs.unlinkSync(link)
    }
    fs.symlinkSync(target, link, 'junction') // 'junction' 只在 Windows 生效，其他平台忽略
    return link
  } catch (e) {
    return null
  }
}

module.exports = { LINK_NAME, ensureBackendLink }
