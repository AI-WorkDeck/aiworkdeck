// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 插件专属视觉标识（左侧栏 rail、主工作区标签栏、插件市场列表与详情页统一复用）。
//
// 设计原则：
// 1. 品牌型插件（如「包晴天 · 案源与笔记」）优先使用高辨识度的专属头像图片（avatarUrl）。
// 2. 工具/协作型插件（如「尽调报告」「项目沟通」「腾讯会议」）使用各自语义鲜明的线性 SVG 路径，
//    严禁让多个插件回退到同一把默认拼图/积木图标（dev-board#1276）。

import { ICONS } from './icons.js'

export const PLUGIN_AVATAR_URLS = Object.freeze({
  baoqingtian: '/static/icons/plugin-baoqingtian.png',
})

export const PLUGIN_GLYPH_MAP = Object.freeze({
  'project-im': ICONS.projectIm,
  'due-diligence': ICONS.dueDiligence,
  'tencent-meeting': ICONS.tmeet,
  tmeet: ICONS.tmeet,
  baoqingtian: ICONS.baoqingtian,
  voice: ICONS.audioLines,
  desensitize: ICONS.catCompliance,
  'litigation-visual': [
    'M3 17h18',
    'M7 17v-4',
    'M12 17V8',
    'M17 17v-7',
    'M7 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    'M17 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  ],
  'plugin-dev': ['M9 8l-5 4 5 4', 'M15 8l5 4-5 4', 'M13 5l-2 14'],
})

export function normalizePluginKey(rawId) {
  const s = String(rawId || '').trim().toLowerCase()
  if (!s) return ''
  return s.startsWith('plugin-') ? s.slice('plugin-'.length) : s
}

/**
 * 获取插件的专属头像 URL（若该插件以品牌头像呈现，如包晴天）。
 * @param {string} pluginId
 * @returns {string|null}
 */
export function getPluginAvatarUrl(pluginId) {
  const id = normalizePluginKey(pluginId)
  return PLUGIN_AVATAR_URLS[id] || null
}

/**
 * 获取插件的专属 SVG 路径数组（string[]）。
 * @param {string} pluginId
 * @returns {string[]}
 */
export function getPluginGlyphPaths(pluginId) {
  const id = normalizePluginKey(pluginId)
  return PLUGIN_GLYPH_MAP[id] || ICONS.blocks
}

/**
 * 获取供 left-rail 使用的 `{ d }[]` 结构。
 * @param {string} pluginId
 * @returns {{ d: string }[]}
 */
export function getPluginRailSvgPaths(pluginId) {
  return getPluginGlyphPaths(pluginId).map((d) => ({ d }))
}
