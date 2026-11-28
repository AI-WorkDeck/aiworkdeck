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
// 归档还校验每个 jar 的 mtime（秒）。Windows 安装包的 7z 不存 mtime（electron-builder 用
// -mtm=off 求可复现），装出来的 jar 都是解压时刻，归档必然失效。所以构建时把 lib/*.jar 的
// mtime 统一成这个常量再 dump，运行时把对不上的改回来（Windows 是按用户安装，目录可写）。
const LIB_MTIME_SEC = 1577836800 // 2020-01-01T00:00:00Z

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

/**
 * 把 libDir 下 mtime 不是 LIB_MTIME_SEC 的 jar 改回去（mac 安装保留 mtime，通常什么都不改；
 * Windows 装完首启改一遍）。全部对齐返回 true；任何一个改不了返回 false，调用方不带归档启动。
 */
function alignLibMtimes(libDir) {
  try {
    for (const name of fs.readdirSync(libDir)) {
      if (!name.endsWith('.jar')) continue
      const file = path.join(libDir, name)
      if (Math.floor(fs.statSync(file).mtimeMs / 1000) !== LIB_MTIME_SEC) fs.utimesSync(file, LIB_MTIME_SEC, LIB_MTIME_SEC)
    }
    return true
  } catch (e) {
    return false
  }
}

module.exports = { LINK_NAME, LIB_MTIME_SEC, ensureBackendLink, alignLibMtimes }
