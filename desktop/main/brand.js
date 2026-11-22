// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// brand.js — 主进程读品牌配置的唯一出口（rfcs/2026-11-21-brand-profile.md）。
//
// brand.json 由 scripts/brand/apply-brand.mjs 写出，入库内容为默认品牌 aiworkdeck；
// 贴牌构建前被覆盖。这里只读、不推断：缺字段说明 apply-brand 没跑或配置坏了，直接用默认品牌兜底。
const DEFAULT_ID = 'aiworkdeck'

let cached = null

function brand() {
  if (cached) return cached
  cached = Object.freeze(require('./brand.json'))
  return cached
}

/** 是否贴牌构建（非默认品牌）。默认品牌的一切行为必须与引入品牌配置之前逐字一致。 */
function isWhiteLabel() {
  return brand().id !== DEFAULT_ID
}

module.exports = { brand, isWhiteLabel, DEFAULT_ID }
