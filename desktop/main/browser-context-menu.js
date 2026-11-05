// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 浏览器面板（BrowserView）的右键菜单模板（问题 68）。自定义菜单会整个替换掉系统菜单，
// 所以基础项（复制 / 全选，可编辑区再加剪切 / 粘贴）要自己补齐；没选中文字也给基础菜单。
// 动作直接打在该 BrowserView 的 webContents 上，不依赖焦点在谁身上。

function browserContextMenuTemplate(params, { t, wc, onWebmark }) {
  const p = params || {}
  const flags = p.editFlags || {}
  const hasSelection = !!String(p.selectionText || '').trim()
  const items = []
  if (p.isEditable) {
    items.push({ label: t({ zh: '剪切', en: 'Cut' }), enabled: !!flags.canCut, click: () => wc.cut() })
  }
  items.push({ label: t({ zh: '复制', en: 'Copy' }), enabled: hasSelection || !!flags.canCopy, click: () => wc.copy() })
  if (p.isEditable) {
    items.push({ label: t({ zh: '粘贴', en: 'Paste' }), enabled: flags.canPaste !== false, click: () => wc.paste() })
  }
  items.push({ label: t({ zh: '全选', en: 'Select All' }), click: () => wc.selectAll() })
  if (hasSelection) {
    items.push({ type: 'separator' })
    items.push({ label: t({ zh: '加入网核收藏', en: 'Save as Web Evidence' }), click: onWebmark })
  }
  return items
}

module.exports = { browserContextMenuTemplate }
