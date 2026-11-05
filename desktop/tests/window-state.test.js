// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 问题 18：窗口大小 / 位置 / 最大化不记住，每次启动都回到 1400×900。
// 恢复时必须仍落在某块显示器上（拔掉外接屏后不能把窗口放到看不见的地方）。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ws = require('../main/window-state')

const laptop = { workArea: { x: 0, y: 25, width: 1440, height: 875 } }
const external = { workArea: { x: 1440, y: 0, width: 2560, height: 1415 } }
const fallback = { width: 1400, height: 875 }

test('没有记录 / 记录损坏：用默认尺寸，不给坐标', () => {
  assert.deepEqual(ws.restoreWindowOptions(null, [laptop], fallback), { bounds: fallback, maximized: false })
  assert.deepEqual(ws.restoreWindowOptions({ x: 'a', y: 0, width: 10, height: 10 }, [laptop], fallback), { bounds: fallback, maximized: false })
})

test('记录仍在某块显示器上：原样恢复位置、大小与最大化', () => {
  const saved = { x: 1600, y: 100, width: 1800, height: 1000, maximized: true }
  assert.deepEqual(ws.restoreWindowOptions(saved, [laptop, external], fallback),
    { bounds: { x: 1600, y: 100, width: 1800, height: 1000 }, maximized: true })
})

test('外接屏拔掉后记录落在屏幕外：退回默认，不恢复坐标', () => {
  const saved = { x: 1600, y: 100, width: 1800, height: 1000, maximized: false }
  assert.deepEqual(ws.restoreWindowOptions(saved, [laptop], fallback), { bounds: fallback, maximized: false })
})

test('标题栏露不出来（窗口顶到屏幕下沿外）也算不可见', () => {
  const saved = { x: 100, y: 890, width: 800, height: 600 }
  assert.deepEqual(ws.restoreWindowOptions(saved, [laptop], fallback).bounds, fallback)
})

test('大小超过所在显示器工作区时夹回去', () => {
  const saved = { x: 0, y: 25, width: 2560, height: 1415 }
  assert.deepEqual(ws.restoreWindowOptions(saved, [laptop], fallback).bounds, { x: 0, y: 25, width: 1440, height: 875 })
})

test('最大化 / 全屏时记下的是还原尺寸', () => {
  const win = {
    isMaximized: () => true, isFullScreen: () => false, isMinimized: () => false,
    getBounds: () => ({ x: 0, y: 25, width: 1440, height: 875 }),
    getNormalBounds: () => ({ x: 50, y: 60, width: 1200, height: 800 }),
  }
  assert.deepEqual(ws.captureWindowState(win), { x: 50, y: 60, width: 1200, height: 800, maximized: true })
})

test('main.js 建窗时读记录、关闭与退出前写记录', () => {
  const src = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
  assert.match(src, /restoreWindowOptions\(/)
  assert.match(src, /screen\.getAllDisplays\(\)/)
  assert.match(src, /captureWindowState\(/)
  const beforeQuit = src.slice(src.indexOf("app.on('before-quit'"))
  assert.ok(beforeQuit.indexOf('saveMainWindowState()') >= 0 && beforeQuit.indexOf('saveMainWindowState()') < beforeQuit.indexOf('hideAllWindowsForQuit()'))
})
