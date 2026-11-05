// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// awd-home.js — 本机数据目录的唯一来源，以及隔离实例开关 AWD_HOME（问题 20，dev-board#1713）。
//
// 不设 AWD_HOME：数据目录 = <home>/.aiworkdeck，home 取 Electron 的 app.getPath('home')
// （macOS 上它不认 $HOME），行为与以前完全一样。
// 设了 AWD_HOME=<目录>：它就是这个实例的「家」——
//   数据目录      <AWD_HOME>/.aiworkdeck（prefs/overlay/logs/packs/models/H2 库…）
//   Electron 的 userData  <AWD_HOME>/userdata（命令行显式给了 --user-data-dir 时以命令行为准）
//   后端 JVM      -Duser.home=<AWD_HOME>（后端所有 ${user.home}/.aiworkdeck 自然跟过来）
//   子进程        HOME / USERPROFILE=<AWD_HOME>
// 主进程自己的 os.homedir() 不改：废纸篓保护、完全磁盘访问探测、用户字体目录说的都是真实主目录。
const path = require('path')
const os = require('os')

function awdHome(env = process.env) {
  const v = String((env && env.AWD_HOME) || '').trim()
  return v ? path.resolve(v) : null
}

function homeDir(env = process.env) {
  const h = awdHome(env)
  if (h) return h
  try {
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') return app.getPath('home')
  } catch (e) { /* 纯 node（单测）下没有 app */ }
  return os.homedir()
}

/** 本机数据目录（原 ~/.aiworkdeck）。所有派生路径都从这里取。 */
function dataDir(env = process.env) {
  return path.join(homeDir(env), '.aiworkdeck')
}

/**
 * 设了 AWD_HOME 且没显式给 --user-data-dir 时，把 userData 落到 <AWD_HOME>/userdata。
 * 必须在 requestSingleInstanceLock 之前调用（单实例锁按 userData 判重）。
 * @returns {string|null} 设置的 userData 目录；未设置返回 null
 */
function applyUserData(app, env = process.env, argv = process.argv) {
  const h = awdHome(env)
  if (!h) return null
  if ((argv || []).some((a) => /^--user-data-dir(=|$)/.test(String(a)))) return null
  const dir = path.join(h, 'userdata')
  app.setPath('userData', dir)
  return dir
}

/** 子进程环境：设了 AWD_HOME 时 HOME / USERPROFILE 指过去；否则原样返回。 */
function childEnv(env, home = awdHome()) {
  if (!home) return env
  return { ...env, HOME: home, USERPROFILE: home }
}

module.exports = { awdHome, homeDir, dataDir, applyUserData, childEnv }
